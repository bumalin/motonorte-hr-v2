"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, match, children }: { href: string; match: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = match === "/" ? path === "/" : path.startsWith(match);
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`block rounded-md px-3 py-2 text-sm ${active ? "bg-brand-50 font-medium text-brand-700" : "text-text-muted hover:bg-surface-2 hover:text-text"}`}>
      {children}
    </Link>
  );
}
