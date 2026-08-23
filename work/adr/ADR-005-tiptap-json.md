# ADR-005：正文持久化为受限 Tiptap JSONB

- 状态：已接受
- 日期：2026-08-23

## 背景

任务、子任务和笔记需要共享段落、列表、检查项和分隔线。把每个块拆成关系行会放大编辑事务和排序复杂度；只存 HTML 难以安全校验和演进。

## 决策

完整 ProseMirror/Tiptap 文档存入 `content_doc` JSONB，同时维护服务端提取的 `content_text` 用于搜索和 Agent。API 只接受 V1 允许的节点和属性；客户端使用受限扩展集并在 IndexedDB 保存带 revision 的草稿。

## 后果

- 任务和笔记复用同一块编辑器与文档模型。
- 查询正文使用 `content_text`，不在业务查询中解析 JSON。
- Schema 升级必须版本化、可迁移且保持旧文档可读；V1 不支持的 mark/node 在 API 边界被拒绝或规范化。
