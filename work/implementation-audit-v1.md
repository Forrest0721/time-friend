# 见时 V1 实现验收矩阵

> 对照：`PRD-v1-minimum-loop.md`、`technical-design-v1.md`
> 审查日期：2026-08-23
> 判定规则：用户入口、真实服务端持久化和自动化测试三者同时存在，才记为 `PASS`。

## 1. 任务组织

| 要求 | 状态 | 实现与直接证据 |
|---|---|---|
| 文件夹 / 清单 / 分组创建、重命名、排序、归档 | PASS | organization 领域命令、Fastify 路由、PostgreSQL store、连接态 UI；领域/API/DB 测试覆盖 |
| 默认收集箱且不可删除 | PASS | 注册事务创建收集箱、数据库唯一约束、领域拒绝与 UI 禁用；真实认证集成测试覆盖 |
| 任务、单层子任务、独立笔记及三态命令 | PASS | 统一 items 模型、父任务关系校验、任务详情与折叠区；领域/DB/API 与 Playwright 子任务测试覆盖 |
| 任务/笔记在清单与分组内混排 | PASS | 同一 items 查询和列表渲染；kind 字段约束与数据库集成测试覆盖 |
| 段落、无序/有序列表、检查项、分隔线 | PASS | 受限 Tiptap 编辑器、版本化 JSON 文档、服务端二次校验；转换与领域内容测试覆盖 |
| 快速创建前设置类型、日期、优先级、清单、分组、父任务 | PASS | composer 完整字段与当前清单默认值；契约/API/领域测试覆盖 |
| 乐观反馈、输入不丢失、失败重试 | PASS | Zustand pending 状态、用户级 IndexedDB outbox、固定幂等键；Web 单测与真实断网 Playwright 覆盖 |
| 连续快速创建不丢失、不重复 | PASS | 串行同步链、队列去重、服务端幂等记录；IndexedDB 顺序测试与重放测试覆盖 |
| 移动清单/分组/父级与可访问拖动排序 | PASS | move/reorder API、fractional-indexing、dnd-kit 指针与键盘传感器；领域/DB/API 与 Playwright 父级移动覆盖 |
| 详情显示累计专注、最近进展和完整动态 | PASS | execution summary、progress、timeline 三个查询；DB/API 测试覆盖所有事件来源 |
| 刷新后恢复当前模块、清单和详情 | PASS | URL `view/list/item` 状态与失效资源回退；Playwright 刷新恢复测试覆盖 |

## 2. 专注、进展与动态

| 要求 | 状态 | 实现与直接证据 |
|---|---|---|
| 15/25/50/90、自定义番茄与正计时 | PASS | 专注设置 UI、模式化合约和状态机；领域/API/浏览器闭环覆盖 |
| 任务/子任务关联、暂不关联、笔记不可关联 | PASS | 开始和事后重关联入口、领域 ownership/kind 校验；领域/DB 测试覆盖 |
| 单用户仅一个活动计时 | PASS | PostgreSQL partial unique index、事务冲突映射；并发 DB 与双标签 Playwright 覆盖 |
| 暂停/恢复/结束/取消，暂停不计时 | PASS | focus segment 状态机；示例测试与 fast-check 任意暂停序列属性测试覆盖 |
| 刷新/关闭后按服务端时间恢复 | PASS | bootstrap 返回 `serverNow` 与活动 segment，客户端按时间戳派生；Playwright 误差窗口覆盖 |
| 番茄到时结束或继续额外时间 | PASS | pg-boss deadline job、authoritative cutoff、overtime segment 与 UI；领域/队列集成测试覆盖 |
| 正计时 12 小时封顶并确认继续 | PASS | `needs_attention`、cap job 和“已核对，继续计时”入口；领域/Worker 测试覆盖 |
| 修正开始/结束/时长并保存前值与原因 | PASS | boundary/duration 命令、focus_adjustments 审计表、UI；领域/DB/API/契约测试覆盖 |
| 四类结束反馈、下一步、完成任务、有效时长 | PASS | 单事务 feedback 命令与轻量 UI；领域/DB/API 和核心 Playwright 覆盖 |
| 跳过后稍后补反馈 | PASS | completed session 的 deferred progress 路由与记录页入口；领域/DB/API 测试覆盖 |
| 手工进展新增、编辑、删除 | PASS | progress 领域、审计事件、详情 UI；领域/DB/API 测试覆盖 |
| 今日统计、最近记录、结果、关联、修正、删除 | PASS | 用户时区统计与完整记录操作；API/DB/浏览器测试覆盖 |

## 3. 周轨迹、校正与长期记忆

