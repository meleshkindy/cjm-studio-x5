import worker from '../../worker/index.js';
import {readState,assetBytes,files,seed} from '../../worker/storage.js';

const imageUrls=new Map();
const env={FILES:files,ASSETS:{fetch:async()=>new Response('Not found',{status:404})}};
async function refreshImages() {
  const {records}=await readState();
  for(const [key,asset] of Object.entries(records)) if(key.startsWith('asset:')) {
    const path='/api/assets/'+asset.id;
    const fingerprint=asset.objectKey??asset.seed;
    if(imageUrls.get(path)?.fingerprint===fingerprint)continue;
    const bytes=await assetBytes(env,asset);
    if(bytes){const old=imageUrls.get(path);if(old)URL.revokeObjectURL(old.url);imageUrls.set(path,{fingerprint,url:URL.createObjectURL(new Blob([bytes],{type:asset.type}))});}
  }
}
const ready=refreshImages();
const nativeFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const raw=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const url=new URL(raw,'https://cjm-offline.local/');
  if(url.origin!=='https://cjm-offline.local'||!url.pathname.startsWith('/api/'))return nativeFetch(input,init);
  await ready;
  const request=new Request(url.href,init);
  const response=await worker.fetch(request,env);
  if(response.ok&&request.method!=='GET'&&['/api/assets','/api/restore'].includes(url.pathname))await refreshImages();
  return response;
};
export function imageSource(path) {return imageUrls.get(path)?.url??path;}
function download(blob,name) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export async function exportBackup() {
  const response=await fetch('/api/backup');if(!response.ok)throw Error('Не удалось сформировать копию');
  download(await response.blob(),'CJM-данные-'+new Date().toISOString().slice(0,10)+'.json');
}
export async function portableHtml() {
  const response=await fetch('/api/backup');if(!response.ok)throw Error('Не удалось сформировать копию');
  const backup=await response.json();backup.packageId=crypto.randomUUID();
  const html=document.documentElement.cloneNode(true);
  html.querySelector('#root').replaceChildren();
  html.querySelector('#cjm-offline-data').textContent=JSON.stringify(backup).replaceAll('<','\\u003c');
  return new Blob(['<!doctype html>\n'+html.outerHTML],{type:'text/html;charset=utf-8'});
}
export async function exportHtml() {
  download(await portableHtml(),'CJM-Studio-'+new Date().toISOString().slice(0,10)+'.html');
}
// Exposed only for browser-level verification and portable-document operations.
export const packageId=seed.packageId;
