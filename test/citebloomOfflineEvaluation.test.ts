import { expect } from "chai";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseCsv,
  parseDataset,
  parseIndexedRows,
} from "../scripts/evaluation/parser";
import {
  decodeSource,
  DATASET,
  FILES,
  SOURCE,
  UPSTREAM_COMMIT,
  prepareDataset,
  sha256,
  type DatasetManifest,
} from "../scripts/evaluation/dataset";
import {
  DEFAULT_CONFIG,
  auditSplitAndPool,
  benchmark,
  candidatePool,
  deterministicResult,
  macroAverage,
  splitUsers,
  toCandidate,
  toSnapshot,
  trainPopularity,
} from "../scripts/evaluation/benchmark";
import { ProfileBuilder } from "../src/recommendation/profile/profileBuilder";
import { rankingMetrics } from "../src/recommendation/evaluation/metrics";
import type { EvaluatedRecommendation } from "../src/recommendation/evaluation/contracts";

// Original synthetic fixture only: no copied upstream titles, abstracts or user data.
function fixture(itemCount = 20) {
  return {
    metadata:
      '"doc.id","title","citeulike.id","raw.title","raw.abstract"\n' +
      Array.from(
        { length: itemCount },
        (_, i) =>
          `${i + 1},topic ${i},${100 + i},"Synthetic ${i} topic ${i % 3}","${i === 0 ? "" : `Original fixture abstract about topic ${i % 3}.`}"`,
      ).join("\n") +
      "\n",
    tags: "topic 0\ntopic 1\ntopic 2\n",
    itemTags:
      Array.from({ length: itemCount }, (_, i) =>
        i === 0 ? "0" : `1 ${i % 3}`,
      ).join("\n") + "\n",
    users:
      "10 0 1 2 3 4 5 6 7 8 9\n10 5 6 7 8 9 10 11 12 13 14\n10 10 11 12 13 14 15 16 17 18 19\n",
  };
}

function rows(ids: number[]): EvaluatedRecommendation[] {
  return ids.map((id, rank) => ({
    paper: {
      ...toCandidate({ id, title: `unique${id}`, tags: [] }),
      rank: rank + 1,
      matchedTopicIds: [],
      scores: { finalScore: 0 },
    },
    explanation: {
      evidence: [],
      reason: {
        summary: "Insufficient evidence",
        matchedTopics: [],
        evidenceRefs: [],
        confidence: 0,
      },
      warnings: [],
    },
  }));
}

