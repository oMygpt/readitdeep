# PaperDaily → RiD 研究阅读桥接

## 本轮范围与入口

用户选择围绕研究问题精读、批注与证据积累，并批准使用主站明确允许转移的全文资源。实现以远端 R6 `eea9554` 为基底，保留多论文、collection、review 深链、偏好、题录/PDF 分离和原计费路径。

- `/open`：题录导入仍免费且不自动下载全文。逐篇显式“导入主站可用全文”；只消费资源 manifest/content 固定路由，分段、长度、SHA256、许可检查。没有可转移 Markdown 时保留 `metadata`，复用 `PaperIntakeActions → /papers/{id}/pdf → billing.admit → parse`；不另开 PDF 免计费入口，不抓取或重解析主站正文。图片暂不转移，导入正文不加载外部图片或原始 HTML。
- Reader 研究面板：正式问题由主站拥有，按本人列表分页选择并保存 ID/文本/更新时间快照；阅读焦点独立保留。问题读取完成后、写入前再次核验委托授权。缺省 `question_id` 的旧客户端保留已有正式关联。
- `/research`：仅本人证据，显式选择多论文摘录、批注及关系（待判断、支持、质疑、适用边界、方法参照），人工填写比较判断与综合理解。保存用版本 CAS，手动保存与导航复用在途请求。回到原文携带 annotation ID，版本不符时明确提示。
- 本地上传论文可先精确查询并确认 PaperDaily 身份，再关联；不改原文、不迁移批注。重复题录身份冲突给出明确处理路径。
- 发布：预览固定所选文本和人工判断；只发布 selected-passages notes/report，claims=[]，不声明全文通读、不自动发芽或领取奖励。回执先持久化，按 fingerprint 重试；后续修改使用 reading-session revisions。unknown 不能用后来的 4xx 抹去；发送接管带 attempt_id，迟到请求不能改写新结果。GET 原回执恢复响应丢失，不通过创建预览查询状态。

## 保留的架构与升级

复用 R6 `metadata_fields`、PDF 安检、OA 白名单、价格确认、账本、runner、偏好、Reader 不可变 revision/anchor/workspace 和主站 reading-sessions/revisions。新增 `services/paperdaily/documents.py` 汇集 canonical identity、用户隔离 upsert 与资源升级；题录入口和全文入口共用，不保留两套导入写法。外部 await 后复核账号、tombstone、委托；PDF 与 Markdown 写入用同一 User→Paper 锁顺序，正文先到者保留，extra 增量合并。

迁移链为 **0004 → R6 0005 → research 0006**，不覆盖 read_charges/provider key_id。比较草稿和回执默认私有，删号清理按 user_id 纳入既有机制。

## 验收

- 新增 deferred 测试：导航等待手动保存、发布响应丢失后读取原回执、unknown 后拒绝、发送接管迟到写回、问题读取期间撤权、双向 PDF/资源竞争、extra 保留、owner/CAS/旧正文不覆盖。
- 完整后端最终门：SQLite 156 passed / 1 skipped；PostgreSQL 157 passed；最终准入异常恢复另由 27 项核心测试在 SQLite/PostgreSQL 补测。包含迁移结构比对、R6 计费模拟回归及研究桥接。
- 前端 18 tests passed，TypeScript/Vite build 通过。真实 IAB 检查比较面板、草稿载入、证据回溯及浏览器 error 日志；截图使用本地合成演示材料：`plan/assets/research-comparison-desktop.png`、`research-evidence-return.png`。
- Astra 完成设计与多轮只读审查；发现的授权、幂等、导航及 R6 并发问题已修复并纳入测试。

## 上线边界

本轮只完成实现、验证和主线合并；未操作生产配置、数据库、部署、定价、白名单、runner 或流量。

主站配套候选为 v2.20.0：须先执行 migration 218，再部署接收 selected-passages 的应用；配置有限研究 scopes/operations 后由用户重新明确授权。现有空 scope 登录不会自动增权，旧授权不能使用新资源。资源还须通过原许可及 e2/e3/capacity/authorization gates。

新研究授权不包含 R6 的 entitlements/balance、library/query-history 或 jobs；这些既有入口可能显示授权未开放，不以扩大研究 scope 消除提示。PDF 计费保留原路径；本轮不把 R6 模拟计费测试视为真实上线验收。Astra 记录的 R6 既有 hold 响应丢失重试与 heartbeat 失效停机风险仍须单独验收；READ_BILLING/runner 保持原配置，不在本轮启用。
