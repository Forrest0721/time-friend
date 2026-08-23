import * as Sentry from "@sentry/node";
import { metrics, SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

export interface ObservabilityConfiguration {
  serviceName: string;
  environment: string;
  otlpEndpoint?: string;
  sentryDsn?: string;
}

export interface ObservabilityRuntime {
  enabled: boolean;
  shutdown(): Promise<void>;
}

const meter = metrics.getMeter("time-friend");
const productEvents = meter.createCounter("time_friend.product_events", { description: "Privacy-safe product events" });
const failures = meter.createCounter("time_friend.failures", { description: "Application failures by bounded category" });
const durations = meter.createHistogram("time_friend.operation.duration", { unit: "ms" });

export async function initializeObservability(configuration: ObservabilityConfiguration): Promise<ObservabilityRuntime> {
  const serviceName = configuration.serviceName.trim();
  if (!serviceName) throw new Error("observability serviceName is required");
  let sdk: NodeSDK | null = null;
  if (configuration.otlpEndpoint) {
    sdk = new NodeSDK({
      serviceName,
      traceExporter: new OTLPTraceExporter({ url: otlpSignalEndpoint(configuration.otlpEndpoint, "traces") }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: otlpSignalEndpoint(configuration.otlpEndpoint, "metrics") }),
        exportIntervalMillis: 60_000,
      }),
      instrumentations: [getNodeAutoInstrumentations({ "@opentelemetry/instrumentation-fs": { enabled: false } })],
    });
    await sdk.start();
  }
  if (configuration.sentryDsn) {
    Sentry.init({
      dsn: configuration.sentryDsn,
      environment: configuration.environment,
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });
  }
  return {
    enabled: sdk !== null || Boolean(configuration.sentryDsn),
    async shutdown() {
      await Promise.all([sdk?.shutdown() ?? Promise.resolve(), configuration.sentryDsn ? Sentry.close(2_000) : Promise.resolve(true)]);
    },
  };
}

export function recordProductEvent(name: string, attributes: Record<string, unknown> = {}): void {
  productEvents.add(1, { "event.name": boundedName(name), ...metricAttributes(attributes) });
}

export function recordFailure(category: string, attributes: Record<string, unknown> = {}): void {
  failures.add(1, { "failure.category": boundedName(category), ...metricAttributes(attributes) });
}

export function recordDuration(operation: string, durationMs: number, attributes: Record<string, unknown> = {}): void {
  durations.record(Math.max(0, durationMs), { "operation.name": boundedName(operation), ...metricAttributes(attributes) });
}

export function captureException(error: unknown, attributes: Record<string, unknown> = {}): void {
  Sentry.captureException(error, { tags: metricAttributes(attributes) as Record<string, string | number | boolean> });
}

export async function withSpan<T>(name: string, attributes: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
  return trace.getTracer("time-friend").startActiveSpan(boundedName(name), { attributes: metricAttributes(attributes) }, async (span) => {
    try {
      const result = await work();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error("unknown failure"));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function metricAttributes(input: Record<string, unknown>): Attributes {
  const output: Attributes = {};
  for (const [key, value] of Object.entries(input).slice(0, 20)) {
    if (!/^[a-z][a-z0-9_.-]{0,63}$/i.test(key)) continue;
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) output[key] = value;
    if (typeof value === "string" && value.length <= 100 && !looksSensitive(value)) output[key] = value;
  }
  return output;
}

export function otlpSignalEndpoint(baseEndpoint: string, signal: "traces" | "metrics"): string {
  const endpoint = new URL(baseEndpoint.trim());
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("OTLP endpoint must use HTTP or HTTPS");
  }
  const prefix = endpoint.pathname.replace(/\/$/u, "").replace(/\/v1\/(?:traces|metrics)$/u, "");
  endpoint.pathname = `${prefix}/v1/${signal}`;
  return endpoint.toString();
}

function boundedName(value: string): string {
  const normalized = value.trim().replace(/[^a-z0-9_.-]+/giu, "_").slice(0, 100);
  return normalized || "unknown";
}

function looksSensitive(value: string): boolean {
  return value.includes("@") || /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/iu.test(value) || value.length > 100;
}
