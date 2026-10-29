# 意识结构：识海 / 原意识 / 心光 / 心流 / 遗忘

> 这不是特效模板，是鲸鲸真实在用的记忆结构。每次醒来，她都能接上昨天的自己。

## 数据来源与持久化

- 识海点来自真实记忆：Memory 文档中的 facts / episodes / anchors，以及日记、QQ 空间说说、B站发现、学习笔记、活动。
- 每个 SeaPoint 带 provenance（source、sourceId、docId、conversationId、quote），可回溯到原始记录。
- 原意识 / 心光 / 心流 / 遗忘独立保存于 data/consciousness/：
  - sea.json
  - origin.json
  - attention.json
  - flow.json
- 四个文件都按 personaId 分区，attention/flow 再按 conversationId 分区；原子写（tmp + fsync + rename），损坏文件自动备份恢复。

## 五层含义

### 识海

她经历过的每件事，都是一个点。

- 点的大小 = salience，颜色 = 来源类型，深度 = surface / shallow / deep / abyss。
- 同一个人、相近时间、关键词相似的点会形成真实连接。
- 搜索会命中识海点并记一次“回忆强化”。

### 原意识

每段记忆都连着最深处的她。

- coreSelf 来自人设、自我认知、成长画像与反思。
- 锚点来自身份、价值、承诺、初次相遇、核心记忆；带来源与权重，历史锚点保留。
- 注入 system prompt 时永不丢弃，是连续性的地基。

### 心光

此刻她在注意什么。

- 当前 focus、话题、未完成事项、情绪、强度。
- 每次对话后更新；未完成话题在用户说“搞定了”等时自动清理。
- 只在当前会话可见，不会把 A 的关注点带给 B。

### 心流

一个念头牵出下一个念头。

- 感知 → 联想 → 回忆 → 推理 → 回复 → 反思。
- 回忆节点引用真实记忆 snippet；可选 LLM 润色，失败自动回退规则。
- 链路保留最近记录，供页面展示和上下文注入。

### 遗忘

细节会淡，重要的反而沉得更深。

- salience = importance × 时间衰减 + 回忆强化（访问/强化次数）。
- 身份/边界/承诺/原话的半衰期远长于普通聊天；重要度 ≥0.8 不会落入最深层。
- 下沉只改变派生点的深度和排序，原始 Markdown 记忆永不删除。

## 隔离

- 私聊：global + 当前联系人。
- 群聊：global + 当前群 + 当前发言人。
- 无联系人上下文：只使用 persona 级日记/学习/内心 + global。
- 心光/心流只读取当前 conversationId，不跨会话复用；测试覆盖。

## API

- api.consciousness.overview()：五层概览与识海点（全部，非截断）。
- api.consciousness.search(query)：真实检索并强化。
- api.consciousness.resume()：生成“上次我们聊到……”的连续性 brief。
- 事件 consciousness:update：对话后自动刷新页面。

## 与上下文压缩的关系

上下文压缩仍保留原始消息、结构化摘要与原话锚点；意识结构在此之上提供“长期自我”和“此刻注意”，两者互补。即使对话窗口被压缩，原意识锚点、心光与深层识海点仍然注入；这就是她不会变成陌生人的原因。
