import Link from "next/link";
import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { todayManila } from "@/lib/format.ts";
import { EmployeeForm } from "../employee-form.tsx";

// S-04 New employee — US-001
export default async function NewEmployeePage() {
  const user = await requireTab("employees");
  // Suggest the next mechanic code (M###); HR can change the prefix/number
  const [{ next }] = await withUser(user.id, (tx) => tx<{ next: number }[]>`
    select coalesce(max(substring(code from '^M(\\d+)$')::int), 0) + 1 as next from employees where code ~ '^M\\d+$'`);
  return (
    <>
      <Link href="/employees" className="text-sm text-brand-700 hover:underline">← Employees</Link>
      <h1 className="mb-6 mt-2 text-2xl font-semibold">New employee</h1>
      <EmployeeForm mode="new" isOwner={user.role === "owner"}
        initial={{ code: `M${String(next).padStart(3, "0")}`, hire_date: todayManila(), rest_day: "sun", bank_name: "RCBC" }} />
    </>
  );
}
