// DOM projection: never return agency contacts, traveller fields, remarks or HTML.
export function projectBookingPage() {
  const body=document.querySelector('#booking_list');
  const table=body?.closest('table');
  const headers=[...(table?.querySelectorAll('thead th,thead td')||[])].map(e=>e.textContent.replace(/\s+/g,' ').trim());
  if(!body||headers[1]!=='รหัสการจอง'||headers[4]!=='จำนวนจอง'||headers[6]!=='สถานะการจอง')throw Error('Booking table changed');
  const rows=[...body.rows].filter(r=>r.cells.length>1).map(r=>{
    const text=i=>r.cells[i]?.innerText.trim()||'';
    const count=i=>text(i)==='-'?0:/^\d+$/.test(text(i))?Number(text(i)):null;
    return {code:text(1).match(/BK\d{13}/)?.[0],tourCode:text(2).split(/\s/)[0],
      seatPax:count(4),nonSeatPax:count(5),status:text(6),
      bookingUrl:r.querySelector('a[href*="/booking/manage/"]')?.href};
  });
  const info=document.querySelector('.dataTables_info')?.textContent.trim()||'';
  const match=/Showing\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+record\s*:\s*(\d+)\s+page/.exec(info);
  const allotment=document.querySelector('#box_period')?.textContent.match(/ที่นั่ง\s*:\s*(\d+)/)?.[1];
  return {rows,range:match?match.slice(1).map(Number):null,allotment:allotment===undefined?null:Number(allotment)};
}

const inactive=new Set(['ยกเลิกการสั่งซื้อ','ปฏิเสธ(ไม่อนุมัติการขาย)']);
const statuses=new Set(['ใบสั่งซื้อใหม่(รอจ่ายเงิน)','รับแจ้งจ่ายมัดจำแล้ว(รอยืนยัน)','รับแจ้งชำระเงินเพิ่มเติม(รอยืนยัน)','รับแจ้งชำระเงินครบถ้วน(รอยืนยัน)','จ่ายมัดจำแล้ว','ชำระเงินครบถ้วนแล้ว','การันตี','รอการติดต่อกลับ','ยืนยันแล้ว(อนุมัติการขาย)',...inactive]);
export function summarizeLive(rows,code,allotment,baseUrl,readAt){
  for(const r of rows){
    if(!/^BK\d{13}$/.test(r.code)||!statuses.has(r.status)||!Number.isSafeInteger(r.seatPax)||r.seatPax<0||!Number.isSafeInteger(r.nonSeatPax)||r.nonSeatPax<0)throw Error('Unrecognized booking row');
    const url=new URL(r.bookingUrl);if(url.origin!==new URL(baseUrl).origin||!/^\/booking\/manage\/\d+$/.test(url.pathname))throw Error('Invalid booking link');
  }
  const selected=rows.filter(r=>r.tourCode===code||r.code===code);
  if(selected.length!==rows.length)throw Error('Search returned another code');
  const active=rows.filter(r=>!inactive.has(r.status));
  const sum=(rs,k)=>rs.reduce((n,r)=>n+r[k],0);
  const statusBreakdown={},statusPax={};
  for(const r of rows){statusBreakdown[r.status]=(statusBreakdown[r.status]||0)+1;statusPax[r.status]=(statusPax[r.status]||0)+r.seatPax+r.nonSeatPax;}
  return {tourCode:code,bookingCount:rows.length,activeBookingCount:active.length,paxTotal:sum(active,'seatPax')+sum(active,'nonSeatPax'),seatPax:sum(active,'seatPax'),nonSeatPax:sum(active,'nonSeatPax'),excludedBookingCount:rows.length-active.length,allotment,statusBreakdown,statusPax,bookings:rows,source:baseUrl+'/booking',readAt};
}

// Add a POST path only after verifying it is the site's read-only search endpoint.
const READ_ONLY_POST_PATHS=new Set(['/booking/get_booking']);
export function allowedBookingRequest(url,method,baseUrl){
  const u=new URL(url);if(u.origin!==new URL(baseUrl).origin)return false;
  if(method==='POST')return READ_ONLY_POST_PATHS.has(u.pathname);
  if(method!=='GET')return false;
  return ['/booking','/member/login'].includes(u.pathname)
    || /^\/(?:js|css|plugin|fonts|font-awesome)\//.test(u.pathname)&&/\.(?:js|css|woff2?|ttf|eot|svg|png|gif|jpg)$/.test(u.pathname);
}

