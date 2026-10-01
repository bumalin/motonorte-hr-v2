// Moving a hire date earlier (PR-072): the starting pay terms are copied to the new date so the earlier days have a rate.
// A copy, not a move, so weeks already paid keep their row. Only an approved rate copied by the Owner is approved;
// otherwise the copy is a proposal for the Owner (PR-020). Returns true if a proposal was created.
import type { Tx } from "./client.ts";

export async function moveHireEarlier(tx: Tx, employeeId: string, newHire: string, isOwner: boolean): Promise<boolean> {
  await tx`update employees set hire_date = ${newHire} where id = ${employeeId} and hire_date > ${newHire}`;
  const [row] = await tx<{ status: string }[]>`
    insert into pay_terms (employee_id, effective_from, position, daily_rate, daily_allowance, status)
    select employee_id, ${newHire}, position, daily_rate, daily_allowance,
      case when status = 'approved' and ${isOwner} then 'approved' else 'proposed' end::term_status_t
    from pay_terms where employee_id = ${employeeId} and status <> 'rejected'
    order by (status = 'approved') desc, effective_from, created_at limit 1
    returning status::text`;
  return row?.status === "proposed";
}
