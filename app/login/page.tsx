import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session.ts";
import { LoginForm } from "./login-form.tsx";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");
  const changed = (await searchParams).changed === "1";
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-md border border-border border-t-4 border-t-brand-600 bg-surface p-6 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
        <img src="/brand/motonorte-logo.svg" alt="MotoNorte" width={280} height={57} className="mx-auto h-auto w-full max-w-64" />
        <h1 className="mt-4 text-center text-lg font-bold">HR &amp; Payroll</h1>
        <p className="mb-6 text-center text-sm text-text-muted">Sign in to continue</p>
        {changed && <p role="status" className="mb-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">Password changed. Sign in with your new password.</p>}
        <LoginForm /><Link href="/activate" className="mt-5 block text-center underline text-sm">First login? Activate your employee account</Link>
      </div>
    </main>
  );
}
