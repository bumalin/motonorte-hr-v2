"use server";
import { redirect } from "next/navigation";
import * as z from "zod";
import { Email } from "@/lib/auth/email.ts";
import { checkPassword } from "@/lib/auth/credentials.ts";
import { clientIp, createSession, deleteSession } from "@/lib/auth/session.ts";

export type LoginState = { error?: string } | undefined;

const Login = z.object({ email: Email, password: z.string().min(1).max(200) });

const GENERIC = "Email or password is incorrect.";

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = Login.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: GENERIC };
  const r = await checkPassword(parsed.data.email, parsed.data.password, await clientIp());
  if (!r.ok) return { error: r.reason === "throttled" ? "Too many attempts. Try again in 15 minutes." : GENERIC };
  await createSession(r.userId);
  redirect("/");
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
