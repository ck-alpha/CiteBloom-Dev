import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDataset, type ParsedDataset } from "./parser";

export const DATASET = "citeulike-a";
export const UPSTREAM_COMMIT = "91b603922d7f2d3db18071d4798bf78c9c5d1680";
export const SOURCE = "https://github.com/js05212/citeulike-a";
export const FILES = [
  "README.md",
  "users.dat",
  "raw-data.csv",
  "item-tag.dat",
  "tags.dat",
] as const;
export const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

export interface DownloadRecord {
  name: string;
  url: string;
  sha256: string;
  bytes: number;
  downloadedAt: string;
  decoding?: {
    encoding: "utf-8";
    invalidUtf8: boolean;
    replacementCharacters: number;
  };
}
export interface DatasetManifest {
  schemaVersion: 1;
  dataset: typeof DATASET;
  source: string;
  upstreamCommit: string;
  files: DownloadRecord[];
  licenseReview: {
    status: "NO_EXPLICIT_LICENSE_FOUND_DO_NOT_REDISTRIBUTE";
    reviewedAt: string;
    treeUrl: string;
    rootFiles: string[];
    note: string;
  };
}

const DEFAULT_MAX_BYTES = 40 * 1024 * 1024;
/** Keep source bytes untouched; never guess repairs to corrupt/mixed historical text. */
export function decodeSource(bytes: Uint8Array) {
  let invalidUtf8 = false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalidUtf8 = true;
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  return {
    text,
    audit: {
      encoding: "utf-8" as const,
      invalidUtf8,
      replacementCharacters: [...text].filter((char) => char === "\uFFFD")
        .length,
    },
  };
}
/** Bounds apply to all downloaded responses, including retry bodies. */
async function boundedFetch(
  url: string,
  budget: { remaining: number },
  timeoutMs: number,
  retries: number,
): Promise<Uint8Array> {
  // Do not inherit a TLS bypass from the execution environment.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "CiteBloom-offline-evaluation" },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} for dataset source`);
      }
      const length = Number(response.headers.get("content-length"));
      if (length > budget.remaining) {
        await response.body?.cancel();
        throw new RangeError("Dataset download byte budget exceeded");
      }
      if (!response.body) throw new Error("Dataset response body is missing");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          budget.remaining -= part.value.length;
          if (budget.remaining < 0)
            throw new RangeError("Dataset download byte budget exceeded");
          chunks.push(part.value);
          bytes += part.value.length;
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      }
      const result = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    } catch (error) {
      if (attempt >= retries || error instanceof RangeError) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function prepareDataset(options: {
  cacheDir: string;
  offline?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
  retries?: number;
}): Promise<{ manifest: DatasetManifest; dataset: ParsedDataset }> {
  const { cacheDir, offline = false } = options;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? 120000;
  const retries = options.retries ?? 2;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 256 * 1024 * 1024
  )
    throw new TypeError("maxBytes must be an integer between 1 and 256 MiB");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw new TypeError("timeoutMs must be an integer between 1 and 120000");
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 3)
    throw new TypeError("retries must be an integer between 0 and 3");
  await mkdir(cacheDir, { recursive: true });
  let manifest: DatasetManifest | undefined;
  try {
    manifest = JSON.parse(
      await readFile(join(cacheDir, "manifest.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (manifest) {
    if (
      manifest.dataset !== DATASET ||
      manifest.upstreamCommit !== UPSTREAM_COMMIT ||
      manifest.source !== SOURCE ||
      manifest.files.length !== FILES.length ||
      new Set(manifest.files.map((f) => f.name)).size !== FILES.length
    )
      throw new Error("Cache manifest does not match pinned dataset source");
  } else {
    if (offline)
      throw new Error("BLOCKED: NETWORK/DATA: no verified offline cache");
    const budget = { remaining: maxBytes };
    const treeUrl = `https://api.github.com/repos/js05212/citeulike-a/git/trees/${UPSTREAM_COMMIT}`;
    const tree = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await boundedFetch(treeUrl, budget, timeoutMs, retries),
      ),
    ) as { tree: { path: string; type: string }[] };
    const rootFiles = tree.tree.map((entry) => entry.path).sort();
    if (
      rootFiles.some((name) =>
        /^(licen[cs]e|copying|notice)(\.|$)/iu.test(name),
      )
    )
      throw new Error(
        "Upstream license files changed; review before downloading",
      );
    manifest = {
      schemaVersion: 1,
      dataset: DATASET,
      source: SOURCE,
      upstreamCommit: UPSTREAM_COMMIT,
      files: [],
      licenseReview: {
        status: "NO_EXPLICIT_LICENSE_FOUND_DO_NOT_REDISTRIBUTE",
        reviewedAt: new Date().toISOString(),
        treeUrl,
        rootFiles,
        note: "Pinned root has no LICENSE/COPYING/NOTICE. README attributes CiteULike, Google Scholar and Wang/Blei, and links historical CiteULike terms; no affirmative redistribution grant verified. Local research cache only; do not publish raw data, excerpts or interaction arrays.",
      },
    };
    for (const name of FILES) {
      const url = `https://raw.githubusercontent.com/js05212/citeulike-a/${UPSTREAM_COMMIT}/${name}`;
      const bytes = await boundedFetch(url, budget, timeoutMs, retries);
      const temporary = join(cacheDir, `${name}.partial`);
      try {
        await writeFile(temporary, bytes);
        await rename(temporary, join(cacheDir, name));
      } finally {
        await rm(temporary, { force: true });
      }
      manifest.files.push({
        name,
        url,
        bytes: bytes.length,
        sha256: sha256(bytes),
        downloadedAt: new Date().toISOString(),
      });
    }
    await writeFile(
      join(cacheDir, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  }
  const text = new Map<string, string>();
  for (const name of FILES) {
    const record = manifest.files.find((file) => file.name === name);
    if (!record) throw new Error(`Missing cached file record: ${name}`);
    const bytes = await readFile(join(cacheDir, name));
    if (sha256(bytes) !== record.sha256 || bytes.length !== record.bytes)
      throw new Error(
        `Cache integrity mismatch: ${name}; restore cache explicitly`,
      );
    const decoded = decodeSource(bytes);
    record.decoding = decoded.audit;
    text.set(name, decoded.text);
  }
  return {
    manifest,
    dataset: parseDataset({
      users: text.get("users.dat")!,
      metadata: text.get("raw-data.csv")!,
      itemTags: text.get("item-tag.dat")!,
      tags: text.get("tags.dat")!,
      encodingDiagnostics: {
        filesWithInvalidUtf8: manifest.files.filter(
          (file) => file.decoding?.invalidUtf8,
        ).length,
        replacementCharacters: manifest.files.reduce(
          (sum, file) => sum + (file.decoding?.replacementCharacters ?? 0),
          0,
        ),
      },
    }),
  };
}
