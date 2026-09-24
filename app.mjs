import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBookingReader, parseIntent, containsSensitive, BookingUnavailable } from './booking.mjs';
import { formatWithHermes, deterministic } from './hermes.mjs';

import { productPage } from './product-format.mjs';
import { runWorkflow, runCatalogWorkflow, interpret, interpretCatalog } from './workflow.mjs';

const DAY = 86400000;
const HELP = '/bk <BK...> ดูสถานะและจำนวนผู้เดินทาง\n/tour <รหัสทัวร์> ดูจำนวนจองและยอดคนแยกตามสถานะ\nส่งรหัสทัวร์พร้อม “จองแล้วกี่ที่” ได้โดยตรง\n/search <จุดหมาย> <เดือน/ฤดูกาล/ช่วงวันที่> [จำนวนคน]\nค้นได้ตามประเทศและเส้นทางที่มีในเว็บไซต์ เช่น “ปักกิ่ง ปีใหม่ จอง 5 ที่” “โปรแกรม ฉงชิ่ง ต.ค. จอง 5 ที่” หรือ “โอซาก้า เดือนหน้า 2 ที่”\nพิมพ์ “เปลี่ยนเป็น ต.ค.” “เอา 4 คน” หรือ “ดูต่อ” เพื่อต่อจากผลล่าสุด\nเจ้าของส่ง /invite เพื่อเพิ่มแชตส่วนตัวที่ได้รับอนุญาต\n/privacy ดูการใช้ข้อมูล\nยอดเงิน กำหนดชำระ ตรวจข้อมูลขาด และแจ้งเตือน ยังไม่เปิดให้บริการ';
const PRIVACY = 'รุ่นนี้โบโบ้อ่านเฉพาะรหัส สถานะ และยอดคนที่อนุญาต แล้วตอบด้วยข้อความรูปแบบคงที่ ไม่ส่งข้อมูลไปยังโมเดลภายนอก ไม่ส่งชื่อ เลขเอกสาร หรือข้อมูลติดต่อ เก็บข้อความไม่เกิน 30 วัน และไม่แก้ไขบุ๊กกิ้ง';
const SENSITIVE = 'เพื่อความปลอดภัย กรุณาอย่าส่งชื่อผู้เดินทาง เลขพาสปอร์ต เลขบัตร โทรศัพท์ หรืออีเมล ส่งเฉพาะรหัส BK หรือรหัสทัวร์ค่ะ';
const HANDOFF = 'รายการนี้ต้องให้พนักงานดำเนินการและกดบันทึกเองในเว็บไซต์ โบโบ้จะไม่ยกเลิก ยืนยัน อนุมัติจ่ายเงิน ลบผู้เดินทาง หรือตีพิมพ์เอกสาร';
const UNKNOWN = 'ยังไม่เข้าใจคำขอนี้ ส่ง /help เพื่อดูรูปแบบที่รองรับ';
const JOINED = 'เชื่อมบัญชี LINE นี้กับโบโบ้แล้วค่ะ ส่ง /help เพื่อดูคำสั่งได้เลย';
const JOIN_FAILED = 'รหัสเชิญไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอรหัสใหม่จากผู้ดูแลค่ะ';
const tokenState=new WeakMap();

