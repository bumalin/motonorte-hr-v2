"use client";
// Light/dark switch. Stores the choice in a cookie (read by the root layout, so the server renders the right theme —
// no flash) and flips <html data-theme> immediately.
import { useState } from "react";

export function ThemeSwitch({ initial }: { initial: "dark" | "light" }) {
  const [theme, setTheme] = useState(initial);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        document.cookie = `mn_theme=${next}; path=/; max-age=31536000; samesite=lax`;
        setTheme(next);
      }}
      className="rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-2">
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
      <span className="ml-1.5 hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}
