"use client";
import Link from "next/link";import {useEffect,useState} from "react";
export function RequestNotification({initial}:{initial:number}){const [count,setCount]=useState(initial);useEffect(()=>{let active=true;const timer=setInterval(async()=>{if(document.hidden)return;try{const r=await fetch("/requests/count",{cache:"no-store"});if(r.ok){const v=await r.json();if(active)setCount(v.count);}}catch{}},30000);return()=>{active=false;clearInterval(timer);};},[]);return <Link href="/requests" className="text-sm" aria-live="polite">Requests {count>0?`(${count} pending)`:""}</Link>;}
