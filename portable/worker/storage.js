export const seed = JSON.parse(document.getElementById('cjm-offline-data').textContent);
let opening;
export function database() {
  if(!opening) opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open('cjm-portable-'+seed.packageId,1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('state');request.result.createObjectStore('files');};
    request.onerror=()=>reject(new Error('Браузер не разрешил локальное хранилище. Откройте HTML в обычном окне Chrome или Edge.'));
    request.onsuccess=()=>resolve(request.result);
  });
  return opening;
}
export async function readState() {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('state','readwrite'),store=tx.objectStore('state');let result;
    const request=store.get('current');
    request.onsuccess=()=>{
      result=request.result??{version:0,records:structuredClone(seed.records)};
      if(!request.result)store.put(result,'current');
    };
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(tx.error??new Error('Не удалось прочитать локальные данные'));
  });
}
export async function writeState(env,state) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('state','readwrite'),store=tx.objectStore('state');let conflict=false;
    const request=store.get('current');
    request.onsuccess=()=>{
      if(request.result.version!==state.version){conflict=true;tx.abort();return;}
      store.put({version:state.version+1,records:state.records},'current');
    };
    tx.oncomplete=()=>resolve();
    tx.onabort=()=>reject(Object.assign(new Error(conflict?'Данные изменены в другой вкладке. Откройте карту заново.':'Не удалось сохранить. Возможно, закончилось место в хранилище браузера.'),{status:conflict?409:507}));
  });
}
export const files={
  async put(key,value,options) {
    const db=await database();const blob=value instanceof Blob?value:new Blob([value],{type:options?.httpMetadata?.contentType??'application/octet-stream'});
    await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(blob,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  },
  async get(key) {
    const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('files'),request=tx.objectStore('files').get(key);request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);});
  },
};
export async function assetBytes(env,asset) {
  // Bundled backups can refer to an R2 key; their bytes are embedded in this HTML.
  const object=asset.objectKey?await files.get(asset.objectKey):null;
  if(object)return new Uint8Array(await object.arrayBuffer());
  const value=seed.assets[asset.id]??seed.assets[asset.seed];
  return value?Uint8Array.from(atob(value),c=>c.charCodeAt(0)):null;
}
export function base64(bytes) {
  let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);
}
