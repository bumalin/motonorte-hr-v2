import {getSession} from "@/lib/auth/session.ts";import {hasTab} from "@/lib/auth/tabs.ts";import {withUser} from "@/lib/db/client.ts";import {validRange} from "@/lib/portal/range.ts";import {payHistory} from "@/lib/portal/data.ts";import {summarizeRange} from "@/lib/portal/summary.ts";
export async function GET(req:Request){
 const u=await getSession();if(!u)return new Response("Unauthorized",{status:401});if(!u.employeeId||!hasTab(u,"payslips"))return new Response("Forbidden",{status:403});
 const params=new URL(req.url).searchParams,start=params.get("from")??"",end=params.get("to")??"";
 if(!validRange(start,end))return new Response("Invalid range",{status:400});
 const summary=await withUser(u.id,async tx=>summarizeRange(start,end,await payHistory(tx,u.employeeId!,start,end)));
 return Response.json(summary,{headers:{"Cache-Control":"private, no-store"}});
}