describe("CiteBloom offline evaluation: original synthetic regression", function () {
  this.timeout(15000);

  it("maps CSV 1-based IDs onto 0-based DAT IDs even when CSV order changes", function () {
    const input = fixture();
    const lines = input.metadata.trimEnd().split("\n");
    input.metadata = [lines[0], ...lines.slice(1).reverse()].join("\n");
    const dataset = parseDataset(input);
    expect(dataset.items[0].title).to.equal("Synthetic 0 topic 0");
    expect(dataset.users[0][0]).to.equal(0);
    expect(dataset.items[19].title).to.equal("Synthetic 19 topic 1");
    expect(dataset.diagnostics.metadataRows).to.equal(20);
    expect(dataset.diagnostics.interactions).to.equal(30);
    expect(dataset.diagnostics.parseSuccessRate).to.equal(1);
  });

  it("handles UTF-8 Unicode, BOM, comma, escaped quote, embedded newline and CRLF", function () {
    expect(
      parseCsv('\uFEFF"x","y"\r\n"研究, ""A""","line1\nline2"\r\n'),
    ).to.deep.equal([
      ["x", "y"],
      ['研究, "A"', "line1\nline2"],
    ]);
  });

  it("records malformed UTF-8 without guessing a replacement word", function () {
    const decoded = decodeSource(Uint8Array.from([65, 0xc0, 0x80, 66]));
    expect(decoded.audit.invalidUtf8).to.equal(true);
    expect(decoded.audit.replacementCharacters).to.equal(2);
    expect(decoded.text).to.equal("A\uFFFD\uFFFDB");
    expect(
      decodeSource(new TextEncoder().encode("研究")).audit.invalidUtf8,
    ).to.equal(false);
  });

  it("rejects malformed CSV quotes, rows and unsupported columns", function () {
    expect(() => parseCsv('a,"unfinished')).to.throw("Unterminated");
    expect(() => parseCsv('a,b"c')).to.throw("Invalid CSV quote");
    expect(() => parseCsv('"a"junk,b')).to.throw("Unexpected text");
    expect(() =>
      parseDataset({ ...fixture(), metadata: "wrong,header\n" }),
    ).to.throw("columns");
    expect(() =>
      parseDataset({
        ...fixture(),
        metadata: fixture().metadata.replace("1,topic 0", "1,extra,topic 0"),
      }),
    ).to.throw("column count");
  });

  it("rejects zero, duplicate, missing and out-of-range CSV IDs", function () {
    for (const replacement of ["0", "2", "21"])
      expect(() =>
        parseDataset({
          ...fixture(),
          metadata: fixture().metadata.replace(
            "1,topic 0",
            `${replacement},topic 0`,
          ),
        }),
      ).to.throw("1-based");
  });

  it("checks length prefixes before deduplicating and records duplicate counts", function () {
    const parsed = parseIndexedRows("3 1 1 2\n0\n", 3, "test");
    expect(parsed.rows).to.deep.equal([[1, 2], []]);
    expect(parsed.duplicates).to.equal(1);
    expect(parsed.rawEntries).to.equal(3);
    const dataset = parseDataset({ ...fixture(), users: "3 0 0 1\n" });
    expect(dataset.diagnostics.duplicateInteractionsRemoved).to.equal(1);
    expect(dataset.diagnostics.interactions).to.equal(2);
    expect(() => parseIndexedRows("2 1\n", 3, "test")).to.throw(
      "Length prefix",
    );
  });

  it("rejects negative/fractional/out-of-range DAT indexes and bad line counts", function () {
    for (const text of ["1 -1\n", "1 0.5\n", "1 20\n", "\n"])
      expect(() => parseIndexedRows(text, 20, "test")).to.throw();
    expect(() => parseDataset({ ...fixture(), itemTags: "0\n" })).to.throw(
      "row counts",
    );
    expect(() =>
      parseDataset({
        ...fixture(),
        itemTags: fixture().itemTags.replace("1 1", "1 3"),
      }),
    ).to.throw("Out-of-range");
  });

  it("preserves empty abstracts/tags and reports genuinely missing metadata", function () {
    const dataset = parseDataset(fixture());
    expect(dataset.items[0].abstract).to.equal(undefined);
    expect(dataset.items[0].tags).to.deep.equal([]);
    expect(dataset.diagnostics.missingAbstractRate).to.equal(0.05);
    expect(dataset.diagnostics.missingTagsRate).to.equal(0.05);
    expect(dataset.diagnostics.missingDoiRate).to.equal(1);
    const snapshot = toSnapshot(dataset, {
      userId: 0,
      train: [0, 1],
      test: [2, 3],
    });
    expect(snapshot.papers.map((paper) => paper.addedAt)).to.deep.equal([0, 0]);
    expect(snapshot.papers[0].doi).to.equal(undefined);
    expect(toCandidate(dataset.items[0]).provenance[0]).to.include({
      provider: "openalex",
    });
    expect(JSON.stringify(toCandidate(dataset.items[0]).provenance)).to.include(
      "MOCK PROVIDER",
    );
  });

  it("verifies cached byte counts/SHA-256 and refuses cache corruption offline", async function () {
    const directory = await mkdtemp(join(tmpdir(), "citebloom-cache-test-"));
    try {
      const data = fixture();
      const texts = {
        "README.md": "Original fixture",
        "users.dat": data.users,
        "raw-data.csv": data.metadata,
        "tags.dat": data.tags,
        "item-tag.dat": data.itemTags,
      };
      const manifest: DatasetManifest = {
        schemaVersion: 1,
        dataset: DATASET,
        source: SOURCE,
        upstreamCommit: UPSTREAM_COMMIT,
        files: FILES.map((name) => ({
          name,
          url: `${SOURCE}/${name}`,
          sha256: sha256(texts[name]),
          bytes: Buffer.byteLength(texts[name]),
          downloadedAt: "2026-10-18T00:00:00.000Z",
        })),
        licenseReview: {
          status: "NO_EXPLICIT_LICENSE_FOUND_DO_NOT_REDISTRIBUTE",
          reviewedAt: "2026-10-18T00:00:00.000Z",
          treeUrl: SOURCE,
          rootFiles: [...FILES],
          note: "Synthetic test fixture",
        },
      };
      for (const name of FILES)
        await writeFile(join(directory, name), texts[name]);
      await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify(manifest),
      );
      expect(
        (await prepareDataset({ cacheDir: directory, offline: true })).dataset
          .items.length,
      ).to.equal(20);
      await writeFile(join(directory, "users.dat"), data.users + "0\n");
      let rejected = false;
      try {
        await prepareDataset({ cacheDir: directory, offline: true });
      } catch (error) {
        rejected = String(error).includes("integrity mismatch");
      }
      expect(rejected).to.equal(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses deterministic disjoint per-user holdout and the same oracle pool", function () {
    const dataset = parseDataset(fixture());
    const config = { ...DEFAULT_CONFIG, users: 3, unlabeled: 5 };
    const splits = splitUsers(dataset, config);
    expect(splits).to.deep.equal(splitUsers(dataset, config));
    for (const split of splits) {
      const pool = candidatePool(dataset, split, config);
      auditSplitAndPool(split, pool);
      expect(split.train.length).to.equal(8);
      expect(split.test.length).to.equal(2);
      expect(pool.length).to.equal(7);
      expect(
        toSnapshot(dataset, split).papers.map((p) => p.itemId),
      ).to.not.have.members(split.test.map((id) => `citeulike-a:item:${id}`));
    }
    expect(
      [...trainPopularity(splits).values()].reduce((sum, n) => sum + n, 0),
    ).to.equal(24);
    expect(
      trainPopularity([{ userId: 0, train: [1, 2], test: [3, 4] }]).has(3),
    ).to.equal(false);
  });

  it("fails closed on leakage and duplicate candidate IDs", function () {
    expect(() =>
      auditSplitAndPool({ userId: 0, train: [0], test: [0] }, [0]),
    ).to.throw("leakage");
    expect(() =>
      auditSplitAndPool({ userId: 0, train: [0], test: [1] }, [1, 1]),
    ).to.throw("Duplicate candidate");
    expect(() =>
      auditSplitAndPool({ userId: 0, train: [0], test: [1] }, [0, 1]),
    ).to.throw("Training item");
    expect(() =>
      auditSplitAndPool({ userId: 0, train: [0], test: [1] }, [2]),
    ).to.throw("lost held-out");
  });

  it("matches hand-calculated production metrics and macro denominators", function () {
    const profile = new ProfileBuilder().build({
      libraryID: 1,
      papers: [],
      now: 0,
    });
    const metrics = rankingMetrics(
      {
        id: "manual",
        profile,
        candidates: [],
        now: 0,
        topK: 5,
        expectedSignals: {
          preferredCandidateIds: [
            "citeulike-a:item:2",
            "citeulike-a:item:3",
            "citeulike-a:item:4",
          ],
        },
        knownCandidateIds: ["citeulike-a:item:1"],
      },
      rows([1, 2, 3]),
    );
    expect(metrics.precisionAtK).to.equal(2 / 5);
    expect(metrics.recallAtK).to.equal(2 / 3);
    expect(metrics.mrr).to.equal(1 / 2);
    expect(metrics.ndcgAtK).to.be.closeTo(
      (1 / Math.log2(3) + 1 / 2) / (1 + 1 / Math.log2(3) + 1 / 2),
      1e-12,
    );
    expect(metrics.diversityScore).to.equal(1);
    expect(metrics.noveltyRate).to.equal(2 / 3);
    expect(
      macroAverage([
        { recall: 1, measured: null },
        { recall: 0, measured: null },
      ]),
    ).to.deep.equal({ recall: 0.5, measured: null });
  });

  it("runs all four production-backed methods with repeatable fingerprints and aggregates", async function () {
    const dataset = parseDataset(fixture());
    const config = { ...DEFAULT_CONFIG, users: 3, unlabeled: 5 };
    const first = await benchmark(dataset, config);
    const second = await benchmark(dataset, config);
    expect(deterministicResult(first)).to.deep.equal(
      deterministicResult(second),
    );
    expect(first.audit.baselineSamePool).to.equal(true);
    expect(first.sample.semanticFallbackRankingCalls).to.equal(9);
    expect(Object.keys(first.methods)).to.have.length(4);
    for (const metrics of Object.values(first.methods)) {
      expect(metrics.unsupportedExplanationCount).to.equal(0);
      expect(metrics.noveltyRate).to.equal(1);
    }
  });
});
