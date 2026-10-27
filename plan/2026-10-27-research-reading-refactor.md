# ReaditDeep：面向研究问题的深读重构评审

日期：2026-10-27，Asia/Shanghai。状态：**源码评审与设计建议，尚未实施**。

> 后续进度：用户已授权从 UI、流程与面板推进。首批实现及验收另记于 `2026-10-27-reader-ui-implementation.md`；下文保留最初评审时的现状与建议，不将整份规划标成已完成。

## 1. 任务依据与审计范围

用户明确优先：**围绕研究问题精读、批注和证据积累**。跨论文比较与写作复用承接这一过程，首期不以自动生成综述为主入口。

- 获取仓库：`oMygpt/readitdeep`，默认分支 `main`。
- RiD 审计提交：`1915250e0c631f4b94f89f5dc1ab8d8a4d6cae7e`；获取结束时重新查询远端 main，SHA 一致。
- 本地独立审计目录：`/Users/alone/Desktop/openai/ReaditDeep-review-20261027`。
- PaperDaily 对照提交：远端 `master` 的 `3ed71be0e545f3457cb50cfb6a8072e85f07635e`，通过 fetch 后的 Git 对象读取，未以陈旧且有其他改动的本地工作树为当前实现依据。
- 与 Astra（`gpt-6-astra`）进行独立源码审阅和第二轮取舍讨论；本文区分实际代码、历史验收记录与建议。
- 本轮完成静态流程追踪与 SQLite 测试；没有执行生产环境或真实浏览器的研究阅读任务。仓库已有生产记录只作为历史记录，不升级为本次验收。

既有 `docs/plans/2026-10-25-refactor-design.md` 的 standalone/linked 双模式、PaperDaily 账号与资源边界继续作为约束。本稿补充后续阅读体验与领域模型设计；不把旧稿里已经修复的风险当作现存问题，也不覆盖其历史验收。

## 2. 核心判断

保留 React / FastAPI / SQLAlchemy / Alembic 和已经落地的 R0–R4a 地基，围绕阅读领域渐进重构。最需要改变的是工作对象和操作顺序：从“上传论文后自动加工出很多卡片”，转向“围绕一个问题，读原文、记判断、积累可定位的材料、恢复阅读现场”。

目标过程：

```text
PaperDaily 的论文、合集或问题 / 本地文件
  → 建立身份与资源映射
  → 正文可读，即可开始；填写或沿用当前阅读问题（可跳过）
  → 选原文 → 批注自动保存 → 按需收进证据篮
  → 核验原文/PDF，补个人解释与适用边界
  → 保存“下一步读什么”，下次恢复
  → 用户选择后整理为主张与研究记忆版本
```

一次高亮不等于证据判断，一次 AI 回答不等于研究结论，滚到末尾不等于读完全文。界面用轻量动作承接这些区别，避免强迫用户在第一次选文时填复杂表单。

## 3. 已实现并值得保留的能力

| 能力 | 源码依据（相对 RiD 根目录） | 保留方式 |
|---|---|---|
| Markdown、KaTeX、目录、引文跳转、Zen 模式 | `frontend/src/pages/ReaderPage.tsx`；`StructurePanel.tsx` | 保留渲染与交互资产，提取成独立 reader 模块；针对正文定位增加可靠契约 |
| 选区即时操作 | `frontend/src/components/SmartSelectionPopup.tsx` | 保留低摩擦入口，优先显示批注、收进证据篮、解释/翻译；细分 AI 能力放到次级动作 |
| 原文 + reflection 的笔记卡 | `backend/app/services/workbench_analysis.py:277`；`frontend/src/components/Workbench.tsx:59` | 保留原始内容与个人理解分开的做法，接入统一的批注/证据读视图 |
| 用户隔离的数据库存储 | `backend/app/core/store.py:130`、`:213`；`workbench_store.py` | 继续复用事务、字段合并与旧接口；新领域对象逐步结构化，不再扩成任意 JSON 大包 |
| Alembic、历史数据导入、测试 | `backend/migrations/`；`backend/tests/` | 保留，迁移采用加字段/新表、读兼容、可回滚的顺序 |
| 可插拔解析与模型入口 | `backend/app/services/parsing/`、`llm.py` | 保留 GROBID/VLM/MinerU 适配，linked 资源来源另加 provider；保留交互/批量分离 |
| 持久化 jobs、翻译分块续传、Token 记录 | `backend/app/core/jobs.py`；`services/translation.py:54`；`models/job.py` | standalone 继续使用；linked 计费执行由主站可信 job 驱动，不把本地任务恢复当作计费保证 |
| PaperDaily 登录、会话与事件 | `backend/app/services/paperdaily/`；`api/paperdaily_auth.py`；`tests/test_paperdaily_*` | 保留 subject 映射、PKCE、会话核验、撤销与删除机制；新数据加入其删除覆盖 |
| 团队/分享、独立图谱 | `teams.py`、`share.py`、`PaperGraph.tsx` | 保存兼容能力；研究者个人深读首期减少默认入口，linked 依现有发布策略开放 |

