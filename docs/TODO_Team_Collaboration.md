# Team Collaboration - 开发任务清单

> 基于 PRD v1.0.0 | 预计总工期: 8-11 周

---

## Phase 1: 基础团队功能 (MVP)
**预计时间**: 2-3 周

### 1.1 数据库模型
- [x] 创建 `teams` 表
- [x] 创建 `team_members` 表
- [x] 创建 `team_invitations` 表
- [x] 创建 `paper_shares` 表
- [x] 添加数据库迁移脚本
- [x] 添加 SQLAlchemy 模型类

### 1.2 后端 API - 团队管理
- [x] `POST /teams` - 创建团队
- [x] `GET /teams` - 获取我的团队列表
- [x] `GET /teams/{id}` - 获取团队详情
- [x] `PUT /teams/{id}` - 更新团队信息
- [x] `DELETE /teams/{id}` - 删除团队 (仅 Owner)
- [x] 权限校验中间件 (Owner/Admin/Member/Guest)

### 1.3 后端 API - 成员管理
- [x] `POST /teams/{id}/invite` - 生成邀请链接
- [x] `POST /teams/{id}/join` - 通过邀请码加入团队
- [x] `GET /teams/{id}/members` - 获取成员列表
- [x] `PUT /teams/{id}/members/{user_id}` - 更新成员角色
- [x] `DELETE /teams/{id}/members/{user_id}` - 移除成员
- [x] 邀请码过期逻辑

### 1.4 后端 API - 论文分享
- [x] `POST /papers/{id}/share` - 分享论文到团队
- [x] `DELETE /papers/{id}/share/{team_id}` - 取消分享
- [x] `GET /teams/{id}/papers` - 获取团队论文列表
- [x] 分享时的数据隔离校验


### 1.5 前端 - 团队管理 UI
- [x] 侧边栏增加 Teams 导航区域
- [x] 团队列表页面
- [x] 创建团队弹窗
- [x] 团队设置页面 (团队详情页)
- [x] 成员管理页面 (显示成员列表)
- [x] 邀请链接生成/复制

### 1.6 前端 - 团队 Library
- [x] 团队论文列表视图
- [x] "分享到团队"按钮 (个人 Library)
- [x] 团队选择弹窗 (ShareToTeamModal)
- [x] 显示论文分享者信息
- [x] 批量选择论文 (多选框)
- [x] 批量分享到团队
- [x] Overview页面分享按钮

### 1.7 API 类型 & 状态管理
- [x] 团队相关 TypeScript 类型
- [x] `teamsApi` 前端 API 客户端
- [x] React Query 状态管理

---

## Phase 2: 协作标注
**预计时间**: 2-3 周

### 2.1 数据库模型
- [x] 创建 `team_annotations` 表
- [x] 支持 highlight / note / comment 类型
- [x] 支持嵌套回复 (parent_id)
- [x] 添加迁移脚本

### 2.2 后端 API - 标注
- [x] `GET /papers/{id}/annotations?team_id=xxx` - 获取团队标注
- [x] `POST /papers/{id}/annotations` - 创建标注
- [x] `PUT /annotations/{id}` - 更新标注
- [x] `DELETE /annotations/{id}` - 删除标注
- [x] `POST /annotations/{id}/reply` - 回复标注
- [x] 标注可见性控制 (private/team)

### 2.3 前端 - 多人高亮
- [x] 高亮颜色分配机制 (按用户)
- [x] hover 显示标注者信息
- [x] 高亮筛选: 全部/自己/指定成员

### 2.4 前端 - 团队笔记
- [x] 笔记可见性切换 (🔒/👥)
- [x] 团队笔记列表侧边栏
- [x] 笔记编辑器

### 2.5 前端 - @提及功能
- [x] @用户 自动补全
- [x] 提及高亮样式
- [ ] 提及通知 (后续 Phase)

### 2.6 前端 - 讨论线程
- [x] 讨论线程 UI 组件
- [x] 嵌套回复显示
- [x] 锚定到论文位置
- [x] 新增讨论入口


---

## Phase 3: 共享 Workbench
**预计时间**: 1-2 周

### 3.1 数据库扩展
- [ ] 扩展 workbench 相关表增加 team_id
- [ ] 资产来源追踪字段 (source_paper, added_by)
- [ ] 团队活动日志表

