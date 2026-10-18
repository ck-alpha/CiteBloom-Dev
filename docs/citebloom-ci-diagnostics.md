# CiteBloom CI 诊断与验收边界

2026-10-18（Asia/Shanghai）。本轮重新读取 GitHub Actions job 元数据与原始日志，
没有在这台 Linux 服务器安装或启动 Zotero、Xvfb 或桌面环境。

## 已核验的历史失败

[历史运行 34423048197](https://github.com/ck-alpha/CiteBloom/actions/runs/34423048197)
的 commit 是 `d88abc5cc417e1a1742c1016969c2392340ea41b`，创建时间为
2026-09-10 08:51:21（Asia/Shanghai）。它不是本轮的验证结果。

| 历史 job           | 实际 conclusion | 日志证据                                           |
| ------------------ | --------------- | -------------------------------------------------- |
| Typecheck          | success         | job 102702410915                                   |
| Build              | success         | job 102702410920                                   |
| Unit tests         | success         | job 102702411106                                   |
| Lint               | failure         | job 102702410907；Prettier 报告 8 个 Markdown 文件 |
| Workflow tests     | failure         | job 102702410769；26 passed / 2 failed             |
| Full npm test gate | skipped         | 依赖 lint 与 workflow 失败；不能算全量测试通过     |

格式问题来自 `doc/codex_phase0_phase1_prompt.md`、
`doc/codex_phase2_research_profile_memory_prompt.md`、
`doc/codex_phase3_candidate_discovery_prompt.md`、
`doc/codex_phase4_personalized_ranking_mmr_prompt.md`、
`doc/codex_phase5_feedback_learning_loop_prompt.md`、
`doc/codex_phase7_evaluation_validation_prompt.md`、
`doc/codex_readme_redesign_prompt.md`、`docs/research_agent_architecture_baseline.md`。
本轮对具体文件修复格式，保留文意；未关闭 lint，也未整目录忽略。

可复核历史证据（不需要导出凭据）：

```sh
gh run view 34423048197 -R ck-alpha/CiteBloom --json headSha,conclusion,jobs,url
gh api repos/ck-alpha/CiteBloom/actions/jobs/102702410769/logs
gh api repos/ck-alpha/CiteBloom/actions/jobs/102702410907/logs
```

本轮 `gh run view --log-failed` 返回空文本，随后直接读取 job 日志成功。
不能把空日志解释成没有失败。

## Collection delete 与清理超时

宿主日志先完成 26 个 UI 用例，随后出现：

1. `puts the collection AND its subcollections in deletedCollections`：
   08:52:56 开始，08:54:56 达到 120000 ms 超时。
2. `"after all" hook in "library operations against real Zotero"`：
   08:56:56 达到第二个 120000 ms 超时。

`test-workflows/libraryOperations.workflow.test.ts` 的第一个用例包含父/子 collection
的 `saveTx()`、`ZoteroGateway.deleteCollection()` 和两个 SQL 读取。
`src/agent/services/zoteroGateway.ts` 的普通删除将 `deleted=true`，随后等待
`collection.saveTx({deleteItems})`；永久删除才调用 `eraseTx()`。
清理钩子则依序等待搜索、条目、collection 的 `eraseTx()` 与 tag 清理。

现有日志没有逐步开始/完成记录，不能确认首个悬挂发生在 collection 创建、删除、
notifier、SQL 查询还是此前 UI 用例遗留的宿主事务状态。清理也在等待宿主异步操作，
与遗留事务/通知未完成相容，但这只是排查方向，**不是已证明的根因**。
`catch` 能处理抛错，无法处理永不完成的 Promise；Mocha 超时也不取消已经运行的
Zotero 操作，因此第二次超时不能简单视为一个独立业务错误。

`scripts/run-workflow-tests.mjs` 原来正确等待子进程 `close` 并传播非零退出码。
日志已经明确报告两个 Mocha 超时，未发现 wrapper 把成功误判为失败的证据。
本轮没有修改删除语义、扩大超时、删除用例或加入 `.skip`。这两个历史宿主失败
仍为 **FAIL / NOT VERIFIED FIXED**。

下一次在可丢弃宿主资料库中先跑原 suite，记录精确 Zotero 版本和 commit。
如果仍超时，在父 collection save、子 collection save、delete、每个 SQL read、
每个 cleanup 操作前后临时加时间点，并同时捕获 Zotero debug/transaction/notifier
状态；再比较单独运行 collection suite 与完整 suite。只有确认具体 await 和依赖链
后才调整宿主实现。保留原始失败日志与重跑结果，不仅公布通过子集。

## 当前 CI 的范围

`.github/workflows/ci.yml` 在 push/PR 运行 `quality.yml`：

| job                                          | 默认执行 | 验证范围                                                             |
| -------------------------------------------- | -------- | -------------------------------------------------------------------- |
| Offline lint                                 | 是       | 全仓库 Prettier 与 ESLint                                            |
| Offline typecheck and cycles                 | 是       | 插件与评测 CLI 类型检查、导入循环                                    |
| Offline unit and SQLite contracts            | 是       | 现有单测与真实 Node SQLite seam                                      |
| Offline parser, metrics and leakage fixtures | 是       | 原创小型合成解析、ID 对齐、指标、泄漏检查；反馈 SQLite 生命周期      |
| Offline build                                | 是       | 构建 XPI 与静态资源                                                  |
| Offline required gate                        | 是       | 上述所有 job 必须 success；任一失败/取消/跳过均令 gate 失败          |
| Zotero host validation status                | 是       | 明示宿主未执行与历史失败，状态报告成功不代表宿主通过                 |
| Zotero host integration (manual desktop)     | 否       | 仅 workflow_dispatch 显式请求，在现有桌面 runner 上运行原 host suite |

“required gate” 是 job 名称及依赖要求，不代表已经修改 GitHub 分支保护规则。
没有使用 `continue-on-error` 将宿主失败变绿，也不再用重复运行 `npm test` 的 aggregate
把宿主依赖伪装成纯离线 gate。`npm test` 仍包含 host suite；服务器使用
`npm run test:offline`，构建/lint 分别执行。

锁定的 scaffold 0.8.2 在 CI 自动启用 headless，其内部会尝试安装 Xvfb/系统包并下载
Zotero。为遵守本轮边界，wrapper 在 spawn 前要求现有
`ZOTERO_PLUGIN_ZOTERO_BIN_PATH`，Linux 还要求现有 `DISPLAY`；缺失立即以 code 2
报告 `BLOCKED`。`CITEBLOOM_EXISTING_DESKTOP=1` 触发 config 的 `test:init` hook，
关闭该 scaffold 自动 headless 安装路径。测试代码、失败处理和测试选择保持原行为。

本轮实际执行 `npm run test:workflow` 的前置检查：**exit 2**，输出
`BLOCKED: ZOTERO HOST NOT CONFIGURED`，因为未设置现有 Zotero 可执行文件。
它在启动子进程前退出，**宿主测试 suite 未执行**，不是 0 个失败的宿主 PASS。

宿主手动执行与 runner 配置见
[宿主验收计划](citebloom-host-validation-plan.md)。本轮最新远端 SHA、Actions URL
与各 job 实际结果以[交付记录](citebloom-delivery-and-handoff.md)为准；不能用此文档
中的历史 PASS 数或新 workflow 定义推断远程已通过。

## SQLite 闭环的实际覆盖

本轮执行 `npm run test:feedback:sqlite`：**exit 0，4 passing**。
文件为 `test/recommendationFeedbackSqliteLifecycle.test.ts`，重用现有真实
`ResearchProfileTestDb`（Node `node:sqlite` 文件数据库）、`ProfileService` / 内部
`ProfileBuilder`、`RankingService` / 内部 MMR、三个 SQLite stores、
`RecommendationFeedbackService`、`AgentToolRegistry` 与真实 feedback tool。

验证训练文献→画像→排序→曝光→受控正反馈→SQLite→画像版本→再排序→关闭/重连→
幂等提交；另外验证确认取消无写入、错误 scope/不存在的曝光成员拒绝、画像写入
故障后持久事件的重连重放，以及真实 SQLite 的旧版本冲突。重复事件只保留一行，
重复已应用反馈不再增加版本。没有另写内存推荐器或冒充 Zotero DB。

这些是原创合成合同 fixture，候选的 `openalex` 枚举仅为 **MOCK PROVIDER** 合同
兼容，未请求真实 API。它们不是历史用户的明确偏好输入，没有测试集效果提升主张，
也不要求下一次 Top-K 必须改变。不代表 Zotero 重启或真实 LLM/GUI 反馈通过。

## 独立手动外部数据评测

`.github/workflows/citebloom-evaluation.yml` 只有 `workflow_dispatch`，不挂在 push/PR
或 offline required gate。固定 seed 20261018、100 用户、200 个未观察候选/用户，
下载上限 40 MiB、单次 120 秒、最多 2 次重试，job 总上限 20 分钟。
先执行 synthetic fixture，再显式 prepare，离线缓存 run + deterministic replay，
最后生成 aggregate report。失败保留非零结果，不宣传成功。

```sh
gh workflow run citebloom-evaluation.yml -R ck-alpha/CiteBloom --ref main
```

artifact 仅包含 `preparation.json`、`medium.json` 与 `medium.md`：文件哈希、许可
审查、解析质量和指标汇总；不上传 `data/raw`、原始论文元数据/摘要、用户交互行。
该手动 job 尚未执行时不能根据其定义声称 CI 上真实数据评测已经通过。