本次不建议换框架、拆微服务、增加第二个图数据库或重建 PaperDaily 的摄入/检索系统。应先让现有可用能力形成完整的研究操作闭环。

## 4. 源码核查出的主要缺口

### F1：选区定位语义错误，且缺少内容版本

- `ReaderPage.tsx:795` 的选区位置只返回 `start_line/end_line` 和前 100 字 snippet。
- `SmartSelectionPopup.tsx:363`、`:395` 将行号直接写入 `start_offset/end_offset`；`models/annotation.py:85` 将它们定义为字符偏移。
- `HighlightOverlay.tsx:41` 在单个 DOM text node 内用前几个词找首个匹配，没有可靠处理重复段落、跨元素选区与原译文差别。
- 批注未绑定 immutable content revision；重新解析后无法证明旧位置仍然指向同一段。

后果：系统可能把笔记带回错误原文。这里应先于更多 AI 按钮或图谱视觉改造。

### F2：笔记分成两条路径，研究问题未成为阅读上下文

- `SmartSelectionPopup.tsx:335` 的工作台 note 保存 `original_text/reflection/location`。
- 同组件 `:395` 的 annotation note 保存 `selected_text/content/offset`。
- `models/workbench_item.py` 按用户/论文/type/zone 存放，未定义与当前研究问题、证据关系的显式契约。
- `models/reading_task.py` 是团队任务分配/提交总结模型，不能直接当个人研究问题模型。

应先统一用户看到的批注与笔记入口，保留旧对象 ID 和读取适配；证据篮通过引用批注组织材料，避免复制出第三套原文笔记。

### F3：PaperDaily 已关联登录，论文资源尚未接通

- `frontend/src/pages/OpenPage.tsx:1` 明示深链仍为待桥接页面；目前只显示 paper/collection 参数并引导去库上传。
- `services/parsing/__init__.py:76` 的 `paperdaily_markdown` 返回失败占位。
- `models/paper.py:71` 已预留来源 ID 与用户来源唯一约束，应复用，不能再造另一套导入身份。
- PaperDaily 当前主线已有 `api/read_resources.py`、`api/read_jobs.py`、`api/v1/read_bridge.py`。已有 API 不表示运行配置已启用，也不表示两站资源/作业联调验收已通过。

因此下一步是实现消费者与契约验收，不能继续以“等主站从零设计接口”为前提，也不能把登录成功写成全文接通。

### F4：正文可读状态被后续加工覆盖

- `api/v1/papers.py:148` 解析后写 `completed`，随后依次进入 `embedding_done/analyzing/classifying`，最后再写 `completed`。
- `ReaderPage.tsx:79` 取正文的 query 仅在 `completed/analyzed` 时启用；其他入口也需要一起核对状态判断。
- 解析任务同时承担 embedding、方法/资产分析、摘要与分类，单项失败与主任务结束语义混杂。`core/jobs.py:225` 以 handler 是否抛异常决定 done，而解析函数部分失败会自行写状态后 return。

改为“内容就绪”稳定不回退；parse、translate、extract、index 各有自己的任务状态。AI 加工失败不应抹掉已可读正文，也不能把 job done 当论文加工成功。

### F5：聊天的上下文覆盖和来源不够明确

- `SmartSelectionPopup.tsx:302` 聊天历史只在组件 state；`:585` 给后端的是正文开头至多 8000 字符。
- `services/smart_analysis.py:104`、`:201` 再截选区至 3000 字符、context 至 5000 字符。
- `api/v1/ai_assist.py:74` 的另一条助手路径只取论文前 3000 字符作预览。
- method/summary 等自动流程也有首部截取。不能据此对外表达“模型已完整读过论文并核验证据”。

后续请求由服务端按当前 selection anchor + 邻近 blocks + 当前问题 + 用户主动加入的材料构造有界上下文，返回真实使用的来源。上下文不覆盖问题时明确提示；不凭模型自己给出的引用判定证据有效。

