"use client";
import { useState, useTransition } from "react";
import { decideTerms } from "@/app/(app)/employees/terms-actions.ts";

/** Owner approve/reject for a proposed pay-terms change. */
export function DecideButtons({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const decide = (decision: "approved" | "rejected") => start(async () => {
    const f = new FormData();
    f.set("id", id); f.set("decision", decision);
    setError((await decideTerms(f)) ?? undefined);
  });
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} onClick={() => decide("approved")}
        className="rounded-md bg-success-solid px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60">Approve</button>
      <button type="button" disabled={pending} onClick={() => decide("rejected")}
        className="rounded-md border border-border px-2.5 py-1 text-xs disabled:opacity-60">Reject</button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}
