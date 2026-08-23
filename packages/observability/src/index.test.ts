import { describe, expect, it } from "vitest";

import { metricAttributes, otlpSignalEndpoint } from "./index.js";

describe("privacy-safe metric attributes", () => {
  it("keeps bounded operational dimensions and drops likely identifiers or content", () => {
    expect(metricAttributes({ route: "/api/v1/items", status: 500, retry: true, email: "person@example.com", userId: "00000000-0000-7000-8000-000000000001" })).toEqual({
      route: "/api/v1/items",
      status: 500,
      retry: true,
    });
  });

  it("derives standard OTLP HTTP signal endpoints from a collector base URL", () => {
    expect(otlpSignalEndpoint("https://otel.example.com/collector/", "traces")).toBe("https://otel.example.com/collector/v1/traces");
    expect(otlpSignalEndpoint("https://otel.example.com/v1/traces", "metrics")).toBe("https://otel.example.com/v1/metrics");
    expect(() => otlpSignalEndpoint("file:///tmp/otel", "traces")).toThrow("HTTP or HTTPS");
  });
});
