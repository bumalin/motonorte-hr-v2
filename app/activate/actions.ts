"use server";
import {redirect} from "next/navigation";
import {Email} from "@/lib/auth/email.ts";
import {withAnon} from "@/lib/db/client.ts";
import {hashToken} from "@/lib/auth/token.ts";
import {hashPassword,MIN_PASSWORD_LENGTH} from "@/lib/auth/password.ts";
import {clientIp,createSession} from "@/lib/auth/session.ts";
export type ActivationState={error?:string}|undefined;
export async function activate(_:ActivationState,form:FormData):Promise<ActivationState>{
 const email=Email.safeParse(form.get("email"));const code=String(form.get("code")??"").trim();
 const password=String(form.get("password")??"");if(!email.success||code.length<20||code.length>100)return {error:"Check your email and activation code."};
 if(password.length<MIN_PASSWORD_LENGTH||password.length>200||password!==form.get("confirm"))return {error:"Use at least 12 characters and matching passwords."};
 const ip=await clientIp();
 const allowed=await withAnon(async tx=>{if(ip)await tx`select pg_advisory_xact_lock(hashtext(${"ip:"+ip}))`;await tx`select pg_advisory_xact_lock(hashtext(${email.data}))`;
 const [{verdict}]=await tx`select auth_throttle(${email.data},${ip}) as verdict`;if(verdict!=="ok")return false;
 await tx`select auth_record_attempt(${email.data},${ip},false)`;return true;});
 if(!allowed)return {error:"Too many attempts. Try again in 15 minutes."};
 const hash=await hashPassword(password);
 const [{id}]=await withAnon(tx=>tx`select activate_crew(${email.data},${hashToken(code)},${hash}) as id`);
 if(!id)return {error:"Invalid or expired activation code. Ask your administrator for a replacement."};
 await withAnon(tx=>tx`select auth_record_attempt(${email.data},${ip},true)`);
 await createSession(id);redirect("/my-pay");
}
