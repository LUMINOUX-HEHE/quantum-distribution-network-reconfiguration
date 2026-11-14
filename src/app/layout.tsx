import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { getSession } from "@/lib/server/auth";
import { SignOutButton } from "@/components/auth-form";
import { SideNav, type NavGroup } from "@/components/nav";

export const metadata: Metadata = {
  title: "QA-DNR · Distribution network reconfiguration",
  description:
    "Hybrid quantum-classical optimisation and digital-twin platform for distribution network reconfiguration, fault restoration and renewable scenario analysis.",
};

const groups: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/", label: "Overview", icon: "M3 10.5 10 4l7 6.5M5 9.5V16h10V9.5" },
      { href: "/networks", label: "Networks", icon: "M10 3v4M4 13h4M12 13h4M10 7v6M4 13v3M16 13v3M8 16h4" },
      { href: "/runs/new", label: "New run", icon: "M7 5l8 5-8 5V5z" },
      { href: "/runs", label: "Run history", icon: "M4 6h12M4 10h12M4 14h8" },
    ],
  },
  {
    label: "Analysis",
    items: [
      { href: "/resilience", label: "Resilience", icon: "M10 3l6 3v5c0 3-2.5 5.5-6 6-3.5-.5-6-3-6-6V6l6-3zM8 10l1.5 1.5L12.5 8" },
      { href: "/scenarios", label: "Scenarios", icon: "M3 14l4-5 3 3 4-6 3 4M3 17h14" },
      { href: "/benchmarks", label: "Benchmarks", icon: "M4 16V8M10 16V4M16 16v-6" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/progress", label: "Program status", icon: "M4 5h12M4 10h12M4 15h7M14 15h2" },
      { href: "/docs", label: "Documentation", icon: "M5 4h7l3 3v9H5V4zM8 9h5M8 12h5" },
      { href: "/presentation", label: "Presentation", icon: "M3 5h14v9H3V5zM7 18h6M10 14v4" },
      { href: "/settings", label: "Settings", icon: "M10 12a2 2 0 100-4 2 2 0 000 4zM10 3v2M10 15v2M3 10h2M15 10h2M5 5l1.5 1.5M13.5 13.5L15 15M15 5l-1.5 1.5M6.5 13.5L5 15" },
    ],
  },
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body>
        {session ? (
          <div className="app-shell">
            <aside className="sidebar">
              <div className="brand">
                <div className="brand-mark">QA</div>
                <div>
                  <div className="brand-title">QA-DNR</div>
                  <div className="brand-sub">Reconfiguration suite</div>
                </div>
              </div>
              <SideNav groups={groups} />
              <div className="sidebar-footer">
                <div className="rail-user">
                  <span className="rail-avatar">{session.username.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <div className="rail-user-name">{session.username}</div>
                    <div className="rail-user-role">{session.role}</div>
                  </div>
                </div>
                <div className="rail-note">
                  Advisory output only. Recommendations are AC-validated and audited; there is no SCADA write path.
                </div>
                <SignOutButton />
              </div>
            </aside>
            <main className="main">{children}</main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