### F6：没有完整的个人阅读现场恢复

Reader 的模式、字体、侧栏、选区与聊天主要在 `useState`，没有找到持久化的、绑定内容版本的 ReadingCheckpoint。翻译续传属于后台加工恢复，不能替代人的阅读恢复。

下次打开需要恢复当前问题、段落位置、原译文状态、未完成草稿、下一步动作，而非只显示一张新论文卡片。

## 5. 与 Astra 两轮讨论的取舍

| 讨论点 | 收敛决定 | 原因 |
|---|---|---|
| 全重写还是渐进重构 | 渐进；保留已完成 R0–R4a 地基 | 当前核心缺口在阅读对象与流程，重写会重复修复存储/鉴权/任务问题 |
| 首先 PDF 双栏还是 Markdown | 先可靠 Markdown anchor，首期同时提供鉴权原 PDF 核验入口；双栏同步后续做 | 跨表示对齐复杂，不能由 Markdown offset 猜 PDF 页码；没有真实映射时只显示章节与摘录 |
| 问题由谁维护 | linked 下 PaperDaily 维护正式研究问题，RiD 保留阅读 focus/草稿和外部 question_ref | 已有主站问题、reading sessions 与 revisions；不要悄悄双向同步两套问题状态 |
| 必须先建项目/主张平台吗 | 不需要；先 Revision/Block、Annotation、EvidenceLink、ReadingCheckpoint、发布映射 | 证据可先归问题，不必先产生完整 claim；成熟时再映射主站 claim |
| 每次高亮是否填研究表 | 不填；批注立即保存，提升为证据是可选明确动作 | 保住阅读连续性，判断、立场和边界可以之后补 |
| AI 内容如何进入笔记 | 独立候选，用户采用后保留来源与改写历史 | “已采用”不等于“已验证”；人工确认是归属判断，不是事实正确性证明 |
| linked 是否沿用本地超时重试结算 | 不可；主站 job/lease/fence/receipt 为权威，本地仅作调度投影 | 本地 stale→queued 不足以证明旧执行已经停止，不足以防重复执行与重复计费 |

## 6. 最小领域模型与归属

| 对象 | 最小职责 | 归属和约束 |
|---|---|---|
| PaperRef | RiD paper ID 与 PD canonical paper ID 的映射 | 复用 source_provider/source_id；同论文版本与同文件不混同 |
| ContentRevision | 资源来源、representation、内容 hash、parser/version、coverage | 对主站来源复用 manifest；本地上传也记录文件 hash 与用户归属。版本不可覆盖 |
| ContentBlock | revision 内段落/标题/图表/公式的稳定 ID、规范文本 | block ID 在同 revision 内稳定；跨 revision 迁移需重新匹配并记录结果 |
| Annotation | 引文 selector、人的批注、可见性、创建者 | 扩展已有 annotation，兼容旧 note；不丢弃旧原文与 offset 原值 |
| EvidenceLink | annotation 与当前 focus 或正式 question 的关系 | 关系可先留空；同材料能被多个问题引用，删除链接不删原始批注 |
| ReadingCheckpoint | 当前 revision/block、阅读 focus、视图偏好、草稿、next_action | 按用户隔离；服务端恢复为主，本地草稿缓存不能变成私有数据离线访问承诺 |
| PublishReceipt | 本地 snapshot 到 PD session/revision 的映射、payload fingerprint、状态 | 同内容重试幂等；内容修改后创建新版本，不覆盖已发布记录 |

正式问题引用必须有 provider + question ID，附本次读取的状态/版本信息。若上游无合适的版本字段，用内容指纹作本地变化检测，不宣称具备上游 CAS。首期可只读正式问题；本地编辑属于 proposal，待有精确写契约时显式提交，不覆盖主站新修改。

Anchor 最小结构：`revision_id + block_id + exact_quote + prefix/suffix + range + representation`，另有 `exact/ambiguous/orphaned/legacy_unverified` 定位结果。字符坐标要明确 Unicode/UTF-16 与 normalization 规则；不能用规范化后的 DOM 下标直接索引原始文本。重复匹配不取首项冒充成功，旧版本缺失不悄悄附会到新正文。

译文是原 revision 的派生表示；保存源 block 映射及译文版本。译文批注可回到其源 block，但不把译文句子或跨语言 offset 当原文证据。PDF page/box 仅来自真实解析结果；无映射可以打开原文件核验，不提供虚构跳页。

