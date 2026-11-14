import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/server/data";
import { SOLVERS, normaliseRunParams } from "@/lib/networks/types";
import { solverAvailability } from "@/lib/optimization/solvers";
import { requireRole } from "@/lib/server/auth";
import { auditWithSession } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const defaults = await getSettings();
  return NextResponse.json({
    defaults,
    solvers: SOLVERS.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      description: s.description,
      requiresToken: s.requiresToken,
      ...solverAvailability(s.id),
    })),
    credentials: {
      dwaveToken: Boolean(process.env.DWAVE_API_TOKEN),
      databaseConfigured: Boolean(process.env.DATABASE_URL),
    },
  });
}

export async function PUT(request: Request) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const solver = body.solver;
  const params = normaliseRunParams(body);
  const merged = {
    ...params,
    solver:
      solver === "simulated-annealing" ||
      solver === "quantum-inspired" ||
      solver === "qaoa-simulator" ||
      solver === "genetic-algorithm" ||
      solver === "dwave-hybrid"
        ? solver
        : "simulated-annealing",
  };
  const defaults = await updateSettings(merged);
  await auditWithSession(auth.session, "settings.update", { detail: merged });
  return NextResponse.json({ defaults });
}
