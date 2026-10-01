// Shared server-safe UI pieces (docs/04-ux-spec.md §4–§5).
import Link from "next/link";
import { formatMoney } from "@/lib/format.ts";

export function Money({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`tabular whitespace-nowrap ${value < 0 ? "text-danger" : ""} ${className}`}>{formatMoney(value)}</span>;
}

const CHIP: Record<string, string> = {
  open: "bg-surface-2 text-text-muted",
  draft: "bg-warning/10 text-warning",
  submitted: "bg-info/10 text-info",
  locked: "bg-success/10 text-success",
  proposed: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  rejected: "bg-danger/10 text-danger",
  active: "bg-success/10 text-success",
  inactive: "bg-surface-2 text-text-muted",
};

/** Status label + color, never color alone (UX §5). */
export function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${CHIP[status] ?? CHIP.open}`}>{status}</span>
  );
}

export function EmptyState({ title, action }: { title: string; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface p-8 text-center">
      <p className="text-text-muted">{title}</p>
      {action && <Link href={action.href} className="mt-2 inline-block font-medium text-brand-700 hover:underline">{action.label}</Link>}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{message}</div>;
}
