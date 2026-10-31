"use server";
import {revalidatePath} from "next/cache";import {requireOwner} from "@/lib/auth/session.ts";import {withUser} from "@/lib/db/client.ts";import {Email} from "@/lib/auth/email.ts";import {newToken,hashToken} from "@/lib/auth/token.ts";import {dbErrorMessage} from "@/lib/db/errors.ts";import * as z from "zod";
export type CrewState={error?:string;code?:string;ok?:string}|undefined;
const tabsOf=(f:FormData)=>["profile","mypay","payslips"].filter(t=>f.getAll("tabs").includes(t));
export async function createCrew(_:CrewState,f:FormData):Promise<CrewState>{
 const owner=await requireOwner();const employee=z.guid().safeParse(f.get("employee_id"));const email=Email.safeParse(f.get("email"));
 if(!employee.success||!email.success)return {error:"Choose an employee and valid email."};
 const code=newToken();try{await withUser(owner.id,async tx=>{
 const [e]=await tx`select full_name from employees where id=${employee.data}`;if(!e)throw new Error("Employee not found");
 await tx`insert into users(email,full_name,password_hash,role,active,access_kind,employee_id,tabs,activation_hash,activation_expires_at)
 values(${email.data},${e.full_name},'not-activated','staff',false,'crew',${employee.data},${tabsOf(f)},${hashToken(code)},now()+interval '7 days')`;});
 }catch(e){return {error:dbErrorMessage(e,"That employee or email already has an account.")};}
 revalidatePath("/team");return {code,ok:"Account created. Share this code privately; it expires in 7 days."};
}
export async function updateCrew(_:CrewState,f:FormData):Promise<CrewState>{
 const owner=await requireOwner();const id=z.guid().safeParse(f.get("id"));const email=Email.safeParse(f.get("email"));if(!id.success||!email.success)return {error:"Invalid account."};
 const reset=f.get("reset")==="yes";const code=reset?newToken():null;
 try{await withUser(owner.id,async tx=>{
 const changes={email:email.data,tabs:tabsOf(f)};
 const [u]=await tx`update users set ${tx(changes)} where id=${id.data} and access_kind='crew' returning id`;if(!u)throw new Error("Account not found");
 if(code)await tx`update users set active=false,activation_hash=${hashToken(code)},activation_expires_at=now()+interval '7 days' where id=${id.data}`;
 });}catch(e){return {error:dbErrorMessage(e)};}
 revalidatePath("/team");return {ok:code?"Account signed out. Share replacement code privately.":"Access saved.",code:code??undefined};
}
