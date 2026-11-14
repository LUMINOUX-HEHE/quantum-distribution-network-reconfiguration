import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-desc">{description}</p> : null}
      </div>
      {actions ? <div className="head-actions">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  bodyStyle,
  noBody,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  bodyStyle?: React.CSSProperties;
  noBody?: boolean;
}) {
  return (
    <section className="panel">
      {title || actions ? (
        <div className="panel-head">
          <div>
            {title ? <div className="panel-title">{title}</div> : null}
            {subtitle ? <div className="panel-sub">{subtitle}</div> : null}
          </div>
          {actions ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div> : null}
        </div>
      ) : null}
      {noBody ? children : (
        <div className="panel-body" style={bodyStyle}>
          {children}
        </div>
      )}
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = "green",
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: "green" | "cyan" | "violet" | "amber" | "rose";
}) {
  const cls =
    tone === "cyan"
      ? "accent-cyan"
      : tone === "violet"
        ? "accent-violet"
        : tone === "amber"
          ? "accent-amber"
          : tone === "rose"
            ? "accent-rose"
            : "";
  return (
    <div className={`stat ${cls}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "ok",
    running: "info",
    queued: "warn",
    failed: "bad",
  };
  return <span className={`badge ${map[status] ?? ""}`}>{status}</span>;
}

export function OriginBadge({ origin }: { origin: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    solver: { cls: "violet", label: "solver sample" },
    current: { cls: "", label: "current state" },
    refinement: { cls: "info", label: "refinement" },
    baseline: { cls: "warn", label: "classical baseline" },
  };
  const item = map[origin] ?? { cls: "", label: origin };
  return <span className={`badge ${item.cls}`}>{item.label}</span>;
}

export function Callout({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "ok" | "info" }) {
  return <div className={`callout ${tone === "warn" ? "" : tone}`}>{children}</div>;
}

export function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function since(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return d.toISOString().slice(0, 10);
}
