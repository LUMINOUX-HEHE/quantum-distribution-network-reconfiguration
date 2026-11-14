import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    service: "qa-dnr",
    api: { current: "v1", base: "/api/v1", legacyBase: "/api", deprecated: [] },
    solverCore: "qa-dnr-core/0.2.0",
    schema: "qa-dnr/schema/v2",
    capabilities: [
      "networks",
      "runs",
      "candidates",
      "benchmarks",
      "scenarios",
      "faults",
      "metrics",
      "audit",
      "export",
      "sse",
    ],
  });
}
