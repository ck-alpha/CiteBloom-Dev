import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Buffer } from "node:buffer";
import { URL, URLSearchParams } from "node:url";

// An explicit, bounded provider connectivity check. No user preference labels,
// candidate discovery service, model, Zotero host, or personalized metrics.
// Never inherit a developer shell's certificate-verification bypass.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
const params = {
  search: "research discovery",
  per_page: "3",
  select: "id,doi,abstract_inverted_index",
};
const url = new URL("https://api.openalex.org/works");
url.search = new URLSearchParams(params).toString();
const key = process.env.OPENALEX_API_KEY;
const attempts = [];
const started = performance.now();
const report = {
  kind: "LIVE OPENALEX API SMOKE",
  queriedAt: new Date().toISOString(),
  endpoint: "https://api.openalex.org/works",
  params,
  authentication: key ? "environment bearer token" : "anonymous",
  documentation: "https://help.openalex.org/api/authentication/",
  status: "BLOCKED",
  attempts,
  sampleCount: 0,
  withDOI: 0,
  withAbstract: 0,
  durationMs: 0,
};

for (let attempt = 1; attempt <= 3; attempt++) {
  const requestStarted = performance.now();
  try {
    const response = await globalThis.fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CiteBloom-offline-evaluation-smoke/1",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      signal: globalThis.AbortSignal.timeout(15000),
      redirect: "error",
    });
    const record = {
      attempt,
      httpStatus: response.status,
      durationMs: 0,
      failureCode: response.ok ? null : `HTTP_${response.status}`,
    };
    attempts.push(record);
    if (!response.ok) {
      await response.body?.cancel();
      record.durationMs = Math.round(performance.now() - requestStarted);
      if (response.status === 429 && attempt < 3) {
        const retryAfter = response.headers.get("retry-after");
        const retrySeconds = /^\d+(?:\.\d+)?$/.test(retryAfter ?? "")
          ? Number(retryAfter)
          : retryAfter
            ? Math.max(0, (Date.parse(retryAfter) - Date.now()) / 1000)
            : 0;
        // A long server delay exceeds this smoke's budget: stop instead of
        // retrying earlier than requested or waiting without a bound.
        if (Number.isFinite(retrySeconds) && retrySeconds > 10) break;
        await delay(Math.max(2 ** attempt, retrySeconds || 0) * 1000);
        continue;
      }
      break;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) {
        await reader.cancel();
        throw new Error("RESPONSE_SIZE_LIMIT");
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!Array.isArray(body.results) || body.results.length > 3)
      throw new Error("INVALID_RESPONSE");
    report.sampleCount = body.results.length;
    report.withDOI = body.results.filter((work) => Boolean(work.doi)).length;
    report.withAbstract = body.results.filter(
      (work) => Object.keys(work.abstract_inverted_index ?? {}).length > 0,
    ).length;
    report.status = report.sampleCount ? "PASS" : "FAIL: EMPTY_RESULT";
    record.durationMs = Math.round(performance.now() - requestStarted);
    break;
  } catch (error) {
    // Do not print URLs, headers, response bodies, or arbitrary error messages:
    // those may contain credentials or transport/proxy details.
    const failureCode = ["RESPONSE_SIZE_LIMIT", "INVALID_RESPONSE"].includes(
      error?.message,
    )
      ? error.message
      : error?.name === "TimeoutError"
        ? "NETWORK_TIMEOUT"
        : "NETWORK_OR_RESPONSE_ERROR";
    const last = attempts.at(-1);
    if (last?.attempt === attempt) {
      last.failureCode = failureCode;
      last.durationMs = Math.round(performance.now() - requestStarted);
    } else {
      attempts.push({
        attempt,
        httpStatus: null,
        durationMs: Math.round(performance.now() - requestStarted),
        failureCode,
      });
    }
    break;
  }
}
report.durationMs = Math.round(performance.now() - started);
await mkdir("data/reports", { recursive: true });
await writeFile(
  "data/reports/openalex-smoke.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
if (report.status !== "PASS") process.exitCode = 1;
