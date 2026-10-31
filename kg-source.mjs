const ORIGIN='https://kg.dbapp.ru';
export class SourceError extends Error {
  constructor(kind){super(kind);this.kind=kind;}
}
const idNumber=v=>Number.isSafeInteger(v)&&v>0;
const text=(v,max=80)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
export function exactPower(v){
  if(typeof v==='number' && (!Number.isSafeInteger(v)||v<0))throw new SourceError('data');
  const s=String(v);
  if(!/^\d{1,40}$/.test(s))throw new SourceError('data');
  return BigInt(s).toString();
}
function character(c){
  if(!c||!idNumber(c.id)||!idNumber(c.serverId)||c.deleted)throw new SourceError('missing');
  return {id:c.id,nickname:text(c.nickname),serverId:c.serverId,power:exactPower(c.power),maxPower:exactPower(c.maxPower),
    alliance:c.alliance&&/^[a-f0-9]{16}$/.test(c.alliance.id)?{id:c.alliance.id,label:text(c.alliance.label,16),name:text(c.alliance.name)}:null};
}
function alliance(a){
  if(!a||!/^[a-f0-9]{16}$/.test(a.id)||!idNumber(a.serverId)||a.deleted)throw new SourceError('data');
  return {id:a.id,name:text(a.name),label:text(a.label,16),serverId:a.serverId};
}
export async function source(path,net=fetch){
  if(!/^\/(?:clusters(?:\/\d+)?|server\/\d+\/alliances|character\/\d+|alliance\/[a-f0-9]{16})$/.test(path))throw new SourceError('input');
  const url=ORIGIN+'/api'+path;
  const cache=net===fetch?globalThis.caches?.default:null;
  try{
    const key=new Request(url,{headers:{Accept:'application/ld+json','Accept-Language':'ru'}});
    const saved=cache?await cache.match(key):null;
    // Cloudflare поддерживает manual/follow, но не redirect:error.
    // При manual ответы 3xx отклоняются ниже; чужие адреса не запрашиваются.
    const r=saved ?? await net(url,{headers:{Accept:'application/ld+json','Accept-Language':'ru'},redirect:'manual',signal:AbortSignal.timeout(6000)});
    if(r.status===404)throw new SourceError('missing');
    if(!r.ok)throw new SourceError('unavailable');
    if(!r.headers.get('content-type')?.includes('json'))throw new SourceError('data');
    const reader=r.body.getReader();let count=0;const chunks=[];
    for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>1500000){await reader.cancel();throw new SourceError('data');}chunks.push(value);}
    const bytes=new Uint8Array(count);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    const body=new TextDecoder().decode(bytes);let data;try{data=JSON.parse(body);}catch{throw new SourceError('data');}
    const loadedAt=saved?.headers.get('X-KG-Loaded-At')??new Date().toISOString();
    if(cache&&!saved){try{await cache.put(key,new Response(body,{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=300','X-KG-Loaded-At':loadedAt}}));}catch{/* основной запрос не зависит от кэша */}}
    return {data,loadedAt};
  }catch(e){if(e instanceof SourceError)throw e;throw new SourceError('unavailable');}
}
export async function groups(net){const {data}=await source('/clusters',net);if(!Array.isArray(data)||data.length>100)throw new SourceError('data');return data.map(g=>{if(!idNumber(g.id))throw new SourceError('data');return{id:g.id,name:text(g.name,20),description:text(g.description,80)};});}
export async function servers(group,net){
  const {data}=await source(`/clusters/${group}`,net);
  if(data.id!==group||!Array.isArray(data.segments))throw new SourceError('data');
  const rows=data.segments.flatMap(s=>Array.isArray(s.servers)?s.servers:[]);
  return [...new Map(rows.filter(s=>idNumber(s.id)&&s.online===true).map(s=>[s.id,{id:s.id}])).values()].sort((a,b)=>a.id-b.id);
}
export async function alliances(server,net){
  const {data,loadedAt}=await source(`/server/${server}/alliances`,net);
  if(!Array.isArray(data.alliances)||data.alliances.length>1000)throw new SourceError('data');
  return {rows:data.alliances.filter(a=>!a.deleted).map(alliance).filter(a=>a.serverId===server),loadedAt};
}
export async function player(id,net){const {data,loadedAt}=await source(`/character/${id}`,net);const row=character(data.character);if(row.id!==id)throw new SourceError('data');return {...row,loadedAt};}
export async function members(id,server,net){
  const {data,loadedAt}=await source(`/alliance/${id}`,net);const a=alliance(data.alliance);
  if(a.id!==id||a.serverId!==server||!Array.isArray(data.alliance.members)||data.alliance.members.length>1000)throw new SourceError('data');
  const rows=data.alliance.members.filter(c=>!c.deleted).map(character);
  if(new Set(rows.map(c=>c.id)).size!==rows.length)throw new SourceError('data');
  return {alliance:a,rows,loadedAt};
}
