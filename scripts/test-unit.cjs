/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test launcher, matching scripts/dev.cjs. */
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(p.endsWith('.test.ts')&&!p.endsWith('.db.test.ts'))files.push(p);}}
walk('lib');
const env={...process.env};delete env.DATABASE_URL;delete env.DATABASE_URL_OWNER;delete env.ALLOW_TEST_DATABASE_RESET;
const r=spawnSync(process.execPath,['--test',...files.sort()],{env,stdio:'inherit'});process.exit(r.status??1);
