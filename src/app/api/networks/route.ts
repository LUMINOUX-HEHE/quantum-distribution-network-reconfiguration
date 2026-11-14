import { NextResponse } from "next/server";
import { importNetwork, listNetworks } from "@/lib/server/data";
import { validateNetworkDraft } from "@/lib/networks/validate";
import { findLoops } from "@/lib/power/topology";
import { buildModel } from "@/lib/power/model";
import { requireRole } from "@/lib/server/auth";
import { auditWithSession } from "@/lib/server/audit";
import { enforceRateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await listNetworks();
  return NextResponse.json({ networks: rows });
}

export async function POST(request: Request) {
  const auth = await requireRole("engineer");
  if (!auth.ok) return auth.response;
  const limited = enforceRateLimit(request, "networks:import", { limit: 20, actor: auth.session.username });
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const { draft, errors } = validateNetworkDraft(body);
  if (!draft) {
    return NextResponse.json({ error: "Network validation failed", errors }, { status: 422 });
  }
  const model = buildModel(
    {
      name: draft.name,
      source: draft.source,
      baseMva: draft.baseMva,
      baseKv: draft.baseKv,
      bestKnownLossKw: null,
      buses: draft.buses.map((b) => ({
        name: b.name,
        kind: b.kind ?? "pq",
        loadPkw: b.loadPkw,
        loadQkvar: b.loadQkvar,
      })),
      lines: draft.lines.map((l) => ({
        branch: l.branch,
        fromBus: l.from,
        toBus: l.to,
        rOhm: l.rOhm,
        xOhm: l.xOhm,
        ratingA: l.ratingA,
        isSwitch: l.switchType !== "fixed",
        switchType: l.switchType,
        initialOpen: l.initialOpen ?? false,
      })),
      ders: draft.ders,
    },
    0,
  );
  const loops = findLoops(model);
  if (loops.loops.length === 0) {
    return NextResponse.json(
      { error: "Network validation failed", errors: ["No fundamental loops found — add at least one tie switch"] },
      { status: 422 },
    );
  }
  const network = await importNetwork(draft);
  await auditWithSession(auth.session, "network.import", {
    resource: `network:${network.id}`,
    detail: { name: draft.name, buses: draft.buses.length, lines: draft.lines.length },
  });
  return NextResponse.json(
    {
      network,
      topology: {
        buses: model.buses.length,
        branches: model.lines.length,
        loops: loops.loops.length,
        switchable: loops.switchableCount,
      },
    },
    { status: 201 },
  );
}
