# CiteBloom real-data offline evaluation results

Actual executions on **2026-10-18 (Asia/Shanghai)**, Linux x64, Node **24.20.0**, Intel Xeon Gold 6530 (16 logical CPUs exposed). The raw artifacts record UTC timestamps. No Zotero or GUI was installed.

**REAL-DATA OFFLINE EVAL: PASS** for the bounded protocol and deterministic replay. This is **ORACLE / FIXED-POOL RANKING EVAL** on historical implicit interactions, with **RETRIEVAL NOT EVALUATED**. Production lexical ranking and evidence contracts ran against real metadata; the `openalex` provider value is explicitly a **MOCK PROVIDER compatibility marker**, with no API calls in this experiment.

The default CiteBloom full ranker does **not** beat the lexical baseline on NDCG@5 in either reported run. All configurations and both sample sizes are reported below, without tuning after results. These are conditional ranking proxies, not real user satisfaction, online click rates, or Zotero Agent effectiveness.

## Data actually obtained

[CiteULike-a](https://github.com/js05212/citeulike-a), pinned upstream commit `91b603922d7f2d3db18071d4798bf78c9c5d1680`, downloaded into ignored `data/raw/citeulike-a/`. All five cached files passed byte-count and SHA-256 verification. The pinned repository has **no explicit LICENSE/COPYING/NOTICE**, and no affirmative redistribution permission was established. Upstream attributes CiteULike, Google Scholar and Wang/Blei; its historical terms link could not be verified. No raw records, abstract excerpts or interaction arrays are committed. See the [protocol](citebloom-evaluation-protocol.md).

| File           |      Bytes | SHA-256                                                            |
| -------------- | ---------: | ------------------------------------------------------------------ |
| `README.md`    |      3,141 | `733c83b5a7dfc2183a9fbbc085c2dc4d8b07f2e74898f3f996dc9ce2cf201259` |
| `users.dat`    |  1,094,785 | `53211d82c14ff261e595634d285ed9fbf8049cf81dcb751d924d695b9612a02c` |
| `raw-data.csv` | 23,719,886 | `10b7a15ac2f7f1e03c6c8229c1398b716b89edfd199dbbdb7be547345d51c50f` |
| `item-tag.dat` |  1,423,307 | `0f7b432796a5038ed2631c02b99d70e636123673afc11bf9e051de5b49467890` |
| `tags.dat`     |    628,894 | `c02b3e5ee1a57f88f3a598b2040018bb198f54cd0c11116fa7a0db905b6f60e3` |

Total cached source bytes: **26,870,013**; download dates: 2026-10-18 10:50–10:51 Asia/Shanghai.

Parser findings: **5,551 users, 16,980 items, 46,391 tags, 204,986 interactions**; 16,980 item-tag rows. The README advertises 204,987 interactions, one more than the actual length-prefixed file; the benchmark uses the measured 204,986. No duplicate interactions or tag IDs were removed. CSV/DAT structural parsing succeeded for 100% of rows, with all 1-based/0-based ID and length-prefix checks passing.

**Source encoding defect:** `raw-data.csv` is not valid UTF-8. Its deterministic decoding produces 82,224 U+FFFD replacement characters. Additional independent CSV inspection found 73 affected abstracts and zero affected titles. Raw bytes and hashes were preserved; no word reconstruction was guessed and no affected user/item was discarded. This degrades some lexical/evidence text and limits interpretation of scores. Other downloaded files decode as valid UTF-8.

| Missing field               |                 Fraction |
| --------------------------- | -----------------------: |
| Abstract                    |                       0% |
| Article tags                | 20.382803% (3,461 items) |
| DOI                         |                     100% |
| Publication time            |                     100% |
| Interaction/collection time |                     100% |
| Authors                     |                     100% |

Missing is based on this source schema, not an assertion that the original papers have no DOI/authors. Required domain timestamps use a common zero placeholder; no recency benefit is measured. Upstream aggregate tags have neither owner nor time, so historical user-attributed/temporal tag isolation cannot be established. Direct held-out interactions never build profiles or popularity counts.

## Fixed protocol and actual sample coverage

Seed **20261018**, minimum 10 unique interactions, 80/20 per-user random holdout with at least two test positives, K=5. All 5,551 users meet eligibility. Every method uses the same sampled users, training split and candidate pools. Uniform unlabeled samples exclude the user’s observed items; all held-out positives are injected into the pool. Unobserved is not negative feedback. Popularity uses training interactions of the sampled cohort only.

| Diagnostic                            |   Small run |  Medium run |
| ------------------------------------- | ----------: | ----------: |
| Evaluated users                       |          10 |         100 |
| Evaluated / eligible users            |   0.180148% |   1.801477% |
| Processed observed interactions       |         284 |       4,219 |
| Training interactions                 |         230 |       3,413 |
| Held-out interactions                 |          54 |         806 |
| Distinct sampled observed items       |         275 |       3,529 |
| Total candidate appearances           |         554 |      20,806 |
| Minimum pool size                     |          52 |         202 |
| Mean pool size                        |   55.400000 |  208.060000 |
| Maximum pool size                     |          65 |         266 |
| Pooled positive fraction              |   9.747292% |   3.873883% |
| Macro positive fraction               |   9.282459% |   3.689352% |
| Held-out positives present in pool    | 100.000000% | 100.000000% |
| Profiles with no topics               |           0 |           1 |
| Failed users                          |           0 |           0 |
| Eligible users outside bounded sample |       5,541 |       5,451 |

The small run uses 50 unlabeled items/user; medium uses 200. Training/test interaction overlap, training-item/pool overlap and duplicate candidate IDs are all **zero** in both runs. Same-pool assertions and training-only popularity contribution audits pass. There are zero feedback updates, no live embeddings and zero seed-DOI/graph route coverage. Selection outside the bounded sample is reported above; it is not a failed evaluation.

## Ranking and evidence outcomes

Macro means across evaluated users, six decimals. **MRR@5 is truncated at five** by the production metric. Conditional Recall@5 divides by relevant IDs actually present in each pool. Diversity is mean pairwise title/abstract Jaccard distance. Novelty is ID-unseen-in-training and equals 1 by construction. Evidence grounding is a deterministic contract, not an independent human quality rating. Unsupported is a total count, not a macro rate.

### Small: 10 users, 50 unlabeled/user

| Method                   |   NDCG@5 | Recall@5 |    MRR@5 | Precision@5 | Diversity@5 | Novelty@5 |
| ------------------------ | -------: | -------: | -------: | ----------: | ----------: | --------: |
| Popularity               | 0.063995 | 0.027619 | 0.120000 |    0.060000 |    0.914635 |  1.000000 |
| Content / Lexical        | 0.706569 | 0.590000 | 0.783333 |    0.520000 |    0.897189 |  1.000000 |
| CiteBloom Full (Offline) | 0.691962 | 0.580000 | 0.783333 |    0.500000 |    0.901368 |  1.000000 |
| CiteBloom lambda=1       | 0.706569 | 0.590000 | 0.783333 |    0.520000 |    0.897189 |  1.000000 |

| Method                   | Evidence availability | Topic evidence coverage | Reason grounding | Unsupported count |
| ------------------------ | --------------------: | ----------------------: | ---------------: | ----------------: |
| Popularity               |              1.000000 |                0.532400 |         0.940000 |                 0 |
| Content / Lexical        |              1.000000 |                0.456670 |         1.000000 |                 0 |
| CiteBloom Full (Offline) |              1.000000 |                0.454015 |         1.000000 |                 0 |
| CiteBloom lambda=1       |              1.000000 |                0.456670 |         1.000000 |                 0 |

### Medium: 100 users, 200 unlabeled/user

| Method                   |   NDCG@5 | Recall@5 |    MRR@5 | Precision@5 | Diversity@5 | Novelty@5 |
| ------------------------ | -------: | -------: | -------: | ----------: | ----------: | --------: |
| Popularity               | 0.103587 | 0.065464 | 0.174833 |    0.098000 |    0.910444 |  1.000000 |
| Content / Lexical        | 0.468707 | 0.325288 | 0.643167 |    0.352000 |    0.889992 |  1.000000 |
| CiteBloom Full (Offline) | 0.465644 | 0.328210 | 0.648500 |    0.348000 |    0.894711 |  1.000000 |
| CiteBloom lambda=1       | 0.468707 | 0.325288 | 0.643167 |    0.352000 |    0.889992 |  1.000000 |

| Method                   | Evidence availability | Topic evidence coverage | Reason grounding | Unsupported count |
| ------------------------ | --------------------: | ----------------------: | ---------------: | ----------------: |
| Popularity               |              1.000000 |                0.525690 |         0.838000 |                 0 |
| Content / Lexical        |              1.000000 |                0.451107 |         0.990000 |                 0 |
| CiteBloom Full (Offline) |              1.000000 |                0.449252 |         0.990000 |                 0 |
| CiteBloom lambda=1       |              1.000000 |                0.451107 |         0.990000 |                 0 |

On medium, default MMR changes NDCG@5 by **-0.003063** and Diversity@5 by **+0.004719** relative to lexical. This is a descriptive tradeoff on one fixed sample, with no significance or practical-usefulness claim. Lambda=1 equals lexical ordering in this source/configuration. No configurations or users were removed after observing outcomes.

The full ranker has no embeddings, real graph route or publication date here. Its default graph feature is zero but retains weight 0.15 in the normalization denominator, giving a `2/3 × lexical` base score; MMR then uses lambda 0.8. Consequently full-vs-lexical reflects default score scale plus MMR, not multiple observed retrieval channels. The complete formula and limitations are in the protocol.

## Runtime and deterministic reproduction

| Run    | First benchmark wall-clock | Independent replay wall-clock | Stable SHA-256                                                     |
| ------ | -------------------------: | ----------------------------: | ------------------------------------------------------------------ |
| Small  |                    5.266 s |                       5.191 s | `dc32d14a3b56d406ad607553080cbddc543d39826e8f1e2a0e26492b7872b5d9` |
| Medium |                  162.148 s |                     163.274 s | `6a909114968e5f5d54f5383801d036a434edd48faa7d039caef594c6ad37f972` |

**Both deterministic comparisons passed**, including all aggregate metrics and split/pool/ranked-score fingerprints, after excluding timing. The medium run overlapped the repository unit/build/type/lint checks on the same host, so these are elapsed-time diagnostics under observed contention, not an isolated performance benchmark. Each method latency has one measurement per evaluated user (10 or 100); these are offline local rank-only timings, excluding downloads, parsing, profile construction, explanations, provider, GUI and Agent latency. Full benchmark wall-clock includes profiles and explanations, but excludes parsing/downloads.

| Method                   | Small mean / p95 (ms) | Medium mean / p95 (ms) |
| ------------------------ | --------------------: | ---------------------: |
| Popularity               |       12.614 / 17.804 |        12.649 / 16.012 |
| Content / Lexical        |     145.208 / 169.898 |      512.019 / 564.838 |
| CiteBloom Full (Offline) |     141.793 / 170.078 |      511.630 / 562.786 |
| CiteBloom lambda=1       |     141.584 / 169.051 |      510.853 / 562.854 |

Medium reproducibility fingerprints:

- Split: `8544743a0a66b99f09fe79485bfbb6080dc37d9ce2a6ac8cf332e99b9d903474`
- Pools: `e887205bc4c197b16cc32abf5d3ec283b57a41abc3adfbefdacec20bfc0a9229`
- Ranked IDs/scores/topic IDs: `655efff52373feff4bf8de0a69503992c7f84b6fb749570d5a0782ed07b2f701`
- Evaluation and recommendation TypeScript source tree: `cd972fec7ead81430a7e2479de4ee7a02aaf2a9e2a301d5d52c1ea0a0945c872`

The [aggregate machine-readable report](citebloom-evaluation-summary.json) preserves full precision and provenance without per-user rows or original text. Local `data/evaluation/small.json` and `medium.json` are ignored. The four methods are production-backed except the straightforward training-count popularity baseline; all evidence formatting and metrics are production code.

## Executed commands and failures

All final commands below returned **exit 0** on this server:

```bash
npm run eval:citebloom:prepare -- --dataset citeulike-a --offline
npm run eval:citebloom:run -- --dataset citeulike-a --seed 20261018 --users 10 --unlabeled 50 --output data/evaluation/small.json --verify-determinism
npm run eval:citebloom:run -- --dataset citeulike-a --seed 20261018 --users 100 --unlabeled 200 --output data/evaluation/medium.json --verify-determinism
npm run eval:citebloom:report -- --input data/evaluation/medium.json
npm run eval:citebloom:typecheck
npm run test:eval:citebloom
```

The focused regression suite contains **13 passing** original synthetic tests. Parser and CLI TypeScript checks pass. Ordinary CI runs only these fixtures and does not download external datasets.

Two initial prepare attempts failed honestly (exit 1): the original 30-second per-attempt timeout exhausted the total 40 MiB retry budget while transferring metadata; a 120-second retry successfully cached every file but strict decoding exposed malformed source UTF-8. The downloader now defaults to 120 seconds, preserves the 40 MiB cap, and records explicit replacement decoding. Cache verification/reparse subsequently succeeded offline. No failed experiment is labeled as a completed result. For a fresh cache, the implemented command is:

```bash
npm run eval:citebloom:prepare -- --dataset citeulike-a --seed 20261018 --timeout-ms 120000
```

The successful transfer used Node 24 system-CA and environment-proxy support with TLS verification enabled. The final prepare script enables those built-in Node flags; no proxy values, credentials or personal filesystem paths are included in artifacts.

## Acceptance boundaries

- **CODE IMPLEMENTED / UNIT-CONTRACT PASS:** parser, production profile/ranking/MMR/evidence/metrics adaptation, deterministic splits and replay; separate SQLite feedback contracts are recorded in the handoff.
- **REAL-DATA OFFLINE EVAL:** both bounded runs above completed, using actual historical interactions.
- **MOCK PROVIDER:** offline candidate contract adapter only. CandidateDiscoveryService online retrieval is not exercised by this benchmark.
- **LIVE OPENALEX API SMOKE:** separate [provider audit](citebloom-provider-and-dependency-audit.md); not merged into personalized metrics.
- **NOT EXECUTED:** full-item retrieval evaluation, semantic embeddings, real citation-graph effectiveness, temporal evaluation, human usefulness assessment or controlled feedback improvement.
- **BLOCKED / NOT EXECUTED:** Zotero host E2E, live LLM Agent E2E and real Agent-interface user interaction.

This supports a portfolio claim of a reproducible **real historical-data conditional ranking benchmark with production-domain reuse and explicit evidence/leakage audits**. It does not support claims of real Zotero online recommendation quality or proven scientific discovery value. The next external validation is the [desktop Zotero host checklist](citebloom-host-validation-plan.md).
