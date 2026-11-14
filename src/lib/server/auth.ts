import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export type Role = "viewer" | "engineer" | "admin";
export type Session = { username: string; role: Role; issuedAt: number; expiresAt: number };

const COOKIE = "qa_dnr_session";
const TTL_MS = 1000 * 60 * 60 * 12;
const ROLE_RANK: Record<Role, number> = { viewer: 1, engineer: 2, admin: 3 };

/**
 * Auth is enforced when QA_DNR_REQUIRE_AUTH=true or when explicit user accounts
 * are supplied. Otherwise the deployment runs in demo-operator mode so the
 * workspace opens directly (the sandbox preview default) while role checks stay
 * active for every request.
 */
export function authRequired(): boolean {
  return process.env.QA_DNR_REQUIRE_AUTH === "true" || Boolean(process.env.QA_DNR_USERS);
}

export function demoSession(): Session {
  return {
    username: "demo-operator",
    role: "admin",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365,
  };
}

function secret(): string {
  return process.env.SESSION_SECRET ?? "qa-dnr-development-secret-change-me";
}

type StoredUser = { role: Role; password: string };

/** Demo accounts can be overridden with QA_DNR_USERS='{"alice":{"role":"admin","password":"..."}}'. */
export function users(): Record<string, StoredUser> {
  const raw = process.env.QA_DNR_USERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, StoredUser>;
      if (parsed && Object.keys(parsed).length > 0) return parsed;
    } catch {
      /* fall through to defaults */
    }
  }
  return {
    admin: { role: "admin", password: "admin123" },
    engineer: { role: "engineer", password: "engineer123" },
    viewer: { role: "viewer", password: "viewer123" },
  };
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(username: string, role: Role): string {
  const now = Date.now();
  const session: Session = { username, role, issuedAt: now, expiresAt: now + TTL_MS };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!session.expiresAt || session.expiresAt < Date.now()) return null;
    if (!["viewer", "engineer", "admin"].includes(session.role)) return null;
    return session;
  } catch {
    return null;
  }
}

export function checkPassword(username: string, password: string): Session | null {
  const user = users()[username];
  if (!user) return null;
  const provided = Buffer.from(password);
  const stored = Buffer.from(user.password);
  if (provided.length !== stored.length || !timingSafeEqual(provided, stored)) return null;
  return {
    username,
    role: user.role,
    issuedAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  };
}

export const sessionCookieName = COOKIE;

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const verified = verifySessionToken(store.get(COOKIE)?.value);
  if (verified) return verified;
  if (!authRequired()) return demoSession();
  return null;
}

export function can(role: Role | undefined, minimum: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function sessionCookie(session: Session): {
  name: string;
  value: string;
  options: { httpOnly: boolean; sameSite: "lax"; path: string; secure: boolean; maxAge: number };
} {
  return {
    name: COOKIE,
    value: createSessionToken(session.username, session.role),
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: Math.floor(TTL_MS / 1000),
    },
  };
}

export async function requireRole(minimum: Role): Promise<
  { ok: true; session: Session } | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authentication required", code: "unauthenticated", version: "v1" },
        { status: 401 },
      ),
    };
  }
  if (!can(session.role, minimum)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Requires ${minimum} role`, code: "forbidden", role: session.role, version: "v1" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session };
}

export function newApiToken(): string {
  return `qadnr_${randomBytes(24).toString("base64url")}`;
}

export function hashApiToken(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("hex");
}

export function scryptHash(value: string): string {
  return scryptSync(value, "qa-dnr", 32).toString("hex");
}
