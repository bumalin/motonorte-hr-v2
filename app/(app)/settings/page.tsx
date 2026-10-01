import { Fragment } from "react";
import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { formatDate, todayManila, periodStartOf } from "@/lib/format.ts";
import { StatusChip } from "@/components/ui.tsx";
import { TABS } from "@/lib/auth/tabs.ts";
import { ConfirmDialog } from "@/components/confirm-dialog.tsx";
import { AddHolidayForm, AddUserForm, MultiplierForm, UserRowForm } from "./forms.tsx";
import { removeHoliday, setUserActive } from "./actions.ts";

// S-11 Settings — PR-030, US-061. Owner edits; staff view.
const LABELS: [string, string][] = [
  ["rest_day_worked_multiplier", "Rest day worked"],
  ["holiday_worked_multiplier", "Holiday worked"],
  ["holiday_unworked_multiplier", "Holiday not worked"],
  ["ot_multiplier", "Overtime"],
];
type Setting = { key: string; effective_from: string; value_hundredths: number };
type Holiday = { date: string; name: string; type: string };
type User = { id: string; email: string; full_name: string; role: string; tabs: string[]; active: boolean; last_login_at: Date | null;
  phone: string | null; address: string | null; emergency_contact: string | null; emergency_contact_phone: string | null };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireTab("settings");
  const isOwner = user.role === "owner";
  const today = todayManila();
  const year = Number((await searchParams).year) || Number(today.slice(0, 4));

  const { settings, holidays, users, frozen } = await withUser(user.id, async (tx) => ({
    settings: await tx<Setting[]>`select key, effective_from::text, value_hundredths from settings order by key, effective_from desc`,
    holidays: await tx<Holiday[]>`select date::text, name, type from holidays where extract(year from date) = ${year} order by date`,
    users: isOwner ? await tx<User[]>`select id, email, full_name, role, tabs, active, last_login_at,
      phone, address, emergency_contact, emergency_contact_phone from users order by role desc, email` : [],
    frozen: (await tx<{ p: string }[]>`select period_start::text as p from payroll_runs where status in ('submitted', 'locked')`).map((r) => r.p),
  }));
  const fmt = (h: number) => (h / 100).toFixed(2);
  const current = (k: string) => settings.find((s) => s.key === k && s.effective_from <= today);

  return (
    <div className="max-w-4xl space-y-10">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Pay multipliers</h2>
        <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          Current policy: rest-day work and holidays are paid at the regular rate. The PH Labor Code generally requires +30% for
          rest-day work and holiday premiums. Please confirm with your accountant or labor consultant.
        </p>
        <div className="space-y-3 rounded-md border border-border bg-surface p-4">
          {LABELS.map(([k, label]) => {
            const c = current(k);
            const upcoming = settings.filter((s) => s.key === k && s.effective_from > today);
            return isOwner ? (
              <div key={k}>
                <MultiplierForm k={k} label={label} current={c ? fmt(c.value_hundredths) : "—"} today={today} />
                {upcoming.map((u) => <p key={u.effective_from} className="ml-56 text-xs text-text-muted">→ {fmt(u.value_hundredths)}× from {formatDate(u.effective_from)}</p>)}
              </div>
            ) : (
              <p key={k} className="text-sm">{label}: <span className="font-mono">{c ? fmt(c.value_hundredths) : "—"}×</span></p>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium">Holidays</h2>
          <form className="flex items-center gap-2 text-sm">
            <label htmlFor="year">Year</label>
            <select id="year" name="year" defaultValue={year} className="rounded-md border border-border px-2 py-1">
              {[year - 1, year, year + 1].map((y) => <option key={y}>{y}</option>)}
            </select>
            <button className="rounded-md border border-border px-2 py-1">Show</button>
          </form>
        </div>
        {holidays.length === 0 ? <p className="text-sm text-text-muted">No holidays for {year}.</p> : (
          <table className="w-full rounded-md border border-border bg-surface text-sm">
            <thead className="bg-surface-2 text-left text-text-muted"><tr>{["Date", "Name", "Type", ""].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.date} className="border-t border-border">
                  <td className="px-3 py-2">{formatDate(h.date)}</td>
                  <td className="px-3 py-2">{h.name}</td>
                  <td className="px-3 py-2 capitalize">{h.type}</td>
                  <td className="px-3 py-2 text-right">{isOwner && !frozen.includes(periodStartOf(h.date)) && (
                    <ConfirmDialog trigger="Remove" title={`Remove ${h.name}?`} body={formatDate(h.date)} confirmLabel="Remove" danger action={removeHoliday}>
                      <input type="hidden" name="date" value={h.date} />
                    </ConfirmDialog>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {isOwner && <AddHolidayForm />}
      </section>

      {isOwner && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Users</h2>
          <table className="w-full rounded-md border border-border bg-surface text-sm">
            <thead className="bg-surface-2 text-left text-text-muted"><tr>{["User", "Access", "Status", "Last sign-in", "Change"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {users.map((u) => (<Fragment key={u.id}>
                <tr className="border-t border-border align-top">
                  <td className="px-3 py-2">{u.full_name}<br /><span className="text-xs text-text-muted">{u.email}</span></td>
                  <td className="px-3 py-2 text-xs">{u.role === "owner" ? "Owner — all tabs" : `Staff — ${TABS.filter((t) => u.tabs.includes(t.key)).map((t) => t.label).join(", ") || "no tabs"}`}</td>
                  <td className="px-3 py-2"><StatusChip status={u.active ? "active" : "inactive"} /></td>
                  <td className="px-3 py-2 text-xs">{u.last_login_at ? u.last_login_at.toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "Never"}</td>
                  <td className="space-y-2 px-3 py-2">
                    {u.id !== user.id && (
                      <ConfirmDialog trigger={u.active ? "Deactivate" : "Reactivate"} danger={u.active} action={setUserActive}
                        title={`${u.active ? "Deactivate" : "Reactivate"} ${u.email}?`} confirmLabel={u.active ? "Deactivate" : "Reactivate"}
                        body={u.active ? "They'll be signed out and can't sign in until reactivated." : "They'll be able to sign in again."}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="active" value={String(!u.active)} />
                      </ConfirmDialog>
                    )}
                  </td>
                </tr>
                <tr><td colSpan={5} className="px-3 pb-3"><UserRowForm user={u} self={u.id === user.id} /></td></tr>
              </Fragment>))}
            </tbody>
          </table>
          <AddUserForm />
          <p className="text-xs text-text-muted">Password resets, role changes and deactivation sign that user out everywhere. Tab changes apply on their next page load.</p>
        </section>
      )}
    </div>
  );
}
