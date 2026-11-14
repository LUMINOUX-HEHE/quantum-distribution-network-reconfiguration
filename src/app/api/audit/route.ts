import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { recentAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 60)));
  const entries = await recentAudit(limit);
  return NextResponse.json({ entries, count: entries.length });
}
