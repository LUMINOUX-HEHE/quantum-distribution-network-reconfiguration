import { sql } from "drizzle-orm";
import { PageHeader, Panel, Stat, Callout } from "@/components/ui";
import { SettingsForm } from "@/components/client";
import { getSettings } from "@/lib/server/data";
import { SOLVERS } from "@/lib/networks/types";
import { solverAvailability } from "@/lib/optimization/solvers";
import { db } from "@/db";
import { getSession, can } from "@/lib/server/auth";
import { recentAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const defaults = await getSettings();
  let dbStatus = "ok";
  let dbVersion = "";
  try {
    const res = await db.execute(sql`select version() as version`);
    const row = (res.rows?.[0] ?? {}) as { version?: string };
    dbVersion = row.version?.split(",")[0] ?? "";
  } catch (error) {
    dbStatus = error instanceof Error ? error.message : String(error);
  }

  const solvers = SOLVERS.map((s) => ({ ...s, ...solverAvailability(s.id) }));
  const session = await getSession();
  const audit = can(session?.role, "admin") ? await recentAudit(12) : [];

  return (
    <div>
      <PageHeader
        eyebrow="Settings & administration"
        title="Defaults, credentials and runtime"
        description="Solver credentials never reach the browser — availability is derived server-side from the environment. The platform exposes read-only status here and stores engineering defaults for new runs."
      />

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <Stat label="Database" value={dbStatus === "ok" ? "connected" : "error"} hint={dbVersion || dbStatus} />
        <Stat label="Solver adapters" value={`${solvers.filter((s) => s.available).length}/${solvers.length}`} hint="available in this deployment" tone="cyan" />
        <Stat label="D-Wave token" value={process.env.DWAVE_API_TOKEN ? "configured" : "absent"} hint="server-side secret only" tone="violet" />
        <Stat label="Queue" value="in-process" hint="worker runs inside the Next.js server" tone="amber" />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 14 }}>
        <Panel title="Solver adapters" subtitle="Availability is evaluated on the server, never from client input" noBody>
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr><th>Solver</th><th>Kind</th><th>Status</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {solvers.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}<div className="helper mono">{s.id}</div></td>
                    <td><span className="badge">{s.kind}</span></td>
                    <td>{s.available ? <span className="badge ok">available</span> : <span className="badge warn">unavailable</span>}</td>
                    <td className="helper" style={{ maxWidth: 300 }}>{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Secret handling" subtitle="NFR-5 / FR-26">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12, color: "#8ba0b8", lineHeight: 1.6 }}>
            <div className="callout ok">
              Credentials are read only inside server route handlers and the optimisation worker. No API response contains a
              token value; the client sees only availability booleans and reasons.
            </div>
            <div>
              <strong style={{ color: "#e6edf6" }}>Environment variables.</strong> <span className="mono">DATABASE_URL</span> is
              required. <span className="mono">DWAVE_API_TOKEN</span> is optional and enables the Leap hybrid adapter slot.
            </div>
            <div>
              <strong style={{ color: "#e6edf6" }}>Role model (planned).</strong> Viewer (read), engineer (run, import), admin
              (settings). v1 runs a single trusted operator role; recommendations remain advisory with no SCADA write path.
            </div>
            <div>
              <strong style={{ color: "#e6edf6" }}>Observability.</strong> Structured run logs are persisted per run with
              timestamps, stage and level, alongside solver metrics and error traces.
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Engineering defaults" subtitle="Applied to new runs and benchmark suites">
        <SettingsForm defaults={defaults} />
      </Panel>

      {audit.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <Panel title="Audit trail" subtitle="Most recent privileged actions (admin view)" noBody>
            <div className="scroll-x">
              <table className="data">
                <thead>
                  <tr><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Resource</th><th>Outcome</th><th>IP</th></tr>
                </thead>
                <tbody>
                  {audit.map((entry) => (
                    <tr key={entry.id}>
                      <td className="mono" style={{ fontSize: 11 }}>{new Date(entry.createdAt).toISOString().slice(11, 19)}</td>
                      <td>{entry.actor}</td>
                      <td><span className="badge">{entry.role}</span></td>
                      <td className="mono" style={{ fontSize: 11 }}>{entry.action}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{entry.resource || "—"}</td>
                      <td>{entry.outcome === "success" ? <span className="badge ok">success</span> : <span className="badge bad">failure</span>}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{entry.ip || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <Callout tone="info">
          The stored reference losses are read from each network record. When a validated recommendation beats the stored
          reference, the platform updates it and records the source as a platform record so gap reporting stays honest.
        </Callout>
      </div>
    </div>
  );
}
