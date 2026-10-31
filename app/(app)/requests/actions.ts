"use server";
import {requireOwner} from "@/lib/auth/session.ts";import {withUser} from "@/lib/db/client.ts";import {revalidatePath} from "next/cache";import {dbErrorMessage} from "@/lib/db/errors.ts";import {documentSnapshot} from "@/lib/portal/data.ts";import {parsePesos} from "@/lib/format.ts";import * as z from "zod";
export type ReviewState={error?:string;ok?:string}|undefined;
export async function reviewRequest(_:ReviewState,f:FormData):Promise<ReviewState>{
 const u=await requireOwner();const id=z.guid().safeParse(f.get("id"));if(!id.success)return {error:"Invalid request."};const approve=f.get("decision")==="approve";const note=String(f.get("note")??"").trim();if(note.length>500||(!approve&&!note))return {error:"Give a reason for rejection (up to 500 characters)."};
 try{await withUser(u.id,async tx=>{const [r]=await tx`select employee_id,range_start::text,range_end::text from payslip_requests where id=${id.data}`;if(!r)throw new Error("Request not found");
 const snapshot=approve?{...await documentSnapshot(tx,r.employee_id,r.range_start,r.range_end),approvedBy:u.fullName,approvedAt:new Date().toISOString()}:null;
 await tx`select review_payslip(${id.data},${approve},${note},${snapshot?JSON.stringify(snapshot):null}::text::jsonb)`;});}catch(e){return {error:dbErrorMessage(e)};}
 revalidatePath("/requests");revalidatePath("/my-payslips");return {ok:approve?"Approved for one PDF download, valid 7 days.":"Request rejected."};
}
export async function recordPayment(_:ReviewState,f:FormData):Promise<ReviewState>{
 const u=await requireOwner();const run=z.guid().safeParse(f.get("run_id"));const employee=z.guid().safeParse(f.get("employee_id"));const amount=parsePesos(String(f.get("amount")??""));const date=String(f.get("paid_on")??"");const method=String(f.get("method")??"").trim();const reference=String(f.get("reference")??"").trim();
 if(!run.success||!employee.success||!amount||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!method||method.length>80||reference.length>200)return {error:"Check payment amount, date and method."};
 try{await withUser(u.id,tx=>tx`select record_payroll_payment(${run.data},${employee.data},${amount},${date},${method},${reference})`);}catch(e){return {error:dbErrorMessage(e)};}
 revalidatePath("/requests");revalidatePath("/my-pay");return {ok:"Payment recorded. This entry is retained in payment history."};
}
