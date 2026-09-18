import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { createApp, getAccessToken, push } from './app.mjs';
import { createBookingReader, containsSensitive, parseIntent, BookingUnavailable } from './booking.mjs';
import { summarizeLive, projectBookingPage, readLiveList, allowedBookingRequest } from './live-booking.mjs';
import { deterministic } from './hermes.mjs';
import { allowedProductRequest, parseProductQuery, projectProductReport, summarizeProducts } from './product-search.mjs';

const owner='U'+'1'.repeat(32),staff='U'+'2'.repeat(32),botId='U'+'3'.repeat(32),group='C'+'4'.repeat(32);
const fixture={departures:{GO2TEST:{allotment:10}},bookings:[
  {code:'BK2026000000001',tourCode:'GO2TEST',status:'ใบสั่งซื้อใหม่(รอจ่ายเงิน)',adults:3,children:0,lapseAt:'2026-09-18T13:00:00+07:00',missing:['email'],incompleteRows:1},
  {code:'BK2026000000002',tourCode:'GO2TEST',status:'การันตี',adults:2,children:1,guaranteeDate:'2026-09-20',missing:[]}
]};

async function setup(t,overrides={}){
  let now=Date.parse('2026-09-18T10:00:00+07:00');const dir=mkdtempSync(resolve(tmpdir(),'bobo-'));
  const config={secret:'secret',token:'token',botId,owner,staff:[staff],group,host:'127.0.0.1',port:3212,dataDir:dir,baseUrl:'https://example.test',fixtureFile:'in-memory'};
  const sent=[];const reader=createBookingReader(config,{clock:()=>now,fixture});
  const app=createApp(config,{clock:()=>now,timers:false,reader,format:async(_c,r)=>r.intent.kind==='get'?'ผลสถานะ':(await import('./hermes.mjs')).deterministic(r),send:async(...args)=>sent.push(args),...overrides});
  await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
  const url=`http://127.0.0.1:${app.server.address().port}/webhook`;
  const event=(id,text='/bk BK2026000000001',source={type:'user',userId:owner})=>({webhookEventId:id,timestamp:now,type:'message',source,replyToken:'r',message:{id:'m'+id,type:'text',text}});
  const send=async(events,change={})=>{const body=JSON.stringify({destination:botId,events,...change});return fetch(url,{method:'POST',headers:{'x-line-signature':createHmac('sha256',config.secret).update(body).digest('base64')},body});};
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  return{app,config,sent,event,send,advance:n=>now+=n};
}

test('intent and sensitive input classification',()=>{
  assert.deepEqual(parseIntent('/bk BK2026000000001'),{kind:'get',code:'BK2026000000001'});
  assert.deepEqual(parseIntent('GO2TEST มีกี่บุ๊ค'),{kind:'by_tour_code',code:'GO2TEST'});
  assert.equal(containsSensitive('passport AB123456'),true);assert.equal(containsSensitive('BK2026000000001 สถานะ'),false);
});

test('product search parses Thai New Year, explicit Buddhist dates and seat count',()=>{
  const now=Date.parse('2026-09-18T10:00:00+07:00');
  assert.deepEqual(parseProductQuery('ฮาร์บินปีใหม่ มีโปรแกรมใหน รับได้บ้าง',()=>now),{
    kind:'search_products',country:'China',menu:'China',routes:['Harbin'],city:'ฮาร์บิน',departureFrom:'2026-12-25',departureTo:'2027-01-05',requiredSeats:1,periodLabel:'ช่วงปีใหม่',rangeDisplay:'25/12/2026–05/01/2027'});
  const explicit=parseIntent('/search ฮาร์บิ้น 25/12/2569-05/01/2570 4 คน');
  assert.equal(explicit.kind,'search_products');assert.equal(explicit.departureFrom,'2026-12-25');assert.equal(explicit.requiredSeats,4);
  assert.equal(parseIntent('/search ฮาร์บิน').kind,'product_clarify');
});