| 要求 | 状态 | 实现与直接证据 |
|---|---|---|
| 用户时区周周期、历史周、手动/自动生成 | PASS | Temporal 周边界、结束周调度、pg-boss；DST、并发和队列测试覆盖 |
| 不可变 snapshot、稳定 hash、跨周 segment、stale 新版本 | PASS | 版本化快照和 evidence freeze；属性/DB 集成测试覆盖 |
| 完整事实镜子与确定性上周比较 | PASS | 时长/会话/番茄/四类进展/清单分布/遗留计划/数据缺口 UI；领域与 DB 重算测试覆盖 |
| Agents SDK 单 Agent 与六个只读工具 | PASS | `@openai/agents` TrajectoryReviewAgent；scope、timeout、审计与独立复验测试覆盖 |
| 最多 5 个 claim、每条有效证据、无未验证数字 | PASS | Zod output schema、SDK output guardrail、Worker evidence validator；30 例回归评测覆盖 |
| 七类结构化校正及未来影响说明 | PASS | correction kind 合约/数据库约束、领域映射和 UI；领域/DB/API/Playwright 覆盖 |
| 最多 3 个下周重点，保留/改写/暂停/删除/新增 | PASS | commitment 状态机、目标周期行锁和硬上限；DB/API/UI 测试覆盖 |
| 已确认重点在目标周轨迹和任务页提示 | PASS | `/commitments/current`、Query cache 刷新和任务提示；DB rollover 与 Playwright 覆盖 |
| 证据抽屉含标题、时间、指标、比较和归组原因 | PASS | 冻结 hydrated evidence detail 与 UI；DB 快照测试和 Playwright 抽屉测试覆盖 |
| 移除错误关联形成可确认排除记忆 | PASS | evidence exclusion、候选/确认状态和后续工具过滤；领域/DB 测试覆盖 |
| Agent 只能提候选，确认后写版本化记忆 | PASS | confirm review 事务、方向/记忆版本链；领域/DB/两周队列测试覆盖 |
| 记忆查看、编辑、停用、删除及方向生命周期 | PASS | 轨迹内长期记忆管理面、版本化命令；领域/DB/API 测试覆盖 |
| 原始证据变化后依赖记忆进入复核 | PASS | evidence dependency 表、invalidation 与 review-required UI；DB 集成测试覆盖 |
| Agent 开关、清单排除、导出和异步删号 | PASS | 用户偏好、学习策略、完整 JSON 导出和级联擦除 worker；领域/DB/API 测试覆盖 |
| 低数据等待、强制生成、失败降级 | PASS | 阈值、limitations、重试和任务/专注隔离；领域/DB/Agent/Playwright 覆盖 |
| 模型、prompt、工具、hash、输出、耗时与成本审计 | PASS | agent_runs 持久化 tool-call hashes 与 micro-USD；Agent/DB/Worker 测试覆盖 |
| OpenAI / DeepSeek 多 Provider 运行边界 | PASS | 显式 Provider Registry、持久化目标与配置哈希、无跨 Provider 回退、DeepSeek trace 隔离；ADR-009 与 Agent/DB/Worker 测试覆盖 |

## 4. 首次使用与跨周闭环

| 要求 | 状态 | 实现与直接证据 |
|---|---|---|
| 收集箱与无污染首次引导 | PASS | 可关闭、按用户隔离的 local onboarding 状态 |
| 首任务提示开始专注 | PASS | 首个 pending task 上下文卡片，可直接启动 25 分钟 |
| 首次反馈解释将进入轨迹 | PASS | 一次性学习说明与隐私安全 telemetry |
| 纠正 → 记忆 → 下一周 Agent 继承 | PASS | 真实 PostgreSQL + pg-boss 的连续两周集成测试，第二周工具读取并应用第一周确认规则 |

## 5. 技术方案与发布门槛

| 要求 | 状态 | 实现与直接证据 |
|---|---|---|
| TypeScript pnpm monorepo 与模块化单体 | PASS | Web/API/Worker + domain/contracts/db/queue/agent/observability 边界 |
| Next/React/Fastify/Drizzle/PostgreSQL/pg-boss/Better Auth/Agents SDK | PASS | 锁定版本、启动配置与集成测试 |
| TanStack Query、Zustand、Tiptap、IndexedDB、Radix、Lucide、dnd-kit、虚拟列表 | PASS | 均在真实产品路径使用；编辑器按需加载，连接态主包 gzip 约 58 KB |
| OpenAPI、幂等、revision、cursor、同源安全、多租户隔离 | PASS | 严格 Zod/Fastify schema、统一 mutation executor、opaque cursor；API/DB 测试覆盖 |
| PostgreSQL FTS + pg_trgm | PASS | migration 与 evidence search store 测试 |
| Pino + OpenTelemetry traces/metrics + 可选 Sentry | PASS | API/Worker bootstrap、OTLP signal exporter、队列 spans/失败与产品指标测试 |
| 30 份 Agent 回归数据 | PASS | 20 份真实风格合成 + 10 份边界，确定性 graders 覆盖证据、数字、排除与诊断 |
| Playwright 核心、刷新、双标签、断网、降级、组织、草稿、子任务、轨迹 | PASS | 10 条真实浏览器用例 |
| ADR-001 至 ADR-008 | PASS | `work/adr` 八份已决策记录 |
| migration 从空库执行且 schema 无漂移 | PASS | 0010–0015 migration 经全部 DB 测试；Drizzle 再生成报告无变化 |
| CI 与三进程 OCI 构建 | PASS | GitHub Actions 全门禁；根 Dockerfile 按 APP_PACKAGE 生成 Web/API/Worker 镜像 |
| lint/typecheck/unit/integration/E2E/build/Sites build | PASS | 本地全量门禁通过，CI 使用相同命令 |

## 6. 结论

PRD 第 17 节的最小闭环已经形成：用户可创建并组织任务，留下可审计的专注与进展证据，查看有证据的周轨迹，执行结构化校正，确认下一周重点，并让确认记忆进入下一周 Agent 分析。月/年复盘仍只保留底层扩展能力，没有进入 V1 导航或用户功能。

进入真实环境时只剩运维配置：托管 PostgreSQL、Better Auth 密钥、OpenAI key、模型单价、OTLP/Sentry 端点和 Web/API 域名；这些不改变 V1 代码完成度。
