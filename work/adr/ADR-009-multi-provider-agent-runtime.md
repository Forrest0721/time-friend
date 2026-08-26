# ADR-009：多 Provider Agent Runtime

- 状态：已接受
- 日期：2026-08-26

## 背景

见时需要在保留现有 Agent 工作流边界的同时支持 DeepSeek。当前工作流已经使用 `@openai/agents` 0.17.0 的结构化输出、工具、Guardrail 和 tracing；领域事实、证据权限与最终持久化验证由确定性代码负责。切换到 GitHub Copilot SDK 或把供应商逻辑写入 API 都会扩大迁移面，并不能改善这一安全边界。

## 决策

保留 `@openai/agents` 0.17.0，不引入 Copilot Runtime。`packages/agent` 提供 Provider-neutral `TrajectoryAgentRunner`，通过显式 `OpenAIProvider` 和独立 `openai` 客户端构建 OpenAI、DeepSeek 两个适配器；禁止修改 SDK 全局默认 Provider。

- V1 统一使用 Responses transport；OpenAI 使用官方 endpoint，DeepSeek 只允许官方 `https://api.deepseek.com` endpoint。
- DeepSeek 只允许 `deepseek-v4-pro` 与 `deepseek-v4-flash`；未知组合启动失败。
- API 与 Worker 共享 `TRAJECTORY_PROVIDER`、`TRAJECTORY_MODEL`；模型密钥只存在 Worker。
- run 创建时持久化 Provider、模型、transport、配置版本和规范化 SHA-256 配置哈希。
- 已排队 run 按固化目标执行；新 run 使用当前平台目标，不提供用户级选择或 BYOK。
- 不做跨供应商自动回退。SDK 客户端重试关闭，pg-boss 统一处理最多 3 次退避。
- Runner 结果必须匹配固化目标，否则以 `AGENT_TARGET_MISMATCH` 永久失败。
- OpenAI 可使用禁用敏感数据的 SDK trace；DeepSeek 禁用 OpenAI SDK tracing，只记录本地 OpenTelemetry。
- Token 价格按 Provider 可选配置。缺少价格时成本为 `null`，Token 数量照常保存。

错误统一映射为可重试与永久错误。认证、模型不存在、不兼容请求、Provider 未配置、目标不匹配和证据越权不重试；超时、网络、429、5xx 可重试；无效输出或 Guardrail 拒绝最多再试一次。

## 后果

- Agent、Prompt、六个只读工具、Zod 输出和独立证据验证不依赖供应商，可以用同一套合约测试两种模型。
- 平台切换不会改变旧队列的执行目标；同一输入只有目标完全一致才复用成功 run。
- 同一周期换 Provider 会生成新复盘版本并保留旧版本，数据库迁移无需在回滚时撤销。
- DeepSeek 内容不会进入 OpenAI trace 服务；日志和数据库不得存储密钥、Authorization header 或 Provider 原始错误正文。
- 生产切换需要先通过合成数据 smoke、30-case 实际模型评测、预发布盲评和首批 50 次运行监控。

## 发布与回滚

先部署同时兼容两种 Provider 的代码和数据库迁移，再统一修改 API/Worker 目标配置。旧 Provider 密钥至少保留 24 小时且直到旧队列清空。回滚只需把目标改回 OpenAI 并重启 API/Worker，不回滚数据库迁移。

参考：[OpenAI Agents SDK 模型与 Provider](https://developers.openai.com/api/docs/guides/agents/models)、[DeepSeek Responses API](https://api-docs.deepseek.com/api/create-response/)。
