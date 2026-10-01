"use client";
import { useActionState } from "react";
import { login } from "./actions.ts";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2" />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2" />
      </div>
      <p role="alert" className="min-h-5 text-sm text-danger">{state?.error}</p>
      <button type="submit" disabled={pending}
        className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:brightness-90 disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