const ids = value => String(value || '').split(',').map(v=>v.trim()).filter(Boolean);
export function configFromEnv(env=process.env) {
  const config={ secret:env.LINE_CHANNEL_SECRET,channelId:env.LINE_CHANNEL_ID,token:env.LINE_CHANNEL_ACCESS_TOKEN,botId:env.LINE_BOT_USER_ID,
    owner:env.PILOT_OWNER_ID,staff:ids(env.PILOT_STAFF_IDS),group:env.PILOT_GROUP_ID,
    host:env.HOST||'127.0.0.1',port:Number(env.PORT||3212),dataDir:resolve(env.BOBO_DATA_DIR||'./data'),
    baseUrl:(env.B2B_BASE_URL||'https://www.qualityb2bpackage.com').replace(/\/$/,''), storageState:env.B2B_STORAGE_STATE,
    workflowEnabled:env.BOBO_WORKFLOW_ENABLED==='true',catalogRouterEnabled:env.BOBO_CATALOG_ROUTER_ENABLED==='true',
    bookingVerified:env.B2B_LIVE_VERIFIED==='true',
    productSearchVerified:env.B2B_PRODUCT_SEARCH_VERIFIED==='true',
    fixtureFile:env.B2B_FIXTURE_FILE,openaiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-4.1',
    hermesPython:env.BOBO_HERMES_PYTHON,hermesSource:env.BOBO_HERMES_SOURCE,runtimeDir:env.BOBO_RUNTIME_DIR||'/run/qualityb2b-bobo' };
  for(const key of ['secret','channelId','botId','owner']) if(!config[key]?.trim()) throw Error(`Missing ${key}`);
  if(!/^\d+$/.test(config.channelId))throw Error('Invalid LINE channel ID');
  for(const id of [config.botId,config.owner,...config.staff]) if(!/^U[0-9a-f]{32}$/.test(id)) throw Error('Invalid LINE user ID');
  if(config.group && !/^C[0-9a-f]{32}$/.test(config.group)) throw Error('Invalid LINE group ID');
  if(!Number.isInteger(config.port)||config.port<1||config.port>65535) throw Error('Invalid port');
  return config;
}

export function validSignature(body,signature,secret){
  if(typeof signature!=='string') return false;
  const expected=Buffer.from(createHmac('sha256',secret).update(body).digest('base64'));
  const actual=Buffer.from(signature);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}

export async function getAccessToken(config,fetcher=fetch){
  if(config.token)return config.token;
  const cached=tokenState.get(config);if(cached?.token&&Date.now()<cached.expires-60000)return cached.token;
  if(cached?.issuing)return cached.issuing;
  const issuing=(async()=>{const response=await fetcher('https://api.line.me/v2/oauth/accessToken',{method:'POST',signal:AbortSignal.timeout(8000),
    headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:config.channelId,client_secret:config.secret})});
    if(!response.ok)throw Error(`LINE token HTTP ${response.status}`);const data=await response.json();if(!data.access_token||!(data.expires_in>0))throw Error('Invalid LINE token response');
    tokenState.set(config,{token:data.access_token,expires:Date.now()+data.expires_in*1000});return data.access_token;})();
  tokenState.set(config,{issuing});try{return await issuing;}catch(error){tokenState.delete(config);throw error;}
}

export async function push(config,to,retryKey,text,fetcher=fetch){
  const messages=(Array.isArray(text)?text:[text]).map(text=>({type:'text',text}));
  if(!messages.length||messages.length>3||messages.some(m=>typeof m.text!=='string'||!m.text.length||m.text.length>4500))throw Error('Invalid LINE message size');
  const token=await getAccessToken(config,fetcher);
  const response=await fetcher('https://api.line.me/v2/bot/message/push',{method:'POST',signal:AbortSignal.timeout(8000),
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Line-Retry-Key':retryKey},
    body:JSON.stringify({to,messages})});
  if(response.ok||(response.status===409&&response.headers.get('x-line-accepted-request-id'))) return;
  const error=Error(`LINE push HTTP ${response.status}`); error.permanent=response.status<500&&response.status!==429; throw error;
}

function addressed(event,config,known=false){
  const source=event.source||{};
  if(source.type==='user') return known;
  if(source.type!=='group'||source.groupId!==config.group||![config.owner,...config.staff].includes(source.userId)) return false;
  const text=event.message?.text?.trim()||'';
  return text.startsWith('/')||event.message?.mention?.mentionees?.some(m=>m.isSelf===true&&(!m.userId||m.userId===config.botId));
}
const destination = event => event.source.type==='group' ? event.source.groupId : event.source.userId;
function authorizedSource(event,config){
  return event?.source?.type==='user' && [config.owner,...config.staff].includes(event.source.userId)
    || event?.source?.type==='group' && Boolean(config.group) && event.source.groupId===config.group && [config.owner,...config.staff].includes(event.source.userId);
}
const prohibited = text => /ยกเลิก|ยืนยัน|อนุมัติ(?:การ)?จ่าย|ชำระเงินครบถ้วนแล้ว|ลบ(?:ผู้เดินทาง|ลูกค้า)|ลดจำนวน|พิมพ์|ออกเอกสาร|cancel|confirm|mark paid|delete|print/i.test(text);
const bangkokDate = time => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
export function deadlineTime(value){
  if(!value)return NaN;
  const thai=/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/.exec(value);
  return thai?Date.parse(`${thai[3]}-${thai[2]}-${thai[1]}T${thai[4]}:${thai[5]}:00+07:00`):Date.parse(value);
}