旧内容第一次版本化只说明“当前抓取到这个内容”，不能追认历史批注创建时所见版本。旧批注匹配成功仍需保留 legacy 来源；不匹配或有歧义就进入待核对列表。

## 7. 阅读界面与行为调整

主界面仍可三栏，但按任务分配空间：

- **顶部**：论文身份、当前问题（可空）、真实内容就绪/加工状态、继续上次阅读入口。
- **左栏**：目录与 PaperDaily 来源上下文；参考关系按需展开，不让大图谱持续占据主要空间。
- **中央**：原文，选段可批注、翻译或解释；核验时打开原 PDF。正文默认优先，首次速览与 AI 摘要可主动选择。
- **右栏**：当前问题的证据篮、我的批注、待解决疑问。AI 方法/资产卡变成按需工具与候选，而不是阅读默认终点。
- **离开/恢复**：自动保存位置和草稿；“下一步读什么”轻量可选，不强制结束会话。回来显示上次问题、最后一段和未完成事项。

第一步选文只需“批注”或“收进证据篮”。当前问题自动沿用；用户可以之后补充“这段为何相关”“支持/反对/限制什么”“研究条件是什么”。支持先收集材料再形成主张，不强迫所有段落立即站队。

方法/资产提炼保留，但模板按论文类型选择：实证研究可关心识别策略、样本与外部有效性；理论研究可关心假设和推导边界；计算研究可关心实验、指标和复现条件。不要对每篇论文默认生成 PyTorch 伪代码。

跨论文阶段采用“问题 × 论文/材料”的证据列表或矩阵，点击材料回到原文。先把差异与条件看清，再生成用户可编辑的比较草稿。

## 8. PaperDaily 衔接边界

对照主站固定提交的 `docs/plans/research-suite-accounts-design.md`、`api/v1/reading.py`、`api/read_resources.py` 和 `api/read_jobs.py`：

1. **PaperDaily**：账号、正式题录和个人库、正式阅读记忆、正式研究问题、权益和可信 job 结算。
2. **RiD**：阅读过程、私有文件/派生正文、批注、focus、证据篮、工作草稿、阅读现场。
3. **资源入口**：先建题录；读 manifest；按许可/用户/资源校验取完整字节并核 hash；成功才进入可读态。没有可转移资源时保留题录并允许用户上传有权使用的文件。
4. **主站 manifest 已有**：source/source_version、license/transfer_policy/policy_version、representation、content_sha256、parser/version、coverage、images、cache_identity。RiD 增补 block anchor，不重造同义资源协议。
5. **阅读记忆**：使用已有 `/api/v1/me/reading-sessions` 和 `/{session_id}/revisions`，正式问题使用已有可用接口。用户主动选择发布范围，原文、私有 PDF 和整篇译文不作为记忆上传；depth 如实标注。当前 read grant/operation 是否允许这些调用，须在联调时逐项核验，不能由源码接口存在推定已授权。
6. **写回失败**：本地笔记继续保存，显示待提交/结果待核验；网络超时重试同一 fingerprint，不另建重复会话，也不自动另发一份研究问题。
7. **作业**：linked 模式引用 PD job ID、Idempotency-Key、lease/fence、receipt；先核验主站状态才决定是否执行。unknown 保留并对账；不能把本地 Token 记录折算成另一份 credits 账本。
8. **迁移**：已有本地任务完成或明确停止后，才对新任务启用 linked 路径；不能把进行中的免费/本地任务原地改为扣费任务。
9. **独立部署**：同一阅读领域代码继续可用，local identity/library/job provider；没有 PaperDaily 的正式 question 时保留本地 focus，不要求建立外部账号。
10. **撤销/删除**：沿用现有会话检查与事件机制，新增 revision、批注、证据、草稿、恢复点、AI 候选、发布映射加入删除与迟到写入验收。仅撤授权不删除历史，删号与凭证失效分开。

首期文件适配应统一现有 `STORAGE_PATH` 与 `papers.py:319` 的上传路径约定，保留旧路径读取。新增原 PDF 入口需要鉴权、内容类型与必要的 Range 访问策略，不能重新静态公开 uploads。

## 9. 模块演进方式

