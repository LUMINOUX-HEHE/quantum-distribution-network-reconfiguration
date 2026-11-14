import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_API = ["/api/health", "/api/version", "/api/docs", "/api/auth/login", "/api/auth/session"];

function securityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  response.headers.set("X-API-Version", "v1");
  return response;
}

/**
 * - Versioned API facade: /api/v1/<route> is rewritten to /api/<route>.
 * - Session gate: when QA_DNR_REQUIRE_AUTH=true (or QA_DNR_USERS is set) browser
 *   requests are redirected to /login and API requests return a 401 envelope.
 *   Otherwise the deployment runs in demo-operator mode and the workspace opens
 *   directly, with role checks still enforced inside handlers.
 * - Rate limiting and audit live in the Node runtime (see src/lib/server).
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const authRequired = process.env.QA_DNR_REQUIRE_AUTH === "true" || Boolean(process.env.QA_DNR_USERS);

  let effectivePath = pathname;
  let response: NextResponse;
  if (pathname.startsWith("/api/v1")) {
    const rewritten = request.nextUrl.clone();
    rewritten.pathname = pathname.replace("/api/v1", "/api");
    effectivePath = rewritten.pathname;
    response = NextResponse.rewrite(rewritten);
  } else {
    response = NextResponse.next();
  }

  if (!authRequired) return securityHeaders(response);
  if (effectivePath.startsWith("/_next") || effectivePath.startsWith("/favicon") || effectivePath.startsWith("/media")) {
    return securityHeaders(response);
  }
  if (PUBLIC_API.some((p) => effectivePath === p || effectivePath.startsWith(`${p}/`))) {
    return securityHeaders(response);
  }
  if (effectivePath === "/login") return securityHeaders(response);
  if (request.cookies.get("qa_dnr_session")?.value) return securityHeaders(response);

  if (effectivePath.startsWith("/api/")) {
    return securityHeaders(
      NextResponse.json(
        { error: "Authentication required", code: "unauthenticated", version: "v1" },
        { status: 401 },
      ),
    );
  }
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
