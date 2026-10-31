# Workshop 2026-10-31 核验与修复

本轮仅代码与隔离测试，不部署、不新增付费PDF或模型作业。来源：PaperDaily统一Workshop backlog。owning repo为oMygpt/ReaditDeep；本机antigravity副本停留旧提交且有本地修改，不使用、不覆盖。

- WS-05 confirmed：生产样例解析Markdown64439字符，Methods偏移9407，Results25085，Discussion42901。生产summary调用仅前8000字符；当前主线自动method前3000、summary前8000。新增实际字符范围、source/input SHA256、truncated提示与持久收据；旧分析范围unknown，正文改变stale。保持局部分析预算，明确不能从局部未见推断原文缺失，未冒称全文评价。
- WS-07 partial：原PDF30页，PDF SHA256 `b51231c03f6960609de0e1daadebac58797543540c5c654fa1ea7981e6e0d94b`；Markdown SHA256 `57060dd934aab56400858f15a1b6892a23b262d21828948813ba1ec6bdbf7235`。只读提取原PDF后比较12-word窗口，755个窗口中657个规范化匹配，存在98个不匹配；此方法无法区分原生提取顺序、公式、表格、脚注与VLM错误，不等同人工金标。新增VLM输出token上限失败处理，不能把此风险当成已证明的历史根因。既有文本不自动重解析。
- WS-01 confirmed代码缺陷：同步逐篇导入可在页面120秒超时后继续落库。综述仅承诺cited IDs最多50，并非所有检索候选。改用固定user/history任务身份、持久逐篇进度、状态查询、显式失败恢复；成功项跳过，重开不再自动获取PDF。
- WS-02 confirmed分页缺陷，原目标身份问题仍待生产验收：列表默认20条；新增分页与owner过滤后的focus排序。完整题名检索在服务器端执行。回归覆盖25条、跨用户focus不可见、搜索和第二页。

生产papers.py与vlm.py指纹不等于最新主线，intake.py相等。没有覆盖线上源码；后续发布必须先复核并保留线上差异。容器默认Python缺少pymupdf/fitz/pdftotext，比较改在隔离本地环境完成，没有向生产安装依赖。

验证：backend完整174 passed / 1 skipped；新增partial-resume用例后定向workshop回归5 passed；frontend 28 tests passed、生产构建通过。首次测试的store.add夹具错误已改为store.set；持久任务新kind和异步review协议对应旧测试已更新并全量复测。SQLite验证不等同PostgreSQL多进程/重启/真实授权验收；不关闭生产验收缺口。
