"use client";
import { useActionState, useEffect, useRef } from "react";
import { changePassword, type PwState } from "./actions.ts";

const input = "mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2";

export function PasswordForm() {
  const [state, action, pending] = useActionState<PwState, FormData>(changePassword, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-4 rounded-md border border-border bg-surface p-4">
      <h2 className="font-medium">Change password</h2>
      <label className="block text-sm">Current password
        <input name="current" type="password" autoComplete="current-password" required className={input} />
      </label>
      <label className="block text-sm">New password (at least 12 characters)
        <input name="next" type="password" autoComplete="new-password" required minLength={12} className={input} />
      </label>
      <label className="block text-sm">Repeat new password
        <input name="confirm" type="password" autoComplete="new-password" required minLength={12} className={input} />
      </label>
      <p role="alert" className="text-sm text-danger empty:hidden">{state?.error}</p>
      {state?.ok && <p aria-live="polite" className="text-sm text-success">Password changed. You&apos;ve been signed out on other devices.</p>}
      <button disabled={pending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:brightness-90 disabled:opacity-60">
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
