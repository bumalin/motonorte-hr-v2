// Jump to any pay week, past or future (historical payroll entry). Plain GET form: works without JS.
export function WeekPicker({ value }: { value?: string }) {
  return (
    <form action="/week" className="flex items-center gap-2 text-sm">
      <label htmlFor="week-picker">Go to week of</label>
      <input id="week-picker" type="date" name="d" required defaultValue={value}
        className="rounded-md border border-border bg-surface px-2 py-1" />
      <button className="rounded-md border border-border bg-surface px-2 py-1 hover:bg-surface-2">Open</button>
    </form>
  );
}
