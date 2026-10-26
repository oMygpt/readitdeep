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
- [ ] R4a.7 与主站实现联调（等 Codex 的 E2/E4a）
- [ ] R4b `/open` 深链与资源桥接导入、状态机（等主站 E4b）
- [ ] R4c read-jobs 记账与受信 runner（等主站 E4d）
- [ ] R4d context-bundle 左栏、阅读记忆回传（E4e）；个人 PD key 模式

## R5 部署
- [x] R5.1 k8s-dslab-1-7 同机部署：独立 RBD 池 readitdeep-rbd（hybird）、独立 pg16 容器、paperdaily 隧道加 read.paperdaily.org（2026-10-26，运维仓库 `just readitdeep-*`）
- [x] R5.2 每日备份到 RGW（pg_dump 30 天 + 上传文件同步），恢复演练通过
- [x] R5.3 生产模型：校内推理 API（Qwen3-VL-32B 解析、Qwen3.6-35B-A3B 翻译/分析），自助注册关闭
