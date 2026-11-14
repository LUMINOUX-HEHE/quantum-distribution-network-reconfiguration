import Link from "next/link";
import { PageHeader, Panel, Stat } from "@/components/ui";
import { CHECKLIST, checklistStats } from "@/lib/content/checklist";
import { DOCS } from "@/lib/content/docs";

export const dynamic = "force-dynamic";

export default function ProgressPage() {
  const stats = checklistStats();
  return (
    <div>
      <PageHeader
        eyebrow="Program status"
        title="Delivery checklist"
        description="Every line of the 154-item program checklist mapped to the artefact that satisfies it, with the file or route to inspect. Each entry is exercised by the regression suite, the benchmark harness or a live page. Where the original specification named a specific runtime (Qiskit Aer, FastAPI), both the native implementation and the optional service artifact are provided and cross-referenced."
        actions={<Link className="btn" href="/docs">Read the documentation</Link>}
      />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Completion" value={`${stats.completionPct}%`} hint={`${stats.total} tracked tasks`} />
        <Stat label="Complete" value={stats.done} hint="implemented and exercised" tone="cyan" />
        <Stat label="Partial" value={stats.partial} hint="documented substitutions" tone="amber" />
        <Stat label="Documentation chapters" value={DOCS.length} hint="architecture → operations" tone="violet" />
      </div>

      <div className="grid" style={{ gap: 14 }}>
        {CHECKLIST.map((group) => {
          const done = group.tasks.filter((t) => t.status !== "partial").length;
          const pct = Math.round((done / group.tasks.length) * 100);
          return (
            <section className="checklist-group" key={group.id}>
              <div className="checklist-head">
                <div>
                  <div className="checklist-title">
                    {group.id}. {group.name}
                  </div>
                  <div className="panel-sub">{group.summary}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 160 }}>
                  <div className="progress" style={{ width: 90 }}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <span className="badge ok">{done}/{group.tasks.length}</span>
                </div>
              </div>
              {group.tasks.map((task) => (
                <div className="task" key={task.title}>
                  <span className={`task-mark ${task.status === "partial" ? "partial" : ""}`}>{task.status === "partial" ? "~" : "✓"}</span>
                  <div>
                    <div className="task-title">{task.title}</div>
                    <div className="task-evidence">{task.evidence}</div>
                  </div>
                  <span className="task-ref">{task.ref}</span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
