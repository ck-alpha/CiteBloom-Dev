# CiteBloom：Provider smoke 与依赖审查

本记录日期为 2026-10-18（Asia/Shanghai）；请求时间保留 UTC ISO 以便复核。

## 真实 OpenAlex API smoke

已执行命令（Node 24）：

```sh
npm run eval:citebloom:openalex
```

底层为 `node --use-env-proxy --use-system-ca scripts/openalex-smoke.mjs`。
先直接执行底层命令退出码 0；随后通过上述 npm 命令复跑，退出码 0，记录如下：

| 字段                           | 实际结果                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| 验收层级                       | LIVE OPENALEX API SMOKE：PASS                                                      |
| 请求日期                       | 2026-10-18T02:49:45.709Z                                                           |
| 方法与 endpoint                | GET `https://api.openalex.org/works`                                               |
| 参数                           | `search=research discovery`, `per_page=3`, `select=id,doi,abstract_inverted_index` |
| 身份验证                       | anonymous；未配置私人 API key                                                      |
| HTTP / 尝试次数                | 200 / 1                                                                            |
| 返回条数 / 有 DOI / 有摘要索引 | 3 / 3 / 3                                                                          |
| 本次请求耗时                   | 1865 ms；单次服务器网络请求，非 GUI/Agent 延迟                                     |
| 失败码                         | null                                                                               |

脚本只保存统计到忽略的 `data/reports/openalex-smoke.json`，不保存摘要或原始响应。
每次显式运行最多 3 次请求，单次 15 秒，响应上限 1 MiB，只有 429 才重试，
指数退避并遵守预算内的 Retry-After；超出预算则停止。可选密钥只从
`OPENALEX_API_KEY` 读取，通过 Authorization 发送，不输出请求头或错误原文。
强制启用证书验证；Node 24 使用系统 CA 及已配置环境代理，不记录代理地址。

身份验证规则以查阅时更新于 2026-10-15 的
[OpenAlex 官方 Authentication 文档](https://help.openalex.org/api/authentication/)
为依据：允许基础匿名调用；更大规模请求与游标分页需要适当 API key，并须处理 429。
这里只运行首屏的 3 条搜索，未申请账号、未购买额度、未进行批量检索。

这是独立 HTTP 连通性与字段完整性检查。它没有执行生产 CandidateDiscoveryService、
Zotero 宿主或 live LLM；没有用户偏好标签，不计算个性化质量指标。
离线 CiteULike 适配器的 mock provenance 也不能由此变成实际 OpenAlex 召回。

## 依赖审查

`npm ci` 退出 0：新增 448 个包、审计 449 个包。`npm audit --json` 退出 1：
29 个漏洞条目（3 low、7 moderate、19 high、0 critical）。这是本轮实际查询，
不代表 29 个独立可利用漏洞，也不能据此宣称项目安全。依赖版本未批量升级。

| 直接依赖               | 报告等级 | 审查与后续动作                                                                                                                                            |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fflate                 | moderate | ZIP64 畸形压缩包无限循环，`<0.8.3`；用于附件/压缩包解码。优先独立升级至修复版本并补恶意归档限额回归。                                                     |
| mermaid                | moderate | 配置、Architecture 原型污染及 CSS/图表 DoS；官方修复范围涉及 11.16.1 及依赖 KaTeX。需连同实际随插件分发的 vendor 资产验证，不能仅更新 lockfile 宣称完成。 |
| katex                  | low      | 已存在原型污染可绕过 trust；audit 建议跨当前 0.x minor 的版本更新，需渲染/宿主回归。                                                                      |
| mocha                  | moderate | 传递依赖 diff、serialize-javascript；audit 建议 12.0.3 major，暂未自动升级测试框架。                                                                      |
| zotero-plugin-scaffold | high     | 传递依赖 adm-zip；audit 建议 0.9.2，涉及打包/宿主测试运行器，需专门迁移验证。                                                                             |

另外包含 lint/build 工具链中的 glob、minimatch、typescript-eslint、yaml 等传递依赖。
按 audit 的直接与传递关系审查后，保留 lockfile 原有版本，只更改项目根包名称。
本轮无 Zotero 宿主，不用 `npm audit fix --force` 作不可验证的广泛升级。
后续首先处理可到达的不可信 ZIP 解码路径，再分别升级 UI 渲染与开发工具链。

原始安装环境继承了关闭 Node TLS 验证的 shell 设置，首次 `npm ci` 日志对此有警告；
本轮新建网络 CLI 强制校验证书，不复制该设置到源码或 CI。npm 还报告上游 epub.js
git 依赖不执行 tarball integrity 校验，以及 4 项尚未加入 allowScripts 的安装脚本提示。
构建/测试是否可运行以本轮实际命令记录为准；这些提示没有被忽略成“零风险”。

审查依据：
[fflate advisory](https://github.com/advisories/GHSA-px8p-9vwx-vf98)、
[Mermaid advisory](https://github.com/advisories/GHSA-c4c3-pg64-4m4v)、
[KaTeX advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7)。
后续重跑 `npm audit --json` 时结果可能随数据库更新变化。
