'use strict';
/** Local-only, exact-anchor Phase 3 UI patch; dry run first and auto-backup. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {patchCart,patchConfig,patchSiteUi,patchLoginHtml}=require('./backend/src/unified/phase3UiPatches');
const root=__dirname;
function command(...args){return cp.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();}
try{
  const branch=command('branch','--show-current');
  if(branch!=='feature/hudson-unified-website')throw Error('STOP: Wrong Git branch ('+branch+'). Select feature/hudson-unified-website.');
  const changes=[
    ['assets/js/cart.js',patchCart],
    ['unified/config.js',patchConfig],
    ['unified/site-ui.js',patchSiteUi],
    ['unified/login.html',patchLoginHtml],
  ];
  const plans=[];
  for(const [name,patch] of changes){
    const rel=name.replaceAll('/',path.sep),abs=path.join(root,rel);
    if(!fs.existsSync(abs))throw Error('STOP: Missing '+name);
    const dirty=command('status','--porcelain','--',name);
    if(dirty)throw Error('STOP: '+name+' has uncommitted changes; commit/stash those changes first.');
    const original=fs.readFileSync(abs,'utf8');
    const usesCrLf=original.includes('\r\n');
    const nextLf=patch(original.replace(/\r\n/g,'\n'));
    const next=usesCrLf?nextLf.replace(/\n/g,'\r\n'):nextLf;
    if(next===original)throw Error('STOP: No changes in '+name);
    plans.push({name,abs,original,next});
  }
  if(!fs.existsSync(path.join(root,'unified','phase3-polish.css')) || !fs.existsSync(path.join(root,'unified','phase3-login.css')))throw Error('STOP: Missing Phase 3 stylesheet(s); extract the complete ZIP.');
  const backup=fs.mkdtempSync(path.join(os.tmpdir(),'coffee-overflow-phase3-'));
  for(const p of plans){const target=path.join(backup,p.name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,p.original);}
  let installed=0;
  try{for(const p of plans){fs.writeFileSync(p.abs,p.next);installed++;}}
  catch(e){for(let i=0;i<installed;i++)fs.writeFileSync(plans[i].abs,plans[i].original);throw e;}
  console.log('SUCCESS: Phase 3 local UI patch installed.');
  console.log('Updated only: '+plans.map(p=>p.name).join(', '));
  console.log('Backups: '+backup);
  console.log('Next: node --test backend/src/unified/phase3UiPatches.test.js');
  console.log('No schema, SQL, secrets, backend checkout or admin code changed.');
}catch(e){console.error(e.message);process.exitCode=1;}
