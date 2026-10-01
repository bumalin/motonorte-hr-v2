"use client";
// Every money cell opens the items behind it (US-031, UX S-08). Native <dialog>: focus trap, Esc, focus returns.
import { useRef } from "react";
import { formatMoney } from "@/lib/format.ts";

export type DrillItem = { text: string; amount: number; rule: string };

export function DrillCell({ value, label, items, negative = false }: { value: number; label: string; items: DrillItem[]; negative?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const shown = negative && value > 0 ? -value : value;
  if (items.length === 0) return <span className={`tabular ${value === 0 ? "text-text-muted" : ""}`}>{formatMoney(shown)}</span>;
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} aria-label={`${label}: ${formatMoney(shown)}, show details`}
        className={`tabular underline decoration-dotted underline-offset-2 hover:text-brand-700 ${shown < 0 ? "text-danger" : ""}`}>
        {formatMoney(shown)}
      </button>
      <dialog ref={ref} aria-label={label} className="m-auto w-full max-w-xl rounded-md p-0 text-left shadow-xl backdrop:bg-black/40">
        <div className="p-5">
          <h2 className="mb-3 font-semibold">{label}</h2>
          <ul className="divide-y divide-border text-sm">
            {items.map((it, i) => (
              <li key={i} className="flex justify-between gap-4 py-2">
                <span>{it.text} <span className="font-mono text-xs text-text-muted">{it.rule}</span></span>
                <span className="tabular whitespace-nowrap">{formatMoney(it.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex justify-between border-t border-border pt-2 text-sm font-medium"><span>Total</span><span className="tabular">{formatMoney(value)}</span></p>
          <form method="dialog" className="mt-4 text-right"><button className="rounded-md border border-border px-4 py-1.5 text-sm">Close</button></form>
        </div>
      </dialog>
    </>
  );
}
