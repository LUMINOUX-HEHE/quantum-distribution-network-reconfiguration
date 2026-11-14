import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { evaluateScenarioForNetwork } from "@/lib/server/resilience";
import { enforceRateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireRole("engineer");
  if (!auth.ok) return auth.response;
  const limited = enforceRateLimit(request, "scenarios:evaluate", { limit: 30, actor: auth.session.username });
  if (limited) return limited;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON", code: "invalid_body" }, { status: 400 });
  }
  const networkId = Number(body.networkId);
  if (!Number.isFinite(networkId)) {
    return NextResponse.json({ error: "networkId is required", code: "invalid_request" }, { status: 400 });
  }
  try {
    const result = await evaluateScenarioForNetwork({
      networkId,
      config: body.config,
      scenarioId: Number.isFinite(Number(body.scenarioId)) ? Number(body.scenarioId) : undefined,
      configs: Array.isArray(body.configs)
        ? (body.configs as { label: string; openSet: number[] }[])
        : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scenario evaluation failed", code: "evaluation_failed" },
      { status: 500 },
    );
  }
}
