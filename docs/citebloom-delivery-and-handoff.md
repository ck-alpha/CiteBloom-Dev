# CiteBloom 交付与下一轮验收入口

记录日期：2026-10-18（Asia/Shanghai）。定位：基于 Zotero 的个性化科研文献发现 Agent。
本轮是工程与离线证据交付，真实 Zotero / live LLM 验收仍阻塞。

## 仓库、工作区与提交

- 起点：重新 fetch 后，本地与远端 `main` 都是
  `d88abc5cc417e1a1742c1016969c2392340ea41b`。
- 原 GitHub 仓库为 `ck-alpha/zotero-research-agent`，repository ID `1359258023`，
  public，`fork=false`，默认分支 `main`；`fork=false` 不改变上游来源与版权归属。
- 本轮目标为原仓库更名至 [ck-alpha/CiteBloom](https://github.com/ck-alpha/CiteBloom)，
  保留历史、标签、issues、PR 与可见性。远端执行结果将在实际 push 后补入本节。
- 原工作区 `llm-for-zotero` 有 32 个既有 tracked 变更（17 个删除、15 个源码修改）。
  已备份二进制 diff 与状态，在独立 `citebloom-delivery` worktree 开发；没有 reset、clean、
  stash 或提交这些未知改动。原工作区仍由用户保有，不能声称它已干净。
- 本轮远端交付分支是 `main`；本地隔离分支 `citebloom-delivery` 不要求原工作区切换分支。
  未创建发布版本、未移动阶段 tags、未强推历史。

## 入口与调用链

| 入口                                                              | 作用与边界                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| [README](../README.md)                                            | 产品能力、真实贡献、上游继承、安装、当前验收层级             |
| [评测协议](citebloom-evaluation-protocol.md)                      | 数据来源/许可、ID 对齐、拆分、候选池、指标与局限             |
| [实际评测结果](citebloom-evaluation-results.md)                   | 所有实际样本配置、指标、哈希、耗时、失败与数据质量           |
| [CI 诊断](citebloom-ci-diagnostics.md)                            | 历史失败证据、新 offline gate 与宿主测试隔离                 |
| [宿主验收计划](citebloom-host-validation-plan.md)                 | 安装、真实 Agent、反馈、重启、group library、collection 删除 |
| [更名兼容性](citebloom-rename-and-compatibility.md)               | 展示信息更名、legacy ID/prefs/DB、并存与更新渠道限制         |
| [Provider 与依赖审查](citebloom-provider-and-dependency-audit.md) | OpenAlex HTTP smoke、29 项 audit 条目与后续升级范围          |

生产调用链保留：`research-intelligence` Skill → `research_recommend` →
`ProfileService` / `ProfileBuilder` → `CandidateDiscoveryService` →
`RankingService` / `diversify()` → `RecommendationEvidenceService` →
`SqliteImpressionStore`。反馈经真实确认入口 `recommendation_feedback` →
`RecommendationFeedbackService` → append-only SQLite events → replay → CAS profile revision。
本轮没有重写领域排序算法，没有把模板理由改为任意 LLM 的已验证回答。

离线数据链：`scripts/evaluation/dataset.ts` 显式有界下载/校验 → `parser.ts`
解析源数据与编码诊断 → `benchmark.ts` 固定用户内拆分、训练-only Popularity、
训练文献 snapshot → 生产 profile/ranking/MMR/evidence/metrics → `cli.ts` 汇总与确定性复跑。
`openalex` 枚举只是本地候选的 **MOCK PROVIDER** 契约适配；真实数据 benchmark 不调用 API。
`scripts/openalex-smoke.mjs` 是独立真实 HTTP 请求，不是上述生产检索链的 live E2E。

关键测试：`test/citebloomOfflineEvaluation.test.ts` 使用原创合成 fixture；
`test/recommendationFeedbackSqliteLifecycle.test.ts` 使用真实 Node 文件 SQLite。
既有 `test/recommendation*.test.ts`、`test/evaluation/` 与 `test/agentRuntime.test.ts`
继续覆盖领域与脚本模型合同。原 `test-workflows/` 完整保留。

## 本轮实际本地检查

环境：Ubuntu 24.04.4、Linux 6.8、x86_64；Node v24.20.0、npm 11.19.0；
16 logical CPUs，Intel Xeon Gold 6530；开始时约 28 GiB 可用空间。
工具链已存在，未安装 Zotero、Xvfb 或桌面。GitHub、npm registry、CiteULike-a 与
OpenAlex 均实际可访问。日期面向用户使用 Asia/Shanghai，机器报告保留 UTC 时间戳。

| 已执行命令                         | 退出码 | 实际观察                                                                                    |
| ---------------------------------- | -----: | ------------------------------------------------------------------------------------------- |
| `npm ci`                           |      0 | 448 packages added / 449 audited；lockfile 依赖版本未改                                     |
| `npm run lint:check`               |      0 | 完整 Prettier + ESLint 通过，未禁用 lint 或隐藏原文档                                       |
| `npm run typecheck`                |      0 | 插件 TypeScript 检查通过                                                                    |
| `npm run eval:citebloom:typecheck` |      0 | 独立离线 CLI 严格类型检查通过                                                               |
| `npm run test:unit`                |      0 | 最终全量 4,541 passing（41 秒）/ 1 existing pending                                         |
| `npm run test:feedback:sqlite`     |      0 | 4 passing，真实文件数据库关闭/重连、幂等与版本合同                                          |
| `npm run build`                    |      0 | 产物 `.scaffold/build/citebloom.xpi`；manifest name、new URLs、legacy addon ID 与作者已检查 |
| `npm run check:cycles`             |      0 | 0 runtime / 0 static allowlisted cycles                                                     |
| `npm run test:workflow`            |      2 | 仅宿主前置检查；BLOCKED，无二进制，未 spawn 或执行 suite                                    |
| `npm run eval:citebloom:openalex`  |      0 | 匿名 HTTP 200，3 条/3 DOI/3 摘要索引，1865 ms                                               |
| `npm audit --json`                 |      1 | 29：3 low / 7 moderate / 19 high / 0 critical；未声称清零                                   |

`npm run lint:check` 首次发现本轮新文档的格式问题；随后 whole-repo ESLint 发现新增
CSV fixture 的 4 处冗余转义。均按具体文件修复；最终完整 lint 退出 0。
原历史 8 份文档的 Prettier 问题已修复；未改 Prompt 的实质要求。
原有 pending 位于 `test/webchatExtensionContracts.test.ts`：相邻 sync-for-zotero
扩展仓库不存在时跳过 DeepSeek DOM 兼容性检查；本轮未新增该 skip。

本地数据命令、退出码、真实 10/50 与 100/200 结果见评测结果文档。完整可复现入口：

```sh
npm ci
npm run eval:citebloom:prepare -- --dataset citeulike-a --seed 20261018
npm run eval:citebloom:prepare -- --dataset citeulike-a --offline
npm run eval:citebloom:run -- --dataset citeulike-a --seed 20261018 --users 100 --unlabeled 200 --verify-determinism
npm run eval:citebloom:report
npm run test:eval:citebloom
npm run test:feedback:sqlite
npm run lint:check
npm run typecheck
npm run eval:citebloom:typecheck
npm run test:unit
npm run build
npm run check:cycles
```

默认 `run` 仅读已校验缓存，不请求网络。`data/raw/` 与本地运行产物均被 git/Prettier
忽略；公开 JSON 仅含汇总、配置、许可与哈希，没有用户交互行或论文片段。
源文件没有明确再分发许可，不上传原始全量数据。

## 远端 Actions 与剩余问题

最终 Actions URL 与各 job conclusion 在真实推送后记录。新 CI 定义不等于已执行 PASS。
默认 offline gate 包含 lint、两套 typecheck/cycles、全量 unit/SQLite、parser/指标/泄漏
fixtures 和 build。宿主 status job 明示 NOT EXECUTED；真正 host integration 是手动
desktop job，默认 SKIPPED。手动外部数据 workflow 不进入 PR 必跑 gate。

- **BLOCKED / NOT EXECUTED：ZOTERO HOST E2E**，当前服务器没有宿主；历史 collection
  delete 与 after-all 的两次 120 秒超时仍 **NOT VERIFIED FIXED**，未更改删除行为或删测试。
- **NOT EXECUTED：LIVE LLM AGENT E2E、真实用户多轮交互、Zotero 重启/group library、
  live embedding**；无人工盲评、真实满意度或线上点击效果。
- **RETRIEVAL NOT EVALUATED**：held-out positives 主动加入 pool，不能称真实召回能力。
  OpenAlex API smoke 只验证服务器连通性。
- 数据无时间/DOI/作者字段；上游 CSV 存在编码损坏；全局 article tags 无归属/时间；
  对应缺失率、替换数量、统计差异与实验局限保留在评测记录。
- 依赖漏洞尚未修复；继承 add-on ID 导致不能与上游插件在同一 profile 并存；
  不能因本轮构建/离线 CI 通过而宣称已安全升级或可直接正式发布。

## 简历表述与下一步

可以写：在基于 Yile Wang 等人 llm-for-zotero 的项目上实现/完善 Research Intelligence
模块，包含按 library 隔离的 SQLite 画像、标签/元数据兴趣建模、query/seed 双路候选
发现的生产代码、多信号排序与 MMR、证据支持边界、确认后的 event-based feedback、
CAS 版本控制与 Skill/Tool 编排；新增复用生产服务的 CiteULike 隐式交互 fixed-pool
排序评测及可复现离线合同。数据指标引用时必须一起注明样本规模、候选池、固定种子、
lexical fallback 与 oracle inclusion，并给出全部基线/消融。

禁止写：整个 Zotero UI/RAG/通用 Runtime 从零独立开发；线上个性化满意度/点击率提升；
真实完整 Agent E2E、live LLM 工具选择准确率、真实引用图模型、神经网络在线训练；
把 49 regex cases、mock provider、SQLite 重连或固定模板 grounding 当作对应真实能力验证。

下一轮最需要补做：在**已有 Zotero 的独立桌面测试 profile** 中执行宿主验收计划，
首先复现 collection 删除与 cleanup 两个历史超时并记录每个 await 的开始/完成，
随后记录真实画像→推荐→批准/取消反馈→退出重启→幂等提交闭环。完成前保持宿主矩阵
NOT EXECUTED；没有录屏时继续将 demo 称为 scripted/expected。
