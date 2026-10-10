import type {PayWeek} from "./types.ts";
export function isWholeMonth(start:string,end:string):boolean{
 if(!start.endsWith("-01"))return false;
 const [year,month]=start.split("-").map(Number);
 return new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)===end;
}
export function needsRangeSummary(start:string,end:string,weeks:number):boolean{return weeks>1||start!==end;}
export function summarizeRange(start:string,end:string,source:PayWeek[]){
 const weeks=source.filter(w=>w.status==="locked");
 const sum=(key:"base"|"ot"|"incentive"|"allowances"|"deductions"|"carriedIn"|"gross"|"net"|"paid")=>weeks.reduce((n,w)=>{
  if(!Number.isSafeInteger(w[key])||!Number.isSafeInteger(n+w[key]))throw new Error("Invalid payroll amount");return n+w[key];
 },0);
 const paydays:string[]=[];const first=new Date(start+"T00:00:00Z");first.setUTCDate(first.getUTCDate()+(7-first.getUTCDay())%7);
 for(const day=new Date(first);day.toISOString().slice(0,10)<=end;day.setUTCDate(day.getUTCDate()+7))paydays.push(day.toISOString().slice(0,10));
 const included=new Set(weeks.map(w=>w.payday));
 return {wholeMonth:isWholeMonth(start,end),rangeStart:start,rangeEnd:end,approvedWeeks:weeks.length,
  base:sum("base"),ot:sum("ot"),incentive:sum("incentive"),allowances:sum("allowances"),gross:sum("gross"),deductions:sum("deductions"),carriedIn:sum("carriedIn"),net:sum("net"),paid:sum("paid"),
  closingCarriedForward:[...weeks].sort((a,b)=>b.payday.localeCompare(a.payday))[0]?.carryOut??0,
  daysPaid:weeks.length&&weeks.every(w=>w.daysPaid!==undefined)?weeks.reduce((n,w)=>n+w.daysPaid!,0):undefined,
  missingPaydays:paydays.filter(day=>!included.has(day)),
  weeks:weeks.map(w=>({runId:w.runId,period:w.period,end:w.end,payday:w.payday,net:w.net}))
 };
}
export type RangeSummary=ReturnType<typeof summarizeRange>;
