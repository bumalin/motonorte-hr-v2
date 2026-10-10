export function validRange(start:string,end:string):boolean{
 const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 return date(start)&&date(end)&&end>=start&&(Date.parse(end)-Date.parse(start))/86400000<=366;
}
