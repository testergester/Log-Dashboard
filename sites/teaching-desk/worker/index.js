import {extractionDraft} from '../src/timetable-format.js';
import {extractionPrompt} from './prompt.js';
import assets from './assets.generated.js';

const failure=(status,message)=>Object.assign(new Error(message),{status});
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
let keyCache;
async function verify(token,project){
  try{
    const parts=token.split('.');if(parts.length!==3)throw Error();
    const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const now=Date.now()/1000;
    if(header.alg!=='RS256'||!header.kid||claims.aud!==project||claims.iss!=='https://securetoken.google.com/'+project||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>128||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+60||!Number.isFinite(claims.auth_time)||claims.auth_time>now+60)throw Error();
    const fetchKeys=async()=>{
      const r=await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');if(!r.ok)throw Error();
      keyCache={keys:(await r.json()).keys,until:Date.now()+3600000};
    };
    if(!keyCache||keyCache.until<Date.now())await fetchKeys();
    let jwk=keyCache.keys.find(k=>k.kid===header.kid);
    if(!jwk){await fetchKeys();jwk=keyCache.keys.find(k=>k.kid===header.kid);}
    if(!jwk)throw Error();
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error();
    if(claims.firebase?.sign_in_provider!=='google.com')throw Error();
    return claims.sub;
  }catch{throw failure(401,'Your sign-in expired. Please sign in again.');}
}
const usage=new Map(),active=new Set();
async function extract(request,env){
  let uid,acquired=false;
  try{
    if(request.method!=='POST')throw failure(405,'Use POST to read a timetable image.');
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)throw failure(403,'Open image import from this dashboard.');
    if(!request.headers.get('content-type')?.startsWith('application/json'))throw failure(415,'Send an image as JSON.');
    const token=/^Bearer (.+)$/.exec(request.headers.get('authorization')||'')?.[1];
    if(!token)throw failure(401,'Please sign in before importing a timetable.');
    uid=await verify(token,env.FIREBASE_PROJECT_ID);
    if(!env.DEEPSEEK_API_KEY)throw failure(503,'Timetable image reading is not configured on the server.');
    const now=Date.now();for(const [id,b] of usage)if(b.until<now)usage.delete(id);
    const bucket=usage.get(uid)||{count:0,until:now+3600000};
    if(active.has(uid)||active.size>=5||bucket.count>=12)throw failure(429,'Image reading is busy or your hourly limit was reached. Try again later.');
    active.add(uid);acquired=true;
    const reader=request.body?.getReader();if(!reader)throw failure(400,'Select a timetable image.');
    const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12*1024*1024){await reader.cancel();throw failure(413,'Choose an image smaller than 8 MB.');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let input;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{throw failure(400,'Invalid image request.');}
    const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.image||'');
    if(!match)throw failure(400,'Use a PNG, JPEG or WebP image.');
    const image=decode(match[2]);if(image.length>8*1024*1024)throw failure(413,'Choose an image smaller than 8 MB.');
    const magic=match[1]==='png'?[137,80,78,71,13,10,26,10].every((v,i)=>image[i]===v):match[1]==='jpeg'?image[0]===255&&image[1]===216&&image[2]===255:new TextDecoder().decode(image.slice(0,4))==='RIFF'&&new TextDecoder().decode(image.slice(8,12))==='WEBP';
    if(!magic)throw failure(400,'The image format does not match its contents.');
    bucket.count++;usage.set(uid,bucket);
    const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',signal:AbortSignal.timeout(90000),headers:{Authorization:'Bearer '+env.DEEPSEEK_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-flash',thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:8192,messages:[{role:'system',content:extractionPrompt},{role:'user',content:[{type:'text',text:'Read this timetable image and return the timetable JSON.'},{type:'image_url',image_url:{url:input.image,detail:'original'}}]}]})});
    if(!response.ok){await response.body?.cancel();throw failure(502,response.status===402?'DeepSeek has insufficient API balance. Add API credits to use image import.':'DeepSeek could not read the image. Please try again.');}
    const choice=(await response.json()).choices?.[0];if(choice?.finish_reason!=='stop')throw failure(422,'The timetable response was incomplete. Try a clearer image.');
    let draft;try{draft=extractionDraft(JSON.parse(choice.message.content));}catch{throw failure(422,'DeepSeek returned an invalid timetable. Try a clearer image.');}
    return json(200,draft);
  }catch(e){return json(e.status||502,{error:e.status?e.message:e.name==='TimeoutError'?'Image reading timed out. Try a smaller or clearer image.':'Image reading is unavailable. Please try again.'});}
  finally{if(acquired)active.delete(uid);}
}
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/timetable/extract')return extract(request,env);
  if(url.pathname==='/healthz')return json(200,{status:'ok'});
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const asset=assets[url.pathname==='/'?'/index.html':url.pathname];
  if(!asset)return new Response('Not found',{status:404});
  return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)),{headers:{'Content-Type':asset.type,'X-Content-Type-Options':'nosniff','Cache-Control':url.pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'}});
}};
