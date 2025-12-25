# Read it DEEP - Team Collaboration PRD

**Product Requirements Document**  
**Version**: 1.0.0  
**Date**: 2025-12-23  
**Status**: Draft

---

## 1. 概述

### 1.1 背景
Read it DEEP 目前是单用户模式的论文阅读平台。为满足学术研究团队的协作需求，我们计划推出 **Team Collaboration** 功能，让研究团队能够共享论文、协作标注、共建知识库。

### 1.2 目标用户
- 学术研究实验室 (5-20人)
- 企业研发团队
- 跨校合作研究组
- 论文读书会/兴趣小组

### 1.3 核心价值
| 痛点 | 解决方案 |
|------|----------|
| 论文资料分散，难以共享 | 团队共享知识库 |
| 阅读心得无法交流 | 协作标注与团队笔记 |
| 方法/数据集重复整理 | 共享 Workbench |
| 读论文进度不透明 | 任务分配与进度追踪 |

---

## 2. 功能规格

### 2.1 团队空间 (Team Workspace)

#### 2.1.1 创建团队
```
用户可以创建或加入多个团队
└── 每个团队有独立的名称、头像、描述
└── 创建者自动成为 Admin
```

**角色权限矩阵**:

| 权限 | Owner | Admin | Member | Guest |
|------|-------|-------|--------|-------|
| 删除团队 | ✅ | ❌ | ❌ | ❌ |
| 管理成员 | ✅ | ✅ | ❌ | ❌ |
| 上传论文到团队 | ✅ | ✅ | ✅ | ❌ |
| 查看团队论文 | ✅ | ✅ | ✅ | ✅ |
| 编辑团队笔记 | ✅ | ✅ | ✅ | ❌ |
| 分配阅读任务 | ✅ | ✅ | ❌ | ❌ |

#### 2.1.2 邀请成员
- **邀请链接**: 生成可配置有效期的邀请链接
- **邮箱邀请**: 直接通过邮箱发送邀请
- **申请加入**: 成员可申请，Admin 审批

#### 2.1.3 团队 Library
```
┌─────────────────────────────────────────────────────┐
│ 📚 My Library    │  🏢 Team: AI Research Lab        │
│                  │                                   │
│ [个人论文列表]   │  [团队共享论文列表]              │
│                  │                                   │
│ 右键 → 分享到团队│  显示: 上传者、分享时间          │
└─────────────────────────────────────────────────────┘
```

**分享机制**:
- 论文可从个人 Library 分享到团队
- 分享时选择 `仅链接` 或 `完整复制`（含标注）
- 团队论文显示上传者信息

---

### 2.2 协作标注 (Collaborative Annotation)

#### 2.2.1 多人高亮
```
当多人阅读同一论文时:
├── 每人高亮颜色不同（自动分配或可自定义）
├── hover 显示: "张三标注于 2024-01-15"
└── 可筛选: 只看自己的 / 看所有人的 / 看特定成员的
```

#### 2.2.2 团队笔记
**笔记可见性**:
| 类型 | 图标 | 说明 |
|------|------|------|
| 私有笔记 | 🔒 | 仅自己可见 |
| 团队笔记 | 👥 | 团队成员可见 |
| 公开笔记 | 🌐 | 未来扩展 |

**@提及功能**:
```markdown
我觉得这个方法很巧妙 @李四 你怎么看？
```
- 被提及者收到通知
- 可直接回复形成讨论线程

#### 2.2.3 讨论线程
```
┌────────────────────────────────────────────┐
│ 📍 第 3.2 节 - Attention Mechanism         │
├────────────────────────────────────────────┤
│ 👤 张三: 这个公式的推导过程不太清楚        │
│    └── 👤 李四: 可以参考原始 Transformer 论文 │
│    └── 🤖 AI: 这个公式是 Scaled Dot-Product   │
│           Attention，核心是 Q·K^T/√d_k...   │
│                                            │
│ [💬 添加评论...]  [🤖 @AI 请求帮助]          │
└────────────────────────────────────────────┘
```

---

### 2.5 AI 讨论助手 (AI Discussion Assistant)

> 🌟 **核心亮点**: 在团队讨论中可以 @AI 参与，异步响应，无需实时协作

