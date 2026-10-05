import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../worker/index.js';
import {readState,writeState} from '../worker/storage.js';
import {document as loadDocument,validateDocument} from '../worker/model.js';

function environment() {
  const db=new DatabaseSync(':memory:');
  class Statement {
    constructor(sql,values=[]) {this.sql=sql;this.values=values;}
    bind(...values){return new Statement(this.sql,values);}
    async first(){return db.prepare(this.sql).get(...this.values)??null;}
    async all(){return {results:db.prepare(this.sql).all(...this.values)};}
    async run(){return {meta:db.prepare(this.sql).run(...this.values)};}
  }
  const objects=new Map();
  return {DB:{prepare:sql=>new Statement(sql),async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}},FILES:{async put(key,value){objects.set(key,value);},async get(key){const v=objects.get(key);return v==null?null:{arrayBuffer:async()=>typeof v==='string'?new TextEncoder().encode(v):v};}},ASSETS:{fetch:async()=>new Response('frontend')}};
}
const call=async(env,path,method='GET',body)=>{
  const response=await worker.fetch(new Request('https://cjm.test'+path,{method,...(body?{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}:{})}),env);
  const result=response.status===204?null:await response.json();return {status:response.status,data:result};
};
async function setup() {
  const env=environment();
  const company=(await call(env,'/api/directories/companies','POST',{code:'TEST',name:'Компания теста'})).data;
  const actor=(await call(env,'/api/directories/actors','POST',{code:'ACT',name:'Актор теста',companyId:company.id})).data;
  const doc=(await call(env,'/api/cjms','POST',{name:'Тестовая карта',companyId:company.id,actorId:actor.id})).data;
  assert.ok(doc.id);return {env,doc,company,actor};
}
const rich={type:'doc',content:[{type:'paragraph'}]};
const action=id=>({id,name:'Действие',position:0,description:'',goal:rich,meaning:rich,pains:rich,openQuestions:'',asIs:{participants:[],systems:[],sequence:rich},toBe:{participants:[],systems:[],sequence:rich}});
test('anonymous visitors share persisted CJMs and stale writes are rejected',async()=>{
  const {env,doc}=await setup();
  assert.equal((await call(env,'/api/auth/config')).data.enabled,false);
  const second=(await call(env,'/api/cjms/'+doc.id)).data;
  doc.name='Правка первого';assert.equal((await call(env,'/api/cjms/'+doc.id,'PUT',doc)).status,200);
  second.name='Устаревшая правка';assert.equal((await call(env,'/api/cjms/'+doc.id,'PUT',second)).status,409);
  assert.equal((await call(env,'/api/cjms/'+doc.id)).data.name,'Правка первого');
  const a=await readState(env),b=await readState(env);a.records['companies:lock']={id:'lock',name:'Lock',code:'LOCK'};await writeState(env,a);
  b.records['companies:wrong']={id:'wrong'};await assert.rejects(()=>writeState(env,b),{status:409});
  assert.equal((await readState(env)).records['companies:wrong'],undefined);
});
test('revision restore creates safety history, reports have consistent snapshots',async()=>{
  const {env,doc}=await setup();
  const rev=await call(env,`/api/cjms/${doc.id}/revisions`,'POST',{comment:'Исходная'});assert.equal(rev.status,201);
  const latest=(await call(env,'/api/cjms/'+doc.id)).data;latest.name='Новое имя';await call(env,'/api/cjms/'+doc.id,'PUT',latest);
  const restored=await call(env,`/api/cjms/${doc.id}/revisions/1/restore`,'POST');assert.equal(restored.status,200);assert.equal(restored.data.name,'Тестовая карта');
  const report=(await call(env,`/api/cjms/${doc.id}/report?history=1`)).data;
  assert.equal(report.revisions.length,3);assert.ok(report.revisions.every(v=>v.snapshot));assert.equal(report.document.currentRevision,3);
});
test('shared company initiatives invalidate other open CJMs and persist across reloads',async()=>{
  const {env,doc,company,actor}=await setup();
  const other=(await call(env,'/api/cjms','POST',{name:'Другая',companyId:company.id,actorId:actor.id})).data;
  doc.initiatives=[{id:'initiative-test',companyId:company.id,name:'Общая',type:'Gap',description:''}];
  assert.equal((await call(env,'/api/cjms/'+doc.id,'PUT',doc)).status,200);
  const refreshed=(await call(env,'/api/cjms/'+other.id)).data;assert.equal(refreshed.initiatives[0].name,'Общая');assert.ok(refreshed.rowVersion>other.rowVersion);
  assert.equal((await call(env,'/api/cjms/'+other.id,'PUT',other)).status,409);
});
test('invalid structure is rejected and deleting actions prunes their comments',async()=>{
  const {env,doc}=await setup();doc.stages=[{id:'stage-test',name:'Стадия',description:'',position:0,steps:[{id:'step-test',name:'Шаг',description:'',position:0,actions:[action('action-test')]}]}];
  const saved=(await call(env,'/api/cjms/'+doc.id,'PUT',doc)).data;
  assert.equal((await call(env,'/api/actions/action-test/comments','POST',{body:'Комментарий'})).status,201);
  const invalid=structuredClone(saved);invalid.links=[{id:'bad',sourceId:'step-test',targetId:'step-test',type:'main'}];assert.equal((await call(env,'/api/cjms/'+doc.id,'PUT',invalid)).status,400);
  saved.stages[0].steps[0].actions=[];assert.equal((await call(env,'/api/cjms/'+doc.id,'PUT',saved)).status,200);
  assert.equal((await call(env,`/api/cjms/${doc.id}/report`)).data.comments.length,0);
});
test('image upload and backup restore retain binary data and reject unsafe image types',async()=>{
  const {env,doc}=await setup();const png=Uint8Array.from([137,80,78,71,13,10,26,10]);
  const form=new FormData();form.append('file',new Blob([png],{type:'image/png'}),'test.png');
  const uploaded=await worker.fetch(new Request('https://cjm.test/api/assets',{method:'POST',body:form}),env);assert.equal(uploaded.status,201);const image=await uploaded.json();
  const copy=(await call(env,'/api/backup')).data;assert.ok(copy.assets[image.id]);
  doc.name='Изменённая';await call(env,'/api/cjms/'+doc.id,'PUT',doc);
  const restore=new FormData();restore.append('backup',new Blob([JSON.stringify(copy)]),'backup.json');
  const result=await worker.fetch(new Request('https://cjm.test/api/restore',{method:'POST',body:restore}),env);assert.equal(result.status,200);
  assert.equal((await call(env,'/api/cjms/'+doc.id)).data.name,'Тестовая карта');
  const response=await worker.fetch(new Request('https://cjm.test'+image.url),env);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),png);
  const unsafe=new FormData();unsafe.append('file',new Blob(['<svg></svg>'],{type:'image/svg+xml'}),'x.svg');
  assert.equal((await worker.fetch(new Request('https://cjm.test/api/assets',{method:'POST',body:unsafe}),env)).status,400);
});
test('cross-origin writes fail, imported CJMs validate, and seed never resurrects deleted data',async()=>{
  const {env,doc}=await setup();
  const result=await worker.fetch(new Request('https://cjm.test/api/cjms',{method:'POST',headers:{Origin:'https://other.test'},body:'{}'}),env);assert.equal(result.status,403);
  const state=await readState(env);for(const [key,value] of Object.entries(state.records))if(key.startsWith('cjm:'))validateDocument(state.records,loadDocument(state.records,value.id));
  assert.equal((await call(env,'/api/cjms/'+doc.id,'DELETE')).status,204);
  assert.equal((await call(env,'/api/cjms/'+doc.id)).status,404);
  assert.ok(Object.keys((await readState(env)).records).some(key=>key.startsWith('deleted:'+doc.id)));
});
