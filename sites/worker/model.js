export const kinds=['companies','actors','participants','systems'];
export const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export const entries=(records,prefix)=>Object.entries(records).filter(([k])=>k.startsWith(prefix+':')).map(([,v])=>v);
export const required=(value,label,max=1000)=>{if(typeof value!=='string'||!value.trim()||value.length>max) fail(`Некорректное поле: ${label}`);return value.trim();};
export const get=(r,key)=>r[key]??fail('Запись не найдена',404);
export const actions=doc=>doc.stages.flatMap(s=>s.steps.flatMap(p=>p.actions));
export function document(r,id) {
  const doc=structuredClone(get(r,'cjm:'+id));
  doc.initiatives=entries(r,'initiative').filter(i=>i.companyId===doc.companyId);
  return doc;
}
export function bootstrap(r,companyId) {
  const data=Object.fromEntries(kinds.map(kind=>[kind,entries(r,kind).filter(v=>!companyId||(kind==='companies'?v.id:v.companyId)===companyId).sort((a,b)=>a.code.localeCompare(b.code,'ru',{numeric:true}))]));
  data.cjms=entries(r,'cjm').filter(d=>!companyId||d.companyId===companyId).map(d=>({id:d.id,name:d.name,companyId:d.companyId,companyName:r['companies:'+d.companyId]?.name??'',actorId:d.actorId,actorName:r['actors:'+d.actorId]?.name??'',stageCount:d.stages.length,stepCount:d.stages.reduce((n,s)=>n+s.steps.length,0),revision:d.currentRevision,updatedAt:d.updatedAt}));
  return data;
}
export function validateRich(node,depth=0) {
  if(!node||depth>40||!['doc','paragraph','text','heading','bulletList','orderedList','listItem','blockquote','hardBreak','image'].includes(node.type)) fail('Некорректный Rich Text');
  if(node.type==='image'&&!/^\/api\/assets\/[a-zA-Z0-9_-]+$/.test(node.attrs?.src??'')) fail('Некорректное изображение');
  if(node.type==='text'&&typeof node.text!=='string') fail('Некорректный текст');
  for(const mark of node.marks??[]) {
    if(!['bold','italic','underline','strike','link'].includes(mark.type)) fail('Некорректное форматирование');
    if(mark.type==='link') {try {if(!['http:','https:'].includes(new URL(mark.attrs?.href).protocol)) fail('Некорректная ссылка');} catch {fail('Некорректная ссылка');}}
  }
  if(node.content&&!Array.isArray(node.content)) fail('Некорректный Rich Text');
  for(const child of node.content??[]) validateRich(child,depth+1);
}
export function validateDocument(r,d) {
  d.name=required(d.name,'Название CJM');
  get(r,'companies:'+d.companyId);
  if(get(r,'actors:'+d.actorId).companyId!==d.companyId) fail('Актор относится к другой компании');
  for(const field of ['stages','links','initiatives','initiativeLinks']) if(!Array.isArray(d[field])) fail('Некорректная структура CJM');
  if(d.stages.length>50) fail('Допускается до 50 стадий');
  const ids=new Set(), stepOrder=new Map(), actionStep=new Map(), initiativeIds=new Set();
  const id=(node)=>{required(node.id,'ID',200);if(ids.has(node.id))fail('Повторяющийся ID');ids.add(node.id);};
  const otherIds=new Set(entries(r,'cjm').filter(v=>v.id!==d.id).flatMap(v=>v.stages.flatMap(s=>[s.id,...s.steps.flatMap(p=>[p.id,...p.actions.map(a=>a.id)])])));
  for(const [si,s] of d.stages.entries()) {
    id(s); required(s.name,'Стадия'); s.position=si;if(!Array.isArray(s.steps))fail('Некорректные шаги');
    for(const [pi,p] of s.steps.entries()) {
      id(p);required(p.name,'Шаг');p.position=pi;stepOrder.set(p.id,stepOrder.size);if(!Array.isArray(p.actions))fail('Некорректные действия');
      for(const [ai,a] of p.actions.entries()) {
        id(a); required(a.name,'Действие');a.position=ai;actionStep.set(a.id,p.id);
        for(const rich of [a.goal,a.meaning,a.pains,a.asIs?.sequence,a.toBe?.sequence]) {if(rich?.type!=='doc') fail('Некорректный Rich Text');validateRich(rich);}
        for(const state of [a.asIs,a.toBe]) for(const kind of ['participants','systems']) {
          if(!Array.isArray(state[kind])) fail('Некорректные участники или системы');
          for(const ref of state[kind]) if(r[kind+':'+ref]?.companyId!==d.companyId) fail('Участник или система не найдены в компании');
        }
      }
    }
  }
  if([...ids].some(v=>otherIds.has(v))) fail('Узел уже принадлежит другой CJM');
  if(stepOrder.size>500||actionStep.size>5000) fail('Превышено количество шагов или действий');
  const links=new Set();
  for(const l of d.links) {
    id(l);const pair=`${l.sourceId}:${l.targetId}:${l.type}`;
    if(!stepOrder.has(l.sourceId)||!stepOrder.has(l.targetId)||stepOrder.get(l.sourceId)>=stepOrder.get(l.targetId)||!['main','additional','alternative'].includes(l.type)||links.has(pair)) fail('Некорректная или повторяющаяся связь шагов');
    links.add(pair);
  }
  for(const i of d.initiatives) {
    required(i.id,'Инициатива',200);required(i.name,'Инициатива');
    if(initiativeIds.has(i.id)||!['Live','Future','Gap','MVP1','MVP2','MVP3'].includes(i.type)) fail('Некорректная инициатива');
    if((i.companyId&&i.companyId!==d.companyId)||(r['initiative:'+i.id]&&r['initiative:'+i.id].companyId!==d.companyId)) fail('Инициатива относится к другой компании');
    initiativeIds.add(i.id);i.companyId=d.companyId;
  }
  const seen=new Set();
  for(const l of d.initiativeLinks) {
    id(l);const key=`${l.initiativeId}:${l.stepId}:${l.actionId??''}`;
    if(!initiativeIds.has(l.initiativeId)||!stepOrder.has(l.stepId)||(l.actionId&&actionStep.get(l.actionId)!==l.stepId)||seen.has(key)) fail('Некорректная привязка инициативы');
    seen.add(key);
  }
}
export function saveDocument(r,input,author,now) {
  const old=get(r,'cjm:'+input.id);
  if(old.rowVersion!==input.rowVersion) fail('CJM изменена другим посетителем. Откройте её заново перед сохранением.',409);
  if(old.companyId!==input.companyId) fail('Перенос CJM между компаниями не поддерживается');
  validateDocument(r,input);
  const removed=new Set(input.deletedInitiativeIds??[]), changed=new Set();
  for(const id of removed) if(r['initiative:'+id]?.companyId===old.companyId) {delete r['initiative:'+id];changed.add(id);}
  for(const i of input.initiatives) if(!removed.has(i.id)) {if(JSON.stringify(r['initiative:'+i.id])!==JSON.stringify(i)) changed.add(i.id);r['initiative:'+i.id]=i;}
  const retained=new Set(actions(input).map(a=>a.id)), previous=new Set(actions(old).map(a=>a.id));
  for(const [key,c] of Object.entries(r)) if(key.startsWith('comment:')&&previous.has(c.actionId)&&!retained.has(c.actionId)) delete r[key];
  const saved={...input,createdAt:old.createdAt,createdBy:old.createdBy,updatedAt:now,updatedBy:author,rowVersion:old.rowVersion+1,currentRevision:old.currentRevision,initiatives:[],initiativeLinks:input.initiativeLinks.filter(l=>!removed.has(l.initiativeId))};
  delete saved.deletedInitiativeIds;r['cjm:'+saved.id]=saved;
  if(changed.size) for(const other of entries(r,'cjm')) if(other.id!==saved.id&&other.companyId===saved.companyId) {
    other.initiativeLinks=other.initiativeLinks.filter(l=>!removed.has(l.initiativeId));other.rowVersion++;other.updatedAt=now;other.updatedBy=author;
  }
  return document(r,saved.id);
}
export function addRevision(r,id,comment,kind,author,now) {
  const doc=document(r,id);
  const number=Math.max(0,...entries(r,'revision').filter(v=>v.cjmId===id).map(v=>v.number))+1;
  const revision={cjmId:id,number,comment,kind,createdAt:now,createdBy:author,snapshot:doc};
  r[`revision:${id}:${number}`]=revision;
  Object.assign(r['cjm:'+id],{currentRevision:number,rowVersion:doc.rowVersion+1,updatedAt:now,updatedBy:author});
  return revision;
}