test('product report guard allows only the verified report search',()=>{
  assert.equal(allowedProductRequest('https://example.test/report/get_control_multi_sub_menu','POST','https://example.test'),true);
  assert.equal(parseProductQuery('ฮาร์บินปีใหม่ มีที่ว่างไหม').kind,'search_products');
  assert.equal(allowedProductRequest('https://example.test/report/get_report_seat','POST','https://example.test'),true);
  assert.equal(allowedProductRequest('https://example.test/report/export_excel','POST','https://example.test'),false);
  assert.equal(allowedProductRequest('https://example.test/travelpackage/package_rate/1','GET','https://example.test'),false);
  assert.equal(allowedProductRequest('https://evil.test/report/get_report_seat','POST','https://example.test'),false);
});

test('pivot projection attaches child departures to programs and excludes totals',async()=>{
  const {chromium}=await import('playwright');const browser=await chromium.launch();
  try{const page=await browser.newPage();await page.setContent(`<div id="report_seller"><table class="report_table"><thead><tr>${['ลำดับ','ชื่อโปรแกรมทัวร์','ประเทศ','เส้นทาง','สายการบิน','รหัสทัวร์','เว็บไซต์','วันเดินทาง','วันเดินทางกลับ','ราคาเริ่มต้น','โควต้ารวม','จองรวม','ใช้ตั๋ว','ไม่ใช้ตั๋ว','คงเหลือ'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>
    <tr><td>ยอดรวมทั้งหมด</td><td>26</td><td>1</td><td>1</td><td>0</td><td>25</td></tr>
    <tr><td>1</td><td>ฮาร์บิน หิมะ</td><td>26</td><td>1</td><td>1</td><td>0</td><td>25</td></tr>
    <tr>${['China','Harbin','CA','GO1HRBTEST','go365travel.com','25/12/2026','31/12/2026','52,900','26','1','1','0','25'].map(x=>`<td>${x}</td>`).join('')}</tr></tbody></table></div>`);
    const rows=await page.evaluate(projectProductReport,'open');assert.equal(rows.length,1);assert.equal(rows[0].program,'ฮาร์บิน หิมะ');
    await page.locator('#report_seller tbody tr').last().evaluate(row=>{const cell=row.insertCell(0);cell.colSpan=2;});
    assert.deepEqual(await page.evaluate(projectProductReport,'open'),rows);
    const query={country:'China',route:'Harbin',city:'ฮาร์บิน',departureFrom:'2026-12-25',departureTo:'2027-01-05',requiredSeats:4};
    const result=summarizeProducts(rows,query,'https://example.test','2026-09-18T00:00:00Z');assert.equal(result.departureCount,1);assert.equal(result.programCount,1);assert.equal(result.departures[0].startingPrice,52900);
  }finally{await browser.close();}
});

test('product summary rejects unauthorized owners, duplicate rows and filters seats',()=>{
  const query={country:'China',route:'Harbin',city:'ฮาร์บิน',departureFrom:'2026-12-25',departureTo:'2027-01-05',requiredSeats:25};
  const row={program:'P',country:'China',route:'Harbin',airline:'CA',tourCode:'GO1TEST',owner:'go365travel.com',departureDate:'25/12/2026',returnDate:'31/12/2026',startingPrice:'52,900',quota:'26',booked:'2',useTicket:'2',noTicket:'0',remaining:'24',category:'open'};
  assert.equal(summarizeProducts([row],query,'https://example.test',new Date().toISOString()).departureCount,0);
  assert.throws(()=>summarizeProducts([{...row,owner:'other.com'}],query,'https://example.test',new Date().toISOString()));
  assert.equal(summarizeProducts([row,row],{...query,requiredSeats:1},'https://example.test',new Date().toISOString()).departureCount,1);
  assert.throws(()=>summarizeProducts([row,{...row,remaining:'23'}],{...query,requiredSeats:1},'https://example.test',new Date().toISOString()),/Conflicting/);
});

