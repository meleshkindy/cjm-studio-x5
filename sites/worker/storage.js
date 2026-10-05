import seed from './seed.js';

export const conflict = () => Object.assign(new Error('Данные изменены другим посетителем. Откройте карту заново перед сохранением.'),{status:409});
const schema = [
  'CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS state_version (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS write_guard (expected INTEGER)',
  "CREATE TRIGGER IF NOT EXISTS check_version BEFORE INSERT ON write_guard WHEN NEW.expected != (SELECT version FROM state_version WHERE id=1) BEGIN SELECT RAISE(ABORT,'CJM_WRITE_CONFLICT'); END",
];
const initialized = new WeakMap();
export async function initialize(env) {
  if (!initialized.has(env.DB)) initialized.set(env.DB,(async () => {
    await env.DB.batch(schema.map(sql=>env.DB.prepare(sql)));
    const existing = await env.DB.prepare('SELECT version FROM state_version WHERE id=1').first();
    if (existing) return;
    const statements = Object.entries(seed.records).map(([key,value])=>env.DB.prepare('INSERT OR IGNORE INTO records(key,value) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM state_version)').bind(key,JSON.stringify(value)));
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO state_version(id,version) VALUES(1,0)'));
    await env.DB.batch(statements);
  })().catch(error=>{ initialized.delete(env.DB); throw error; }));
  await initialized.get(env.DB);
}
export async function readState(env) {
  await initialize(env);
  // A single SELECT gives a consistent snapshot, including the compare-and-swap version.
  const result = await env.DB.prepare("SELECT key,value FROM records UNION ALL SELECT '$version',CAST(version AS TEXT) FROM state_version WHERE id=1").all();
  const records = {}, original = new Map(); let version;
  for (const {key,value} of result.results) {
    if(key==='$version') version=Number(value);
    else { records[key]=JSON.parse(value); original.set(key,value); }
  }
  return {records,original,version};
}
export async function writeState(env,state) {
  const statements=[env.DB.prepare('INSERT INTO write_guard(expected) VALUES(?)').bind(state.version),env.DB.prepare('DELETE FROM write_guard'),env.DB.prepare('UPDATE state_version SET version=version+1 WHERE id=1')];
  for(const [key,value] of Object.entries(state.records)) {
    const json=JSON.stringify(value);
    if(json!==state.original.get(key)) {
      if(new TextEncoder().encode(json).length>1900000) throw Object.assign(new Error('Запись превышает допустимый размер 1,9 МБ. Разделите карту на несколько CJM.'),{status:413});
      statements.push(env.DB.prepare('INSERT INTO records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,json));
    }
  }
  for(const key of state.original.keys()) if(!(key in state.records)) statements.push(env.DB.prepare('DELETE FROM records WHERE key=?').bind(key));
  try { await env.DB.batch(statements); }
  catch(error) { if(String(error).includes('CJM_WRITE_CONFLICT')) throw conflict(); throw error; }
}
export async function assetBytes(env,asset) {
  if(asset.seed) {
    const base64=seed.assets[asset.seed];
    if(!base64) return null;
    return Uint8Array.from(atob(base64), c=>c.charCodeAt(0));
  }
  const object=await env.FILES.get(asset.objectKey);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}
export function base64(bytes) {
  let text=''; for(let i=0;i<bytes.length;i+=8192) text+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(text);
}
