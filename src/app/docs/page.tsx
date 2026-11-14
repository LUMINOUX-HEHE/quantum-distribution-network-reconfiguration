import { PageHeader, Panel } from "@/components/ui";
import { DOCS } from "@/lib/content/docs";

export const dynamic = "force-dynamic";

export default function DocsPage() {
  return (
    <div>
      <PageHeader
        actions={
          <a className="btn" href="/presentation">
            Presentation deck
          </a>
        }
        eyebrow="Documentation"
        title="Architecture, formulation and operations"
        description="Reference material for engineers, operators and reviewers: how the hybrid pipeline is structured, how the QUBO is derived, what the solvers actually do, how to deploy the platform and how each result is validated."
      />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 220px) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
        <nav className="panel" style={{ position: "sticky", top: 18 }}>
          <div className="panel-head"><div className="panel-title">Chapters</div></div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {DOCS.map((doc, i) => (
              <a key={doc.id} href={`#${doc.id}`} className="nav-item" style={{ color: "var(--ink-2)", padding: "6px 8px" }}>
                <span className="mono" style={{ color: "var(--muted-2)", fontSize: 11 }}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ fontSize: 12.5 }}>{doc.title}</span>
              </a>
            ))}
          </div>
        </nav>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {DOCS.map((doc, i) => (
            <Panel key={doc.id} title={`${String(i + 1).padStart(2, "0")} · ${doc.title}`} subtitle={doc.summary}>
              <div id={doc.id} className="doc-section">
                {doc.blocks.map((block, bi) => {
                  if (block.kind === "p") return <p className="doc-p" key={bi}>{block.text}</p>;
                  if (block.kind === "h") return <h3 className="doc-h" key={bi}>{block.text}</h3>;
                  if (block.kind === "list")
                    return (
                      <ul className="doc-list" key={bi}>
                        {block.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    );
                  return <pre className="doc-code" key={bi}>{block.text}</pre>;
                })}
              </div>
            </Panel>
          ))}
        </div>
      </div>
    </div>
  );
}