export async function readLiveList(config,code,clock=Date.now){
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true});
  const abort=()=>void browser.close().catch(()=>{});config.signal?.addEventListener('abort',abort,{once:true});
  try{
    config.signal?.throwIfAborted();
    const context=await browser.newContext({storageState:config.storageState,serviceWorkers:'block'});
    await context.route('**/*',route=>{
      const req=route.request();
      if(allowedBookingRequest(req.url(),req.method(),config.baseUrl))return route.continue();
      return route.abort();
    });
    const page=await context.newPage();page.setDefaultTimeout(config.searchTimeoutMs||20000);
    await page.goto(config.baseUrl+'/booking',{waitUntil:'domcontentloaded',timeout:45000});
    // An expired session uses a client-side redirect after the first document loads.
    if(!new URL(page.url()).pathname.startsWith('/member/login')){
      await page.locator('#frm_search #tourcode, input[type="password"]').first().waitFor({state:'visible'}).catch(error=>{if(!new URL(page.url()).pathname.startsWith('/member/login'))throw error;});
    }
    if(new URL(page.url()).pathname.startsWith('/member/login')||await page.locator('input[type="password"]').count()){
      const error=Error('Booking session expired');error.code='SESSION_EXPIRED';throw error;
    }
    if(new URL(page.url()).pathname!=='/booking'||await page.locator('#frm_search #tourcode').count()!==1)throw Error('Booking page changed');
    // Finish the automatic initial search before issuing another one.
    await page.waitForFunction(()=>document.querySelector('.dataTables_info')?.textContent.includes('Showing')&&!document.querySelector('#booking_list .spiner-example'));
    await page.locator('#frm_search #reset_search').click();
    // Reset clears this required product-scope selector, causing a server PHP notice.
    await page.locator('#frm_search [name="bk_status_agent"]').selectOption('0',{force:true});
    await page.locator('#frm_search [name="booking_type"]').selectOption('1',{force:true});
    await page.locator('#frm_search #tourcode').fill(code.startsWith('BK')?'':code);
    await page.locator('#frm_search input[name="orderkeyword"]').fill(code.startsWith('BK')?code:'');
    async function search(action,pageNumber){
      const responsePromise=page.waitForResponse(r=>{
        if(new URL(r.url()).pathname!=='/booking/get_booking'||r.request().method()!=='POST')return false;
        const data=new URLSearchParams(r.request().postData());
        return data.get('page')===String(pageNumber)&&data.get(code.startsWith('BK')?'orderkeyword':'tourcode')===code;
      });
      const [response]=await Promise.all([responsePromise,action()]);
      if(!response.ok())throw Error('Search request failed');
      await response.finished();
      try{const data=await response.json();if(!['strHTML','page','totalPage'].every(k=>typeof data[k]==='string')||(data.period!==undefined&&typeof data.period!=='string'))throw Error();}
      catch{throw Error('Invalid booking search response');}
      // The site's success handler replaces the table in a fadeOut callback.
      await page.waitForFunction(()=>!document.querySelector('#booking_list .spiner-example')&&document.querySelector('.dataTables_info')?.textContent.includes('Showing'));
    }
    const combined=new Map();let departureAllotment=null;
    // The site's default scope excludes cancellations; read inactive scopes explicitly.
    for(const [statusValue,statusLabel] of [['',''],['11','ยกเลิกการสั่งซื้อ'],['4','ปฏิเสธ(ไม่อนุมัติการขาย)']]){
    await page.locator('#frm_search [name="order_status"]').selectOption(statusValue,{force:true});
    await search(()=>page.locator('#frm_search #submit_search').click(),1);
    const rows=[],seen=new Set();let total,allotment,pages;
    // ponytail: serialize and cap at 100 pages; return unavailable rather than a partial total.
    for(let n=0;n<100;n++){
      const snapshot=await page.evaluate(projectBookingPage);
      if(!snapshot.range)throw Error('Missing pagination metadata');
      const [start,end,count,pageCount]=snapshot.range;
      if(total!==undefined&&count!==total)throw Error('Results changed during pagination');
      if(pages!==undefined&&(pages!==pageCount||allotment!==snapshot.allotment))throw Error('Departure changed during pagination');
      pages=pageCount;
      total=count;allotment=snapshot.allotment;
      if(count===0&&snapshot.rows.length===0)break;
      if(start!==rows.length+1||end-start+1!==snapshot.rows.length)throw Error('Incomplete booking page');
      for(const row of snapshot.rows){if(seen.has(row.code))throw Error('Duplicate booking page');seen.add(row.code);rows.push(row);}
      if(rows.length===total)break;
      // The site's arrow jumps a block of pages, so follow the exact next number.
      const next=page.locator(`#page_controle a[data-page="${n+2}"]`).first();
      if(await next.count()!==1)throw Error('Next page unavailable');
      await search(()=>next.click(),n+2);
    }
    if(rows.length!==total)throw Error('Incomplete departure results');
    if(allotment!==null){if(departureAllotment!==null&&departureAllotment!==allotment)throw Error('Allotment changed between searches');departureAllotment=allotment;}
    for(const row of rows){
      if(statusLabel&&row.status!==statusLabel)throw Error('Status filter mismatch');
      const prior=combined.get(row.code);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw Error('Booking changed between searches');
      combined.set(row.code,row);
    }
    }
    return summarizeLive([...combined.values()],code,departureAllotment,config.baseUrl,new Date(clock()).toISOString());
  }finally{config.signal?.removeEventListener('abort',abort);await browser.close();}
}
