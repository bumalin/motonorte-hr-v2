"use client";
// S-06 Tab 1 — attendance grid. Native <select> per cell: typing F/H/A/R picks the option; arrow keys move between
// cells (never change values); per-cell save keeps focus in place.
import { useEffect, useState, useTransition } from "react";
import { saveCell, fillEmptyCells } from "./actions.ts";

export type GridEmployee = { id: string; code: string; name: string; position: string; restDay: string; employed: boolean[] };
type Cell = { status: string; otHours: string };

const GROUP: Record<string, string> = { mechanic: "Mechanics", technician: "Technicians", staff: "Staff" };
const WD = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const LABEL: Record<string, string> = { F: "F Full", H: "H Half", A: "A Absent", R: "R Rest" };
const COLOR: Record<string, string> = { F: "text-success", H: "text-warning", A: "text-text-muted", R: "text-info", "": "text-warning" };
const MOVES: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/** Arrow keys jump to the nearest editable cell in that direction (skips not-employed days). */
function moveFocus(e: React.KeyboardEvent<HTMLSelectElement>) {
  const d = MOVES[e.key];
  if (!d || e.altKey) return; // Alt+Down still opens the native list
  e.preventDefault();
  let r = Number(e.currentTarget.dataset.r), c = Number(e.currentTarget.dataset.c);
  for (let i = 0; i < 50; i++) {
    r += d[0]; c += d[1];
    if (c < 0 || c > 6 || r < 0) return;
    const next = document.querySelector<HTMLSelectElement>(`select[data-r="${r}"][data-c="${c}"]`);
    if (next) { next.focus(); return; }
    if (!document.querySelector(`[data-row="${r}"]`)) return;
  }
}

function GridCell({ emp, date, row, col, initial, locked }: { emp: GridEmployee; date: string; row: number; col: number; initial: Cell; locked: boolean }) {
  // Local state follows server data when it changes (e.g. after "Fill empty cells") without remounting
  const [cell, setCell] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [otDraft, setOtDraft] = useState(initial.otHours);
  if (seen.status !== initial.status || seen.otHours !== initial.otHours) { setSeen(initial); setCell(initial); setOtDraft(initial.otHours); }
  const [msg, setMsg] = useState<{ ok?: boolean; error?: string }>({});
  const [pending, start] = useTransition();
  const isRest = WD[col] === emp.restDay;

  const save = (next: Cell) => {
    const prev = cell;
    setCell(next);
    start(async () => {
      const error = await saveCell({ employeeId: emp.id, date, status: next.status, otHours: next.status === "F" ? next.otHours : "" });
      if (error) { setCell(prev); setOtDraft(prev.otHours); setMsg({ error }); } else setMsg({ ok: true });
    });
  };
  const label = `${emp.code} ${date}`;
  return (
    <td className={`border-l border-border px-1.5 py-1 align-top ${isRest ? "bg-info/5" : ""} ${cell.status === "" && !locked ? "outline outline-1 -outline-offset-2 outline-warning/60" : ""}`}>
      <select aria-label={`${label} status`} value={cell.status} disabled={locked} aria-busy={pending}
        data-r={row} data-c={col} data-key={`${emp.id}|${date}`} onKeyDown={moveFocus}
        onChange={(e) => save({ status: e.target.value, otHours: e.target.value === "F" ? cell.otHours : "" })}
        className={`w-full rounded border border-border bg-surface px-1 py-0.5 text-sm font-medium ${COLOR[cell.status]}`}>
        <option value="">—</option>
        {["F", "H", "A", "R"].map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
      </select>
      {cell.status === "F" && (
        <input aria-label={`${label} overtime hours`} type="number" step="0.25" min="0" max="16" placeholder="OT h" disabled={locked}
          value={otDraft} onChange={(e) => setOtDraft(e.target.value)}
          onBlur={() => { if (otDraft !== cell.otHours) save({ status: "F", otHours: otDraft }); }}
          className="mt-1 w-full rounded border border-border px-1 py-0.5 text-xs" />
      )}
      <span aria-live="polite" className="block min-h-4 text-[11px]">
        {msg.error ? <span className="text-danger">✕ {msg.error}</span> : msg.ok ? <span className="text-success">✓</span> : null}
      </span>
    </td>
  );
}

export function AttendanceGrid({ start, days, dayLabels, holidays, employees, cells, mechanicsFullDay, locked, focus }: {
  start: string; days: string[]; dayLabels: string[]; holidays: Record<string, string>;
  employees: GridEmployee[]; cells: Record<string, Cell>; mechanicsFullDay: number[]; locked: boolean; focus?: string;
}) {
  const [fillError, setFillError] = useState<string>();
  const [filling, startFill] = useTransition();
  const groups = ["mechanic", "technician", "staff"].map((p) => [p, employees.filter((e) => e.position === p)] as const).filter(([, l]) => l.length);
  const rowOf = new Map(groups.flatMap(([, l]) => l).map((e, i) => [e.id, i]));
  const empty = employees.reduce((n, e) => n + e.employed.filter((ok, i) => ok && !cells[`${e.id}|${days[i]}`]).length, 0);

  // "Fix →" links from the generate error list land on the exact cell
  useEffect(() => {
    if (!focus) return;
    const el = document.querySelector<HTMLSelectElement>(`select[data-key="${CSS.escape(focus)}"]`);
    el?.scrollIntoView({ block: "center" });
    el?.focus();
  }, [focus]);

  return (
    <div className="space-y-3">
      {!locked && (
        <div className="flex items-center gap-3">
          <button type="button" disabled={filling || empty === 0}
            onClick={() => startFill(async () => setFillError((await fillEmptyCells(start)) ?? undefined))}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50">
            Fill empty cells ({empty})
          </button>
          <span className="text-xs text-text-muted">Fills only empty cells: F on work days, R on each person&apos;s rest day. Arrow keys move between cells.</span>
          {fillError && <span role="alert" className="text-sm text-danger">{fillError}</span>}
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-surface-2 text-text-muted">
            <tr>
              <th scope="col" className="w-48 px-3 py-2 text-left font-medium">Employee</th>
              {dayLabels.map((l, i) => (
                <th key={days[i]} scope="col" className="border-l border-border px-2 py-2 text-left font-medium">
                  {l}{holidays[days[i]] && <span className="mt-0.5 block rounded bg-warning/10 px-1 text-[11px] text-warning">{holidays[days[i]]}</span>}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map(([pos, list]) => (
            <tbody key={pos}>
              <tr><th colSpan={8} scope="rowgroup" className="bg-surface-2/60 px-3 py-1 text-left text-xs font-medium uppercase text-text-muted">{GROUP[pos]}</th></tr>
              {list.map((e) => (
                <tr key={e.id} data-row={rowOf.get(e.id)} className="border-t border-border">
                  <th scope="row" className="px-3 py-1 text-left font-normal"><span className="font-mono">{e.code}</span> · {e.name}</th>
                  {days.map((d, i) => e.employed[i]
                    ? <GridCell key={d} emp={e} date={d} row={rowOf.get(e.id)!} col={i} initial={cells[`${e.id}|${d}`] ?? { status: "", otHours: "" }} locked={locked} />
                    : <td key={d} className="border-l border-border bg-surface-2 px-2 text-center text-text-muted" aria-label={`${e.code} ${d} not employed`}>-</td>)}
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot className="border-t border-border bg-surface-2 text-xs text-text-muted">
            <tr>
              <th scope="row" className="px-3 py-2 text-left font-medium">Full-day mechanics</th>
              {mechanicsFullDay.map((n, i) => <td key={days[i]} className="border-l border-border px-2 py-2">{n}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
