// Applied SQL is immutable. Runs are serialized on a dedicated connection.
import postgres from "postgres";import {readdirSync,readFileSync} from "node:fs";import {createHash} from "node:crypto";
const url=process.env.DATABASE_URL_OWNER;if(!url)throw new Error("DATABASE_URL_OWNER is not set");
if(process.argv.includes("--reset")&&(!new URL(url).pathname.endsWith("_test")||process.env.ALLOW_TEST_DATABASE_RESET!=="1"))throw new Error("Reset is restricted to explicitly enabled disposable *_test databases.");
const sql=postgres(url,{onnotice:()=>{},max:1});const dir=new URL("./migrations/",import.meta.url);
try{
 await sql`select pg_advisory_lock(76239147)`;
 if(process.argv.includes("--reset")){await sql`drop schema public cascade`;await sql`create schema public`;}
 await sql`create table if not exists schema_migrations(version text primary key,applied_at timestamptz not null default now(),checksum text)`;
 await sql`alter table schema_migrations add column if not exists checksum text`;
 const applied=new Map((await sql<{version:string;checksum:string|null}[]>`select version,checksum from schema_migrations`).map(r=>[r.version,r.checksum]));
 let count=0;for(const file of readdirSync(dir).filter(f=>f.endsWith(".sql")).sort()){
 const source=readFileSync(new URL(file,dir),"utf8");const checksum=createHash("sha256").update(source).digest("hex");
 if(applied.has(file)){const old=applied.get(file);if(old&&old!==checksum)throw new Error("Applied migration checksum changed: "+file);
 // Legacy filenames acquire a baseline checksum; this cannot reconstruct pre-baseline edits.
 if(!old)await sql`update schema_migrations set checksum=${checksum} where version=${file}`;continue;}
 await sql.begin(async tx=>{await tx.unsafe(source).simple();await tx`insert into schema_migrations(version,checksum) values(${file},${checksum})`;});console.log("applied "+file);count++;}
 console.log(count?count+" migration(s) applied":"up to date");
}finally{try{await sql`select pg_advisory_unlock(76239147)`;}finally{await sql.end();}}
