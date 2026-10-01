"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()}
      className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:brightness-90">
      Print / Save as PDF
    </button>
  );
}
