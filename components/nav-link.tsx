"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, match, children }: { href: string; match: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = match === "/" ? path === "/" : path.startsWith(match);
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`workspace-nav-link ${active?"is-active":""}`}>
      {children}
    </Link>
  );
}
