"use client";
// Native <dialog> confirm for irreversible actions (UX §4): focus trap + Esc built in; focus returns to the trigger.
// The action returns an error message (shown in the dialog) or nothing on success.
import { useId, useRef, useState, useTransition } from "react";

export function ConfirmDialog({
  trigger, title, body, confirmLabel, action, danger = false, children,
}: {
  trigger: string;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  action: (form: FormData) => Promise<string | void>;
  danger?: boolean;
  children?: React.ReactNode; // extra form fields (e.g. a required note), plus hidden inputs
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const btn = danger ? "bg-danger-solid hover:brightness-90" : "bg-brand-600 hover:brightness-90";
  const submit = (form: FormData) =>
    start(async () => {
      const err = await action(form);
      if (err) setError(err);
      else ref.current?.close();
    });
  return (
    <>
      <button type="button" onClick={() => { setError(undefined); ref.current?.showModal(); }}
        className={`rounded-md px-4 py-2 text-sm font-medium text-white ${btn}`}>{trigger}</button>
      <dialog ref={ref} aria-labelledby={titleId} className="m-auto w-full max-w-md rounded-md p-0 shadow-xl backdrop:bg-black/40">
        <form action={submit} className="space-y-4 p-6">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <div className="text-sm text-text-muted">{body}</div>
          {children}
          <p role="alert" className="text-sm text-danger empty:hidden">{error}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => ref.current?.close()} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={pending}
              className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${btn}`}>{pending ? "Working…" : confirmLabel}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