#### 2.5.1 @AI 功能
在任何讨论中可以 `@AI` 触发 AI 助手：

| 指令 | 功能 | 示例 |
|------|------|------|
| `@AI 解释` | 解释当前选中的文本/公式 | `@AI 解释这个公式` |
| `@AI 总结` | 总结当前讨论线程 | `@AI 总结一下大家的观点` |
| `@AI 搜索` | 在团队论文库中搜索 | `@AI 搜索相关的 LoRA 论文` |
| `@AI 比较` | 比较不同论文的方法 | `@AI 比较这篇和 BERT 的区别` |
| `@AI 拓展` | 推荐相关论文/资料 | `@AI 还有哪些论文用了这个方法？` |

#### 2.5.2 AI 响应模式
```
用户发起 @AI 请求
    ↓
系统显示 "🤖 AI 正在思考..."
    ↓
AI 异步处理（结合论文上下文 + 团队知识库）
    ↓
AI 回复作为新的讨论消息显示
```

#### 2.5.3 AI 上下文感知
AI 回复时会考虑：
- 📄 **当前论文内容**: 相关段落、公式、图表
- 💬 **讨论上下文**: 之前的讨论内容
- 📚 **团队知识库**: Workbench 中的方法/数据集
- 📈 **相关论文**: 团队 Library 中的其他论文

#### 2.5.4 UI 示例
```
┌────────────────────────────────────────────┐
│ 💬 讨论: Attention 机制                    │
├────────────────────────────────────────────┤
│ 👤 张三: Multi-head attention 的作用是什么？  │
│                                            │
│ 👤 李四: @AI 帮我们解释一下                │
│                                            │
│ 🤖 AI: Multi-head attention 的核心作用是：  │
│   1. 让模型同时关注不同位置的信息          │
│   2. 捕捉不同类型的依赖关系                  │
│   📎 参考: 团队论文《Vision Transformer》      │
│                                            │
│ 👤 张三: 懂了！谢谢 @AI                       │
└────────────────────────────────────────────┘
```

---

### 2.3 共享 Workbench

#### 2.3.1 团队资产库
```
团队 Workbench
├── 📐 Methods (方法库)
│   ├── Transformer Attention (from 论文A)
│   ├── LoRA Fine-tuning (from 论文B)
│   └── ...
├── 📊 Datasets (数据集库)
│   ├── ImageNet
│   ├── COCO
│   └── ...
└── 💻 Code (代码库)
    ├── https://github.com/xxx
    └── ...
```

**来源追踪**:
- 每个资产记录: 来源论文、添加者、添加时间
- 支持合并重复资产

#### 2.3.2 研究进展时间线
```
📅 2024-01-20
├── 👤 张三 添加了 "LoRA" 到方法库 (from 论文X)
├── 👤 李四 完成了论文Y的阅读总结

📅 2024-01-19
├── 👤 王五 分享了新论文到团队
└── ...
```

---

### 2.4 阅读任务分配

#### 2.4.1 创建任务
```json
{
  "title": "阅读 BERT 原论文",
  "paper_id": "xxx",
  "assignees": ["user_id_1", "user_id_2"],
  "deadline": "2024-01-25",
  "requirements": "完成阅读笔记，总结核心贡献"
}
```

#### 2.4.2 任务看板
```
┌─────────────────────────────────────────────────────┐
│ 📋 阅读任务                      [+ 新建任务]       │
├─────────────────────────────────────────────────────┤
│ 待开始 (3)    │ 进行中 (2)    │ 已完成 (5)        │
│               │               │                    │
│ ┌───────────┐ │ ┌───────────┐ │ ┌───────────┐      │
│ │ BERT      │ │ │ GPT-4     │ │ │ Attention │      │
│ │ 👤 张三   │ │ │ 👤 李四   │ │ │ ✅ 全员   │      │
│ │ 📅 1/25   │ │ │ 📅 1/22   │ │ │           │      │
│ └───────────┘ │ └───────────┘ │ └───────────┘      │
└─────────────────────────────────────────────────────┘
```

#### 2.4.3 阅读总结
- 成员提交结构化总结（核心贡献、方法、局限性等）
- 支持 Markdown 格式
- 组长可发起「在线论文组会」讨论

