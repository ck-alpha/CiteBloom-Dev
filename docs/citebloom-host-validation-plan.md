# CiteBloom 真实宿主验收计划

2026-10-18（Asia/Shanghai）。本轮 Linux 服务器无 Zotero/桌面/library/PDF，以下
宿主与真实模型项目均为 **NOT EXECUTED / BLOCKED: ZOTERO HOST NOT INSTALLED**。
Node SQLite 与脚本模型合同通过，只证明各自离线范围。此表是下一轮可执行清单，
不是本轮已通过清单；不得将预期输出写成实际观察。

## 桌面前提与执行命令

在有 Zotero 的 Windows、macOS 或 Linux 桌面验收，使用可丢弃测试资料库和独立
profile，不使用日常资料库。记录 commit、OS、Zotero 精确版本、插件版本、library
ID、provider 配置名与验收时间；不要记录 key、token 或个人资料路径。
先构建并从 Zotero 的插件管理界面安装 `.scaffold/build/citebloom.xpi`：

```sh
npm ci
npm run build
```

继承的 add-on ID 仍为 `zotero-llm@github.com.yilewang`；它与上游插件不能安全地
按两个独立插件同时安装。详见[兼容性说明](citebloom-rename-and-compatibility.md)。

自动宿主 suite 用 scaffold 创建的 `.scaffold/test/profile` 与 `.scaffold/test/data`
测试环境，仍会实际创建、删除测试条目与 collection。运行用户必须有桌面会话权限。
先设置现有二进制位置；Linux 还须继承有效 `DISPLAY`，不要将示例路径当成实际安装：

```sh
# Linux/macOS shell；路径替换为已有的 Zotero 可执行文件。
export ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/absolute/path/to/existing/zotero
npm run test:workflow
```

Windows PowerShell：

```powershell
$env:ZOTERO_PLUGIN_ZOTERO_BIN_PATH = 'C:\Program Files\Zotero\zotero.exe'
npm run test:workflow
```

也可继续通过既有 `.env.example` → `.env` 配置，wrapper 会在检查前加载它；已有
进程环境变量优先。不要提交 `.env` 或在日志中打印其内容。

wrapper 先验证文件存在、可执行及 Linux DISPLAY，缺失时 exit 2 并报告 BLOCKED，
不会安装宿主。桌面 hook 禁用 scaffold 的 CI 自动安装/下载路径。
保留 `--abort-on-fail`；失败后的未运行用例必须记 NOT EXECUTED，而非 PASS。
清理超时后保留调试证据，再关闭测试宿主；不能因清理是 best effort 就忽略失败。

## 手动 GitHub Actions 宿主 job

需要仓库维护者**事先**准备隔离桌面 runner 并配置标签 `self-hosted`、
`citebloom-zotero`，在 runner 进程环境中提供上述 Zotero 路径，Linux 还须可访问
DISPLAY；Windows runner 要在交互桌面用户会话运行，而非不可见的系统服务会话。
Node 24 与 npm 由 job 配置。不得把无 runner 的排队状态写成 PASS。
此轮没有注册 runner 或安装桌面。

在 GitHub Actions 的 `CI` 选择 `Run workflow`，分支 `main`，勾选
`run_host_tests`，或者：

```sh
gh workflow run ci.yml -R ck-alpha/CiteBloom --ref main -f run_host_tests=true
gh run list -R ck-alpha/CiteBloom --workflow ci.yml --limit 5
```

该 job 仅接受显式 workflow_dispatch，PR 不在桌面 runner 执行。完整 host suite
非零退出会令 job failure，20 分钟 job 上限不会把失败改成通过。普通 push/PR 里
该 job 为 SKIPPED，独立 `Zotero host validation status` 提醒 NOT EXECUTED。
同一 CI 的 offline gate success 只代表离线检查。

## 人工验收矩阵

| 操作/场景                  | 操作与核验依据                                                                                                                                                        | 本轮状态     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 安装与显示名               | 安装构建的 XPI，重启 Zotero，核对 CiteBloom 名称、设置页、原有配置读取与无初始化异常                                                                                  | NOT EXECUTED |
| Agent/Provider 设置        | 选择内置 Agent 模式，使用合法自有模型/provider 配置；记录 provider 名，不存密钥；不使用脚本模型替代真实调用                                                           | NOT EXECUTED |
| 个人资料库画像             | 用至少两篇有真实标签/摘要/DOI 的测试条目调用 `research_profile_get({})`；首次 built、再次 loaded，显式 refresh 后 revision 合理、主题可追溯                           | NOT EXECUTED |
| 实际 OpenAlex 候选发现     | `research_candidate_discover({"limit":5})`，核对 provenance、当前 scope、已有 DOI 排除、provider 错误与部分失败；服务器 HTTP smoke 不能替代这个入口                   | NOT EXECUTED |
| 推荐与证据                 | `research_recommend({"topK":3})`，核对顺序/rank、分数、matchedTopics、摘要证据 refs；无摘要明确证据不足；保存真实 recommendationId/candidateId                        | NOT EXECUTED |
| 明确反馈与取消             | 对真实曝光调用 `recommendation_feedback` positive/save/negative/skip，先拒绝一次确认核对无写入，再批准；检查版本、计数、条目数不被 save 改变                          | NOT EXECUTED |
| 重复与错误 scope           | 重复相同事件返回 already_recorded、不增行/版本；用另一 library 提交旧曝光应拒绝，两个画像均不变                                                                       | NOT EXECUTED |
| Zotero 真实退出/重启持久化 | 关闭整个 Zotero 进程并重开，核对画像 version、曝光、事件、旧曝光幂等；只读检查既有 profiles/impressions/feedback 表，不能用 Node 重新连接代替                         | NOT EXECUTED |
| Group library              | 两个不同标签 library 切换画像/候选/evidence；验证只读 group 的实际权限行为以及反馈隔离；保存两库 ID 与结果                                                            | NOT EXECUTED |
| 真实多轮模型               | 自然语言“推荐三篇→第二篇有兴趣→换个方向→再次推荐”，核对真实 tool 选择、参数、确认、代词指代、最终证据陈述；记录失败与未调用工具的回合，不用 regex 49 案例当模型准确率 | NOT EXECUTED |
| Provider 失败与降级        | 断网/模拟失败时核对错误或 partial fallback；无 embedding 时 lexical fallback，未持久化曝光不能展示为持久推荐                                                          | NOT EXECUTED |
| 真实 embedding（可选）     | 仅在合法配置可用时验证 semanticRequested/Succeeded 与实际服务调用；离线随机或 mock 向量不能算通过                                                                     | NOT EXECUTED |
| 宿主 collection 删除回归   | 完整 `npm run test:workflow`；特别核对 collection/subcollection trash 与 after-all cleanup 两个历史超时，保留失败日志，按 CI 诊断收窄具体 await                       | NOT EXECUTED |

每项记录实际输入、可脱敏 tool 输出/宿主 DB 证据、通过/失败/阻塞、耗时、记录路径和后续
修复项。整表不能因一项成功而统一改 PASS。真实 LLM 的最终自然语言结论还需要独立人工
核对，不能由固定模板 reason grounding 指标替代。

下一轮优先任务：在有 Zotero 的桌面测试 profile 中重跑 collection 删除与完整 host
suite，捕获首次未完成操作与 cleanup 的时间点。随后完成画像→推荐→批准/取消反馈→
真实 Zotero 重启→重复提交这条闭环，并保留可复核记录。
