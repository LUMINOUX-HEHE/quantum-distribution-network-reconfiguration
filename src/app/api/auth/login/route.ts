import { NextResponse } from "next/server";
import { checkPassword, sessionCookie } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/audit";
import { enforceRateLimit } from "@/lib/server/ratelimit";
import { ensureSeeded } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await ensureSeeded();
  const limited = enforceRateLimit(request, "auth:login", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON", code: "invalid_body" }, { status: 400 });
  }
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!username || !password) {
    return NextResponse.json(
      { error: "Username and password are required", code: "invalid_credentials" },
      { status: 400 },
    );
  }
  const session = checkPassword(username, password);
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  if (!session) {
    await writeAudit({
      actor: username,
      role: "none",
      action: "auth.login",
      outcome: "failure",
      detail: { reason: "invalid credentials" },
      ip,
    });
    return NextResponse.json({ error: "Invalid credentials", code: "invalid_credentials" }, { status: 401 });
  }
  const cookie = sessionCookie(session);
  await writeAudit({
    actor: session.username,
    role: session.role,
    action: "auth.login",
    outcome: "success",
    ip,
  });
  const response = NextResponse.json({ session: { username: session.username, role: session.role } });
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
