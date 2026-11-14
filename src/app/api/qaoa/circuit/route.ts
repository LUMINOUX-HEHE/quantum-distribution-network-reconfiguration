import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";
import { loadNetworkRows } from "@/lib/server/data";
import { buildModel } from "@/lib/power/model";
import { findLoops } from "@/lib/power/topology";
import { buildQaoaCircuit } from "@/lib/optimization/qaoa-circuit";

export const dynamic = "force-dynamic";

/**
 * Exports the exact QAOA circuit for a feeder as OpenQASM 3. The same circuit is
 * executed by the in-app statevector simulator and can be fed to Qiskit Aer via
 * services/qaoa_aer.py for an independent cross-check.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Authentication required", code: "unauthenticated" }, { status: 401 });
  const url = new URL(request.url);
  const networkId = Number(url.searchParams.get("networkId") ?? 1);
  const rows = await loadNetworkRows(networkId);
  if (!rows) return NextResponse.json({ error: "Network not found", code: "not_found" }, { status: 404 });
  const model = buildModel(rows, Number(url.searchParams.get("derPenetrationPct") ?? 0));
  const loops = findLoops(model).loops;
  const gammas = (url.searchParams.get("gammas") ?? "0.6,1.3").split(",").map(Number).filter(Number.isFinite);
  const betas = (url.searchParams.get("betas") ?? "0.45,0.75").split(",").map(Number).filter(Number.isFinite);
  const circuit = buildQaoaCircuit(model, loops, {
    maxQubits: Math.min(10, Math.max(2, Number(url.searchParams.get("maxQubits") ?? 10))),
    layers: Math.min(4, Math.max(1, Number(url.searchParams.get("layers") ?? 2))),
    gammas: gammas.length ? gammas : undefined,
    betas: betas.length ? betas : undefined,
    requestedPenalty: Number.isFinite(Number(url.searchParams.get("penalty")))
      ? Number(url.searchParams.get("penalty"))
      : null,
  });
  return NextResponse.json({
    network: { id: networkId, name: rows.name, buses: model.buses.length },
    ...circuit,
    aer: {
      runner: "services/qaoa_aer.py",
      usage: "python services/qaoa_aer.py --qasm circuit.qasm --shots 4096 --layers 2",
    },
  });
}
