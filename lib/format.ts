// Display formatting (docs/04-ux-spec.md §5). ISO dates are calendar dates in Asia/Manila;
// they're formatted with timeZone UTC so the calendar day never shifts.

const peso = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1234567 centavos → "₱12,345.67"; negatives → "−₱150.00" (true minus sign). */
export function formatMoney(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) throw new Error(`formatMoney expects integer centavos, got ${centavos}`);
  const s = `₱${peso.format(Math.abs(centavos) / 100)}`;
  return centavos < 0 ? `−${s}` : s;
}

/** "150.00" or "150" → 15000 centavos; null if not a valid non-negative amount with ≤ 2 decimals. */
export function parsePesos(input: string): number | null {
  const m = input.trim().replace(/,/g, "").match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts });
const dayShort = fmt({ weekday: "short", month: "short", day: "numeric" });
const dateLong = fmt({ month: "short", day: "numeric", year: "numeric" });
const monthDay = fmt({ month: "short", day: "numeric" });

/** "Mon Oct 5" (grids) */
export const formatDay = (iso: string) => dayShort.format(d(iso)).replace(",", "");
/** "Oct 5, 2026" */
export const formatDate = (iso: string) => dateLong.format(d(iso));

export function addDays(iso: string, n: number): string {
  const x = d(iso);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** "Oct 5 – 11, 2026" · "Sep 28 – Oct 4, 2026" · "Dec 28, 2026 – Jan 3, 2027" */
export function formatWeek(periodStart: string): string {
  const end = addDays(periodStart, 6);
  const [sy, sm] = periodStart.split("-"), [ey, em] = end.split("-");
  if (sy !== ey) return `${formatDate(periodStart)} – ${formatDate(end)}`;
  if (sm !== em) return `${monthDay.format(d(periodStart))} – ${monthDay.format(d(end))}, ${ey}`;
  return `${monthDay.format(d(periodStart))} – ${Number(end.slice(8))}, ${ey}`;
}

/** Today's calendar date in Manila as ISO. */
export function todayManila(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

/** Monday of the week containing `iso`. */
export function periodStartOf(iso: string): string {
  const dow = (d(iso).getUTCDay() + 6) % 7; // Mon = 0
  return addDays(iso, -dow);
}

/** Positions in display order. */
export const POSITIONS = [["mechanic", "Mechanic"], ["technician", "Technician"], ["staff", "Staff"]] as const;
export const POSITION_KEYS = POSITIONS.map(([k]) => k) as ["mechanic", "technician", "staff"];
export const positionLabel = (p: string | null | undefined) => POSITIONS.find(([k]) => k === p)?.[1] ?? p ?? "—";