- ReaderPage（1505 行）、GuestReaderPage（645 行）、Workbench（916 行）分批提取 renderer、anchor、selection、checkpoint、translation、evidence 等职责。先抽纯渲染/定位逻辑，再迁移状态；不一次性机械拆很多文件。
- 复用 TanStack Query 管理服务器数据，hooks 管理局部交互；先定义 API 类型和状态契约，再判断是否需要额外全局状态库。
- 后端路由调用 reading/content/annotation/evidence 应用服务；services 不再反向依赖 `api/v1/papers.py` 的大流水线。保留 store 接口用于过渡，新对象使用明确 repository 与事务边界。
- standalone 的本地 jobs 继续服务原部署；linked 执行适配器独立处理主站 admission/claim/heartbeat/receipt。先将 worker 入口与 Web 生命周期可分离，再决定部署进程数量；不因此引入消息队列或微服务集群。
- Library 的过滤/分页逐步下推 SQL；`api/v1/library.py:96` 目前在 Python 侧加载、筛选、排序，`:133` 逐论文查分享团队。该优化放在阅读闭环之后，按实际用户库规模验证。
- 不在新功能中继续增加整篇 `papers.extra` 依赖；旧结构通过兼容读取保留，新增 revision/annotation 等有独立 schema 与 migration。

## 10. 分期切片与验收

### 切片 A：内容可读、版本明确、批注不丢

实现内容就绪与 AI 子状态分离；ContentRevision/Block/Anchor；统一选区坐标；兼容旧笔记读取；提供鉴权 PDF 核验入口。Reader/批注 API/迁移一起完成，不只交付拆组件。

验收：重复句子第二处、跨粗体/链接/公式的选区、中英文混排、原译文切换、改变字体/窗口、刷新后定位正确；重新解析产生新 revision；歧义与孤儿不自动贴错；解析完成后即能读，翻译/分析失败不影响已就绪正文。

### 切片 B：一个问题的单篇精读闭环

增加可空 focus/question_ref、证据篮与 ReadingCheckpoint；整合两类 note 的读视图；支持原文、个人解释、AI 候选区分。用户可不调用 AI 完成这一闭环。

验收：从选文到保存材料无需填完整研究表；一段材料能关联问题；同论文切换不同问题保留各自材料；刷新/换设备恢复现场；未提交草稿有可见状态；不将旧摘录静默转换为新版本证据。

### 切片 C：PaperDaily 资源和记忆衔接

完成 `/open` 的消费者流程、幂等身份映射、resource manifest/hash 校验、context-bundle 展示，以及已有 reading sessions/revisions 的显式发布与回执。依实际 scope/operation 逐项开放；涉及算力前完成主站可信 job 适配与独立验收。

验收：同论文重复打开不重复导入；不可用资源停在题录态；不因同标题合并不同论文；不同 owner/文件/版本的私有解析不串用；写回超时只重试同一产物；撤销、断网、删除、迟到结果行为符合既有协议。真实 linked AI 流量另需价格、预算、并发与 runner 验收，不因阅读 UI 完成自动开启。

### 切片 D：跨论文证据与 grounded AI

按问题组织跨论文证据矩阵；按源 blocks 构造上下文；AI 回答提供可核对的来源与覆盖说明；候选整理为用户可编辑的主张。再评估段落翻译对齐、双栏 PDF 同步、导出写作材料。

验收：每条主张能回到证据和对应版本原文；AI 未覆盖/证据不足时不伪造全文支持；跨论文相反结论保留其研究条件；采用 AI 候选后不显示“事实已验证”。

后置：团队管理重设计、思维回放、停留时长追踪、冲突自动判决、播客、自动 SOTA/License 判断和大图谱动效。保存已有数据与兼容功能，不将这些当作个人精读的前置条件。

## 11. 本次验证与边界

在新 clone 的 `backend` 执行：

```bash
env -u RID_TEST_DATABASE_URL -u DATABASE_URL uv run --extra dev pytest -q
```

结果：**119 passed, 1 skipped, 677 warnings in 54.53s**，exit 0。Python 3.13.5；依赖使用仓库 `uv.lock`；测试 harness 使用临时 SQLite 与临时上传目录。跳过项为需要显式 PostgreSQL 地址的 schema 对照测试。本轮未运行 PostgreSQL、前端构建、真实浏览器选区回归或生产资源/job 联调。

warnings 包括 Pydantic 配置弃用、`datetime.utcnow()`、Alembic 路径配置，以及子进程环境中的 pytest testpaths 提示。保留这些结果，不用本次全绿证明未写测试的阅读体验与来源链已正确。

本稿是后续实施依据的候选。正式实施时逐切片更新现有设计与验收清单，保留旧记录；发布状态、scope、容量和真实服务行为在实施窗口重新核验。
