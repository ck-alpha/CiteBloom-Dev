import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentToolRegistry } from "../src/agent/tools/registry";
import { createRecommendationFeedbackTool } from "../src/agent/tools/recommendation/recommendationFeedback";
import type { AgentToolContext } from "../src/agent/types";
import type { RecommendationCandidate } from "../src/recommendation/domain/candidate";
import {
  SqliteFeedbackStore,
  SqliteImpressionStore,
} from "../src/recommendation/feedback/stores";
import { RecommendationFeedbackService } from "../src/recommendation/feedback/service";
import { ProfileService } from "../src/recommendation/profile/profileService";
import {
  PROFILE_TABLE,
  ProfileVersionConflict,
  SqliteProfileStore,
} from "../src/recommendation/profile/profileStore";
import { RankingService } from "../src/recommendation/ranking/rankingService";
import { ResearchProfileTestDb } from "./helpers/researchProfileDb";
import { paperSignal } from "./helpers/researchProfileFixtures";
import { resolvedAgentRequest } from "./helpers/resolvedAgentRequest";

// Authored synthetic contract data, not historical human feedback or API output.
const now = Date.UTC(2026, 9, 18);
const training = [
  paperSignal(1, {
    title: "Agents for research discovery",
    abstract: "Agents discover related research using library interests.",
    manualTags: ["Agents"],
    addedAt: now,
    modifiedAt: now,
  }),
  paperSignal(2, {
    title: "Recommendation systems with user profiles",
    abstract: "Recommendation systems use library topics to rank papers.",
    manualTags: ["Recommendation systems"],
    addedAt: now,
    modifiedAt: now,
  }),
];
const candidates: RecommendationCandidate[] = [
  "Agents for personalized research discovery",
  "Recommendation systems for academic libraries",
].map((title, index) => ({
  candidateId: `synthetic-contract:${index}`,
  title,
  abstract: title,
  authors: [],
  // MOCK PROVIDER solely for the existing typed domain contract.
  provenance: [
    {
      route: "profile_query",
      provider: "openalex",
      providerRank: index + 1,
      query: "synthetic contract fixture; no API request",
    },
  ],
  sources: ["profile_query"],
  scores: {},
}));

function services(db: ResearchProfileTestDb) {
  const profiles = new SqliteProfileStore(() => db);
  const impressions = new SqliteImpressionStore(() => db);
  const events = new SqliteFeedbackStore(() => db);
  const feedback = new RecommendationFeedbackService(
    profiles,
    impressions,
    events,
  );
  const profileService = new ProfileService(
    profiles,
    {
      getLibrarySnapshot: async (libraryID) => ({
        libraryID,
        papers: training,
      }),
    },
    undefined,
    () => now,
    undefined,
    feedback.replay,
  );
  return { profiles, impressions, events, feedback, profileService };
}

async function expose(db: ResearchProfileTestDb) {
  const service = services(db);
  const { profile, status } = await service.profileService.get(1);
  assert.equal(status, "built");
  assert.equal(profile.signalSummary.libraryPaperCount, training.length);
  const ranked = await new RankingService().rank({
    profile,
    candidates,
    now,
    topK: 2,
  });
  assert.isTrue(ranked.diagnostics.semanticFallback);
  const recommendationId = "synthetic-sqlite-lifecycle";
  await service.impressions.save({
    recommendationId,
    profileId: profile.profileId,
    profileVersion: profile.version,
    timestamp: now,
    topicSnapshot: profile.topics.map(({ id, label }) => ({ id, label })),
    candidates: ranked.recommendations,
  });
  const candidate = ranked.recommendations.find(
    (paper) => paper.matchedTopicIds.length > 0,
  )!;
  assert.isOk(
    candidate,
    "controlled positive feedback must have a matched topic",
  );
  return {
    ...service,
    profile,
    ranked,
    input: {
      libraryID: 1,
      recommendationId,
      candidateId: candidate.candidateId,
      action: "positive" as const,
      timestamp: now,
    },
  };
}

