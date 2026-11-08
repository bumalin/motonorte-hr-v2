"use server";
import {requireOwner} from '@/lib/auth/session.ts';import {withUser} from '@/lib/db/client.ts';import {parsePesos} from '@/lib/format.ts';import {dbErrorMessage} from '@/lib/db/errors.ts';import {revalidatePath} from 'next/cache';import * as z from 'zod';
export type ContributionFormState={error?:string;ok?:string}|undefined;
export async function saveContributions(_:ContributionFormState,form:FormData):Promise<ContributionFormState>{
 const user=await requireOwner();const id=z.guid().safeParse(form.get('employee_id'));
 const amounts=['sss','philhealth','pagibig'].map(key=>parsePesos(String(form.get(key)??'')));
 if(!id.success||amounts.some(n=>n===null||n>100000000))return {error:'Enter all three monthly amounts, from ₱0 to ₱1,000,000.'};
 try{const [{month}]=await withUser(user.id,tx=>tx`select set_employee_contributions(${id.data},${amounts[0]},${amounts[1]},${amounts[2]})::text as month`);
 for(const p of ['/employees','/','/reports/contributions',`/employees/${id.data}`,'/my-pay'])revalidatePath(p);
 return {ok:`Monthly employer contributions saved, effective ${month}. Existing approved payroll remains unchanged.`};
 }catch(e){return {error:dbErrorMessage(e)};}
}
