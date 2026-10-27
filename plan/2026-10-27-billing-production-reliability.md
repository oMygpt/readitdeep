# 25分计费上线前可靠性修复

主站用户明确批准25分并部署。本轮不改研究阅读交互，只修R6计费准入与runner安全：持久化请求body/key并在网络不确定后精确重放、用户级准入串行化、未知/执行中charge拒绝重复处理、heartbeat丢失停止、自动翻译纳入同一lease。修正主站合集列表/items与collection_id契约。新增0007仅加可空admission JSON，保留现有账务与研究0006。

先本地SQLite模拟真实主站的HMAC/幂等/丢回执，再回归全后端。正式部署固定main SHA，先主站能力后两端配置；25价格与容量门分别读回。生产普通账号小PDF验证不冒充本地测试。

验证：166 passed、1 skipped（本地未启用Postgres专用迁移测试）；21项计费/共享签名测试通过，ruff E9/F63/F7/F82通过。共享fixture为TEST-ONLY30分协议向量，生产价格只取主站read-per-pdf-25-v1，不修改历史向量。
