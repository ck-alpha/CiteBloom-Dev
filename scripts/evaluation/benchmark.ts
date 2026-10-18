import { ProfileBuilder } from "../../src/recommendation/profile/profileBuilder";
import type { ResearchLibrarySnapshot } from "../../src/recommendation/profile/contracts";
import type { RecommendationCandidate } from "../../src/recommendation/domain/candidate";
import type { RecommendedPaper } from "../../src/recommendation/domain/recommendation";
import { RankingService } from "../../src/recommendation/ranking/rankingService";
import { resolveRankingConfig } from "../../src/recommendation/ranking/config";
import { computeFeatures } from "../../src/recommendation/ranking/features";
import { compareText } from "../../src/recommendation/ranking/textSimilarity";
import { RecommendationEvidenceService } from "../../src/recommendation/evidence/evidenceService";
import {
  rankingMetrics,
  evidenceMetrics,
} from "../../src/recommendation/evaluation/metrics";
import type {
  EvidenceMetrics,
  RankingMetrics,
  RecommendationEvaluationCase,
} from "../../src/recommendation/evaluation/contracts";
import type { ParsedDataset, DatasetItem } from "./parser";
import { sha256 } from "./dataset";

export const METHOD_NAMES = [
  "Popularity",
  "Content / Lexical",
  "CiteBloom Full (Offline)",
  "CiteBloom lambda=1",
] as const;
type MethodName = (typeof METHOD_NAMES)[number];
export interface BenchmarkConfig {
  seed: number;
  users: number;
  unlabeled: number;
  minInteractions: number;
  testFraction: number;
  topK: number;
}
export const DEFAULT_CONFIG: BenchmarkConfig = {
  seed: 20261018,
  users: 100,
  unlabeled: 200,
  minInteractions: 10,
  testFraction: 0.2,
  topK: 5,
};
export interface UserSplit {
  userId: number;
  train: number[];
  test: number[];
}

