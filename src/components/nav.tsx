"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavGroup = { label: string; items: { href: string; label: string; icon: string }[] };

export function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <>
      {groups.map((group) => (
        <nav className="nav-group" key={group.label} aria-label={group.label}>
          <div className="nav-label">{group.label}</div>
          {group.items.map((item) => (
            <Link key={item.href} href={item.href} className={`nav-item ${isActive(item.href) ? "active" : ""}`}>
              <svg className="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={item.icon} />
              </svg>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      ))}
    </>
  );
}
