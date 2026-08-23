# Time Friend / 见时

见时是一款从真实行动中帮助用户看见方向的个人时间管理应用。V1 完成三个闭环模块：

- 文件夹 / 清单 / 分组 → 任务 / 子任务 / 笔记与检查事项；
- 番茄、正计时、进展与任务动态；
- 周轨迹、Agent 解释、用户校正、下周承诺与版本化长期记忆。

Agent 使用 OpenAI Agents SDK，但只有只读工具。事实由确定性代码计算，证据由独立校验器核验；方向、长期记忆和承诺只有在用户明确确认后才会写入。

用户可以随时关闭全部 Agent 分析或排除单个清单；关闭后不会再自动或手动生成解释，既有任务、专注、事实与历史轨迹仍然可用。账户支持完整 JSON 数据导出，以及“立即撤销会话、后台级联擦除、仅保留无正文凭证”的删除流程。

## Monorepo

- `apps/web`：Next.js 16 / React 19 Web 应用
- `apps/api`：Fastify API、Better Auth、OpenAPI
- `apps/worker`：pg-boss Worker 与 Agent 工作流
- `packages/domain`：任务、专注、轨迹和记忆领域规则
- `packages/contracts`：Zod API 契约
- `packages/db`：Drizzle PostgreSQL schema、migration 和 repository
- `packages/queue`：事务内队列生产者与 Worker 注册
- `packages/agent`：OpenAI Agents SDK 适配器与只读工具
- `packages/observability`：OpenTelemetry traces/metrics 与可选 Sentry
- `tests/e2e`：Playwright 核心闭环与故障降级验收
- `work`：产品调研、PRD、技术方案、实现验收矩阵与 ADR

## 本地启动

需要 Node.js 22+、pnpm 9+、Docker，以及可用于轨迹生成的 OpenAI API key。

1. 安装依赖：`pnpm install`
2. 启动 PostgreSQL：`pnpm infra:up`
3. 将三个应用目录中的 `.env.example` 复制为 `.env`，填写密钥
4. 执行迁移：`pnpm db:migrate`
5. 启动应用：`pnpm dev`

Web 默认运行在 `http://localhost:3000`，API 默认运行在 `http://localhost:4000`。若 Web 未配置 `NEXT_PUBLIC_API_URL`，页面会进入不依赖后端的交互演示模式；配置后会启用真实注册登录和完整数据闭环。

`OTEL_EXPORTER_OTLP_ENDPOINT` 填 OTLP/HTTP 基础地址（例如 `http://localhost:4318`），API 与 Worker 会分别发送到 `/v1/traces` 和 `/v1/metrics`。设置 `SENTRY_DSN` 可启用无默认 PII 的异常上报。Worker 同时设置两项 `TRAJECTORY_*_USD_PER_MILLION_TOKENS` 后，会保存每次周轨迹的估算成本。

## 质量检查

- `pnpm lint`
- `pnpm typecheck`
- `pnpm run test:unit`（含真实 PostgreSQL 与 pg-boss 集成测试）
- `pnpm exec playwright install chromium`（首次准备浏览器运行时）
- `pnpm run test:e2e`
- `pnpm test`（一次运行全部测试）
- `pnpm build`
- `pnpm site:build`（生成 Codex Sites 发布产物）

数据库与队列集成测试使用 Testcontainers 启动真实 PostgreSQL，需保证 Docker 可用。

## 容器构建

同一个根 `Dockerfile` 通过 `APP_PACKAGE` 构建三个独立镜像，例如：`docker build --build-arg APP_PACKAGE=@time-friend/api -t time-friend-api .`。Web、API 与 Worker 使用同一提交和锁文件；运行 API/Worker 时按各自 `.env.example` 注入环境变量。

## 设计文档

- [V1 PRD](work/PRD-v1-minimum-loop.md)
- [V1 技术方案](work/technical-design-v1.md)
- [V1 实现验收矩阵](work/implementation-audit-v1.md)
- [架构决策记录](work/adr)
- [滴答清单产品拆解](work/dida-product-teardown.md)
- [产品调研](work/product-research-v0.md)
