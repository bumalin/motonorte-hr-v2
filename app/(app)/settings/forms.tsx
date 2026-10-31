"use client";
import { useActionState, useState } from "react";
import { TABS } from "@/lib/auth/tabs.ts";
import { addHoliday, addUser, setMultiplier, updateUser, type SettingsState } from "./actions.ts";

const input = "mt-1 block w-full rounded-md border border-border bg-surface px-3 py-1.5";
const button = "rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:brightness-90 disabled:opacity-60";

function Status({ state }: { state: SettingsState }) {
  return (
    <>
      <span role="alert" className="text-sm text-danger empty:hidden">{state?.error}</span>
      {state?.ok && <span aria-live="polite" className="text-sm text-success">{state.ok}</span>}
    </>
  );
}

export function MultiplierForm({ k, label, current, today }: { k: string; label: string; current: string; today: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(setMultiplier, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="key" value={k} />
      <span className="w-56 pb-1.5 text-sm">{label} <span className="font-mono text-text-muted">(now {current}×)</span></span>
      <label className="text-sm">New value<input name="value" required inputMode="decimal" placeholder={current} aria-label={`${label}: new value`} className={`${input} w-24`} /></label>
      <label className="text-sm">From<input type="date" name="effective_from" required defaultValue={today} aria-label={`${label}: effective from`} className={input} /></label>
      <button disabled={pending} aria-label={`Save ${label}`} className={button}>Save</button>
      <Status state={state} />
    </form>
  );
}

export function AddHolidayForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(addHoliday, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Date<input type="date" name="date" required className={input} /></label>
      <label className="text-sm">Name<input name="name" required className={input} /></label>
      <label className="text-sm">Type
        <select name="type" className={input}><option value="regular">Regular</option><option value="special">Special</option></select>
      </label>
      <button disabled={pending} className={button}>Add holiday</button>
      <Status state={state} />
    </form>
  );
}

/** Tab access checkboxes. Owners always see every tab, so the boxes are only shown for staff. */
function TabBoxes({ role, tabs, who }: { role: string; tabs: readonly string[]; who: string }) {
  if (role === "owner") return <p className="text-xs text-text-muted">Administrators have every tab. Staff access is selected manually.</p>;
  return (
    <fieldset className="tab-access-grid">
      <legend className="mb-1 text-xs text-text-muted">Tabs {who} can open</legend>
      {TABS.filter(t => !["mypay","profile","payslips"].includes(t.key)).map((t) => (
        <label key={t.key} className="tab-access-option">
          <input type="checkbox" role="switch" aria-label={t.label} name="tabs" value={t.key} defaultChecked={tabs.includes(t.key)} className="accent-brand-600" />
          {t.label}
        </label>
      ))}
    </fieldset>
  );
}

type Contact = { phone?: string | null; address?: string | null; emergency_contact?: string | null; emergency_contact_phone?: string | null };

/** Optional contact details (phone, address, emergency contact). */
function ContactFields({ v = {}, who }: { v?: Contact; who: string }) {
  const f = (name: keyof Contact, label: string, type = "text") => (
    <label className="text-sm">{label} <span className="text-text-muted">(optional)</span>
      <input name={name} type={type} defaultValue={v[name] ?? ""} aria-label={`${label} for ${who}`} className={input} />
    </label>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {f("phone", "Phone", "tel")}
      {f("address", "Address")}
      {f("emergency_contact", "Emergency contact")}
      {f("emergency_contact_phone", "Emergency contact number", "tel")}
    </div>
  );
}

export function AddUserForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(addUser, undefined);
  const [role, setRole] = useState("staff");
  return (
    <form action={action} className="space-y-3 rounded-md border border-border bg-surface p-4">
      <h3 className="font-medium">Add user</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Email<input type="email" name="email" required className={input} /></label>
        <label className="text-sm">Name<input name="full_name" required className={input} /></label>
        <label className="text-sm">Role
          <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={input}><option value="staff">Staff</option><option value="owner">Owner / administrator</option></select>
        </label>
        <label className="text-sm">Temporary password<input type="password" name="password" required minLength={12} autoComplete="new-password" className={input} /></label>
      </div>
      <ContactFields who="the new user" />
      <TabBoxes role={role} tabs={[]} who="this user" />
      <div className="flex items-center gap-3">
        <button disabled={pending} className={button}>Add user</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function UserRowForm({ user, self }: { user: { access_kind?: string; id: string; email: string; full_name: string; role: string; tabs: string[] } & Contact; self: boolean }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateUser, undefined);
  const [role, setRole] = useState(user.role);
  const who = user.email;
  if (user.access_kind === "crew") return <a href="/team" className="underline text-sm">Edit employee login on Team members</a>;
  return (
    <details className="rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-1.5 text-sm hover:bg-surface-2">Edit <span className="sr-only">{who}</span></summary>
      <form action={action} className="space-y-3 p-3">
        <input type="hidden" name="id" value={user.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Name<input name="full_name" required defaultValue={user.full_name} aria-label={`Name for ${who}`} className={input} /></label>
          <label className="text-sm">Email<input type="email" name="email" required defaultValue={user.email} aria-label={`Email for ${who}`} className={input} /></label>
          <label className="text-sm">Role
            <select name="role" value={role} onChange={(e) => setRole(e.target.value)} disabled={self} aria-label={`Role for ${who}`} className={input}>
              <option value="staff">Staff</option><option value="owner">Owner</option>
            </select>
          </label>
          {!self && (
            <label className="text-sm">New password <span className="text-text-muted">(optional)</span>
              <input type="password" name="password" minLength={12} autoComplete="new-password" aria-label={`New password for ${who}`} className={input} />
            </label>
          )}
        </div>
        <ContactFields v={user} who={who} />
        {self && <input type="hidden" name="role" value={role} />}
        <TabBoxes role={role} tabs={user.tabs} who={user.full_name} />
        <div className="flex items-center gap-3">
          <button disabled={pending} aria-label={`Save changes for ${who}`} className={button}>Save</button>
          <Status state={state} />
        </div>
      </form>
    </details>
  );
}
