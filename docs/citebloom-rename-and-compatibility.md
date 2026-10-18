# CiteBloom 更名与兼容性

2026-10-18。本轮对外项目名为 **CiteBloom**，定位为“基于 Zotero 的个性化科研文献发现 Agent / Personalized Research Discovery Agent for Zotero”。`Research Intelligence` 保留为功能模块名。

## 仓库与来源

当前项目入口为 [ck-alpha/CiteBloom](https://github.com/ck-alpha/CiteBloom)。本轮操作针对原 `ck-alpha/zotero-research-agent` 仓库更名，保持原 Git 历史、issues、PR、标签和公开可见性；不创建替代仓库、不强推历史。实际远端仓库身份、重定向验证、提交 SHA 和 Actions 状态以[交付记录](citebloom-delivery-and-handoff.md)为准，不能由文档中的目标 URL 推断操作成功。

GitHub 的 `fork` 字段不是来源或版权声明。项目基于 [Yile Wang 与贡献者的 llm-for-zotero](https://github.com/yilewang/llm-for-zotero)，继承 Zotero UI、Agent Runtime、RAG/PDF、provider、确认和 change journal 等基础能力。CiteBloom 的新增贡献是 Research Intelligence 领域实现与编排、画像和反馈持久化、排序/MMR、证据边界及可复现离线评测，详见 [README Contributions](../README.md#contributions)。

## 本轮修改的展示与打包信息

| 项目                               | 当前值 / 行为                                                   |
| ---------------------------------- | --------------------------------------------------------------- |
| npm `name`、lockfile 根包名称      | `citebloom`                                                     |
| `description`                      | `Personalized Research Discovery Agent for Zotero`              |
| `repository` / `bugs` / `homepage` | `ck-alpha/CiteBloom` 对应地址                                   |
| `config.addonName`、manifest name  | `CiteBloom`；manifest 仍通过构建替换 `__addonName__`            |
| XPI 文件                           | `.scaffold/build/citebloom.xpi`，由 scaffold `xpiName` 显式配置 |
| 菜单、设置页、启动状态与页签       | 英文和简体中文 Fluent 文案均展示 `CiteBloom`                    |
| 设置页注册、图标辅助标题、帮助文字 | 使用 `CiteBloom` 展示名                                         |
| Codex App Server 客户端标题        | `CiteBloom`；机器可读 client name 不变                          |
| `version`                          | `3.9.5`，继承版本保持不变；未据此宣称新版本已发布               |
| `author` / `license`               | `Yile Wang` / `AGPL-3.0-or-later`，保持不变                     |

`zotero-plugin.config.ts` 继续从 package config 读取 manifest 展示名、ID、namespace、prefs prefix。改名不新增 DB schema、不执行配置迁移。MinerU 导出包中的 `addonName` 是展示元数据，会随新名称更新；读取兼容性由未变的 `kind`、版本和来源 key 决定。

## 有意保留的兼容性标识

| 标识                       | 保留值 / 边界                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| add-on ID                  | `zotero-llm@github.com.yilewang`                                                                                                     |
| runtime / chrome namespace | `addonRef=llmforzotero`、`addonInstance=LLMForZotero`                                                                                |
| 偏好前缀                   | `extensions.zotero.llmforzotero`                                                                                                     |
| 推荐持久化表               | `llm_for_zotero_research_profiles`、`llm_for_zotero_recommendation_impressions`、`llm_for_zotero_recommendation_feedback`            |
| 其他持久化表和缓存         | 现有表、Skill 存储目录、MinerU / embedding / journal 缓存路径继续沿用 legacy 名称                                                    |
| 外部协议                   | `/llm-for-zotero/mcp`、WebChat 路径、scope header、机器可读 client name 和同步包 `kind` 不变                                         |
| 工作流配置                 | 既有 `LLM_FOR_ZOTERO_*` 开关继续可用                                                                                                 |
| Skill 与 Tool API          | `research-intelligence`、`research_profile_get`、`research_candidate_discover`、`research_recommend`、`recommendation_feedback` 不变 |
| 历史记录与上游文档         | 原 Prompt、历史提交/XPI 名称、上游文档、credits 和支持链接保留其历史含义                                                             |

这些字符串不应通过全库替换消除。它们可能是数据库身份、持久化路径、协议合同或调用方依赖，而非可见品牌。上游 model capability registry 和 PDF runtime 下载地址也保留其真实服务来源，本轮没有复制或重新发布这些服务。

新建或导出的笔记使用 `Written by CiteBloom.` 作为生成工具标记，不是对上游代码的版权主张。导出器同时识别旧 `LLM-for-Zotero` 和新 footer，以免重复。`write-note` 默认模板更新为内部版本 10（项目版本仍为 `3.9.5`）；仅精确匹配已知旧默认内容的模板自动更新，用户定制正文与 managed block 之外的定制保留。managed marker 和 Skill ID 不变。MinerU 同步附件标题含旧名称且参与已有包的识别，因此继续保留。

## 当前并存与升级限制

**CiteBloom 与原 llm-for-zotero 使用同一 add-on ID，不能在同一个 Zotero profile 并存。** 安装 CiteBloom XPI 会替换相同 ID 的插件。首次宿主验收应使用可丢弃的独立 Zotero profile 和测试 library，并事先保留配置与资料备份。

同一 ID 与偏好前缀让已有配置仍可寻址，但本轮 Linux 服务器没有 Zotero，因此不能把静态检查、单元测试或构建成功表述为真实宿主升级成功。没有执行真实安装、旧配置加载、重启、回滚、同步或 group library 验收。具体步骤见[宿主验证计划](citebloom-host-validation-plan.md)。

新构建的 manifest homepage/update 地址由 CiteBloom 仓库元数据生成；历史已安装构建可能仍指向原上游更新渠道。源码更名不会追溯修改它们，也不保证 GitHub 更名重定向等同于插件更新迁移。没有新建发布 tag、没有承诺自动升级，需在未来受控宿主中核验更新渠道。

## 后续安全迁移计划

1. 先在真实桌面记录旧版 profile、prefs、SQLite、Skill/cache 路径和同步包样本，验证备份恢复与本次同 ID 安装。
2. 若确需独立 add-on ID 以支持并存，单独设计带版本的、用户可见的迁移，不与展示更名混合。
3. 采用显式来源检查、复制后校验、冲突处理、幂等重试与可回退备份；新旧实例同时运行时不得写入同一份状态。
4. 覆盖旧→新升级、取消/失败恢复、重复迁移、个人库与 group library 隔离、重启以及外部 MCP/WebChat 客户端兼容。
5. 迁移与宿主验收完成后才考虑新的发布版本和更新渠道。此次交付不宣称上述迁移已实现。

## 许可

[LICENSE](../LICENSE) 中的 **AGPL-3.0-or-later**、版权与上游贡献归属保留。品牌更名不改变许可义务，也不代表 Zotero 集成、通用 Agent Runtime 或 PDF/RAG 体系由本项目从零开发。[保留的使用指南](../doc/existing-usage.md)继续记录 Yile Wang、其他贡献者与上游支持入口。