describe("CiteBloom offline SQLite feedback lifecycle (synthetic contract)", function () {
  let directory: string;
  let path: string;
  let db: ResearchProfileTestDb;
  beforeEach(function () {
    directory = mkdtempSync(join(tmpdir(), "citebloom-feedback-"));
    path = join(directory, "memory.sqlite");
    db = new ResearchProfileTestDb(path);
  });
  afterEach(function () {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("builds from training, persists exposure and positive feedback, reranks, then reconnects and deduplicates", async function () {
    const initial = await expose(db);
    const recorded = await initial.feedback.submit(initial.input);
    assert.equal(recorded.status, "recorded");
    assert.equal(recorded.newProfileVersion, initial.profile.version + 1);
    assert.isTrue(recorded.profileUpdated);
    const updated = (await initial.profiles.load(initial.profile.profileId))!;
    assert.equal(updated.signalSummary.positiveFeedbackCount, 1);
    assert.isTrue(
      updated.topics.some((topic) => topic.sources.includes("feedback")),
    );
    assert.deepEqual(
      updated.representativePapers,
      initial.profile.representativePapers,
    );
    const reranked = await new RankingService().rank({
      profile: updated,
      candidates,
      now,
      topK: 2,
    });
    assert.equal(reranked.profileVersion, updated.version);
    assert.lengthOf(reranked.recommendations, 2);
    // Stable Top-K is valid; this contract does not measure relevance uplift.
    const savedImpression = await initial.impressions.load(
      initial.input.recommendationId,
    );
    const replay = await initial.feedback.replay.loadForProfile(
      updated.profileId,
      now,
    );

    db.close();
    db = new ResearchProfileTestDb(path);
    const reopened = services(db);
    const loaded = await reopened.profileService.get(1);
    assert.equal(loaded.status, "loaded");
    assert.deepEqual(loaded.profile, updated);
    assert.deepEqual(
      await reopened.impressions.load(initial.input.recommendationId),
      savedImpression,
    );
    assert.deepEqual(
      await reopened.feedback.replay.loadForProfile(updated.profileId, now),
      replay,
    );
    const retry = await reopened.feedback.submit({
      ...initial.input,
      timestamp: now + 1000,
    });
    assert.equal(retry.status, "already_recorded");
    assert.isFalse(retry.profileUpdated);
    assert.equal(retry.newProfileVersion, updated.version);
    assert.lengthOf(await reopened.events.list(), 1);
    assert.deepEqual(await reopened.profiles.load(updated.profileId), updated);
    assert.deepEqual(
      await new RankingService().rank({
        profile: loaded.profile,
        candidates,
        now,
        topK: 2,
      }),
      reranked,
    );
  });

  it("denied real tool confirmation writes neither feedback nor a profile revision, including after reconnect", async function () {
    const initial = await expose(db);
    const registry = new AgentToolRegistry();
    registry.register(
      createRecommendationFeedbackTool(initial.feedback, () => now),
    );
    const context: AgentToolContext = {
      request: resolvedAgentRequest({
        conversationKey: 1,
        mode: "agent",
        userText: "Controlled positive feedback",
        libraryID: 1,
      }),
      item: null,
      currentAnswerText: "",
      modelName: "",
    };
    const prepared = await registry.prepareExecution(
      {
        id: "controlled-feedback",
        name: "recommendation_feedback",
        arguments: {
          recommendationId: initial.input.recommendationId,
          candidateId: initial.input.candidateId,
          action: "positive",
        },
      },
      context,
    );
    assert.equal(prepared.kind, "confirmation");
    if (prepared.kind !== "confirmation")
      throw new Error("Expected confirmation");
    assert.isFalse(prepared.deny().result.ok);
    assert.lengthOf(await initial.events.list(), 0);
    db.close();
    db = new ResearchProfileTestDb(path);
    const reopened = services(db);
    assert.lengthOf(await reopened.events.list(), 0);
    assert.deepEqual(
      await reopened.profiles.load(initial.profile.profileId),
      initial.profile,
    );
    assert.isNotNull(
      await reopened.impressions.load(initial.input.recommendationId),
    );
  });

  it("rejects cross-library scope and an absent exposure member without modifying durable state", async function () {
    const initial = await expose(db);
    await rejects(
      initial.feedback.submit({ ...initial.input, libraryID: 2 }),
      /relation/,
    );
    await rejects(
      initial.feedback.submit({ ...initial.input, candidateId: "not-exposed" }),
      /relation/,
    );
    assert.lengthOf(await initial.events.list(), 0);
    assert.deepEqual(
      await initial.profiles.load(initial.profile.profileId),
      initial.profile,
    );
  });

  it("replays an event left by a failed profile write after reconnect and rejects an actual stale SQLite revision", async function () {
    const initial = await expose(db);
    db.failWhen = (sql) => sql.includes(`UPDATE ${PROFILE_TABLE}`);
    const pending = await initial.feedback.submit(initial.input);
    assert.equal(pending.status, "recorded");
    assert.isFalse(pending.profileUpdated);
    assert.include(pending.warnings, "feedback_profile_reconcile_required");
    assert.lengthOf(await initial.events.list(), 1);
    assert.deepEqual(
      await initial.profiles.load(initial.profile.profileId),
      initial.profile,
    );

    db.close();
    db = new ResearchProfileTestDb(path);
    const reopened = services(db);
    const recovered = await reopened.feedback.submit(initial.input);
    assert.equal(recovered.status, "already_recorded");
    assert.isTrue(recovered.profileUpdated);
    assert.equal(recovered.newProfileVersion, initial.profile.version + 1);
    const updated = (await reopened.profiles.load(initial.profile.profileId))!;
    await rejects(
      reopened.profiles.save(updated, initial.profile.version),
      ProfileVersionConflict,
    );
    const retry = await reopened.feedback.submit(initial.input);
    assert.equal(retry.status, "already_recorded");
    assert.isFalse(retry.profileUpdated);
    assert.lengthOf(await reopened.events.list(), 1);
    assert.deepEqual(
      await reopened.profiles.load(initial.profile.profileId),
      updated,
    );
  });
});
