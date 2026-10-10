import {getSession} from "@/lib/auth/session.ts";import {hasTab} from "@/lib/auth/tabs.ts";import {withUser} from "@/lib/db/client.ts";import {payslipPdf} from "@/lib/portal/pdf.ts";import type {PayslipSnapshot} from "@/lib/portal/types.ts";
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const origin=req.headers.get("origin");const host=process.env.TRUST_PROXY==="1"?(req.headers.get("x-forwarded-host")??req.headers.get("host")):req.headers.get("host");
 if(!origin||!host)return new Response("Forbidden",{status:403});
 try{if(new URL(origin).host!==host)return new Response("Forbidden",{status:403});}catch{return new Response("Forbidden",{status:403});}
 const u=await getSession();if(!u)return new Response("Unauthorized",{status:401});if(!u.employeeId||!hasTab(u,"payslips"))return new Response("Forbidden",{status:403});
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))return new Response("Invalid request",{status:400});
 try{const bytes=await withUser(u.id,async tx=>{const [r]=await tx`select snapshot from payslip_requests where id=${id} and employee_id=${u.employeeId} and status='approved' and expires_at>now()`;
 if(!r)throw new Error("DOWNLOAD_UNAVAILABLE");const pdf=await payslipPdf(r.snapshot as PayslipSnapshot,id);
 await tx`select consume_payslip(${id})`;return pdf;});
 return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="MotoNorte-Payslips-${id}.pdf"`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch(e){
  if(e instanceof Error&&e.message.includes("DOWNLOAD_UNAVAILABLE"))return new Response("Approval unavailable, expired or already used. Request fresh admin approval.",{status:409,headers:{"Cache-Control":"no-store"}});
  // Transaction rolled back: the approval was not consumed, so the employee can simply retry.
  console.error("payslip download failed",id,e);
  return new Response("Couldn't generate the PDF. Your approval was not used; please try again.",{status:500,headers:{"Cache-Control":"no-store"}});
 }
}
