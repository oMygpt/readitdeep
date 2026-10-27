# 致 ask：增加「到 Read it DEEP 深度阅读」入口（A1–A3）

来源：RiD 设计 `docs/plans/2026-10-27-series-site-quota-config-design.md` v0.2（用户 2026-10-27 决定）。
流程：ask 按自己的规则开 PR；完成后在本 issue 回链，由 RiD 侧（Claude）对齐联调。

## 背景

用户在 ask 检索和综述之后，可以把论文**题录**带到 RiD 精读。带过去不花积分；用户在 RiD 上传或抓取 PDF 时，才按篇消耗主站积分。ask 只负责拼链接，不调用 RiD 的任何接口，也不传递 token。

## A1 搜索结果论文卡片

在每张结果卡片（`renderSerp` 的每一项，标题链接 `paperUrl(it.id)` 旁边）加一个次级按钮「RiD 深读」，英文界面为「Deep read」：

```
https://read.paperdaily.org/open?paper=<encodeURIComponent(it.id)>&from=ask
```

- 新标签页打开（`target="_blank" rel="noopener"`）。
- 埋点 `track("open_rid", { pos, src: "serp" })`，与现有点开论文的统计分开。

## A2 导出与综述

1. **导出菜单**：在「导出引用」下拉框（BibTeX / RIS / GB/T 7714）里增加一项「到 RiD 深度阅读（当前列表，最多 50 篇）」。

   ```
   https://read.paperdaily.org/open?paper=<id1>&paper=<id2>…&from=ask&title=<encodeURIComponent(原始问题，截断 100 字)>
   ```

   取与导出引用相同的列表（`d.items`，最多 50 篇），按当前排序。

2. **深度综述**：深度综述生成完成后，在卡片底部加按钮「在 RiD 精读本综述的 N 篇引文」。
   - 已登录且有主站综述历史 id 时，优先用 `https://read.paperdaily.org/open?review=<history_id>&from=ask`，RiD 会同时导入问题和答案作为笔记。
   - 否则用引文 paper_id 列表：`?paper=…&paper=…&from=ask&title=<问题>`。
   - 引文 id 取自现有 `#paper-card-<id>` 锚点改写逻辑使用的同一份数据。

## A3 链接约定（深链契约 v1，由 RiD 实现）

- `paper` 可以重复，最多 50 个；每个值都用 `encodeURIComponent`（paper_id 可能含 `/` 或 `:`）。
- `from`：取 `ask`。
- `title`：可选，≤100 字，RiD 只拿来当文件夹名。
- 禁止在链接中放 token、邮箱或论文元数据。RiD 会用用户自己的授权回主站取题录。
- 未登录 RiD 的用户会先跳 PaperDaily 登录，回来后继续导入。ask 无需判断登录状态。
- 链接总长控制在 4000 字符以内；超出时减少篇数。

## 验收

- 中英文界面都显示按钮；键盘可达，有 `aria-label`。
- 点击后打开的 URL 与上述格式完全一致（附截图或 e2e 断言）。
- 发布时 RiD 的 `/open` 若尚未上线，按钮先用 feature flag 隐藏（`RID_DEEP_READ_ENABLED`）。RiD 上线后通知 ask 打开。
