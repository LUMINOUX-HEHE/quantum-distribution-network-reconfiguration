import { NextResponse } from "next/server";
import { getSession, users } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const accounts = Object.entries(users()).map(([username, user]) => ({ username, role: user.role }));
  return NextResponse.json({ session, accounts, authenticated: Boolean(session) });
}
