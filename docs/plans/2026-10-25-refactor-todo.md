# Read it DEEP 改造 TODO

对应计划 `2026-10-25-refactor-plan.md`。完成一项勾一项并写上 PR 号；验收证据记在 `2026-10-25-refactor-acceptance.md`。

## R0 仓库卫生与测试地基
- [x] R0.1 删除 `backend/data/*.json(.bak)`、`.pids*`、空 `backend.md`、一次性脚本；`.gitignore` 增 `backend/data/`
- [x] R0.2 删除 `jiejian/`（作者决定直接删除，不留分支）
- [x] R0.3 `backend/tests/` + pytest 配置 + 临时 SQLite / 临时存储目录 fixture
- [x] R0.4 GitHub Actions：ruff（宽松规则起步）+ pytest
- [x] R0.5 首批测试：注册、登录、上传（MinerU 打桩）、论文访问控制
- [x] R0.6 重写 git 历史清除 `backend/data/`（先做本地 mirror 备份）

## R1 安全基线
- [x] R1.1 统一依赖 `require_paper_access`，覆盖全部论文相关路由
- [x] R1.2 workbench 全部路由要求登录（R2 前按 source_paper 归属过滤）
- [x] R1.3 路由鉴权清单测试：新增无鉴权路由即失败（白名单：health、auth 登录注册、share 公开读取）
- [x] R1.4 取消 `/uploads` 静态挂载，鉴权文件路由 + 图片链接改写
- [x] R1.5 启动安全检查（默认 secret、CORS * + credentials）
- [x] R1.6 端点地址仅管理员可配；`ALLOW_USER_ENDPOINTS` + 内网地址拦截（用户自己的 API Key 仍可填）
- [x] R1.7 无 user_id 论文不再公开
- [x] R1.8 LLM 触发路由计入 AI 配额

## R2 单一存储（设计 §2.5）
- [x] R2.1 Alembic：0001 基线、0002 新表新列、启动升级脚本、迁移=模型一致性测试
- [x] R2.2 `store` 改为数据库实现（固定列 + extra JSON），`update()` 合并写、`list_light()`
- [x] R2.3 存量 `set(id, {**旧快照, …})` 全部改为 `update()`；修正 embedding 原地修改未写回
- [x] R2.4 `workbench_store` 改为 `workbench_items` 表实现
- [x] R2.5 `scripts/migrate_json_to_db.py`（幂等 + 对账），启动自动执行一次
- [x] R2.6 启动时恢复卡住的论文/翻译状态
- [x] R2.7 迁移演练（历史 45 篇 / 620 条）与并发写测试

## R3 可插拔后端（设计 §2.6）
- [x] R3a.1 `get_chat_model(task, user_id)` 统一入口；翻译、引用分析、@AI、提示词预览改用管理员配置
- [x] R3a.2 模型配置按触发者取（与 AI 配额一致）
- [x] R3a.3 多端点故障转移传输层（冷却、仅响应头前重试）
- [x] R3a.4 交互 / 批量两个并发通道
- [x] R3a.5 `LLM_EXTRA_BODY`（校内 Qwen3 关闭思考输出）
- [x] R3b.1 ParseProvider 接口 + mineru / grobid / paperdaily_markdown 占位
- [x] R3b.2 `parse_providers` / `grobid_url` 配置与回退；`parser` 字段；MinerU Key 缺失不再失败
- [x] R3c.1 `jobs` 表 + worker（认领、心跳、重试）；上传 / 重新分析 / 翻译入队
- [x] R3c.2 `token_usage` 表取代 token_stats.json
- [x] R3.3 校内 GROBID + vLLM 实测记录
- [x] R3d 视觉模型解析（校内 Qwen3-VL，逐页转写 + 裁图，排在 GROBID 之前）
- [x] R3c.3 启动时立即接管本机已退出进程留下的任务（不必等心跳超时）

