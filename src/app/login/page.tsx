import { redirect } from "next/navigation";
import { getSession, users } from "@/lib/server/auth";
import { LoginForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSession();
  const sp = await searchParams;
  void redirect;
  const accounts = Object.entries(users()).map(([username, user]) => ({ username, role: user.role }));
  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="auth-brand">
          <span className="auth-logo">QA</span>
          <div>
            <div className="auth-title">QA-DNR</div>
            <div className="auth-sub">Distribution reconfiguration platform</div>
          </div>
        </div>
        <h1 className="auth-heading">Sign in</h1>
        <p className="auth-copy">
          Role-scoped access. Engineers can submit optimisation runs, import networks and run fault studies; admins can also
          change platform defaults and read the audit trail.
        </p>
        {session ? (
          <div className="callout ok">
            Demo-operator mode is active as <strong>{session.username}</strong> ({session.role}). The workspace is already
            open — signing in below switches to an explicit role account.
          </div>
        ) : null}
        <LoginForm next={sp.next ?? "/"} />
        <div className="auth-accounts">
          <div className="auth-accounts-label">Demo accounts</div>
          {accounts.map((a) => (
            <div key={a.username} className="auth-account">
              <span className="mono">{a.username}</span>
              <span className="badge">{a.role}</span>
            </div>
          ))}
          <p className="auth-hint">
            Passwords follow the pattern <span className="mono">&lt;role&gt;123</span>. Override with the server-side{" "}
            <span className="mono">QA_DNR_USERS</span> environment variable.
          </p>
        </div>
      </div>
      <div className="auth-aside">
        <div className="auth-aside-inner">
          <div className="auth-eyebrow">Hybrid optimisation, adjudicated by physics</div>
          <h2 className="auth-aside-title">Every recommendation is validated before an operator sees it.</h2>
          <ul className="auth-list">
            <li>Loop-based QUBO encoding with auto-tuned penalties</li>
            <li>Quantum-inspired, QAOA and simulated annealing backends</li>
            <li>Classical repair to a spanning tree, then exact AC power flow</li>
            <li>Fault, contingency and renewable scenario analysis</li>
            <li>Immutable run records for reproducibility and audit</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
