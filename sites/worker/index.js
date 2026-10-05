import {readState,writeState,assetBytes,base64} from './storage.js';
import {kinds,fail,required,get,entries,actions,document,bootstrap,saveDocument,addRevision,validateDocument} from './model.js';

const json=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const user={subject:'public',username:'public',displayName:'Общий редактор',role:'admin',companyIds:[],cjmIds:[]};
const publicRevision=({cjmId,...v},snapshot=false)=>{if(!snapshot)delete v.snapshot;return v;};
async function body(req,max=1900000) {const text=await req.text();if(new TextEncoder().encode(text).length>max)fail('Слишком большой запрос',413);try{return JSON.parse(text);}catch{fail('Некорректный JSON');}}
function imageType(bytes) {
  if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71) return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(String.fromCharCode(...bytes.slice(0,3))==='GIF')return 'image/gif';
  if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
  fail('Допускаются PNG, JPEG, GIF и WebP');
}
async function route(req,env) {
  const url=new URL(req.url), p=url.pathname.split('/').filter(Boolean), method=req.method;
  if(p[0]!=='api')return env.ASSETS.fetch(req);
  if(method!=='GET'&&method!=='HEAD') {
    const origin=req.headers.get('origin');if(origin&&origin!==url.origin)fail('Запрос с другого сайта запрещён',403);
    if(Number(req.headers.get('content-length')??0)>30000000)fail('Слишком большой запрос',413);
  }
  if(p[1]==='health')return json({ok:true,mode:'shared'});
  if(p[1]==='auth') {
    if(p[2]==='config')return json({enabled:false});
    if(p[2]==='me')return json(user);
    return json({ok:true});
  }
  const state=await readState(env),r=state.records,now=new Date().toISOString(),author='Общий редактор';
  const commit=async(value,status=200)=>{await writeState(env,state);return status===204?new Response(null,{status,headers:{'Cache-Control':'no-store'}}):json(value,status);};
  if(p[1]==='bootstrap'||p[1]==='cjms'&&p.length===2&&method==='GET')return json(bootstrap(r));
  if(p[1]==='directories') {
    const kind=p[2],id=p[3];if(!kinds.includes(kind))fail('Справочник не найден',404);
    if(method==='GET')return json(entries(r,kind));
    if(method==='POST'||method==='PUT') {
      const item=await body(req,200000);item.id=method==='POST'?crypto.randomUUID():id;
      item.name=required(item.name,'Название');item.code=required(item.code,'Код',100);
      if(method==='PUT')get(r,kind+':'+id);
      if(kind!=='companies')get(r,'companies:'+item.companyId);
      if(entries(r,kind).some(v=>v.id!==item.id&&v.code===item.code&&(kind==='companies'||v.companyId===item.companyId)))fail('Такой код уже существует');
      if(method==='PUT'&&kind!=='companies'&&r[kind+':'+id].companyId!==item.companyId)fail('Перенос записи между компаниями не поддерживается');
      r[kind+':'+item.id]={id:item.id,code:item.code,name:item.name,description:String(item.description??''),...(kind==='companies'?{}:{companyId:item.companyId})};
      return commit(r[kind+':'+item.id],method==='POST'?201:200);
    }
    if(method==='DELETE') {
      get(r,kind+':'+id);
      if(kind==='companies'&&Object.values(r).some(v=>v.companyId===id))fail('Компания используется в данных');
      if(kind==='actors'&&entries(r,'cjm').some(d=>d.actorId===id))fail('Актор используется в CJM');
      if(['participants','systems'].includes(kind)&&entries(r,'cjm').some(d=>actions(d).some(a=>a.asIs[kind].includes(id)||a.toBe[kind].includes(id))))fail('Запись используется в CJM');
      delete r[kind+':'+id];return commit(null,204);
    }
  }
  if(p[1]==='cjms') {
    const id=p[2];
    if(!id&&method==='POST') {
      const input=await body(req);const newId=crypto.randomUUID();
      const doc={id:newId,name:required(input.name,'Название'),companyId:input.companyId,actorId:input.actorId,createdAt:now,updatedAt:now,createdBy:author,updatedBy:author,rowVersion:1,currentRevision:0,stages:[],links:[],initiatives:[],initiativeLinks:[]};
      validateDocument(r,doc);r['cjm:'+newId]=doc;return commit(document(r,newId),201);
    }
    const doc=document(r,id);
    if(p[3]==='report'&&method==='GET')return json({generatedAt:now,document:doc,directories:bootstrap(r,doc.companyId),comments:entries(r,'comment').filter(c=>actions(doc).some(a=>a.id===c.actionId)),revisions:entries(r,'revision').filter(v=>v.cjmId===id).sort((a,b)=>b.number-a.number).map(v=>publicRevision(v,url.searchParams.get('history')==='1'))});
    if(p[3]==='revisions') {
      const number=Number(p[4]);
      if(p.length===4&&method==='GET')return json(entries(r,'revision').filter(v=>v.cjmId===id).sort((a,b)=>b.number-a.number).map(v=>publicRevision(v)));
      if(p.length===4&&method==='POST') {const input=await body(req);const revision=addRevision(r,id,String(input.comment??'').slice(0,10000),'manual',author,now);return commit(publicRevision(revision),201);}
      const revision=get(r,`revision:${id}:${number}`);
      if(p.length===5&&method==='GET')return json(publicRevision(revision,true));
      if(p[5]==='restore'&&method==='POST') {
        const before=addRevision(r,id,'Перед восстановлением редакции','pre_restore',author,now);
        const restored=structuredClone(revision.snapshot);restored.rowVersion=before.snapshot.rowVersion+1;
        saveDocument(r,restored,author,now);addRevision(r,id,`Восстановление редакции ${number}`,'restore',author,now);
        return commit(document(r,id));
      }
    }
    if(p.length===3) {
      if(method==='GET')return json(doc);
      if(method==='PUT') {const input=await body(req);input.id=id;return commit(saveDocument(r,input,author,now));}
      if(method==='DELETE') {
        // Keep a recoverable snapshot in shared backup records before deleting a map.
        r['deleted:'+id+':'+crypto.randomUUID()]={document:doc,deletedAt:now,comments:entries(r,'comment').filter(c=>actions(doc).some(a=>a.id===c.actionId)),revisions:entries(r,'revision').filter(v=>v.cjmId===id)};
        const actionIds=new Set(actions(doc).map(a=>a.id));
        for(const [key,v] of Object.entries(r)) if(key==='cjm:'+id||key.startsWith('revision:')&&v.cjmId===id||key.startsWith('comment:')&&actionIds.has(v.actionId))delete r[key];
        return commit(null,204);
      }
    }
  }
  if(p[1]==='actions'&&p[3]==='comments') {
    const actionId=p[2],commentId=p[4];if(!entries(r,'cjm').some(d=>actions(d).some(a=>a.id===actionId)))fail('Действие не найдено',404);
    if(method==='GET')return json(entries(r,'comment').filter(c=>c.actionId===actionId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)));
    if(method==='POST') {const input=await body(req);const c={id:crypto.randomUUID(),actionId,author,body:required(input.body,'Комментарий',10000),createdAt:now,updatedAt:now};r['comment:'+c.id]=c;return commit(c,201);}
    const c=get(r,'comment:'+commentId);if(c.actionId!==actionId)fail('Комментарий не найден',404);
    if(method==='PUT') {c.body=required((await body(req)).body,'Комментарий',10000);c.updatedAt=now;return commit(c);}
    if(method==='DELETE'){delete r['comment:'+commentId];return commit(null,204);}
  }
  if(p[1]==='assets') {
    if(method==='GET') {const asset=get(r,'asset:'+p[2]);const bytes=await assetBytes(env,asset);if(!bytes)fail('Изображение не найдено',404);return new Response(bytes,{headers:{'Content-Type':asset.type,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'}});}
    if(method==='POST') {
      const file=(await req.formData()).get('file');if(!file||typeof file==='string')fail('Выберите файл');if(file.size>10000000)fail('Изображение больше 10 МБ',413);
      const bytes=new Uint8Array(await file.arrayBuffer()),type=imageType(bytes),id=crypto.randomUUID(),objectKey='images/'+id;
      await env.FILES.put(objectKey,bytes,{httpMetadata:{contentType:type}});
      r['asset:'+id]={id,name:file.name,size:bytes.length,type,objectKey};return commit({id,url:'/api/assets/'+id,name:file.name,size:bytes.length},201);
    }
  }
  if(p[1]==='backup'&&method==='GET') {
    const assets={};for(const a of entries(r,'asset')){const data=await assetBytes(env,a);if(data)assets[a.id]=base64(data);}
    return json({format:'cjm-studio-sites',version:1,createdAt:now,records:r,assets},200,{'Content-Disposition':`attachment; filename="cjm-studio-${now.slice(0,10)}.json"`});
  }
  if(p[1]==='restore'&&method==='POST') {
    const file=(await req.formData()).get('backup');if(!file||typeof file==='string'||file.size>25000000)fail('Выберите копию JSON до 25 МБ');
    let data;try{data=JSON.parse(await file.text());}catch{fail('Некорректный файл резервной копии');}
    if(data.format!=='cjm-studio-sites'||data.version!==1||!data.records||!data.assets)fail('Нужна резервная копия веб-версии CJM Studio');
    const restored=structuredClone(data.records);
    if(Object.keys(restored).some(key=>!(/^(companies|actors|participants|systems|cjm|initiative|revision|comment|asset|deleted):/.test(key))))fail('Некорректные записи копии');
    for(const d of entries(restored,'cjm'))validateDocument(restored,document(restored,d.id));
    for(const a of entries(restored,'asset')) {
      if(typeof data.assets[a.id]!=='string')fail('В копии отсутствует изображение');
      let bytes;try{bytes=Uint8Array.from(atob(data.assets[a.id]),c=>c.charCodeAt(0));}catch{fail('Повреждённое изображение');}
      a.type=imageType(bytes);a.size=bytes.length;a.objectKey='restores/'+crypto.randomUUID();delete a.seed;
      await env.FILES.put(a.objectKey,bytes,{httpMetadata:{contentType:a.type}});
    }
    // Preserve the pre-restore backup in object storage for recovery.
    await env.FILES.put('backups/before-restore-'+crypto.randomUUID()+'.json',JSON.stringify({format:'cjm-studio-sites',version:1,createdAt:now,records:r}));
    state.records=restored;return commit({ok:true,message:'Общая база восстановлена из резервной копии.'});
  }
  fail('Маршрут не найден',404);
}
export default {async fetch(req,env) {try {return await route(req,env);}catch(error){console.error(error.status?error.message:error);return json({error:error.status?error.message:'Не удалось выполнить запрос. Повторите попытку.'},error.status??500);}}};
