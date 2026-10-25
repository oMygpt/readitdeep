# Read it DEEP 改造验收

每个阶段的验收标准与证据。证据写明日期、提交、命令与结果摘要；失败如实记录。

## 通用（每个 PR）
- `pytest` 全绿，CI 通过；
- 独立模式回归：`docker compose up` 冷启动，注册 → 上传（打桩或真实 MinerU）→ 阅读 → 工作台 → 翻译入口可用；
- 不引入新的无鉴权路由（R1.3 清单测试）。

## R0
| 项 | 标准 | 证据 |
|---|---|---|
| 数据移除 | HEAD 中不存在 `backend/data/*.json`；`.gitignore` 生效 | 2026-10-25 R0 PR：`git rm` 删除 backend/data、jiejian、一次性脚本；`.gitignore` 增 `backend/data/`、`/data/`。原数据另存本机私有目录供 R2 迁移演练，不入库 |
| 历史清除 | `git log --all -- backend/data` 为空；GitHub 上旧 blob 链接 404 或已请求清除缓存 | 2026-10-25：先做完整 mirror 备份（本机 `readitdeep-mirror-backup-20261025`，含原数据，不外传）；`git filter-repo --invert-paths --path backend/data/` 重写 main / multi-user / single-user 并强制推送；三个分支的最终文件树与重写前逐一比对一致（main 树哈希相同）。仓库 .git 由 116MB 降到 1.1MB。旧 raw 链接已 404。**未尽事项**：GitHub 的 PR 引用（#1、#2）和 1 个 fork（htynkn/readitdeep，2026-01-10 之前 fork，含数据）仍保留旧对象，API 仍能按旧 SHA 查到提交；彻底清除需仓库所有者向 GitHub Support 提交敏感数据清除请求，fork 需联系其所有者 |
| 测试地基 | `uv run pytest` 在干净环境可跑，CI 有 test job | 2026-10-25 本地 `uv run pytest -q` → 9 passed（认证 4、论文上传/访问/列表 5）；CI 结果见 R0 PR |

## R1
| 项 | 标准 | 证据 |
|---|---|---|
| 鉴权矩阵 | 每条论文相关路由：未登录 401、他人 403、所有者 2xx（参数化测试） | 2026-10-25 `tests/test_access_matrix.py`：8 条读路由 × (匿名/他人/所有者/管理员)、4 条写路由、团队成员可读不可改、无主论文仅管理员、任务列表/标签/工作台按用户隔离、旧工作台条目归属回落；`tests/test_route_auth_inventory.py` 遍历全部路由，未在公开清单中的无鉴权路由即失败 |
| 文件 | `/uploads/...` 不再可访问；新文件路由同样遵守鉴权矩阵 | `tests/test_files.py`：静态挂载已移除（404）；正文中的图片链接被改写为签名地址并可取回；篡改签名、过期、挪用到其他论文均 403；`..` 文件名拒绝 |
| 启动检查 | 默认 secret 时非 debug 启动失败 | `tests/test_security_settings.py`：空/示例/过短密钥抛错，debug 只警告；部署脚本自动生成随机密钥 |
| SSRF | 普通用户无法设置端点地址；开关打开时内网地址被拒 | 同上：默认 403、仍可只填 key；开关打开时 127/10/192.168/169.254/::1 与非 http(s) 被拒（保存与测试接口都拦）；已存的用户地址在未开放时不生效 |

## R2
| 项 | 标准 | 证据 |
|---|---|---|
| 迁移演练 | 用历史 `papers.json`（45 篇）/`workbench.json`（620 条）副本迁移，条数、正文长度逐条一致，二次运行无变化 | 2026-10-26 本机私有副本演练（不入库）：45 篇全部插入，逐字段比对 0 差异（1 篇旧数据标签为 JSON 字符串，读出为列表，属预期修正）；620 条工作台全部插入，字段 0 差异，355 条有归属、265 条无主（151 条来源论文已不在 JSON 中，其余来自 7 篇无主论文）；第二次导入 0 插入、全部覆盖、内容 0 变化。真实启动流程（uvicorn + 旧 papers.json）自动建库并导入 45 篇。CI 中以合成数据跑同样断言（`tests/test_data_import.py`） |
| 并发 | 两个 worker 并发上传/编辑工作台不丢数据 | `tests/test_store.py::test_concurrent_processes_do_not_lose_updates`：两个独立进程各对同一论文的不同字段写 30 次，两个字段都保留最终值（修复前 SQLite 下会丢）；旧快照覆盖场景 `test_update_merges_and_does_not_clobber` |
| 重启恢复 | 解析中途重启后任务继续或明确失败，不卡在 parsing | `test_recover_stuck`：超时的中间状态按有无正文恢复为 completed / failed，翻译标为 failed，未超时的不动。持久化续跑并入 R3.4 |

| 迁移体系 | 空库升级后与模型一致；旧库补齐后 stamp | `tests/test_migrations.py`：空库 `upgrade head` 后 autogenerate 对比 0 差异；模拟旧库（缺 2 表、5 列、1 索引，含存量用户）升级后无缺失且数据保留，再次升级无报错 |

R2 本地测试：64 passed。

## R3
| 项 | 标准 | 证据 |
|---|---|---|
| GROBID | 无 MinerU key 时可用 GROBID 完成解析 | |
| LLMPool | 一个端点故障时请求转移；并发上限生效 | |
| 实测 | 一篇 arXiv 论文解析/翻译/提炼耗时记录 | |

## R4 / R5
见计划；依赖主站 E2/E3，届时补充具体标准。

| 配额 | 触发 LLM 的路由按调用者扣 AI 配额，用完 403 且不调用模型 | `tests/test_ai_quota.py`；他人论文上调用 AI 403 且不扣配额 |
| 前端 | 编译通过；所有直连 fetch / EventSource 带凭证 | `tsc -b` 通过；Vite 构建（编程接口）2.7s 完成。本机 `vite build` CLI 无输出挂起，与改动无关（编程接口同配置可构建），以 CI 的 Docker 构建为准 |

R1 本地测试：`uv run pytest -q` → 53 passed。