test('private product search replies deterministically and ดูต่อ re-reads the report',async t=>{
  let reads=0;const departures=Array.from({length:6},(_,index)=>({program:index<3?'โปรแกรม A':'โปรแกรม B',owner:'Go365',ownerDomain:'go365travel.com',country:'China',route:'Harbin',airline:'CA',tourCode:`GO1TEST${index}`,departureDate:`2026-12-${String(25+index).padStart(2,'0')}`,returnDate:`2027-01-0${index+1}`,startingPrice:50000+index,quota:26,booked:1,useTicket:1,noTicket:0,remaining:25,category:index<2?'open':'automatic'}));
  const reader={health:()=>({state:'ready',ready:true,productState:'ready',productReady:true,capabilities:['product_search']}),search_products:async query=>{reads++;return {query,programCount:2,departureCount:6,departures,source:'https://example.test/report/report_seat',readAt:'2026-09-18T03:00:00Z'};}};
  const s=await setup(t,{reader});s.config.bookingVerified=false;s.config.productSearchVerified=true;
  await s.send([s.event('product','ฮาร์บินปีใหม่ มีโปรแกรมไหนรับได้บ้าง')]);await s.app.tick();assert.match(s.sent[0][3],/พบทั้งหมด: 2 โปรแกรม รวม 6 รอบเดินทาง/);assert.match(s.sent[0][3],/พิมพ์ “ดูต่อ”/);
  await s.send([s.event('more','ดูต่อ')]);await s.app.tick();assert.match(s.sent[1][3],/GO1TEST5/);assert.equal(reads,2);
});

test('booking tools return only allowlisted aggregates',async()=>{
  const reader=createBookingReader({baseUrl:'https://example.test'},{clock:()=>0,fixture});
  assert.equal((await reader.get({code:'BK2026000000001'})).status,'ใบสั่งซื้อใหม่(รอจ่ายเงิน)');
  const tour=await reader.by_tour_code({code:'GO2TEST'});assert.equal(tour.bookingCount,2);assert.equal(tour.impliedRemaining,4);
  assert.deepEqual((await reader.missing_fields({code:'GO2TEST'})).bookings[0].missing,['email']);
  assert.equal(Object.values(await reader.get({code:'BK2026000000001'})).some(v=>String(v).includes('passport')),false);
});

test('signature, destination, authorization, mention policy and deduplication',async t=>{
  const s=await setup(t);const bad=await fetch(`http://127.0.0.1:${s.app.server.address().port}/webhook`,{method:'POST',body:'{}'});assert.equal(bad.status,401);
  assert.equal((await s.send([],{destination:owner})).status,400);
  await s.send([s.event('unknown','/help',{type:'user',userId:botId})]);
  await s.send([s.event('quiet','hello',{type:'group',groupId:group,userId:staff})]);
  const mentioned=s.event('mention','@โบโบ้ สถานะ BK2026000000001',{type:'group',groupId:group,userId:staff});mentioned.message.mention={mentionees:[{isSelf:true,userId:botId}]};
  await s.send([mentioned,mentioned]);assert.equal(s.app.db.prepare('SELECT count(*) n FROM jobs').get().n,1);await s.app.tick();assert.equal(s.sent.length,1);assert.equal(s.sent[0][1],group);
});

test('commands, privacy filter and prohibited writes stay local',async t=>{
  const s=await setup(t);for(const [id,text] of [['help','/help'],['private','passport AB123'],['write','ยกเลิก BK2026000000001']]){await s.send([s.event(id,text)]);await s.app.tick();}
  assert.match(s.sent[0][3],/\/bk/);assert.match(s.sent[1][3],/อย่าส่ง/);assert.match(s.sent[2][3],/กดบันทึกเอง/);
});

