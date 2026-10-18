# CiteBloom evaluation protocol

This benchmark is **ORACLE / FIXED-POOL RANKING EVAL**, using real historical
implicit interactions and local article metadata. It evaluates conditional
ranking and production domain contracts without Zotero. **RETRIEVAL NOT
EVALUATED**. None of these numbers measure live user satisfaction, click-through,
real Zotero use, LLM tool selection or an end-to-end Agent.

## Source, version and redistribution boundary

The input is [CiteULike-a](https://github.com/js05212/citeulike-a), pinned to
commit `91b603922d7f2d3db18071d4798bf78c9c5d1680`. Its
[README](https://github.com/js05212/citeulike-a/blob/91b603922d7f2d3db18071d4798bf78c9c5d1680/README.md)
attributes the records to CiteULike, Google Scholar and earlier work by Wang and
Blei, with further dataset work by Wang, Chen and Li. The metadata, tags and
interaction files are external historical observations, not synthetic labels.

The pinned root contains no `LICENSE`, `COPYING` or `NOTICE`, and the README
provides no affirmative redistribution grant. It links historical CiteULike data
terms whose present enforceable terms have not been established in this review.
Public access is not treated as permission to republish. The repository's
AGPL-3.0-or-later license applies to its code, not automatically to this dataset.
Only locally ignored caches are downloaded. **Do not publish source CSV/DAT
files, titles, abstract excerpts, user interaction arrays or derived full data.**
Public artifacts are original synthetic fixtures, code, protocol, aggregate
metrics and checksums. This is a record of source inspection, not a legal opinion.

The preparation CLI retrieves the pinned Git tree before downloading and stops
if unexpected license files appear. Its local manifest records source URLs,
commit, download timestamps, byte lengths, SHA-256 hashes, root file names and
license findings. Required files are `README.md`, `users.dat`, `raw-data.csv`,
`item-tag.dat` and `tags.dat`. It deliberately does not download citations or
bag-of-words data because this experiment does not use them.

Downloads are explicit, bounded by **40 MiB total transferred response bytes**,
120 seconds per attempt by default, up to two retries, and exponential bounded
backoff. `--timeout-ms` sets each attempt's budget (at most 120,000 ms) without removing
the total byte cap. Completed caches are verified by both byte count and
SHA-256 before every parse. A mismatch fails closed; nothing silently replaces
a cached file. `run` always uses offline cache; `prepare --offline` verifies and
reparses without any network. Missing caches fail as `BLOCKED: NETWORK/DATA`.
TLS validation is never disabled by the implementation. Hosts with an explicit
proxy and private system CA can use Node 24's `NODE_USE_ENV_PROXY=1` and
`NODE_USE_SYSTEM_CA=1` with `NODE_TLS_REJECT_UNAUTHORIZED=1`; do not publish proxy
values or credentials.

CiteULike-t's tag organization differs. It is not accepted by this adapter.
CiteULike-a was available during this delivery, so fallback to CiteULike-t was
unnecessary; silently parsing it with the a parser would invalidate alignment.

## Parsing and domain adaptation

`raw-data.csv` uses **1-based `doc.id`**. The parser subtracts exactly one,
requires unique contiguous IDs and validates that item-tag row count equals the
metadata item count. CSV row order is not treated as identity. `users.dat` and
`item-tag.dat` use **0-based indices**, with a row's leading count checked
against the number of raw entries before deduplication. Out-of-bounds, negative,
fractional, malformed and incomplete records fail rather than being skipped.
Duplicate interactions and tag IDs are removed and counted. UTF-8 validity is checked before decoding. Malformed sequences are retained as
standard U+FFFD replacement characters, counted per source file, without
guessing a repaired word or changing the cached original bytes. The CSV parser handles BOM, CRLF, quoted commas,
doubled quotes and embedded newlines. Empty abstracts and absent tags stay
missing; an empty title is an error.

A sampled user's **training items only** become a `ResearchLibrarySnapshot`.
Titles and abstracts come from the raw fields; article tags become `manualTags`,
a documented proxy for library tags. Authors, DOI, publication time and
interaction timestamps are absent in the downloaded schema. No missing field is
invented. The domain requires numeric `addedAt` and `modifiedAt`; both, and the
profile/ranking clock, use a common technical placeholder of zero. All training
items therefore have the same neutral decay. Even if a representative's stored
reason says `recent`, that enum is a technical consequence, **not evidence of
recency**. No time-based effectiveness claim is valid.

The adapter calls the existing `ProfileBuilder`, `RankingService` (which calls
production `diversify()`), `RecommendationEvidenceService`, `rankingMetrics`
and `evidenceMetrics`. It adds no substitute recommendation algorithm. No LLM
extractor, random embedding or live embedding is used. The production profile
builder consumes tags and selects representative papers; candidate lexical
matching consumes real title/abstract text, with the production 1,200-character
limit. Candidate tags are not appended to abstracts or presented as quotes.

The candidate contract accepts only named online-provider values. The local
adapter therefore uses `openalex` **as a typed MOCK PROVIDER compatibility
value**, paired with an explicit mock query string, stable local candidate IDs
and no `openAlexId`. It performs zero OpenAlex calls. Its numeric `providerRank`
is the local item ordinal, not a retrieval score; query-route rank does not enter
the ranking formula. No seed route is fabricated: DOI route coverage and graph
route coverage are zero. `citations.dat` is not represented as production graph
recall. The separate [live API smoke](citebloom-provider-and-dependency-audit.md), if present,
is independently measured connectivity, not part of this benchmark.

## Fixed deterministic sampling and leakage audit

Configuration is fixed before inspecting real-data results: seed `20261018`,
minimum 10 unique interactions/user, 80/20 random interaction holdout with
`max(2, floor(n × 0.2))` test items, `K=5`, and the existing production defaults.
There is no usable time field, so this is **random interaction holdout**, never
a temporal experiment. The first run uses 10 users and 50 unlabeled candidates;
the medium run uses 100 users and 200 unlabeled candidates. Selected users are a
seeded sample of eligible users, not chosen based on scores. All eligible users
are counted, and users outside the configured sample are reported separately
from evaluation failures. Exceptions abort the run rather than selecting only
successful users.

Independent SHA-256-derived Mulberry32 streams control user sampling, each
user's split and each candidate pool. Every method receives exactly the same
split, profile, pool and labels. Each pool contains **all held-out positives**
plus a uniform deterministic sample of unobserved items, excluding all the
user's observed train/test items from the unlabeled sample. There is no hard
negative selection. Unobserved items are **unlabeled, not explicit dislikes**.
The oracle inclusion makes held-out-in-pool coverage 100% by construction; it is
not achieved retrieval recall. Per-user pool size varies with held-out count,
and positive fraction is reported both pooled and macro averaged.

Popularity counts **training interactions of the sampled cohort only**. No
held-out interaction contributes to counts, profiles, prompt extraction or
feedback; there is no feedback effectiveness experiment. A held-out item for
one user may legitimately occur in another user's training set. Excluding all
such item identities across users would be a different item-cold-start task.
Checks enforce zero train/test overlap, zero training-item/pool overlap,
deduplicated candidate IDs, full oracle positive coverage, a shared unchanged
pool for all methods and the exact training contribution count. Split/pool and
ranked-output SHA-256 fingerprints are published without the underlying IDs.

**Metadata limitation:** article tags were aggregated upstream, without tag
owner or event timestamps. A training article's tags may have been contributed
by another user or at a later historical time. This protocol prevents direct
held-out-interaction leakage, but cannot establish temporal or user-attributed
tag isolation. It treats the fixed article metadata as globally available side
information. Such an assumption must accompany all reported results.

## Methods and scoring

| Method                   | Configuration                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popularity               | Descending training-only interaction count; stable candidate ID tie-break. Production feature matching is used only to derive explanation topics, never to change this order. |
| Content / Lexical        | Production `RankingService`: lexical weight 1, semantic/graph/recency weights 0, MMR lambda 1.                                                                                |
| CiteBloom Full (Offline) | Unmodified production defaults: lexical fallback, available signals and MMR lambda 0.8.                                                                                       |
| CiteBloom lambda=1       | Same default ranker with MMR lambda 1; low-cost diversity ablation.                                                                                                           |

The full production weights are lexical 0.30, graph 0.15, semantic 0.45 and
recency 0.10. Missing embeddings and dates are omitted by production
normalization, but the graph feature is **zero and still included in the
denominator**. Thus, in this dataset full base score equals `2/3 × lexical`,
with neutral preference compatibility; MMR then uses
`0.8 × baseScore − 0.2 × max Jaccard similarity to prior selections`.
The content baseline has base score `lexical` and no diversity penalty. The
lambda-1 ablation should have the same order as content, barring exact numerical
ties, because the scaling is monotonic. The full-vs-content comparison includes
this existing score scale and MMR; it is not evidence that graph or semantic
signals help. Defaults are not tuned after seeing results. Report every method
even if CiteBloom is worse.

## Metric definitions and interpretation

All ranking and evidence rates are **macro means across evaluated users**;
unsupported explanation count is a total across all returned rows. Production
metrics are reused and checked against an independent hand-calculated fixture.
For user `u`, let `R_u` be relevant IDs **actually in the pool**, `r_i` binary
relevance at rank `i`, and `K=5`:

- `Precision@5 = sum(r_i, i<=5) / 5`, including a short result list's missing
  positions in the denominator.
- Conditional `Recall@5 = sum(r_i, i<=5) / |R_u|`. In this oracle pool all
  held-out IDs happen to be present. Separate held-out-in-pool coverage is
  reported; neither is end-to-end discovery recall.
- `NDCG@5 = sum(r_i/log2(i+1), i<=5) / sum(1/log2(i+1), i<=min(5, |R_u|))`.
- Production `mrr` is the reciprocal first relevant rank **within the returned
  top five**, or zero. Tables label it **MRR@5**, not an untruncated full-pool MRR.
- `Diversity@5` is mean pairwise `1 − Jaccard(tokens(title + abstract))` over
  returned papers. The metric uses complete text; production MMR uses its
  bounded candidate text. High diversity can simply reflect heterogeneous text.
- `Novelty@5` is the fraction of returned IDs absent from training history.
  It is 1 by pool construction, not a claim of novel scientific insight or
  low-popularity recommendations.
- Evidence availability is the fraction with any valid evidence. Reason
  grounding is the fraction with reproducible production-format reasons and
  resolving evidence references. Unsupported counts reject invented snippets,
  nonresolving references, foreign topic labels and formatter differences.
  Evidence topic coverage is also in the JSON. These are deterministic evidence
  contracts, **not independent human assessments of explanation usefulness**.

The aggregate JSON includes source/item/user/interaction counts, missing field
rates, valid/eligible/sample proportions, positive fraction, skipped/failed
users, and data/split/output hashes. Method timing is the rank-only elapsed time
for one call per sampled user (mean and p95); total run time includes profiles
and explanations but excludes downloading/parsing. These are local algorithm
timings, not online-provider, Agent, GUI or Zotero latencies. No significance or
confidence-interval claim is made.

## Reproduction

Use Node 24 and `npm ci` in the repository root. An external dataset download is
opt-in and is not part of ordinary PR CI.

```bash
npm run eval:citebloom:prepare -- --dataset citeulike-a --seed 20261018 --timeout-ms 120000
npm run eval:citebloom:prepare -- --dataset citeulike-a --offline
npm run eval:citebloom:run -- --dataset citeulike-a --seed 20261018 --users 10 --unlabeled 50 --output data/evaluation/small.json --verify-determinism
npm run eval:citebloom:run -- --dataset citeulike-a --seed 20261018 --users 100 --unlabeled 200 --output data/evaluation/medium.json --verify-determinism
npm run eval:citebloom:report -- --input data/evaluation/medium.json
npm run test:eval:citebloom
npm run eval:citebloom:typecheck
```

The cache lives at `data/raw/citeulike-a/`; aggregate JSON defaults to
`data/evaluation/medium.json`. `--verify-determinism` independently executes the
benchmark twice and compares the complete deterministic output, including
split, pool, score/order hashes and all metrics. Only timing is excluded from
that result; download/execution timestamps and environment are outside the
result being compared. The report also hashes all evaluation and recommendation
TypeScript sources. Outputs contain no per-user interaction lists or excerpts.
A fixed original synthetic fixture covers parser alignment, counts, duplicates,
CSV/encoding, bounds, absent metadata, cache corruption, leakage, macro metrics
and production-backed deterministic replay with no network.

[Executed results and limitations](citebloom-evaluation-results.md) contain the
actual numbers. [Host validation](citebloom-host-validation-plan.md) remains a
separate acceptance level.
