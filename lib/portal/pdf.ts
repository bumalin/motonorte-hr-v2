import {summarizeRange,needsRangeSummary} from "./summary.ts";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import type {PayslipSnapshot,PayWeek} from "./types.ts";

// All values come from the approved snapshot; rendering never queries current payroll.
export async function payslipPdf(s:PayslipSnapshot,documentId:string):Promise<Buffer>{
 const doc=new PDFDocument({autoFirstPage:false,size:"A4",margin:0,pdfVersion:"1.4",compress:true});
 const chunks:Buffer[]=[];
 const result=new Promise<Buffer>((resolve,reject)=>{doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
 const font=(family:string,weight:number)=>join(process.cwd(),"node_modules","@fontsource",family,"files",family+"-latin-"+weight+"-normal.woff");
 doc.registerFont("body",join(process.cwd(),"public","payslip-fonts","manrope-400.ttf"));doc.registerFont("bold",join(process.cwd(),"public","payslip-fonts","manrope-700.ttf"));
 doc.registerFont("heading",font("barlow-condensed",800));doc.registerFont("mono",join(process.cwd(),"public","payslip-fonts","jetbrains-mono-500.ttf"));doc.registerFont("monoBold",join(process.cwd(),"public","payslip-fonts","jetbrains-mono-700.ttf"));
 const logo=readFileSync(join(process.cwd(),"public","brand","motonorte-logo.svg"),"utf8");
 const red="#e30613",black="#0a0a0a",muted="#6e6e6e",width=595.28;
 const money=(n:number)=>"₱"+(n/100).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2});
 const date=(v:string)=>new Date(v.slice(0,10)+"T00:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
 const rect=(x:number,y:number,w:number,h:number,color:string)=>doc.rect(x,y,w,h).fill(color);
 const text=(v:string,x:number,y:number,w:number,size=10,fontName="body",color=black,align:"left"|"right"|"center"="left")=>{
  doc.font(fontName).fontSize(size).fillColor(color).text(v,x,y,{width:w,align,lineGap:2});
 };
 const line=(y:number,x=36,w=523,color=black,thickness=1)=>doc.moveTo(x,y).lineTo(x+w,y).lineWidth(thickness).strokeColor(color).stroke();
 const footer=()=>{
  text("System-generated payslip. Keep it for your records. Questions? Talk to the Administrator.",36,758,523,8,"body",muted,"center");
  text("Document "+documentId,36,774,523,6,"mono",muted,"center");
  rect(0,785,width,57,"#8c0410");rect(0,785,112,57,black);
  SVGtoPDF(doc,logo,10,803,{width:92,height:20,preserveAspectRatio:"xMidYMid meet"});
  text("Back of Addessa, Cangrunaan,\nBatac, Ilocos Norte",128,801,160,8,"bold","#ffffff");
  text("0932 440 6593\nmotonorteph",299,801,90,8,"bold","#ffffff");
  text("motonorteph@gmail.com\nOpen daily, 8:30 AM - 5:30 PM",391,801,187,8,"bold","#ffffff","right");
 };
 const page=(title:string,range:string)=>{
  doc.addPage();rect(0,0,width,96,black);rect(0,96,width,4.5,red);
  SVGtoPDF(doc,logo,36,30,{width:158,height:32,preserveAspectRatio:"xMidYMid meet"});
  text("HR & PAYROLL",36,70,200,9,"mono","#bdbdbd");
  const plateWidth=title==="PAYSLIP"?143:190;const left=559-plateWidth;
  doc.save().translate(left,22).transform(1,0,-0.1,1,0,0).rect(0,0,plateWidth,40).fill(red).restore();
  text(title,left+4,23,plateWidth-8,31,"heading","#ffffff","center");
  text(range.toUpperCase(),302,75,257,9,"monoBold","#ffffff","right");
  footer();
 };
 const identity=(subtitle:string)=>{
  text("PAID TO",36,119,300,9,"mono",muted);
  let size=33;while(size>14&&doc.font("heading").fontSize(size).widthOfString(s.name.toUpperCase())>315)size--;
  text(s.name.toUpperCase(),36,135,315,size,"heading");
  text("Employee "+s.code+(s.hireDate?" · With MotoNorte since "+date(s.hireDate):""),36,174,320,9,"body","#3f3f3f");
  text(subtitle,365,122,194,9,"bold",black,"right");
  line(192,36,523,black,1.5);
 };
 const netPlate=(amount:number,days?:number,caption="Take-home for this pay period")=>{
  rect(36,205,411,72,red);rect(447,205,112,72,black);
  text("NET PAY",54,218,135,25,"heading","#ffffff");
  text(caption,54,249,150,8,"bold","#ffffff");
  let size=32;while(size>15&&doc.font("monoBold").fontSize(size).widthOfString(money(amount))>240)size--;
  text(money(amount),205,224,222,size,"monoBold","#ffffff","right");
  text("DAYS PAID",460,222,89,8,"mono","#bdbdbd");
  text(days===undefined?"—":String(days),460,238,89,27,"heading","#ffffff");
 };
 const columns=(label:string,y:number)=>{
  text(label,36,y,170,9,"monoBold");text("DETAILS",209,y,200,9,"monoBold",muted);text("AMOUNT",434,y,125,9,"monoBold",black,"right");line(y+20,36,523,black,1.5);
 };
 const row=(label:string,detail:string,amount:number,y:number,total=false)=>{
  if(total)rect(36,y-4,523,29,"#f1f1f1");
  text(label,total?44:36,y,164,11,"bold");
  text(detail,209,y,218,9,"body","#3f3f3f");
  text(money(amount),432,y,total?119:127,11,"monoBold",black,"right");
  if(!total)line(y+23,36,523,"#bdbdbd",0.5);
 };
 const weekly=(w:PayWeek)=>{
  page("PAYSLIP",date(w.period)+" - "+date(w.end));
  identity("Pay period: "+date(w.period)+" - "+date(w.end)+"\nPayday: "+date(w.payday)+(w.dailyRate!==undefined?"\nDaily rate: "+money(w.dailyRate):"")+(s.restDay?"\nDay off: "+s.restDay:""));
  netPlate(w.net,w.daysPaid);
  columns("EARNINGS",300);
  row("Basic pay",w.daysPaid!==undefined&&w.dailyRate!==undefined&&w.base===Math.round(w.daysPaid*w.dailyRate)?w.daysPaid+" days × "+money(w.dailyRate):"See frozen calculation detail",w.base,329);
  row("Overtime","Approved overtime",w.ot,357);
  row("Incentives","Shared pool + personal jobs",w.incentive,385);
  row("Allowances","Approved allowances",w.allowances,413);
  row("Gross pay","",w.gross,447,true);
  columns("DEDUCTIONS",490);
  row("Deductions",w.deductions===0?"None this pay period":"Approved deductions",w.deductions,519);
  row("Carried in / out","In "+money(w.carriedIn)+" / Out "+money(w.carryOut),w.carriedIn,547);
  doc.rect(36,589,523,45).lineWidth(1.5).strokeColor(black).stroke();
  text(money(w.gross)+" gross − "+money(w.deductions+w.carriedIn)+" deductions",49,599,480,9,"monoBold");
  text("= "+money(w.net)+" net"+(w.carryOut?" · "+money(w.carryOut)+" carried forward":""),49,615,480,9,"monoBold","#b8050f");
  line(681,36,243);line(681,316,243);
  text("Prepared by: "+(s.approvedBy??"Administrator"),36,689,243,9,"bold");
  text("Payroll locked "+date(w.version)+"\nReceived payments: "+money(w.paid)+(w.paidOn?" · "+date(w.paidOn):""),36,706,243,8,"body",muted);
  text("Received by: "+s.name,316,689,243,9,"bold");text("Date: ____________________",316,706,243,8,"body",muted);
 };
 if(needsRangeSummary(s.rangeStart,s.rangeEnd,s.weeks.length)){
  const total=summarizeRange(s.rangeStart,s.rangeEnd,s.weeks);
  page(total.wholeMonth?"MONTHLY PAY":"PAY SUMMARY",date(s.rangeStart)+" - "+date(s.rangeEnd));
  identity("Selected paydays\n"+date(s.rangeStart)+" - "+date(s.rangeEnd)+"\n"+total.approvedWeeks+" approved weeks");
  netPlate(total.net,total.daysPaid,total.wholeMonth?"Total approved net pay for the month":"Total approved net pay for selected range");
  columns("TOTAL EARNINGS",300);
  row("Basic pay","Sum of approved weekly basic pay",total.base,329);
  row("Overtime","Sum of approved weekly overtime",total.ot,357);
  row("Incentives","Sum of approved weekly incentives",total.incentive,385);
  row("Allowances","Sum of approved weekly allowances",total.allowances,413);
  row("Gross pay","",total.gross,447,true);
  columns("TOTAL DEDUCTIONS",490);
  row("Deductions","Sum of approved weekly deductions",total.deductions,519);
  row("Carried in","Balances applied in included weeks",total.carriedIn,547);
  text("Total net pay = sum of approved weekly net pay.",36,592,523,10,"monoBold");
  text("Recorded payments: "+money(total.paid)+" · Closing carry: "+money(total.closingCarriedForward),36,613,523,9,"mono");
  text("INCLUDED APPROVED WEEKS",36,642,523,9,"monoBold");
  if(s.weeks.length<=5)s.weeks.forEach((w,i)=>text(date(w.period)+" - "+date(w.end)+" · payday "+date(w.payday)+" · "+money(w.net),36,663+i*13,523,8,"mono"));
  else text("See the included-weeks pages and individual weekly slips.",36,663,523,9);
  if(total.missingPaydays.length)text("Partial "+(total.wholeMonth?"month":"range")+": "+total.approvedWeeks+" approved of "+(total.approvedWeeks+total.missingPaydays.length)+" scheduled paydays. Unapproved paydays excluded.",36,732,523,8,"bold","#b8050f");
  else text("Payroll approval does not itself confirm payment.",36,732,523,8,"body",muted);
  if(s.weeks.length>5)for(let offset=0;offset<s.weeks.length;offset+=16){
   page("INCLUDED WEEKS",date(s.rangeStart)+" - "+date(s.rangeEnd));identity("Approved weeks in selected range");
   columns("APPROVED WEEKS",218);
   s.weeks.slice(offset,offset+16).forEach((w,i)=>row(date(w.period),date(w.end)+" · Payday "+date(w.payday),w.net,250+i*28));
  }
 }
 for(const w of s.weeks){
  weekly(w);
  // The reference is a single-page slip. Item-level provenance is retained on overflow pages.
  let y=0;
  for(const original of w.items){
   const parts=original.detail.match(/[\s\S]{1,1000}/g)??[""];
   for(let part=0;part<parts.length;part++){
   const item={...original,detail:parts[part]+(part<parts.length-1?" (continued)":"")};
   doc.font("body").fontSize(10);
   const height=Math.max(28,doc.heightOfString(item.detail,{width:400,lineGap:2})+14);
   if(height>410)throw new Error("Payslip detail exceeds printable bounds");
   if(y===0||y+height>735){page("PAY DETAIL",date(w.period)+" - "+date(w.end));identity("Frozen payroll calculation detail");columns("ITEM",218);y=250;}
   text(item.detail,36,y,400,10);if(part===parts.length-1)text(money(item.amount),443,y,116,10,"monoBold",black,"right");
   line(y+height-5,36,523,"#bdbdbd",0.5);y+=height;
   }
  }
 }
 doc.end();return result;
}