test('unsend cancels pending work and 30-day cleanup removes retained jobs',async t=>{
  const s=await setup(t);await s.send([s.event('a')]);await s.send([{...s.event('u'),type:'unsend',unsend:{messageId:'ma'},message:undefined}]);await s.app.tick();assert.equal(s.sent.length,0);
  await s.send([s.event('b')]);await s.app.tick();s.advance(31*86400000);s.app.prune();assert.equal(s.app.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
});

test('uncertain delivery retries same idempotency key and answer',async t=>{
  const attempts=[];const s=await setup(t,{send:async(_c,_to,key,answer)=>{attempts.push({key,answer});if(attempts.length===1)throw Error('uncertain');}});
  await s.send([s.event('retry')]);await s.app.tick();s.advance(3000);await s.app.tick();assert.equal(attempts.length,2);assert.deepEqual(attempts[0],attempts[1]);
});

test('deadline threshold is deduplicated across sweeps and restarts',async t=>{
  const s=await setup(t);await s.app.scheduleAlerts();await s.app.scheduleAlerts();assert.equal(s.app.db.prepare('SELECT count(*) n FROM alerts').get().n,1);await s.app.tick();assert.match(s.sent[0][3],/ไม่เกิน 4 ชั่วโมง/);
});

test('LINE push handles accepted retry conflict and permanent failures',async()=>{
  await push({token:'x'},owner,'key','answer',async()=>new Response('',{status:409,headers:{'x-line-accepted-request-id':'yes'}}));
  await assert.rejects(push({token:'x'},owner,'key','answer',async()=>new Response('',{status:403})),e=>e.permanent);
});

test('short-lived LINE tokens are issued once and cached',async()=>{
  const config={channelId:'2011654458',secret:'secret'};let calls=0;
  const fetcher=async(url)=>{calls++;assert.match(url,/oauth\/accessToken/);return new Response(JSON.stringify({access_token:'issued',expires_in:900}),{status:200,headers:{'content-type':'application/json'}});};
  assert.equal(await getAccessToken(config,fetcher),'issued');assert.equal(await getAccessToken(config,fetcher),'issued');assert.equal(calls,1);
});

test('unsend before message and duplicate message IDs suppress delivery',async t=>{
  const s=await setup(t);
  await s.send([{...s.event('u'),type:'unsend',unsend:{messageId:'mlate'},message:undefined}]);
  await s.send([s.event('late')]);await s.app.tick();assert.equal(s.sent.length,0);
  const first=s.event('first','/help');await s.send([first,{...first,webhookEventId:'other-event'}]);
  await s.app.tick();await s.app.tick();assert.equal(s.sent.length,1);
});

test('private chat greeting works and unverified booking access fails closed',async t=>{
  const s=await setup(t);await s.send([s.event('hello','ทดสอบ')]);await s.app.tick();assert.match(s.sent[0][3],/รับข้อความได้แล้ว/);
  assert.equal(parseIntent('TTAO5NTAOQW261105 มีกี่บุ๊ค').code,'TTAO5NTAOQW261105');
  await assert.rejects(createBookingReader({baseUrl:'https://example.test'}).get({code:'BK2026000000001'}),/ยังไม่เปิด/);
});

test('uncertain delivery stops before retry-key expiration',async t=>{
  let calls=0;const s=await setup(t,{send:async()=>{calls++;throw Error('timeout');}});
  await s.send([s.event('retry-limit','/help')]);await s.app.tick();s.advance(24*3600000);await s.app.tick();assert.equal(calls,1);
});

test('live departure counts exclude cancelled orders and distinguish non-seat pax',()=>{
  const row=(n,status,seatPax,nonSeatPax=0)=>({code:'BK202600000000'+n,tourCode:'TTTEST261105',status,seatPax,nonSeatPax,bookingUrl:'https://example.test/booking/manage/'+n});
  const rows=[row(1,'จ่ายมัดจำแล้ว',6),row(2,'ชำระเงินครบถ้วนแล้ว',1,1),row(3,'ยกเลิกการสั่งซื้อ',4)];
  const result=summarizeLive(rows,'TTTEST261105',21,'https://example.test','2026-09-18T00:00:00Z');
  assert.equal(result.paxTotal,8);assert.equal(result.seatPax,7);assert.equal(result.activeBookingCount,2);assert.equal(result.excludedBookingCount,1);
  const reply=deterministic({intent:{kind:'by_tour_code'},result});assert.match(reply,/ยอดจองทั้งหมด 2 บุ๊กกิ้ง รวม 8 คน/);assert.doesNotMatch(reply,/ผู้ใหญ่|undefined|null/);
  assert.throws(()=>summarizeLive([{...rows[0],seatPax:null}],'TTTEST261105',21,'https://example.test',0));
  assert.throws(()=>summarizeLive(rows,'TTOTHER',21,'https://example.test',0));
});

test('browser projection excludes identity columns and rejects changed headers',async()=>{
  const {chromium}=await import('playwright');const browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    const headers=['#','รหัสการจอง','รหัสทัวร์','วันที่จอง','จำนวนจอง','จำนวนจอง (ไม่ตัดที่นั่ง)','สถานะการจอง'];
    const cells=['','BK2026000375477 name birthday','TTTAO5NTAOQW261105','',2,'-','จ่ายมัดจำแล้ว','PRIVATE_CONTACT_CANARY','PRIVATE_NAME_CANARY','-',...Array(8).fill(''),'<a href="https://example.test/booking/manage/375477">Edit</a>'];
    await page.setContent(`<div id="box_period">ที่นั่ง : 21</div><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody id="booking_list"><tr>${cells.map(c=>`<td>${c}</td>`).join('')}</tr></tbody></table><div class="dataTables_info">Showing 1 to 1 of 1 record : 1 page</div>`);
    const projection=await page.evaluate(projectBookingPage);assert.equal(projection.rows[0].seatPax,2);assert.equal(projection.rows[0].nonSeatPax,0);assert.doesNotMatch(JSON.stringify(projection),/PRIVATE_/);
    await page.setContent('<table><tbody id="booking_list"></tbody></table>');await assert.rejects(page.evaluate(projectBookingPage),/Booking table changed/);
  }finally{await browser.close();}
});

