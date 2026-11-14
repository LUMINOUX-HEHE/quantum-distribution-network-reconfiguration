import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { auditWithSession } from "@/lib/server/audit";
import { enforceRateLimit } from "@/lib/server/ratelimit";
import { createScenario, listScenarios } from "@/lib/server/resilience";
import { normaliseScenarioConfig } from "@/lib/power/profiles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const networkId = Number(url.searchParams.get("networkId"));
  const rows = await listScenarios(Number.isFinite(networkId) && networkId > 0 ? networkId : undefined);
  return NextResponse.json({ scenarios: rows });
}

export async function POST(request: Request) {
  const auth = await requireRole("engineer");
  if (!auth.ok) return auth.response;
  const limited = enforceRateLimit(request, "scenarios:create", { limit: 30, actor: auth.session.username });
  if (limited) return limited;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON", code: "invalid_body" }, { status: 400 });
  }
  const networkId = Number(body.networkId);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!Number.isFinite(networkId) || !name) {
    return NextResponse.json(
      { error: "networkId and name are required", code: "invalid_request" },
      { status: 400 },
    );
  }
  const row = await createScenario({
    networkId,
    name,
    description: typeof body.description === "string" ? body.description : undefined,
    kind: typeof body.kind === "string" ? body.kind : undefined,
    config: body.config ?? normaliseScenarioConfig({}),
    actor: auth.session.username,
  });
  await auditWithSession(auth.session, "scenario.create", {
    resource: `scenario:${row.id}`,
    detail: { networkId, config: row.config },
  });
  return NextResponse.json({ scenario: row }, { status: 201 });
}
