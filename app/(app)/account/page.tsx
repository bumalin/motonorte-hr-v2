import { requireUser } from "@/lib/auth/session.ts";
import { PasswordForm } from "./password-form.tsx";

// Your account — change your own password (security report M-4)
export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">Your account</h1>
      <p className="text-sm text-text-muted">{user.fullName} · {user.email} · <span className="capitalize">{user.role}</span></p>
      <PasswordForm />
    </div>
  );
}
