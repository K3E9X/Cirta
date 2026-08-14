import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const ROOT='/home/user/Cirta/dist-web';
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
 const rel=decodeURIComponent(req.url).replace(/^\/Cirta/,'');
 const path=join(ROOT, rel==='/'?'index.html':rel);
 try{const b=await readFile(path);res.writeHead(200,{'Content-Type':T[extname(path)]??'application/octet-stream'});res.end(b);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(8790,r));
const A=process.env.A;
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage(); const errs=[];
p.on('pageerror',e=>errs.push('PAGEERROR '+e));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text())});
p.on('request',r=>{if(!r.url().startsWith('http://localhost:8790'))errs.push('EXTERNE '+r.url())});
await p.goto('http://localhost:8790/Cirta/',{waitUntil:'networkidle'});

const files=['a.pdf','a.docx','a.pptx','a.xlsx','a.odt','a.ods','a.odp','a.svg','a.html','a.md','a.txt','a.py','a.json','a.zip','signed.jpg'];
await p.setInputFiles('#file-input', files.map(f=>`${A}/${f}`));
await p.waitForFunction(n=>document.querySelectorAll('#file-results .card:not(.is-busy)').length===n, files.length, {timeout:30000});

console.log('=== une carte par fichier ===');
for (const card of await p.locator('#file-results .card').all()) {
  const title=(await card.locator('.card-title').textContent())?.trim();
  const badge=await card.locator('.badge').first().textContent().catch(()=>'—');
  const count=await card.locator('.count').textContent().catch(()=>'—');
  const err=await card.locator('.error').textContent().catch(()=>'');
  const hasBtn=await card.locator('.card-foot button').count();
  console.log(`  ${title.padEnd(13)} [${(badge||'—').padEnd(9)}] ${(count||'').padEnd(14)} bouton=${hasBtn} ${err?'ERREUR: '+err.slice(0,60):''}`);
}
console.log('\nrésumé :', (await p.locator('#file-summary .summary-text').textContent())?.trim());

// Nettoyage de chaque carte qui en propose un.
console.log('\n=== téléchargements ===');
for (const card of await p.locator('#file-results .card').all()) {
  if (await card.locator('.card-foot button').count() === 0) continue;
  const title=(await card.locator('.card-title').textContent())?.trim();
  const dl=p.waitForEvent('download',{timeout:15000}).catch(()=>null);
  await card.locator('.card-foot button').click();
  const d=await dl;
  const state=(await card.locator('.card-foot button').textContent())?.trim();
  console.log(`  ${title.padEnd(13)} → ${d?d.suggestedFilename():'AUCUN'} (${state})`);
}
console.log('\nerreurs :', errs.length?errs:'aucune');
await b.close(); server.close();
