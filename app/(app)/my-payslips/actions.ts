"use server";
import {revalidatePath} from "next/cache";import {requireTab} from "@/lib/auth/session.ts";import {withUser} from "@/lib/db/client.ts";import {dbErrorMessage} from "@/lib/db/errors.ts";import {documentSnapshot} from "@/lib/portal/data.ts";import {validRange} from "@/lib/portal/range.ts";
export type RequestState={error?:string;ok?:string}|undefined;
export async function requestPayslip(_:RequestState,f:FormData):Promise<RequestState>{
 const u=await requireTab("payslips");if(!u.employeeId)return {error:"A linked employee account is required."};const start=String(f.get("from")??"");const end=String(f.get("to")??"");
 if(!validRange(start,end))return {error:"Choose valid dates, up to one year apart."};
 try{await withUser(u.id,async tx=>{const [{n}]=await tx`select count(*)::int as n from payslip_requests where employee_id=${u.employeeId} and status='pending'`;if(n>=5)throw new Error("You already have five pending requests.");
 const s=await documentSnapshot(tx,u.employeeId!,start,end);if(!s.weeks.length)throw new Error("No approved payroll.");
 await tx`insert into payslip_requests(employee_id,range_start,range_end) values(${u.employeeId},${start},${end})`;});}catch(e){return {error:dbErrorMessage(e)};}
 revalidatePath("/my-payslips");revalidatePath("/requests");return {ok:"Request sent. Your administrator has been notified in the approval queue."};
}
