import { initializeObservability } from "@time-friend/observability";

const observability = await initializeObservability({
  serviceName: "time-friend-worker",
  environment: process.env.NODE_ENV ?? "development",
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || undefined,
  sentryDsn: process.env.SENTRY_DSN?.trim() || undefined,
});
process.once("beforeExit", () => void observability.shutdown());
await import("./index.js");