test('expired-session notification is durable and deduplicated; deferred features stay local',async t=>{
 const expired=Object.assign(new BookingUnavailable('expired'),{code:'SESSION_EXPIRED',sessionVersion:'1'});
 const s=await setup(t,{reader:{get:async()=>{throw expired;}}});s.config.fixtureFile='';
 for(const id of ['expired1','expired2']){await s.send([s.event(id)]);await s.app.tick();await s.app.tick();}
 assert.equal(s.sent.filter(r=>r[3].includes('แจ้งผู้ดูแล:')).length,1);
 assert.equal(s.app.db.prepare('SELECT count(*) n FROM notices').get().n,1);
 await s.send([s.event('deferred','/deadlines')]);await s.app.tick();assert.match(s.sent.at(-1)[3],/ยังไม่เปิดให้บริการ/);
});

test('validated live answers never invoke model formatter',async t=>{
 let called=false;const s=await setup(t,{format:async()=>{called=true;throw Error('must not call');}});s.config.bookingVerified=true;
 await s.send([s.event('deterministic')]);await s.app.tick();assert.equal(called,false);assert.match(s.sent[0][3],/BK2026000000001/);
});

test('read-only guard blocks mutations, documents and unrelated destinations',()=>{
 const base='https://example.test';
 assert.equal(allowedBookingRequest(base+'/booking/get_booking','POST',base),true);
 for(const path of ['/booking/remove_booking','/booking/manage/1','/booking/save','/booking/report_booking_print','/report/get_agent_contact'])for(const method of ['GET','POST','DELETE'])assert.equal(allowedBookingRequest(base+path,method,base),false);
 assert.equal(allowedBookingRequest('https://other.test/booking','GET',base),false);
});

