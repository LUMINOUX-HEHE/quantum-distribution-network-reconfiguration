import { NextResponse } from "next/server";

type Bucket = { count: number; resetAt: number };
const globalForLimit = globalThis as typeof globalThis & { __qaDnrBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (globalForLimit.__qaDnrBuckets ??= new Map());

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number; limit: number };

export function checkRateLimit(key: string, limit = 60, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0, limit };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      limit,
    };
  }
  return { allowed: true, remaining: limit - bucket.count, retryAfterSec: 0, limit };
}

export function clientKey(request: Request, scope: string, actor = "anon"): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return `${scope}:${actor}:${ip}`;
}

/** Returns a 429 response when the limit is exceeded, otherwise null. */
export function enforceRateLimit(
  request: Request,
  scope: string,
  options: { limit?: number; windowMs?: number; actor?: string } = {},
): NextResponse | null {
  const result = checkRateLimit(
    clientKey(request, scope, options.actor),
    options.limit ?? 60,
    options.windowMs ?? 60_000,
  );
  if (result.allowed) return null;
  return NextResponse.json(
    {
      error: "Rate limit exceeded",
      code: "rate_limited",
      limit: result.limit,
      retryAfterSec: result.retryAfterSec,
      version: "v1",
    },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } },
  );
}

export function rateLimitSnapshot(): { keys: number; buckets: { key: string; count: number; resetAt: number }[] } {
  return {
    keys: buckets.size,
    buckets: [...buckets.entries()].slice(0, 50).map(([key, b]) => ({ key, ...b })),
  };
}