---

## 3. 数据模型

### 3.1 新增数据库表

```sql
-- 团队表
CREATE TABLE teams (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    avatar_url VARCHAR(500),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 团队成员表  
CREATE TABLE team_members (
    id UUID PRIMARY KEY,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member',  -- owner, admin, member, guest
    joined_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);

-- 团队邀请表
CREATE TABLE team_invitations (
    id UUID PRIMARY KEY,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    invite_code VARCHAR(20) UNIQUE,
    created_by UUID REFERENCES users(id),
    max_uses INT DEFAULT 0,  -- 0 = unlimited
    used_count INT DEFAULT 0,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 论文分享表
CREATE TABLE paper_shares (
    id UUID PRIMARY KEY,
    paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    shared_by UUID REFERENCES users(id),
    shared_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(paper_id, team_id)
);

-- 团队笔记/标注表
CREATE TABLE team_annotations (
    id UUID PRIMARY KEY,
    paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    type VARCHAR(20),  -- highlight, note, comment
    content TEXT,
    position_data JSONB,  -- 标注位置信息
    visibility VARCHAR(20) DEFAULT 'team',  -- private, team
    parent_id UUID REFERENCES team_annotations(id),  -- 用于回复
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 阅读任务表
CREATE TABLE reading_tasks (
    id UUID PRIMARY KEY,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    paper_id UUID REFERENCES papers(id),
    title VARCHAR(200),
    description TEXT,
    created_by UUID REFERENCES users(id),
    deadline TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending',  -- pending, in_progress, completed
    created_at TIMESTAMP DEFAULT NOW()
);

-- 任务分配表
CREATE TABLE task_assignees (
    id UUID PRIMARY KEY,
    task_id UUID REFERENCES reading_tasks(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending',
    summary TEXT,  -- 阅读总结
    completed_at TIMESTAMP,
    UNIQUE(task_id, user_id)
);
```

### 3.2 修改现有表

```sql
-- papers 表增加字段（可选）
ALTER TABLE papers ADD COLUMN visibility VARCHAR(20) DEFAULT 'private';
-- private: 仅自己可见
-- team: 分享到团队后可见
```

---

## 4. API 设计

### 4.1 团队管理

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/teams` | 创建团队 |
| GET | `/teams` | 获取我的团队列表 |
| GET | `/teams/{id}` | 获取团队详情 |
| PUT | `/teams/{id}` | 更新团队信息 |
| DELETE | `/teams/{id}` | 删除团队 |
| POST | `/teams/{id}/invite` | 生成邀请链接 |
| POST | `/teams/{id}/join` | 加入团队 |
| GET | `/teams/{id}/members` | 获取成员列表 |
| PUT | `/teams/{id}/members/{user_id}` | 更新成员角色 |
| DELETE | `/teams/{id}/members/{user_id}` | 移除成员 |

### 4.2 论文分享

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/papers/{id}/share` | 分享论文到团队 |
| DELETE | `/papers/{id}/share/{team_id}` | 取消分享 |
| GET | `/teams/{id}/papers` | 获取团队论文列表 |

### 4.3 协作标注

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/papers/{id}/annotations?team_id=xxx` | 获取论文团队标注 |
| POST | `/papers/{id}/annotations` | 创建标注 |
| PUT | `/annotations/{id}` | 更新标注 |
| DELETE | `/annotations/{id}` | 删除标注 |
| POST | `/annotations/{id}/reply` | 回复标注 |

### 4.4 阅读任务

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/teams/{id}/tasks` | 获取团队任务列表 |
| POST | `/teams/{id}/tasks` | 创建阅读任务 |
| PUT | `/tasks/{id}` | 更新任务 |
| PUT | `/tasks/{id}/assignees/{user_id}` | 提交阅读总结 |