## R4 PaperDaily 关联（设计 §2.7，契约 paperdaily-connect-contract.md；主站侧由 Codex 实现）
- [x] R4a.1 `RID_MODE=linked` 关闭本地注册/密码登录；`GET /api/v1/auth/mode` 供前端判断
- [x] R4a.2 授权码 + PKCE 登录、callback、外部身份映射（email_verified 才按邮箱关联）
- [x] R4a.3 provider_sessions：委托 key AES-GCM 加密（双密钥轮换）、绝对期限、≤15 分钟 JWT、会话续签实时核验
- [x] R4a.4 请求核验：读 60 秒缓存、写/AI/上传实时，主站不可用 503
- [x] R4a.5 退出 revoke；事件 webhook（签名、时间窗、去重、先落库后 ack）；游标补漏；account.deleted 删除 + tombstone
- [x] R4a.6 前端：「使用 PaperDaily 账号登录」、cookie 续签、401 处理
- [x] R4a.7a 对齐主站真实实现（subject、拉取 + ack、revoke 204、无邮箱 → 运维脚本绑定、管理员 subject）
- [x] R4a.7b 与主站生产环境联调（2026-10-27，read.paperdaily.org 切为 linked；主站 read 白名单 1 人）
- [ ] R4a.8 撤销链路生产验证（退出登录 → 主站 grant.revoked → 本站会话失效）；主站部署 read 推送 worker 后验证推送
- [x] R4b `/open` 深链与资源桥接导入 → 由 R6.4（#14）与研究桥接（#15）实现
- [x] R4c read-jobs 记账与受信 runner → 由 R6.3（#14）与可靠性修复（#19）实现
- [ ] R4d context-bundle 左栏、阅读记忆回传（E4e）；个人 PD key 模式

## R5 部署
- [x] R5.1 与主站同机部署：独立 Ceph RBD 卷、独立 pg16 容器、paperdaily 隧道加 read.paperdaily.org（2026-10-26，运维仓库 `just readitdeep-*`）
- [x] R5.2 每日备份到 RGW（pg_dump 30 天 + 上传文件同步），恢复演练通过
- [x] R5.3 生产模型：校内推理 API（Qwen3-VL-32B 解析、Qwen3.6-35B-A3B 翻译/分析），自助注册关闭

## R6 系列站：题录/PDF 分离、按篇计费、配置分层（设计 2026-10-27-series-site-quota-config-design.md v0.2）
- [x] R6.1 配置分层：linked 下忽略/拒绝 key 与地址类配置；`ALLOWED_MODELS`；用户偏好白名单（目标语言、风格、术语表、解析质量、自动翻译）接入翻译
- [x] R6.2 题录态 `metadata`；主站题录导入（委托 key `get_paper`，幂等）；`/papers/{id}/pdf` 补传；`/papers/{id}/fetch-pdf` 开放获取抓取（白名单）；PDF 哈希/页数
- [x] R6.3 计费（代码与模拟主站测试；生产联调等主站 P1/P3/P9）：`read_charges`（迁移 0004）、篇数与周期、`READ_BILLING`、主站 read-jobs 客户端（assertion/preflight/create/claim/heartbeat/complete/对账）、402/409 状态、问答限速；linked 停用本地 PLAN_LIMITS
- [x] R6.4 `/open` 深链（paper 可重复 / collection / review）与「从 PaperDaily 导入」面板（等主站 P1）
- [x] R6.5 前端计费体验：价格、余额、n/5 篇、题录卡片、待确认/余额不足（昵称待主站 P8 决定）
- [x] R6.6a 主站 P1–P10 对齐：主站 2.21.0 上线（read client 开放已验证账号、档位字段、key_id、25 分/篇），RiD #19、#21 对齐
- [x] R6.6b 主站 P11：`source=read` 不计入全站/个人合成预算（主站 #197/#198，v2.22.6；2026-10-28 生产配置与回滚事务计数验收通过，真实PDF全链路仍见R6.7）
- [ ] R6.6c ask A1–A3 深链入口（alonegg/paperdaily-ask#16），待 ask PR 落地后联调
- [ ] R6.7 生产验收：注册与 Pro 测试账号全链路 + 主站 ledger 对账

## R7 上线后调整（2026-10-28）
- [x] R7.1 任务并发可配置 `JOBS_*_CONCURRENCY`（#22）；生产 VLM / 批量并发 4，主站 read.bridge 并发 4、每篇 1 预算单位
- [x] R7.2 发布 #21 + #22，生产 env 手改项并入保险库（2026-10-27 联合发布回执，运维 PR #1；本次文档纠正见配套 PR）
- [x] R7.3 交接文档 `docs/HANDOFF.md`、`AGENTS.md`；清理已合并分支

