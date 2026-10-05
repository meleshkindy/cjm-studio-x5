import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
const root='http://127.0.0.1:8080';
const read=async path=>{const response=await fetch(root+path);if(!response.ok)throw Error(`${path}: ${response.status}`);return response.json();};
await fs.mkdir('artifacts',{recursive:true});
const backup=await fetch(root+'/api/backup');if(!backup.ok)throw Error('Local backup failed');
await fs.writeFile('artifacts/local-before-sites.sqlite',Buffer.from(await backup.arrayBuffer()));
const data={records:{},assets:{}};
const initial=await read('/api/bootstrap');
for(const kind of ['companies','actors','participants','systems'])for(const item of initial[kind])data.records[kind+':'+item.id]=item;
for(const cjm of initial.cjms) {
  const report=await read(`/api/cjms/${cjm.id}/report?history=1`),doc=report.document;
  for(const i of doc.initiatives)data.records['initiative:'+i.id]=i;
  data.records['cjm:'+doc.id]={...doc,initiatives:[]};
  for(const c of report.comments)data.records['comment:'+c.id]=c;
  for(const v of report.revisions)data.records[`revision:${doc.id}:${v.number}`]={...v,cjmId:doc.id};
}
const db=new DatabaseSync('artifacts/local-before-sites.sqlite',{readOnly:true});
for(const asset of db.prepare('SELECT id,name,content_type,size,data FROM rich_text_assets').all()) {
  data.records['asset:'+asset.id]={id:asset.id,name:asset.name,type:asset.content_type,size:asset.size,seed:asset.id};
  data.assets[asset.id]=Buffer.from(asset.data).toString('base64');
}
db.close();
await fs.writeFile('worker/seed.js','export default '+JSON.stringify(data)+';\n');
console.log(JSON.stringify({cjms:initial.cjms.length,records:Object.keys(data.records).length,assets:Object.keys(data.assets).length,bytes:JSON.stringify(data).length}));
