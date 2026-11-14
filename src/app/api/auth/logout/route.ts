import { NextResponse } from "next/server";
import { getSession, sessionCookieName } from "@/lib/server/auth";
import { auditWithSession } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  await auditWithSession(session, "auth.logout");
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName, "", { path: "/", maxAge: 0 });
  return response;
}
