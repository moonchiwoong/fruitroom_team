// Keep Next and Playwright in one process tree/network namespace.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../..');
const out=resolve(here,'artifacts');
await mkdir(out,{recursive:true});
const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://review.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_local_test_only'};
const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3000'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',d=>{logs+=d;});server.stderr.on('data',d=>{logs+=d;});
let ready=false,exitCode=1;
try {
  for(let i=0;i<100;i++) {
    if(server.exitCode!==null)throw new Error(`Next exited: ${server.exitCode}\n${logs}`);
    try{const response=await fetch('http://127.0.0.1:3000/');if(response.status===200){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,700));
  }
  if(!ready)throw new Error(`Next did not become ready\n${logs}`);
  exitCode=0;
  for(const script of (process.env.UI_TEST_SCRIPT||'run-ui.mjs,run-auth-switch.mjs,run-measurement-ui.mjs,run-ai-ui.mjs').split(',')) {
    const code=await new Promise((finish,reject)=>{
      const child=spawn(process.execPath,[resolve(here,script)],{cwd:root,env,stdio:'inherit'});
      child.once('error',reject);child.once('exit',code=>finish(code??1));
    });
    if(code)exitCode=code;
  }
} catch(e){console.error(e);}
finally{server.kill('SIGTERM');await writeFile(resolve(out,'next-test-server.log'),logs);}
process.exitCode=exitCode;
