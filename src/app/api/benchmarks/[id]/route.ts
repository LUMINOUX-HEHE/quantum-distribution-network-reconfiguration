import { NextResponse } from "next/server";
import { getBenchmark } from "@/lib/server/benchmarks";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const benchmarkId = Number(id);
  if (!Number.isFinite(benchmarkId)) {
    return NextResponse.json({ error: "Invalid benchmark id" }, { status: 400 });
  }
  const detail = await getBenchmark(benchmarkId);
  if (!detail) return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  return NextResponse.json(detail);
}