### 4.5 AI 讨论助手

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/discussions/{id}/ai-assist` | @AI 请求处理 |
| GET | `/papers/{id}/ai-search?team_id=xxx&query=xxx` | AI 团队知识库搜索 |
| POST | `/discussions/{id}/ai-summarize` | AI 总结讨论 |

---

## 5. 用户界面

### 5.1 导航栏变化
```
┌─────────────────────────────────────────────────────┐
│ 📚 Read it DEEP                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│ 📖 My Library                                       │
│ ──────────────                                      │
│ 🏢 Teams                                            │
│    ├── AI Research Lab ⭐                           │
│    │   ├── 📚 Papers (23)                           │
│    │   ├── 📐 Workbench                             │
│    │   └── 📋 Tasks (3)                             │
│    └── NLP Study Group                              │
│                                                     │
│ [+ Create Team]                                     │
└─────────────────────────────────────────────────────┘
```

### 5.2 团队论文页面
```
┌─────────────────────────────────────────────────────┐
│ 🏢 AI Research Lab > 📚 Papers                      │
├─────────────────────────────────────────────────────┤
│ [🔍 搜索...] [📤 分享论文到团队] [筛选 ▼]         │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 📄 Attention Is All You Need                    │ │
│ │ 分享者: 张三 | 2024-01-15 | 👁 5人已读          │ │
│ │ [📖 阅读] [📝 2条团队笔记] [📋 阅读任务]       │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 📄 BERT: Pre-training of Deep Transformers      │ │
│ │ 分享者: 李四 | 2024-01-14 | 👁 3人已读          │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 5.3 阅读器团队模式
```
┌─────────────────────────────────────────────────────┐
│ 📄 论文内容         │ 👥 团队侧边栏                 │
│                     │                               │
│ [高亮文本示例]      │ 📝 团队笔记 (5)               │
│ ├── 🟡 张三标注     │ ├── 张三: 这段很关键          │
│ ├── 🔵 李四标注     │ └── 李四: 同意，值得深入      │
│                     │                               │
│                     │ 💬 讨论区 (2)                 │
│                     │ @张三 你怎么理解这个公式？    │
│                     │                               │
│                     │ 📋 阅读任务                    │
│                     │ ┌───────────────────────────┐ │
│                     │ │ 🔴 待完成                 │ │
│                     │ │ 截止: 2024-01-25          │ │
│                     │ │ [提交阅读总结]             │ │
│                     │ └───────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## 6. 实施计划

### Phase 1: 基础团队功能 (MVP)
**时间**: 2-3 周
- [ ] 团队 CRUD
- [ ] 成员邀请/管理
- [ ] 论文分享到团队
- [ ] 团队 Library 视图

### Phase 2: 协作标注
**时间**: 2-3 周
- [ ] 多人高亮（不同颜色区分）
- [ ] 团队笔记
- [ ] @提及功能
- [ ] 讨论线程

### Phase 3: 共享 Workbench
**时间**: 1-2 周
- [ ] 团队资产库
- [ ] 来源追踪
- [ ] 活动时间线

### Phase 4: 任务管理 & AI 助手
**时间**: 2-3 周
- [ ] 阅读任务创建/分配
- [ ] 任务看板
- [ ] 阅读总结提交
- [ ] @AI 讨论助手
- [ ] AI 团队知识库搜索
- [ ] 通知系统

---

## 7. 成功指标

| 指标 | 目标 |
|------|------|
| 团队创建数 | 上线首月 50+ |
| 平均团队成员数 | 5+ 人 |
| 论文分享率 | 30% 的论文被分享到团队 |
| 协作标注使用率 | 20% 的团队论文有多人标注 |
| 阅读任务完成率 | 70%+ |

---

## 8. 技术风险与对策

| 风险 | 对策 |
|------|------|
| 数据隔离安全 | 严格的 RLS (Row-Level Security) |
| 大团队性能 | 分页加载 + 缓存策略 |
| 用户体验复杂度 | 渐进式功能引导 |
| AI 响应质量 | 结合 RAG + 团队知识库上下文 |
| AI 费用控制 | 团队配额限制 + 用量统计 |


---

## 附录 A: 竞品参考

| 产品 | 亮点 | 可借鉴 |
|------|------|--------|
| Notion | 团队协作、实时编辑 | 权限系统、@提及 |
| Zotero Groups | 文献共享 | 简单的分享机制 |
| Hypothesis | 网页标注协作 | 公开/私有标注 |
| ReadCube Papers | 团队文献管理 | 论文组织方式 |



---

*Document End*
