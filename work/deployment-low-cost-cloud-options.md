# 见时低成本云部署方案（暂不实施）

状态：调研记录，暂不创建或修改任何云端资源

调研日期：2026-10-09

## 结论

本地和单机云主机以相同的容器镜像、环境变量、健康检查和迁移命令为可移植边界。Docker Compose 是本地与单台 Linux VM 的编排方式，不作为所有 PaaS 的通用部署格式。

后续需要部署时，按目标二选一：

1. 优先保持 Compose 原样运行：使用 OCI Always Free ARM VM。
2. 优先免运维：静态 Web 放 Cloudflare Pages，API、Worker 和 PostgreSQL 映射到 Northflank Sandbox。

免费平台只适合个人验证、演示和早期封闭测试。正式对外服务应准备每月约 5–10 美元的基础设施预算，并将模型 API、域名和备份存储单独计费。

## 方案 A：OCI Always Free VM

适用目标：最大程度复用本地 Compose，接受自己维护 Linux、Docker、TLS 和备份。

当前官方免费资源包括：

- ARM 实例合计 2 OCPU、12 GB 内存；
- 200 GB 免费块存储；
- Always Free 资源在账户生命周期内有效；
- 空闲免费实例存在被回收风险，部分区域也可能没有可用容量。

未来实施前提：

- 应用镜像同时支持 `linux/amd64` 和 `linux/arm64`；
- 增加 Caddy 或等价入口，只开放 80/443，PostgreSQL 不暴露公网；
- 云端使用独立随机数据库密码和 `BETTER_AUTH_SECRET`；
- 使用不可变版本标签，不以 `latest` 作为回滚依据；
- 每日 `pg_dump` 到独立对象存储，并定期验证恢复；
- 将主机和 Compose 配置做成可重复创建的基础设施脚本。

官方资料：[OCI Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

## 方案 B：Cloudflare Pages + Northflank Sandbox

适用目标：基础设施月费为 0，尽量减少系统运维，接受平台免费层限制。

资源映射：

| 当前组件 | 目标资源 |
| --- | --- |
| Web | Cloudflare Pages 静态站点 |
| API | Northflank 免费 Service 1 |
| Worker | Northflank 免费 Service 2 |
| PostgreSQL / pg-boss | Northflank 免费 Addon |
| 数据库迁移 | Northflank Job 1 |
| 数据库备份 | Northflank Job 2 |

Northflank Sandbox 当前提供 2 个常驻免费服务、1 个免费数据库和 2 个免费 Job/Cron，不会因无流量自动休眠。它支持 Dockerfile、外部容器镜像、自定义域名和 TLS，但不会原样执行仓库的 Compose，需要逐个创建平台资源。创建资源前需要添加付款方式，官方也明确免费层不应用于生产服务。

Web 当前使用 Next 动态请求头生成元数据，迁移到纯静态 Pages 前需要移除这一动态依赖并启用静态导出。建议 Web 和 API 使用同一注册域名下的子域名，降低认证 Cookie 与跨域配置复杂度。

官方资料：

- [Northflank 免费层与计费说明](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)
- [Northflank Pricing](https://northflank.com/pricing)
- [Cloudflare Workers/Pages Functions Pricing](https://developers.cloudflare.com/workers/platform/pricing/)

## 未优先采用的方案

### Google Cloud

永久免费 Compute Engine 只有一个指定美国区域的 `e2-micro` 和 30 GB 标准磁盘。完整运行 Next、Fastify、Worker 和 PostgreSQL 的余量过小。Cloud Run 可以低成本托管 API，但当前 pg-boss Worker 是常驻进程；改成 Cloud Run Job、Cloud Tasks 或事件驱动消费者需要重构，不作为当前阶段目标。

资料：[Google Cloud Free Program](https://docs.cloud.google.com/free/docs/free-cloud-features)

### Render

免费 Web Service 15 分钟无入站流量会休眠，750 小时由工作区全部免费实例共享；免费 PostgreSQL 30 天后过期，免费层也不提供后台 Worker，因此不适合当前架构。

资料：[Render Deploy for Free](https://render.com/docs/free)

### Railway

免费计划每月有 1 美元用量额度，每个服务最多 0.5 GB 内存。可以做短期预览，但 Web、API、Worker 与数据库持续运行很容易超过额度。若以后接受约 5 美元月费，Railway Hobby 可作为易用的迁移候选。

资料：[Railway Pricing Plans](https://docs.railway.com/pricing/plans)

### Fly.io 与 Koyeb

Fly.io 新账户没有永久免费层；Koyeb 当前没有适合常驻 API/Worker 的免费计算层。二者可以作为低价付费方案，但不满足本轮“尽量免费”的优先级。

资料：

- [Fly.io Resource Pricing](https://fly.io/docs/about/pricing/)
- [Koyeb Pricing](https://www.koyeb.com/pricing)

### Vercel、Cloudflare Workers 与 Serverless PostgreSQL

Vercel/Cloudflare 很适合静态前端和请求驱动函数，但当前 Fastify API、SSE 与常驻 pg-boss Worker 无法零改动迁入。Neon 等 Serverless PostgreSQL 虽有免费层，pg-boss 的持续轮询还可能阻止数据库缩容休眠、快速消耗免费计算时长。

因此现阶段坚持“标准容器 + PostgreSQL + 常驻 Worker”，等真实负载和成本数据出现后，再判断是否值得重构为 Serverless。

## 实施前检查清单

本文件转为实施计划前，至少重新确认：

- 各平台当日免费额度、付款方式要求、区域和出站流量价格；
- ARM 镜像构建和依赖兼容性；
- 数据库容量、备份、恢复与连接数限制；
- 自定义域名、Cookie、CORS、TLS 和中国大陆访问体验；
- AI Provider 的调用预算与失败降级；
- 免费层被暂停、回收或取消后的迁移和恢复时间。