test('browser search waits for slow updates and rejects incomplete, repeated or changed pages',async t=>{
 let mode='normal',base,mutations=0;
 const row=(n,code)=>'<tr>'+['',`BK202600000000${n}`,code,'',n, n===2?'1':'-',n===3?'ยกเลิกการสั่งซื้อ':'จ่ายมัดจำแล้ว','PRIVATE_NAME_CANARY','PRIVATE_CONTACT_CANARY',...Array(9).fill(''),`<a href="${base}/booking/manage/${n}">Edit</a>`].map(c=>`<td>${c}</td>`).join('')+'</tr>';
 const html=()=>`<form id="frm_search"><input id="tourcode" name="tourcode"><input name="orderkeyword"><select name="order_status"><option value="">All</option><option value="11">Cancelled</option><option value="4">Rejected</option></select><select name="bk_status_agent"><option value="0">b2b</option></select><select name="booking_type"><option value="1">tour</option></select><button type="button" id="reset_search">Reset</button><button type="button" id="submit_search">Search</button></form><table><thead><tr>${['#','รหัสการจอง','รหัสทัวร์','วันที่จอง','จำนวนจอง','ไม่ตัด','สถานะการจอง'].map(h=>`<th>${mode==='structure'?'changed':h}</th>`).join('')}</tr></thead><tbody id="booking_list"></tbody></table><div class="dataTables_info"></div><div id="box_period"></div><div id="page_controle"></div><script>
 async function search(page){document.querySelector('#booking_list').innerHTML='<tr><td class="spiner-example">Loading</td></tr>';const data=new URLSearchParams(new FormData(document.querySelector('form')));data.set('page',page);const r=await fetch('/booking/get_booking',{method:'POST',body:data});const d=await r.json();setTimeout(()=>{document.querySelector('#booking_list').innerHTML=d.strHTML;document.querySelector('.dataTables_info').textContent=d.totalPage;document.querySelector('#box_period').textContent=d.period;document.querySelector('#page_controle').innerHTML=d.page;},250);}
 document.querySelector('#submit_search').onclick=()=>search(1);document.querySelector('#reset_search').onclick=()=>{};document.querySelector('#page_controle').onclick=e=>{e.preventDefault();search(e.target.dataset.page);};search(1);
 fetch('/booking/remove_booking',{method:'POST'}).catch(()=>{});</script>`;
 const server=createServer(async(req,res)=>{
  if(req.url==='/booking/remove_booking'){mutations++;res.end();return;}
  if(req.url==='/member/login'){res.end('<input type="password">');return;}
  if(req.url==='/booking'){if(mode==='expired'){res.writeHead(302,{location:'/member/login'}).end();return;}res.setHeader('content-type','text/html; charset=utf-8');res.end(html());return;}
  let body='';for await(const c of req)body+=c;const q=new URLSearchParams(body),page=Number(q.get('page')),code=q.get('tourcode')||'TTTEST';
  if(q.get('order_status')){const found=q.get('order_status')==='11'&&code!=='TTUNKNOWN';res.setHeader('content-type','application/json');res.end(JSON.stringify({strHTML:found?row(3,code):'',page:'',totalPage:`Showing ${found?1:0} to ${found?1:0} of ${found?1:0} record : ${found?1:0} page`}));return;}
  const unknown=code==='TTUNKNOWN';let count=unknown?0:3;let rows=unknown?'':page===1?row(1,code)+row(2,code):row(mode==='duplicate'?1:3,code);
  if(mode==='changing'&&page===2)count=4;
  if(mode==='incomplete'&&page===2)rows='';
  res.setHeader('content-type','application/json');res.end(JSON.stringify({strHTML:rows,period:unknown?undefined:'ที่นั่ง : 21',page:page===1&&!unknown?'<a data-page="2">2</a>':'',totalPage:`Showing ${unknown?0:page===1?1:3} to ${unknown?0:page===1?2:3} of ${count} record : ${unknown?0:2} page`}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;t.after(()=>new Promise(r=>server.close(r)));
 const config={baseUrl:base,storageState:{cookies:[],origins:[]},searchTimeoutMs:3000};
 const result=await readLiveList(config,'TTTEST');assert.equal(result.bookingCount,3);assert.equal(result.paxTotal,4);assert.equal(result.seatPax,3);assert.equal(result.nonSeatPax,1);assert.equal(mutations,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);
 assert.equal((await readLiveList(config,'TTUNKNOWN')).bookingCount,0);
 for(mode of ['duplicate','changing','incomplete','structure'])await assert.rejects(readLiveList(config,'TTTEST'));
 mode='expired';await assert.rejects(readLiveList(config,'TTTEST'),e=>e.code==='SESSION_EXPIRED');
});