export function createApp(config,{clock=Date.now,timers=true,reader=createBookingReader(config,{clock}),format=formatWithHermes,send=push,planner=interpret,catalogPlanner=interpretCatalog,dbPath}={}){
  mkdirSync(config.dataDir,{recursive:true,mode:0o700});
  const db=new DatabaseSync(dbPath||resolve(config.dataDir,'bobo.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,message_id TEXT,source_id TEXT,received INTEGER NOT NULL,status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,message_id TEXT NOT NULL,target TEXT NOT NULL,text TEXT NOT NULL,received INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',answer TEXT NOT NULL DEFAULT '',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS alerts(key TEXT PRIMARY KEY,target TEXT NOT NULL,created INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',answer TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS unsent(source TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(source,message_id));
    CREATE TABLE IF NOT EXISTS notices(key TEXT PRIMARY KEY,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS contexts(scope TEXT PRIMARY KEY,target TEXT NOT NULL,payload TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS plans(job_id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dependencies(job_id TEXT NOT NULL,target TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(job_id,target,message_id));
    CREATE TABLE IF NOT EXISTS product_catalog(key TEXT PRIMARY KEY,scope TEXT NOT NULL,label TEXT NOT NULL,country TEXT NOT NULL,menu TEXT NOT NULL,route TEXT NOT NULL,fetched INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS catalog_meta(id INTEGER PRIMARY KEY CHECK(id=1),version TEXT NOT NULL,refreshed INTEGER NOT NULL,session_version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflow_metrics(stage TEXT PRIMARY KEY,count INTEGER NOT NULL,last_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS authorized_users(user_id TEXT PRIMARY KEY,created INTEGER NOT NULL,created_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
    UPDATE jobs SET status='pending' WHERE status='processing';`);
  let busy=false,closing=false;
  const active=new Map();
  const inviteHash=code=>createHash('sha256').update(`qualityb2b-bobo:${code}`).digest('hex');
  const isAuthorized=userId=>[config.owner,...config.staff].includes(userId)||Boolean(db.prepare('SELECT 1 FROM authorized_users WHERE user_id=?').get(userId));
  const metric=stage=>db.prepare('INSERT INTO workflow_metrics VALUES(?,1,?) ON CONFLICT(stage) DO UPDATE SET count=count+1,last_at=excluded.last_at').run(stage,clock());
  const cachedCatalog=()=>db.prepare('SELECT key,scope,label,country,menu,route FROM product_catalog ORDER BY key').all();
  const catalogMeta=()=>db.prepare('SELECT version,refreshed,session_version sessionVersion FROM catalog_meta WHERE id=1').get();
  async function ensureCatalog(force=false,signal=AbortSignal.timeout(90000)){
    const meta=catalogMeta(),health=reader.health?.()||{};let currentSession='';try{currentSession=String(statSync(config.storageState).mtimeMs);}catch{}
    if(!force&&meta?.version.startsWith('2:')&&clock()-meta.refreshed<6*3600000&&(!currentSession||currentSession===meta.sessionVersion)){const entries=cachedCatalog();if(entries.length)return {entries,version:meta.version,refreshed:meta.refreshed};}
    const result=await reader.product_catalog({signal}),version=`2:${clock()}`;
    db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM product_catalog').run();const insert=db.prepare('INSERT INTO product_catalog VALUES(?,?,?,?,?,?,?)');for(const entry of result.entries)insert.run(entry.key,entry.scope,entry.label,entry.country||'',entry.menu||'',entry.route||'',clock());db.prepare('INSERT OR REPLACE INTO catalog_meta VALUES(1,?,?,?)').run(version,clock(),result.sessionVersion||health.sessionVersion||'');db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    return {entries:result.entries,version,refreshed:clock()};
  }
  function savedContext(scope){const row=db.prepare('SELECT payload FROM contexts WHERE scope=? AND expires>?').get(scope,clock());return row?JSON.parse(row.payload):null;}
  function check(job,signal){signal?.throwIfAborted();if(job&&db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id)?.status!=='processing')throw Error('Cancelled');}
  function enqueue(event){
    if(typeof event?.webhookEventId!=='string'||!Number.isFinite(event.timestamp)) return;
    const privateJoin=event?.source?.type==='user'&&event?.type==='message'&&event.message?.type==='text'&&/^\/join\s+[A-Z0-9]{8}$/i.test(event.message.text.trim());
    const known=event?.source?.type==='user'?isAuthorized(event.source.userId):authorizedSource(event,config);
    if(!known&&!privateJoin)return;
    if(db.prepare('SELECT 1 FROM events WHERE id=?').get(event.webhookEventId)) return;
    if(event.timestamp<clock()-20*60000||event.timestamp>clock()+60000) return;
    if(event.type==='unsend'&&typeof event.unsend?.messageId==='string'){
      db.exec('BEGIN IMMEDIATE'); try{
        db.prepare('INSERT OR IGNORE INTO unsent VALUES(?,?)').run(destination(event),event.unsend.messageId);
        const target=destination(event),messageId=event.unsend.messageId;
        const affected=db.prepare('SELECT job_id FROM dependencies WHERE target=? AND message_id=?').all(target,messageId);
        for(const row of affected){active.get(row.job_id)?.abort();db.prepare("UPDATE jobs SET status='cancelled',text='',answer='' WHERE id=?").run(row.job_id);db.prepare('DELETE FROM plans WHERE job_id=?').run(row.job_id);}
        db.prepare("UPDATE jobs SET status='cancelled',text='',answer='' WHERE message_id=? AND target=?").run(messageId,target);
        for(const row of db.prepare('SELECT scope,payload FROM contexts WHERE target=?').all(target))if(JSON.parse(row.payload).sources.includes(messageId))db.prepare('DELETE FROM contexts WHERE scope=?').run(row.scope);
        db.prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(event.webhookEventId,event.unsend.messageId,event.source?.userId||event.source?.groupId||'',clock(),'unsent'); db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;} return;
    }
    if(event.type!=='message'||event.message?.type!=='text'||typeof event.message.text!=='string'||typeof event.message.id!=='string'||!addressed(event,config,known||privateJoin)) return;
    if(db.prepare('SELECT 1 FROM unsent WHERE source=? AND message_id=?').get(destination(event),event.message.id)
      ||db.prepare('SELECT 1 FROM jobs WHERE message_id=? AND target=?').get(event.message.id,destination(event)))return;
    const text=event.message.text.trim(); if(!text||text.length>1000) return;
    if(privateJoin){
      const code=text.split(/\s+/)[1].toUpperCase(),hash=inviteHash(code),now=clock();
      db.exec('BEGIN IMMEDIATE');try{
        db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(event.webhookEventId,event.message.id,event.source.userId,now,'queued');
        const valid=db.prepare('SELECT 1 FROM invites WHERE hash=? AND used=0 AND expires>?').get(hash,now);
        let answer=JOIN_FAILED;
        if(valid){db.prepare('UPDATE invites SET used=1 WHERE hash=?').run(hash);db.prepare('INSERT OR IGNORE INTO authorized_users VALUES(?,?,?)').run(event.source.userId,now,config.owner);answer=JOINED;}
        db.prepare("INSERT INTO jobs(id,event_id,message_id,target,text,received,status,answer) VALUES(?,?,?,?,?,?,'ready',?)").run(randomUUID(),event.webhookEventId,event.message.id,event.source.userId,'',now,answer);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}return;
    }
    db.exec('BEGIN IMMEDIATE'); try{
      db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(event.webhookEventId,event.message.id,event.source.userId||event.source.groupId,clock(),'queued');
      const jobId=randomUUID(),target=destination(event);
      db.prepare('INSERT INTO jobs(id,event_id,message_id,target,text,received) VALUES(?,?,?,?,?,?)').run(jobId,event.webhookEventId,event.message.id,target,text,clock());
      db.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?,?)').run(jobId,target,event.message.id);
      if(text==='ดูต่อ'||config.workflowEnabled&&!text.startsWith('/')){
        const context=savedContext(target+':'+event.source.userId);
        for(const messageId of context?.sources||[])db.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?,?)').run(jobId,target,messageId);
      }
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  async function answer(text,contextKey='',job=null,signal=AbortSignal.timeout(90000)){
    check(job,signal);
    if(text==='/invite'){
      if(job?.target!==config.owner)return UNKNOWN;
      const code=randomBytes(4).toString('hex').toUpperCase();db.prepare('DELETE FROM invites WHERE expires<=? OR used=1').run(clock());db.prepare('INSERT INTO invites VALUES(?,?,0)').run(inviteHash(code),clock()+10*60000);
      return `รหัสเชิญสำหรับเพิ่มแชตส่วนตัว: ${code}\nให้ผู้ใช้ส่ง /join ${code} หาโบโบ้ภายใน 10 นาที\nรหัสนี้ใช้ได้ครั้งเดียว`;
    }
    if(text==='/help') return 'โบโบ้พร้อมรับข้อความส่วนตัวแล้วค่ะ\n'+HELP+(!config.bookingVerified?'\nขณะนี้ยังไม่เปิดการอ่านข้อมูลจองจริง กำลังเชื่อมต่อและตรวจสอบระบบ Quality B2B':'')+(!config.productSearchVerified?'\nการค้นหาโปรแกรมยังอยู่ระหว่างตรวจสอบ':''); if(text==='/privacy') return config.workflowEnabled?'โบโบ้ส่งเฉพาะคำค้นหาที่แยกแล้ว ช่วงเวลา จำนวนที่นั่ง บริบทแบบตัวกรอง และป้ายชื่อจากตัวกรองเว็บไซต์ให้โมเดลช่วยเลือกจุดหมาย ไม่ส่งข้อความส่วนอื่น ข้อมูลผู้เดินทาง รหัสผ่าน คุกกี้ หรือหน้าเว็บไซต์ เก็บบริบท 30 นาที และข้อความไม่เกิน 30 วัน ไม่แก้ไขบุ๊กกิ้ง':PRIVACY;
    if(/^(สวัสดี(?:ครับ|ค่ะ|คะ)?|หวัดดี|hello|hi|ทดสอบ|test)$/i.test(text.trim()))return 'สวัสดีค่ะ โบโบ้รับข้อความได้แล้ว ส่ง /help เพื่อดูคำสั่งได้ค่ะ';
    if(prohibited(text)) return HANDOFF; if(containsSensitive(text)) return SENSITIVE;
    const saved=savedContext(contextKey);
    if(job&&saved)for(const messageId of saved.sources)db.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?,?)').run(job.id,job.target,messageId);
    const execute=intent=>executeIntent(intent,contextKey,job,signal,saved);
    if(config.workflowEnabled&&!text.startsWith('/')&&text.trim()!=='ดูต่อ'){
      const local=parseIntent(text,clock,saved?.product);
      if(local.kind!=='unknown'&&(!config.catalogRouterEnabled||local.kind!=='search_products'))return execute(local);
      const previous=job?db.prepare('SELECT payload FROM plans WHERE job_id=?').get(job.id):null;
      const context=/เอา|เหลือ|ที่นั่ง|เฉพาะ|เปลี่ยน|เดือน|เหนือ|ใต้|ตะวันตก|ฤดู|หน้าหนาว|สงกรานต์|ม\.?ค|ก\.?พ|มี\.?ค|เม\.?ย|พ\.?ค|มิ\.?ย|ก\.?ค|ส\.?ค|ก\.?ย|ต\.?ค|พ\.?ย|ธ\.?ค/.test(text)&&saved?.product?saved.product:saved?.intent;
      if(config.catalogRouterEnabled){
        let catalog;try{catalog=await ensureCatalog(false,signal);}catch(error){metric(error.code==='SESSION_EXPIRED'?'browser_failure':'catalog_mismatch');return error instanceof BookingUnavailable?error.message:'ตัวกรองจุดหมายยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง';}
        let stage='';const run=current=>runCatalogWorkflow({config,text,context:saved?.product||context,clock,signal,catalog:current.entries,catalogVersion:current.version,planner:catalogPlanner,savedPlan:previous?JSON.parse(previous.payload):null,
          savePlan:plan=>{check(job,signal);if(job)db.prepare('INSERT OR REPLACE INTO plans VALUES(?,?)').run(job.id,JSON.stringify(plan));},execute,onFailure:value=>{stage=value;metric(value);}});
        let reply=await run(catalog);
        if(stage==='catalog_mismatch'){try{catalog=await ensureCatalog(true,signal);stage='';reply=await run(catalog);}catch{metric('browser_failure');}}
        return reply;
      }
      return runWorkflow({config,text,context,clock,signal,planner,savedPlan:previous?JSON.parse(previous.payload):null,
        savePlan:plan=>{check(job,signal);if(job)db.prepare('INSERT OR REPLACE INTO plans VALUES(?,?)').run(job.id,JSON.stringify(plan));},execute});
    }
    let intent;
    if(text.trim()==='ดูต่อ'){
      if(!saved||saved.offset==null)return 'ไม่พบผลชุดถัดไป กรุณาส่งคำค้นหาใหม่ค่ะ';
      intent={...(saved.product||saved.intent),offset:saved.offset};
    }else intent=parseIntent(text,clock);
    return execute(intent);
  }
  async function executeIntent(intent,contextKey,job,signal,saved){
    check(job,signal);
    if(intent.kind==='product_clarify')return intent.message;
    if(intent.kind==='unknown'||!intent.code&&!['countdown','search_products'].includes(intent.kind)) return UNKNOWN;
    if(!config.fixtureFile&&['countdown','missing_fields'].includes(intent.kind))return 'กำหนดชำระและตรวจข้อมูลขาดยังไม่เปิดให้บริการ กรุณาตรวจสอบในเว็บไซต์ Quality B2B';
    try{
      const result=await reader[intent.kind](intent.kind==='search_products'?{...intent,signal}:{code:intent.code,signal});
      check(job,signal);
      if(contextKey&&['get','by_tour_code','search_products'].includes(intent.kind)){
        const page=intent.kind==='search_products'?productPage(intent,result):null;
        const current=savedContext(contextKey);
        const sources=[...new Set([...(current?.sources||[]),...(saved?.sources||[]),...(job?[job.message_id]:[])])];
        const normalized={...intent,offset:0};
        db.prepare('INSERT OR REPLACE INTO contexts VALUES(?,?,?,?)').run(contextKey,job?.target||contextKey,JSON.stringify({intent:normalized,product:page?normalized:current?.product,offset:page?page.nextOffset:current?.offset??null,sources}),clock()+30*60000);
      }
      // Forward a canonical intent, never arbitrary chat text or passenger details.
      try{return config.bookingVerified||config.productSearchVerified?deterministic({intent,result}):await format(config,{text:`${intent.kind} ${intent.code||''}`,intent,result},AbortSignal.timeout(50000));}
      catch{return deterministic({intent,result});}
    }catch(error){
      if(error.code==='SESSION_EXPIRED'){
        const key='session-expired:'+error.sessionVersion;
        db.exec('BEGIN IMMEDIATE');try{
          if(db.prepare('INSERT OR IGNORE INTO notices VALUES(?,?)').run(key,clock()).changes){
            db.prepare("INSERT INTO jobs(id,event_id,message_id,target,text,received,status,answer) VALUES(?,?,?,?,?,?,'ready',?)").run(randomUUID(),key,key,config.owner,'',clock(),'แจ้งผู้ดูแล: เซสชัน Quality B2B ของโบโบ้หมดอายุ ระบบหยุดอ่านข้อมูลจองชั่วคราว กรุณาเปิดหน้าล็อกอินบน Hostinger ตาม OPERATIONS.md แล้วเข้าสู่ระบบใหม่');
          }db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
      }
      if(intent.targets){error.code=error.code||'BROWSER_FAILURE';throw error;}return error instanceof BookingUnavailable?error.message:'อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่ภายหลัง';
    }
  }
  async function deliver(table,row){
    if(row.attempts>0 && clock()-(row.received||row.created)>23*3600000){
      db.prepare(`UPDATE ${table} SET status='failed',answer='' WHERE ${table==='jobs'?'id':'key'}=?`).run(row.id||row.key);return;
    }
    db.prepare(`UPDATE ${table} SET attempts=attempts+1 WHERE ${table==='jobs'?'id':'key'}=?`).run(row.id||row.key);
    try{if(table==='jobs'&&db.prepare('SELECT status FROM jobs WHERE id=?').get(row.id)?.status!=='ready')return;await send(config,row.target,row.id||row.key,row.answer.startsWith('["')?JSON.parse(row.answer):row.answer); db.prepare(`UPDATE ${table} SET status='done',answer='' WHERE ${table==='jobs'?'id':'key'}=?`).run(row.id||row.key);}
    catch(error){if(error.permanent) db.prepare(`UPDATE ${table} SET status='failed',answer='' WHERE ${table==='jobs'?'id':'key'}=?`).run(row.id||row.key);
      else db.prepare(`UPDATE ${table} SET next_attempt=? WHERE ${table==='jobs'?'id':'key'}=?`).run(clock()+Math.min(300000,1000*2**Math.min(row.attempts,8)),row.id||row.key);}
  }
  async function tick(){
    if(busy||closing)return; busy=true;
    try{
      let job=db.prepare("SELECT * FROM jobs WHERE status='pending' ORDER BY received LIMIT 1").get();
      if(job){
        db.prepare("UPDATE jobs SET status='processing' WHERE id=?").run(job.id);
        db.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?,?)').run(job.id,job.target,job.message_id);
        const source=db.prepare('SELECT source_id FROM events WHERE id=?').get(job.event_id)?.source_id||job.target;
        const controller=new AbortController();active.set(job.id,controller);const timeout=setTimeout(()=>controller.abort(),90000);
        try{const result=await answer(job.text,job.target+':'+source,job,controller.signal);
          db.prepare("UPDATE jobs SET status='ready',text='',answer=? WHERE id=? AND status='processing'").run(Array.isArray(result)?JSON.stringify(result):result,job.id);
        }catch{db.prepare("UPDATE jobs SET status='ready',text='',answer=? WHERE id=? AND status='processing'").run('อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่ค่ะ',job.id);}
        finally{clearTimeout(timeout);active.delete(job.id);}
      }
      job=db.prepare("SELECT * FROM jobs WHERE status='ready' AND next_attempt<=? ORDER BY received LIMIT 1").get(clock()); if(job) await deliver('jobs',job);
      const alert=db.prepare("SELECT * FROM alerts WHERE status='pending' AND next_attempt<=? ORDER BY created LIMIT 1").get(clock());
      if(alert){
        const current=await reader.countdown({});
        const valid=alert.key.startsWith('lapse|')?current.deadlines.some(d=>`lapse|${d.code}|${d.lapseAt}|`&&alert.key.startsWith(`lapse|${d.code}|${d.lapseAt}|`))
          :current.deadlines.some(d=>d.guaranteeDate&&alert.answer.includes(d.code)&&alert.answer.includes(d.guaranteeDate));
        if(valid)await deliver('alerts',alert);else db.prepare("UPDATE alerts SET status='cancelled',answer='' WHERE key=?").run(alert.key);
      }
    }finally{busy=false;}
  }
  async function scheduleAlerts(){
    if(!config.group||!config.fixtureFile)return;
    const result=await reader.countdown({}); const now=clock();
    for(const d of result.deadlines){
      if(d.lapseAt){ const due=deadlineTime(d.lapseAt); if(!Number.isFinite(due)) continue; const hours=(due-now)/3600000;
        for(const threshold of [1,4,12]) if(hours>0&&hours<=threshold){const key=`lapse|${d.code}|${d.lapseAt}|${threshold}|${config.group}`;
          db.prepare('INSERT OR IGNORE INTO alerts(key,target,created,answer) VALUES(?,?,?,?)').run(key,config.group,now,`แจ้งเตือน ${d.code}\nเหลือไม่เกิน ${threshold} ชั่วโมง\nหมดเวลา ${d.lapseAt}`); break;}}
      }
    const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
    if(hour===8){const today=bangkokDate(now);const todayMs=Date.parse(today+'T00:00:00+07:00');const due=result.deadlines.filter(d=>d.guaranteeDate&&Date.parse(d.guaranteeDate+'T00:00:00+07:00')>=todayMs&&Date.parse(d.guaranteeDate+'T00:00:00+07:00')<=todayMs+7*DAY);
      if(due.length){const answer=['สรุปกำหนดชำระการันตี 7 วัน',...due.map(d=>`${d.code} · ${d.guaranteeDate}${d.guaranteeDate===today?' · วันนี้':''}`)].join('\n');
        db.prepare('INSERT OR IGNORE INTO alerts(key,target,created,answer) VALUES(?,?,?,?)').run(`guarantee|${today}|${config.group}`,config.group,now,answer);}}
    }
  function prune(){db.prepare('DELETE FROM contexts WHERE expires<=?').run(clock());db.prepare('DELETE FROM invites WHERE expires<=? OR used=1').run(clock());db.prepare('DELETE FROM jobs WHERE received<?').run(clock()-30*DAY);db.prepare('DELETE FROM events WHERE received<?').run(clock()-7*DAY);db.prepare('DELETE FROM alerts WHERE created<?').run(clock()-30*DAY);db.exec('DELETE FROM plans WHERE job_id NOT IN (SELECT id FROM jobs); DELETE FROM dependencies WHERE job_id NOT IN (SELECT id FROM jobs); PRAGMA wal_checkpoint(TRUNCATE)');}
  prune();
  const server=createServer(async(req,res)=>{
    if(req.method==='GET'&&req.url==='/health'){const bookingHealth=reader.health?.()||{state:'unverified',ready:false,productState:'unverified',productReady:false,capabilities:[]},meta=catalogMeta(),count=db.prepare('SELECT count(*) count FROM product_catalog').get().count;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,service:'qualityb2b-bobo',version:'0.6.3',workflow:Boolean(config.workflowEnabled),catalogRouter:Boolean(config.catalogRouterEnabled),catalogReady:count>0&&Boolean(meta?.version.startsWith('2:')),catalogEntries:count,catalogAgeSeconds:meta?Math.max(0,Math.floor((clock()-meta.refreshed)/1000)):null,catalogVersion:meta?.version||null,authorizedPrivateChats:1+config.staff.length+db.prepare('SELECT count(*) count FROM authorized_users').get().count,booking:bookingHealth.ready,bookingState:bookingHealth.state,productSearch:bookingHealth.productReady,productSearchState:bookingHealth.productState,capabilities:bookingHealth.capabilities,mode:config.group?'pilot':'private'}));return;}
    if(req.method!=='POST'||req.url!=='/webhook'){res.writeHead(404).end();return;}
    try{let length=0,chunks=[];for await(const chunk of req){length+=chunk.length;if(length>262144){res.writeHead(413).end();return;}chunks.push(chunk);}const body=Buffer.concat(chunks);
      if(!validSignature(body,req.headers['x-line-signature'],config.secret)){res.writeHead(401).end();return;}let payload;try{payload=JSON.parse(body);}catch{res.writeHead(400).end();return;}
      if(payload.destination!==config.botId||!Array.isArray(payload.events)||payload.events.length>100){res.writeHead(400).end();return;}for(const event of payload.events)enqueue(event);res.writeHead(200).end();
    }catch{if(!res.headersSent)res.writeHead(500);res.end();}}
  ); server.requestTimeout=15000;server.headersTimeout=10000;
  const worker=timers?setInterval(()=>void tick().catch(()=>console.error('Bobo worker failed; content omitted')),250):null;worker?.unref();
  const sweeper=timers?setInterval(()=>void scheduleAlerts().catch(()=>console.error('Deadline sweep failed')),15*60000):null;sweeper?.unref();
  const cleanup=timers?setInterval(prune,60000):null;cleanup?.unref();
  const catalogRefresh=timers&&config.catalogRouterEnabled?setInterval(()=>void ensureCatalog(true).catch(()=>metric('browser_failure')),6*3600000):null;catalogRefresh?.unref();
  if(timers&&config.catalogRouterEnabled)void ensureCatalog().catch(()=>metric('browser_failure'));
  return{server,db,enqueue,tick,prune,scheduleAlerts,async close(){closing=true;clearInterval(worker);clearInterval(sweeper);clearInterval(cleanup);clearInterval(catalogRefresh);await new Promise(done=>server.close(done));while(busy)await new Promise(done=>setTimeout(done,10));db.close();}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const config=configFromEnv();const app=createApp(config);app.server.listen(config.port,config.host,()=>console.error(`โบโบ้ listening on ${config.host}:${config.port}`));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close().then(()=>process.exit(0)));}