### 3.2 后端 API
- [ ] `GET /teams/{id}/workbench` - 获取团队 Workbench
- [ ] `POST /teams/{id}/workbench/methods` - 添加方法到团队
- [ ] `POST /teams/{id}/workbench/datasets` - 添加数据集到团队
- [ ] `POST /teams/{id}/workbench/code` - 添加代码到团队
- [ ] `GET /teams/{id}/activity` - 获取团队活动时间线

### 3.3 前端 - 团队 Workbench
- [ ] 团队 Workbench 页面
- [ ] 方法库 / 数据集库 / 代码库 分 Tab
- [ ] 资产来源标注 (from 论文X, by 用户Y)
- [ ] "添加到团队" 按钮 (个人 Workbench)

### 3.4 前端 - 活动时间线
- [ ] 时间线 UI 组件
- [ ] 按日期分组
- [ ] 活动类型图标

---

## Phase 4: 任务管理 & AI 助手
**预计时间**: 2-3 周

### 4.1 数据库模型
- [ ] 创建 `reading_tasks` 表
- [ ] 创建 `task_assignees` 表
- [ ] 添加迁移脚本

### 4.2 后端 API - 阅读任务
- [ ] `GET /teams/{id}/tasks` - 获取团队任务列表
- [ ] `POST /teams/{id}/tasks` - 创建阅读任务
- [ ] `PUT /tasks/{id}` - 更新任务
- [ ] `PUT /tasks/{id}/assignees/{user_id}` - 提交阅读总结
- [ ] 任务状态流转逻辑

### 4.3 前端 - 任务看板
- [ ] 任务看板页面 (三栏: 待开始/进行中/已完成)
- [ ] 任务卡片组件
- [ ] 创建任务弹窗
- [ ] 任务详情页

### 4.4 前端 - 阅读总结
- [ ] 总结提交页面
- [ ] Markdown 编辑器
- [ ] 结构化总结模板 (贡献/方法/局限性)

### 4.5 后端 API - AI 讨论助手
- [ ] `POST /discussions/{id}/ai-assist` - @AI 请求处理
  - [ ] 解释功能
  - [ ] 总结功能
  - [ ] 搜索功能
  - [ ] 比较功能
  - [ ] 拓展功能
- [ ] `GET /papers/{id}/ai-search?team_id=xxx&query=xxx` - AI 团队知识库搜索
- [ ] `POST /discussions/{id}/ai-summarize` - AI 总结讨论
- [ ] AI 上下文构建 (论文 + 讨论 + Workbench)
- [ ] 团队 AI 配额限制

### 4.6 前端 - AI 讨论助手
- [ ] `@AI` 输入自动识别
- [ ] AI 指令补全 (解释/总结/搜索/比较/拓展)
- [ ] AI 思考中状态显示
- [ ] AI 回复消息样式 (🤖 图标)
- [ ] AI 引用来源链接

### 4.7 通知系统
- [ ] 通知数据模型
- [ ] `GET /notifications` API
- [ ] 通知中心 UI
- [ ] @提及 通知
- [ ] 任务分配/完成 通知
- [ ] 新讨论/回复 通知

---

## 非功能性任务

### 测试
- [ ] 团队权限单元测试
- [ ] 数据隔离集成测试
- [ ] API 端点测试
- [ ] 前端组件测试

### 文档
- [ ] API 文档更新 (Swagger/OpenAPI)
- [ ] 用户使用指南
- [ ] 团队管理员手册

### 性能与安全
- [ ] RLS (Row-Level Security) 策略
- [ ] 大团队分页优化
- [ ] AI 请求频率限制
- [ ] 敏感操作审计日志

---

## 里程碑

| 里程碑 | 预计完成 | 交付内容 |
|--------|----------|----------|
| **M1 - MVP** | Week 3 | 团队创建、成员管理、论文分享 |
| **M2 - 协作** | Week 6 | 多人标注、讨论线程、@提及 |
| **M3 - Workbench** | Week 8 | 团队资产库、活动时间线 |
| **M4 - 完整版** | Week 11 | 任务管理、AI 助手、通知系统 |

---

*Last Updated: 2025-12-23*
