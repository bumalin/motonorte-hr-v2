"use client";
// S-06 Tab 1 — attendance grid (2026-11-08 redesign). One compact button per day; clicking opens an editor strip under
// the person's row with the status buttons, Clear and an overtime stepper in 0.5 h steps (PR-042). Keyboard on a focused
// day: F/H/A/R set the status, Delete clears, + / − change overtime, arrows move between days, Esc closes the editor.
// Each change saves at once (optimistic, reverted with a message on error). Unmarked days stay empty on purpose:
// "Fill empty cells" marks them in one click, and the engine reports any still missing (MISSING_ATTENDANCE).
import { useEffect, useState, useTransition } from "react";
import { saveCell, fillEmptyCells } from "./actions.ts";

export type GridEmployee = { id: string; code: string; name: string; position: string; restDay: string; employed: boolean[] };
type Cell = { status: string; otHours: string };

const GROUP: Record<string, string> = { mechanic: "Mechanics", technician: "Technicians", staff: "Staff" };
const WD = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const NAME: Record<string, string> = { F: "Full", H: "Half", A: "Absent", R: "Rest", "": "Not marked" };
const MOVES: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const EMPTY: Cell = { status: "", otHours: "" };
const STEP = 30, MAX_OT = 960; // minutes: 0.5 h steps, 16 h cap (DB check)

const otMin = (h: string) => (h ? Math.round(Number(h) * 60) : 0);
const hours = (m: number) => (m ? String(m / 60) : "");
/** Next overtime on the half-hour grid; an old quarter-hour value snaps to the nearest step in that direction. */
const stepOt = (h: string, dir: 1 | -1) => {
  const m = otMin(h), snapped = dir > 0 ? Math.floor(m / STEP) * STEP : Math.ceil(m / STEP) * STEP;
  return hours(Math.min(MAX_OT, Math.max(0, snapped + dir * STEP)));
};

/** Arrow keys jump to the nearest editable day in that direction (skips not-employed days). */
function moveFocus(e: React.KeyboardEvent<HTMLButtonElement>) {
  const d = MOVES[e.key];
  if (!d) return false;
  e.preventDefault();
  let r = Number(e.currentTarget.dataset.r), c = Number(e.currentTarget.dataset.c);
  const mode = e.currentTarget.dataset.phone ? '[data-phone="true"]' : ':not([data-phone="true"])';
  for (let i = 0; i < 50; i++) {
    r += d[0]; c += d[1];
    if (c < 0 || c > 6 || r < 0) return true;
    const next = document.querySelector<HTMLButtonElement>(`button.att-day[data-r="${r}"][data-c="${c}"]${mode}`);
    if (next) { next.focus(); return true; }
    if (!document.querySelector(`[data-row="${r}"]`)) return true;
  }
  return true;
}

function summary(e: GridEmployee, days: string[], cells: Record<string, Cell>) {
  const n: Record<string, number> = { F: 0, H: 0, A: 0, R: 0, "": 0 };
  let ot = 0;
  days.forEach((d, i) => { if (!e.employed[i]) return; const c = cells[`${e.id}|${d}`] ?? EMPTY; n[c.status]++; ot += otMin(c.otHours); });
  const parts = (["F", "H", "A", "R"] as const).filter((s) => n[s]).map((s) => `${n[s]}${s}`);
  if (ot) parts.push(`OT ${hours(ot)}h`);
  return { text: parts.join(" · ") || "Nothing marked", unmarked: n[""] };
}