/** Mulberry32 with SHA-256 derived independent streams, not Math.random(). */
export function seededShuffle<T>(
  values: readonly T[],
  seed: number,
  scope: string,
): T[] {
  const result = [...values];
  let state = Number.parseInt(sha256(`${seed}:${scope}`).slice(0, 8), 16) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function splitUsers(
  dataset: ParsedDataset,
  config: BenchmarkConfig,
): UserSplit[] {
  const eligible = dataset.users.flatMap((items, userId) =>
    items.length >= config.minInteractions ? [userId] : [],
  );
  return seededShuffle(eligible, config.seed, "users")
    .slice(0, config.users)
    .map((userId) => {
      const shuffled = seededShuffle(
        dataset.users[userId],
        config.seed,
        `split:${userId}`,
      );
      const testCount = Math.max(
        2,
        Math.floor(shuffled.length * config.testFraction),
      );
      return {
        userId,
        train: shuffled.slice(testCount).sort((a, b) => a - b),
        test: shuffled.slice(0, testCount).sort((a, b) => a - b),
      };
    });
}

export function candidatePool(
  dataset: ParsedDataset,
  split: UserSplit,
  config: BenchmarkConfig,
): number[] {
  const interacted = new Set([...split.train, ...split.test]);
  const unlabeled = seededShuffle(
    dataset.items.map((item) => item.id).filter((id) => !interacted.has(id)),
    config.seed,
    `pool:${split.userId}`,
  ).slice(0, config.unlabeled);
  return [...split.test, ...unlabeled].sort((a, b) => a - b);
}

const candidateId = (id: number) => `citeulike-a:item:${id}`;
/** The production contract requires a provider: explicitly MOCK, never an API trace. */
export function toCandidate(item: DatasetItem): RecommendationCandidate {
  return {
    candidateId: candidateId(item.id),
    title: item.title,
    abstract: item.abstract,
    authors: [],
    provenance: [
      {
        route: "profile_query",
        provider: "openalex",
        providerRank: item.id + 1,
        query:
          "MOCK PROVIDER: CiteULike-a local oracle pool; no OpenAlex request",
      },
    ],
    sources: ["profile_query"],
    scores: {},
  };
}

export function toSnapshot(
  dataset: ParsedDataset,
  split: UserSplit,
): ResearchLibrarySnapshot {
  return {
    libraryID: split.userId + 1,
    papers: split.train.map((id) => {
      const item = dataset.items[id];
      return {
        itemId: candidateId(id),
        title: item.title,
        abstract: item.abstract,
        authors: [],
        manualTags: [...item.tags],
        automaticTags: [],
        collectionPaths: [],
        // Missing history times: common neutral technical placeholder, not recency data.
        addedAt: 0,
        modifiedAt: 0,
      };
    }),
  };
}

export function trainPopularity(
  splits: readonly UserSplit[],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const split of splits)
    for (const id of split.train) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
export function auditSplitAndPool(
  split: UserSplit,
  pool: readonly number[],
): void {
  const train = new Set(split.train);
  if (
    train.size !== split.train.length ||
    new Set(split.test).size !== split.test.length
  )
    throw new Error("Duplicate interaction in split");
  if (split.test.some((id) => train.has(id)))
    throw new Error("Train/test leakage");
  if (new Set(pool).size !== pool.length)
    throw new Error("Duplicate candidate ID");
  if (pool.some((id) => train.has(id)))
    throw new Error("Training item in candidate pool");
  if (split.test.some((id) => !pool.includes(id)))
    throw new Error("Oracle pool lost held-out item");
}

export function macroAverage(
  rows: readonly Record<string, number | null>[],
): Record<string, number | null> {
  if (!rows.length) throw new Error("Cannot macro-average empty results");
  return Object.fromEntries(
    Object.keys(rows[0]).map((key) => {
      const values = rows.map((row) => row[key]);
      return [
        key,
        values.some((value) => value === null)
          ? null
          : (values as number[]).reduce((sum, value) => sum + value, 0) /
            values.length,
      ];
    }),
  );
}

function validateConfig(config: BenchmarkConfig): void {
  for (const name of [
    "seed",
    "users",
    "unlabeled",
    "minInteractions",
    "topK",
  ] as const)
    if (
      !Number.isSafeInteger(config[name]) ||
      config[name] < (name === "seed" ? 0 : 1)
    )
      throw new Error(`Invalid benchmark ${name}`);
  if (
    config.users > 500 ||
    config.unlabeled > 2000 ||
    config.topK > 20 ||
    config.minInteractions < 10 ||
    config.testFraction !== 0.2
  )
    throw new Error(
      "Bounded protocol requires users<=500, unlabeled<=2000, topK<=20, minInteractions>=10 and testFraction=0.2",
    );
}

export async function benchmark(
  dataset: ParsedDataset,
  config: BenchmarkConfig,
) {
  validateConfig(config);
  const started = performance.now();
  const splits = splitUsers(dataset, config);
  if (!splits.length) throw new Error("No eligible users");
  const counts = trainPopularity(splits);
  const trainingInteractions = splits.reduce(
    (sum, split) => sum + split.train.length,
    0,
  );
  if (
    [...counts.values()].reduce((sum, count) => sum + count, 0) !==
    trainingInteractions
  )
    throw new Error("Popularity training interaction audit failed");
  const metricRows = Object.fromEntries(
    METHOD_NAMES.map((name) => [
      name,
      [] as (RankingMetrics & EvidenceMetrics)[],
    ]),
  ) as Record<MethodName, (RankingMetrics & EvidenceMetrics)[]>;
  const timings = Object.fromEntries(
    METHOD_NAMES.map((name) => [name, [] as number[]]),
  ) as Record<MethodName, number[]>;
  const outputOrders: string[] = [];
  const poolHashes: string[] = [];
  const poolSizes: number[] = [];
  let totalPositives = 0;
  let profilesWithoutTopics = 0;
  let fallbackCalls = 0;
  const rankers = {
    "Content / Lexical": new RankingService({
      semanticWeight: 0,
      lexicalWeight: 1,
      graphWeight: 0,
      recencyWeight: 0,
      mmrLambda: 1,
    }),
    "CiteBloom Full (Offline)": new RankingService(),
    "CiteBloom lambda=1": new RankingService({ mmrLambda: 1 }),
  };
  for (const split of splits) {
    const pool = candidatePool(dataset, split, config);
    auditSplitAndPool(split, pool);
    poolHashes.push(sha256(JSON.stringify(pool)));
    poolSizes.push(pool.length);
    totalPositives += split.test.length;
    const snapshot = toSnapshot(dataset, split);
    const profile = new ProfileBuilder().build({
      libraryID: snapshot.libraryID,
      papers: snapshot.papers,
      now: 0,
    });
    profilesWithoutTopics += Number(profile.topics.length === 0);
    const candidates = pool.map((id) => toCandidate(dataset.items[id]));
    const input: RecommendationEvaluationCase = {
      id: `offline-user:${split.userId}`,
      profile,
      candidates,
      now: 0,
      topK: config.topK,
      expectedSignals: { preferredCandidateIds: split.test.map(candidateId) },
      knownCandidateIds: split.train.map(candidateId),
    };
    const commonPoolHash = sha256(
      JSON.stringify(candidates.map((c) => c.candidateId)),
    );
    for (const method of METHOD_NAMES) {
      if (
        sha256(JSON.stringify(candidates.map((c) => c.candidateId))) !==
        commonPoolHash
      )
        throw new Error("Method candidate pool changed");
      const methodStart = performance.now();
      let recommendations: RecommendedPaper[];
      if (method === "Popularity") {
        const byId = new Map(pool.map((id) => [candidateId(id), id]));
        recommendations = [...candidates]
          .sort(
            (a, b) =>
              (counts.get(byId.get(b.candidateId)!) ?? 0) -
                (counts.get(byId.get(a.candidateId)!) ?? 0) ||
              compareText(a.candidateId, b.candidateId),
          )
          .slice(0, config.topK)
          .map((candidate, i) => {
            const { matchedTopicIds } = computeFeatures(
              profile,
              candidate,
              undefined,
              0,
              resolveRankingConfig(),
            );
            return {
              ...candidate,
              matchedTopicIds,
              rank: i + 1,
              scores: {
                finalScore: counts.get(byId.get(candidate.candidateId)!) ?? 0,
              },
            };
          });
      } else {
        const ranking = await rankers[method].rank({
          profile,
          candidates,
          now: 0,
          topK: config.topK,
        });
        recommendations = ranking.recommendations;
        fallbackCalls += Number(ranking.diagnostics.semanticFallback);
      }
      timings[method].push(performance.now() - methodStart);
      const evidence = new RecommendationEvidenceService();
      const rows = await Promise.all(
        recommendations.map(async (paper) => ({
          paper,
          explanation: await evidence.explain({
            candidate: paper,
            profile,
            snapshot,
            now: 0,
          }),
        })),
      );
      metricRows[method].push({
        ...rankingMetrics(input, rows),
        ...evidenceMetrics(input, rows),
      });
      outputOrders.push(
        sha256(
          JSON.stringify(
            recommendations.map((paper) => ({
              id: paper.candidateId,
              scores: paper.scores,
              matchedTopicIds: paper.matchedTopicIds,
            })),
          ),
        ),
      );
    }
  }
  const eligible = dataset.users.filter(
    (items) => items.length >= config.minInteractions,
  ).length;
  const methods = Object.fromEntries(
    METHOD_NAMES.map((method) => {
      const rows = metricRows[method];
      const averaged = macroAverage(rows.map((row) => ({ ...row })));
      averaged.unsupportedExplanationCount = rows.reduce(
        (sum, row) => sum + row.unsupportedExplanationCount,
        0,
      );
      return [method, averaged];
    }),
  );
  const sortedTimes = (method: MethodName) =>
    [...timings[method]].sort((a, b) => a - b);
  return {
    protocol:
      "ORACLE / FIXED-POOL RANKING EVAL; random interaction holdout; implicit-positive proxies",
    retrieval: "RETRIEVAL NOT EVALUATED",
    provider:
      "MOCK PROVIDER: local CiteULike-a; openalex type only; zero API calls",
    pipelineVersion: 1,
    config,
    sourceDiagnostics: dataset.diagnostics,
    sample: {
      eligibleUsers: eligible,
      evaluatedUsers: splits.length,
      eligibleUserRate: eligible / dataset.users.length,
      evaluatedEligibleUserRate: splits.length / eligible,
      processedInteractions: splits.reduce(
        (sum, split) => sum + split.train.length + split.test.length,
        0,
      ),
      trainingInteractions,
      heldOutInteractions: totalPositives,
      sampledDistinctItems: new Set(
        splits.flatMap((split) => [...split.train, ...split.test]),
      ).size,
      poolCount: poolSizes.length,
      totalPoolItems: poolSizes.reduce((sum, size) => sum + size, 0),
      poolSizeMin: Math.min(...poolSizes),
      poolSizeMax: Math.max(...poolSizes),
      poolSizeMean:
        poolSizes.reduce((sum, size) => sum + size, 0) / poolSizes.length,
      pooledPositiveFraction:
        totalPositives / poolSizes.reduce((sum, size) => sum + size, 0),
      macroPositiveFraction:
        poolSizes.reduce(
          (sum, size, i) => sum + splits[i].test.length / size,
          0,
        ) / splits.length,
      heldOutInPoolCoverage: 1,
      conditionalRelevantCount: totalPositives,
      profilesWithoutTopics,
      seedDoiRouteCoverage: 0,
      graphRouteCoverage: 0,
      semanticFallbackRankingCalls: fallbackCalls,
      failedUsers: 0,
      skippedEligibleUsers: eligible - splits.length,
    },
    audit: {
      trainTestOverlap: 0,
      trainPoolOverlap: 0,
      duplicateCandidateIds: 0,
      baselineSamePool: true,
      popularityTrainingInteractionsOnly: true,
      noTestFeedback: true,
      splitSha256: sha256(JSON.stringify(splits)),
      poolsSha256: sha256(JSON.stringify(poolHashes)),
      rankedOutputsSha256: sha256(JSON.stringify(outputOrders)),
    },
    methods,
    timing: {
      wallClockMs: performance.now() - started,
      rankingOnlyMs: Object.fromEntries(
        METHOD_NAMES.map((method) => [
          method,
          {
            observations: timings[method].length,
            mean:
              timings[method].reduce((sum, value) => sum + value, 0) /
              timings[method].length,
            p95: sortedTimes(method)[
              Math.ceil(timings[method].length * 0.95) - 1
            ],
          },
        ]),
      ),
    },
  };
}

export type BenchmarkResult = Awaited<ReturnType<typeof benchmark>>;
export function deterministicResult(
  result: BenchmarkResult,
): Omit<BenchmarkResult, "timing"> {
  const { timing: _timing, ...stable } = result;
  return stable;
}
