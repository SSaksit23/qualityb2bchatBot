import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readProductSearch} from './product-search.mjs';
import {productFailureMessage} from './booking.mjs';

test('product report completion, retry, invalid structure and expiry are fail-closed',async t=>{
 let mode='slow',requests=0,mutations=0;
 const headers=['ลำดับ','ชื่อโปรแกรมทัวร์','ประเทศ','เส้นทาง','สายการบิน','รหัสทัวร์','เว็บไซต์','วันเดินทาง','วันเดินทางกลับ','ราคาเริ่มต้น','โควต้ารวม','จองรวม','ใช้ตั๋ว','ไม่ใช้ตั๋ว','คงเหลือ'];
 const table=()=>`<table class="report_table"><thead><tr>${headers.map(h=>`<th>${mode==='columns'?'changed':h}</th>`).join('')}</tr></thead><tbody><tr>${['1','โปรแกรมทดสอบ','','','','',''].map(v=>`<td>${v}</td>`).join('')}</tr><tr>${['China','Chongqing','CA','2UTEST','2ucenter.com','10/10/2026',mode==='date'?'31/02/2026':'20/10/2026','10000','20','0','0','0','4'].map(v=>`<td>${v}</td>`).join('')}</tr>${mode==='partial'?'<tr><td><a data-page="2">2</a></td></tr>':''}</tbody><tfoot><tr><td colspan="15"></td></tr></tfoot></table>`;
 const select=(name,values)=>`<select name="${name}" multiple>${values.map(v=>`<option value="${v}">${v}</option>`).join('')}</select>`;
 const html=()=>`<form id="frm_search">${select('country[]',['China'])}${select('menu[]',[])}${select('sub_menu[]',[])}${select('website[]',['go365travel.com','2ucenter.com','teetiao.com'])}${select('group_show',['package_name'])}${select('airline',[''])}${select('package_visible',['1'])}${select('visible[]',['1','2'])}${select('status_seat',['1'])}<input name="start_date"><input name="end_date"><input type="radio" name="type_package" value="jointour"><input type="radio" name="show_format" value="advanced"><button type="button" class="report_search">Search</button></form><div id="report_seller"></div><script>document.querySelector('button').onclick=async()=>{const r=await fetch('/report/get_report_seat',{method:'POST',body:new URLSearchParams(new FormData(document.querySelector('form')))});const d=await r.json();setTimeout(()=>{document.querySelector('#report_seller').innerHTML=d.strHtml;const t=document.querySelector('#report_seller table');if(t){const f=t.createTFoot();f.innerHTML='<tr><td colspan=15><ul class=pagination><li class=footable-page-arrow><a data-page=first>«</a></li><li class=footable-page><a data-page=0>1</a></li><li class=footable-page-arrow><a data-page=next>›</a></li></ul></td></tr>';}} ,200);};fetch('/booking/save',{method:'POST'}).catch(()=>{});</script>`;
 const server=createServer(async(req,res)=>{
  if(req.url==='/booking/save'){mutations++;res.end();return;}
  if(req.url==='/member/login'){res.end('<input type="password">');return;}
  if(req.url==='/report/report_seat'){if(mode==='expired'){res.writeHead(302,{location:'/member/login'}).end();return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html());return;}
  requests++;let body='';for await(const part of req)body+=part;
  if(mode==='transient'&&requests===1){res.writeHead(503).end();return;}
  if(mode==='timeout'){return;}
  const automatic=new URLSearchParams(body).get('visible[]')==='2';
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({strHtml:automatic?'ไม่พบข้อมูล':table(),setting:''}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const config={baseUrl:`http://127.0.0.1:${server.address().port}`,storageState:{cookies:[],origins:[]},searchTimeoutMs:700,signal:AbortSignal.timeout(25000)};
 const q={kind:'search_products',city:'จีน',targets:[{scope:'country',country:'China',label:'China'}],routes:['China'],departureFrom:'2026-10-10',departureTo:'2026-10-20',dateMode:'whole_trip',requiredSeats:4,rangeDisplay:'10/10/2026–20/10/2026'};
 assert.equal((await readProductSearch(config,q)).departureCount,1);assert.equal(requests,2);assert.equal(mutations,0);
 mode='transient';requests=0;assert.equal((await readProductSearch(config,q)).departureCount,1);assert.equal(requests,3);
 for(const [failure,code,count] of [['columns','REPORT_INVALID',1],['partial','REPORT_INCOMPLETE',1],['date','REPORT_INVALID',2],['expired','SESSION_EXPIRED',0],['timeout','REPORT_TIMEOUT',2]]){
  mode=failure;requests=0;await assert.rejects(readProductSearch(config,q),e=>e.code===code);assert.equal(requests,count,failure);
  const message=productFailureMessage(code,q);assert.match(message,/2026-10-10–2026-10-20/);assert.doesNotMatch(message,/ไม่พบรอบ/);
 }
});
