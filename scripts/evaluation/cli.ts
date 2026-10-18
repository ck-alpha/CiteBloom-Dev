import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { cpus, platform, arch } from "node:os";
import {
  prepareDataset,
  sha256,
  DATASET,
  type DatasetManifest,
} from "./dataset";
import {
  benchmark,
  DEFAULT_CONFIG,
  deterministicResult,
  type BenchmarkResult,
} from "./benchmark";

type SavedReport = {
  status: "REAL-DATA OFFLINE EVAL";
  executedAt: string;
  environment: {
    node: string;
    platform: string;
    arch: string;
    cpu: string;
    logicalCpus: number;
  };
  implementationSha256: string;
  data: DatasetManifest;
  result: BenchmarkResult;
  determinism: {
    checked: boolean;
    equal: boolean | null;
    stableSha256: string;
    replayWallClockMs?: number;
  };
};

async function implementationHash(): Promise<string> {
  const files: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".ts")) files.push(path);
    }
  }
  await walk("src/recommendation");
  await walk("scripts/evaluation");
  const entries = await Promise.all(
    files.sort().map(async (path) => [path, sha256(await readFile(path))]),
  );
  return sha256(JSON.stringify(entries));
}

function renderReport(report: SavedReport): string {
  const { result } = report;
  const lines = [
    `# CiteBloom real-data offline evaluation`,
    "",
    `${result.protocol}. ${result.retrieval}.`,
    "",
    `Executed: ${report.executedAt}. Node ${report.environment.node}; ${report.environment.platform}/${report.environment.arch}.`,
    "",
    `Dataset: ${report.data.dataset}, commit ${report.data.upstreamCommit}. Seed ${result.config.seed}.`,
    `Users: ${result.sample.evaluatedUsers}; training interactions: ${result.sample.trainingInteractions}; held-out: ${result.sample.heldOutInteractions}.`,
    `Pool: all held-out positives + up to ${result.config.unlabeled} uniformly sampled unlabeled items/user; mean ${result.sample.poolSizeMean.toFixed(2)}, positive fraction ${(result.sample.pooledPositiveFraction * 100).toFixed(2)}%.`,
    "",
    "Metrics are macro means over evaluated users; unsupported is a total count. MRR is truncated at K=5 by the production metric.",
    "",
    "| Method | NDCG@5 | Recall@5 | MRR@5 | Precision@5 | Diversity@5 | Novelty@5 | Evidence availability | Reason grounding | Unsupported |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [method, metrics] of Object.entries(result.methods)) {
    const keys = [
      "ndcgAtK",
      "recallAtK",
      "mrr",
      "precisionAtK",
      "diversityScore",
      "noveltyRate",
      "evidenceAvailability",
      "reasonGroundingRate",
      "unsupportedExplanationCount",
    ];
    lines.push(
      `| ${method} | ${keys.map((key) => (metrics[key] === null ? "N/A" : key === "unsupportedExplanationCount" ? metrics[key] : metrics[key]?.toFixed(6))).join(" | ")} |`,
    );
  }
  lines.push(
    "",
    `Determinism checked: ${report.determinism.checked}; equal: ${report.determinism.equal}; stable SHA-256: ${report.determinism.stableSha256}.`,
    "",
    `First execution wall-clock: ${(result.timing.wallClockMs / 1000).toFixed(3)} s.`,
    "",
    "No actual OpenAlex provider, semantic embeddings, citation graph, temporal holdout, Zotero host or live LLM are evaluated here.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command || !["prepare", "run", "report"].includes(command))
    throw new Error(
      "Usage: tsx scripts/evaluation/cli.ts prepare|run|report [--dataset citeulike-a] [--seed 20261018] [--offline] [--users 100] [--unlabeled 200] [--verify-determinism] [--output data/evaluation/medium.json]",
    );
  const flags = new Map<string, string | boolean>();
  const booleans = new Set(["offline", "verify-determinism"]);
  const valued = new Set([
    "dataset",
    "seed",
    "users",
    "unlabeled",
    "output",
    "input",
    "cache-dir",
    "max-bytes",
    "timeout-ms",
    "retries",
  ]);
  while (args.length) {
    const name = args.shift()!;
    if (!name.startsWith("--")) throw new Error(`Unexpected argument: ${name}`);
    const key = name.slice(2);
    if (flags.has(key)) throw new Error(`Duplicate option: ${name}`);
    if (booleans.has(key)) flags.set(key, true);
    else if (valued.has(key)) {
      const value = args.shift();
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value: ${name}`);
      flags.set(key, value);
    } else throw new Error(`Unknown option: ${name}`);
  }
  const string = (key: string, fallback: string) =>
    String(flags.get(key) ?? fallback);
  const number = (key: string, fallback: number) => {
    const value = Number(flags.get(key) ?? fallback);
    if (!Number.isSafeInteger(value))
      throw new Error(`Invalid integer: --${key}`);
    return value;
  };
  if (string("dataset", DATASET) !== DATASET)
    throw new Error(
      "Only citeulike-a is supported: citeulike-t has a different tag schema; do not reuse this adapter blindly",
    );
  if (command === "report") {
    const report = JSON.parse(
      await readFile(string("input", "data/evaluation/medium.json"), "utf8"),
    ) as SavedReport;
    const text = renderReport(report);
    if (flags.has("output")) await writeFile(string("output", ""), text);
    else process.stdout.write(text);
    return;
  }
  const { manifest, dataset } = await prepareDataset({
    cacheDir: string("cache-dir", "data/raw/citeulike-a"),
    offline: command === "run" || flags.has("offline"),
    maxBytes: number("max-bytes", 40 * 1024 * 1024),
    timeoutMs: number("timeout-ms", 120000),
    retries: number("retries", 2),
  });
  if (command === "prepare") {
    process.stdout.write(
      JSON.stringify(
        {
          dataset: DATASET,
          upstreamCommit: manifest.upstreamCommit,
          files: manifest.files,
          licenseReview: manifest.licenseReview,
          diagnostics: dataset.diagnostics,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  const result = await benchmark(dataset, {
    ...DEFAULT_CONFIG,
    seed: number("seed", DEFAULT_CONFIG.seed),
    users: number("users", DEFAULT_CONFIG.users),
    unlabeled: number("unlabeled", DEFAULT_CONFIG.unlabeled),
  });
  const stableSha256 = sha256(JSON.stringify(deterministicResult(result)));
  let replay: BenchmarkResult | undefined;
  if (flags.has("verify-determinism")) {
    replay = await benchmark(dataset, result.config);
    if (sha256(JSON.stringify(deterministicResult(replay))) !== stableSha256)
      throw new Error("Deterministic replay failed (timing excluded)");
  }
  const report: SavedReport = {
    status: "REAL-DATA OFFLINE EVAL",
    executedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      logicalCpus: cpus().length,
    },
    implementationSha256: await implementationHash(),
    data: manifest,
    result,
    determinism: {
      checked: Boolean(replay),
      equal: replay ? true : null,
      stableSha256,
      ...(replay ? { replayWallClockMs: replay.timing.wallClockMs } : {}),
    },
  };
  const output = string("output", "data/evaluation/medium.json");
  await mkdir(dirname(output), { recursive: true });
  // Aggregate-only output: never export user IDs, interaction rows, titles or snippets.
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(renderReport(report));
  process.stdout.write(
    `Aggregate report saved: ${relative(process.cwd(), output)}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `CiteBloom evaluation failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