export function AttendanceGrid({ start, days, dayLabels, holidays, employees, cells: serverCells, mechanicsFullDay, locked, focus }: {
  start: string; days: string[]; dayLabels: string[]; holidays: Record<string, string>;
  employees: GridEmployee[]; cells: Record<string, Cell>; mechanicsFullDay: number[]; locked: boolean; focus?: string;
}) {
  // Local copy for instant feedback; follows server data when it changes (e.g. after "Fill empty cells")
  const [cells, setCells] = useState(serverCells);
  const [seen, setSeen] = useState(serverCells);
  if (seen !== serverCells) { setSeen(serverCells); setCells(serverCells); }
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [, start_] = useTransition();
  const [fillError, setFillError] = useState<string>();
  const [filling, startFill] = useTransition();

  const groups = ["mechanic", "technician", "staff"].map((p) => [p, employees.filter((e) => e.position === p)] as const).filter(([, l]) => l.length);
  const ordered = groups.flatMap(([, l]) => l);
  const rowOf = new Map(ordered.map((e, i) => [e.id, i]));
  const empty = employees.reduce((n, e) => n + e.employed.filter((ok, i) => ok && !cells[`${e.id}|${days[i]}`]?.status).length, 0);
  const labelOf = (date: string) => dayLabels[days.indexOf(date)] ?? date;

  const save = (emp: GridEmployee, date: string, next: Cell) => {
    const key = `${emp.id}|${date}`, prev = cells[key] ?? EMPTY;
    if (prev.status === next.status && prev.otHours === next.otHours) return;
    setCells((c) => ({ ...c, [key]: next }));
    start_(async () => {
      const error = await saveCell({ employeeId: emp.id, date, status: next.status, otHours: next.status === "F" ? next.otHours : "" });
      if (error) { setCells((c) => ({ ...c, [key]: prev })); setNote({ text: `${emp.name}, ${labelOf(date)}: ${error}`, error: true }); }
      else setNote({ text: `Saved ${emp.name}, ${labelOf(date)}: ${NAME[next.status]}${next.status === "F" && next.otHours ? ` + ${next.otHours} h OT` : ""}` });
    });
  };
  const setStatus = (emp: GridEmployee, date: string, status: string) =>
    save(emp, date, { status, otHours: status === "F" ? (cells[`${emp.id}|${date}`]?.otHours ?? "") : "" });
  const changeOt = (emp: GridEmployee, date: string, dir: 1 | -1) => {
    const c = cells[`${emp.id}|${date}`] ?? EMPTY;
    if (c.status === "F") save(emp, date, { status: "F", otHours: stepOt(c.otHours, dir) });
  };

  // "Fix →" links from the generate error list land on the exact day
  useEffect(() => {
    if (!focus) return;
    const el = Array.from(document.querySelectorAll<HTMLButtonElement>(`button.att-day[data-key="${CSS.escape(focus)}"]`)).find((e) => e.getClientRects().length > 0);
    el?.scrollIntoView({ block: "center" });
    el?.focus();
  }, [focus]);
  // Esc closes the editor from anywhere
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Plain render functions (not components) so a save never remounts the focused day button.
  const day = (emp: GridEmployee, i: number, phone = false) => {
    const date = days[i], key = `${emp.id}|${date}`, c = cells[key] ?? EMPTY, isOpen = open === `${key}|${phone}`;
    if (!emp.employed[i]) return <span className="att-day att-none" aria-label={`${emp.code} ${date} not employed`}>·</span>;
    const onKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (moveFocus(e)) return;
      if (locked) return;
      const k = e.key.toUpperCase();
      if (["F", "H", "A", "R"].includes(k)) { e.preventDefault(); setStatus(emp, date, k); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); setStatus(emp, date, ""); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); changeOt(emp, date, 1); }
      else if (e.key === "-") { e.preventDefault(); changeOt(emp, date, -1); }
    };
    return (
      <button type="button" className={`att-day att-${c.status || "empty"}${WD[i] === emp.restDay ? " att-restday" : ""}`} data-on={isOpen || undefined}
        data-key={key} data-r={rowOf.get(emp.id)} data-c={i} data-phone={phone ? "true" : undefined} disabled={locked && !c.status}
        aria-expanded={locked ? undefined : isOpen} aria-label={`${emp.code} ${emp.name}, ${dayLabels[i]}: ${NAME[c.status]}${c.otHours ? `, overtime ${c.otHours} hours` : ""}`}
        onClick={() => !locked && setOpen(isOpen ? null : `${key}|${phone}`)} onKeyDown={onKey}>
        {c.status || "—"}{c.status === "F" && c.otHours && <small>+{c.otHours}h</small>}
      </button>
    );
  };

  const editor = (emp: GridEmployee, phone = false) => {
    const [id, date, p] = open?.split("|") ?? [];
    if (id !== emp.id || p !== String(phone)) return null;
    const c = cells[`${id}|${date}`] ?? EMPTY;
    return (
      <div className="att-editor" role="group" aria-label={`Edit ${emp.name}, ${labelOf(date)}`}>
        <strong>{emp.name} · {labelOf(date)}</strong>
        <div className="att-status">
          {(["F", "H", "A", "R"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={c.status === s} className={`att-pick att-${s}`} onClick={() => { setStatus(emp, date, s); setOpen(null); }}>
              <b>{s}</b> {NAME[s]}
            </button>
          ))}
          <button type="button" className="att-clear" disabled={!c.status} onClick={() => { setStatus(emp, date, ""); setOpen(null); }}>Clear</button>
        </div>
        <div className="att-ot" aria-label="Overtime">
          <span>Overtime</span>
          <button type="button" disabled={c.status !== "F" || !c.otHours} onClick={() => changeOt(emp, date, -1)} aria-label="Less overtime (0.5 h)">−</button>
          <output aria-live="polite">{c.status === "F" ? `${c.otHours || "0"} h` : "Full days only"}</output>
          <button type="button" disabled={c.status !== "F" || otMin(c.otHours) >= MAX_OT} onClick={() => changeOt(emp, date, 1)} aria-label="More overtime (0.5 h)">+</button>
          <small>0.5 h steps</small>
        </div>
        <button type="button" className="att-close" onClick={() => setOpen(null)}>Done</button>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="attendance-tools flex flex-wrap items-center gap-3">
        {!locked && (
          <button type="button" disabled={filling || empty === 0}
            onClick={() => startFill(async () => setFillError((await fillEmptyCells(start)) ?? undefined))}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50">
            Fill empty cells ({empty})
          </button>
        )}
        <span className="att-legend text-xs text-text-muted">
          <span className="att-day att-F">F</span> Full <span className="att-day att-H">H</span> Half <span className="att-day att-A">A</span> Absent
          <span className="att-day att-R">R</span> Rest <span className="att-day att-empty">—</span> Not marked
          {!locked && <> · Tap a day to change it.<span className="att-keys"> Keys: F H A R, Delete, + / − overtime (0.5 h), arrows.</span></>}
        </span>
        {fillError && <span role="alert" className="text-sm text-danger">{fillError}</span>}
      </div>
      <p aria-live="polite" className={`min-h-5 text-sm ${note?.error ? "text-danger" : "text-text-muted"}`}>{note?.text}</p>

      <div className="attendance-desktop overflow-x-auto rounded-md border border-border bg-surface">
        <table data-attendance className="att-table w-full min-w-[900px] text-sm">
          <thead className="bg-surface-2 text-text-muted">
            <tr>
              <th scope="col" className="w-52 px-3 py-2 text-left font-medium">Employee</th>
              {dayLabels.map((l, i) => (
                <th key={days[i]} scope="col" className="px-1 py-2 text-center font-medium">
                  {l}{holidays[days[i]] && <span className="mt-0.5 block rounded bg-warning/10 px-1 text-[12px] text-warning">{holidays[days[i]]}</span>}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-medium">Week</th>
            </tr>
          </thead>
          {groups.map(([pos, list]) => (
            <tbody key={pos}>
              <tr><th colSpan={9} scope="rowgroup" className="bg-surface-2/60 px-3 py-1 text-left text-xs font-medium uppercase text-text-muted">{GROUP[pos]}</th></tr>
              {list.flatMap((e) => {
                const s = summary(e, days, cells);
                return [
                  <tr key={e.id} data-row={rowOf.get(e.id)} className="border-t border-border">
                    <th scope="row" className="px-3 py-1.5 text-left font-normal"><span className="block font-medium">{e.name}</span><span className="font-mono text-xs text-text-muted">{e.code} · {e.restDay} off</span></th>
                    {days.map((d, i) => <td key={d} className="px-1 py-1.5 text-center">{day(e, i)}</td>)}
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs text-text-muted">{s.text}{s.unmarked > 0 && <span className="block text-warning">{s.unmarked} not marked</span>}</td>
                  </tr>,
                  open?.startsWith(e.id + "|") && open.endsWith("|false") ? <tr key={e.id + "-edit"}><td colSpan={9} className="px-3 pb-3">{editor(e)}</td></tr> : null,
                ];
              })}
            </tbody>
          ))}
          <tfoot className="border-t border-border bg-surface-2 text-xs text-text-muted">
            <tr>
              <th scope="row" className="px-3 py-2 text-left font-medium">Full-day mechanics</th>
              {mechanicsFullDay.map((n, i) => <td key={days[i]} className="px-1 py-2 text-center">{n}</td>)}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="attendance-phone">
        {employees.map((e, index) => {
          const s = summary(e, days, cells);
          return (
            <details key={e.id} open={index === 0} className="attendance-person-card">
              <summary><strong>{e.name}</strong><span className="text-text-muted">{e.code} · {GROUP[e.position] || e.position} · {s.text}{s.unmarked > 0 ? ` · ${s.unmarked} not marked` : ""}</span></summary>
              <div className="att-week">
                {days.map((d, i) => <div key={d}><span>{dayLabels[i].split(" ")[0]}{holidays[d] ? " ★" : ""}</span>{day(e, i, true)}</div>)}
              </div>
              {editor(e, true)}
            </details>
          );
        })}
      </div>
    </div>
  );
}
