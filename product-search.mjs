import {travelWindow,strictDate} from './travel-window.mjs';
const REPORT_PATH = '/report/report_seat';
const SEARCH_PATH = '/report/get_report_seat';
const OWNERS = new Map([
  ['go365travel.com', 'Go365'],
  ['2ucenter.com', '2U Center'],
  ['teetiao.com', 'Teetiao'],
]);
const FIELDS = ['country','sub_menu','airline','package_name','tourcode','website','departure_date','arrival_date','price','numseat','numorder','useticket','noticket','remain'];
const DESTINATIONS=[
  {pattern:/ฮาร์บิ[น้น]|harbin/i,city:'ฮาร์บิน',country:'China',menu:'China',routes:['Harbin']},
  {pattern:/ซินเจียง|ซินเกียง|xinjiang|xinjaing/i,city:'ซินเจียง',country:'China',menu:'China',routes:['Xinjiang','Northern Xinjaing','Southern Xinjiang','Western Xinjiang']},
];
const MONTHS=[
  ['มกราคม','มกรา','มค','jan','january'],['กุมภาพันธ์','กุมภา','กพ','feb','february'],
  ['มีนาคม','มีนา','มีค','mar','march'],['เมษายน','เมษา','เมย','apr','april'],
  ['พฤษภาคม','พฤษภา','พค','may'],['มิถุนายน','มิถุนา','มิย','jun','june'],
  ['กรกฎาคม','กรกฎา','กค','jul','july'],['สิงหาคม','สิงหา','สค','aug','august'],
  ['กันยายน','กันยา','กย','sep','september'],['ตุลาคม','ตุลา','ตค','oct','october'],
  ['พฤศจิกายน','พฤศจิกา','พย','nov','november'],['ธันวาคม','ธันวา','ธค','dec','december'],
];
const SEASONS=[
  {pattern:/หน้าหนาว|ฤดูหนาว|winter/i,label:'ช่วงหน้าหนาว',start:11,end:2},
  {pattern:/ฤดูใบไม้ผลิ|spring/i,label:'ช่วงฤดูใบไม้ผลิ',start:2,end:3},
  {pattern:/สงกรานต์/i,label:'ช่วงสงกรานต์',start:4,end:4},
  {pattern:/หน้าร้อน|ฤดูร้อน|summer/i,label:'ช่วงฤดูร้อน',start:5,end:9},
  {pattern:/ฤดูใบไม้ร่วง|ใบไม้ร่วง|autumn|fall/i,label:'ช่วงฤดูใบไม้ร่วง',start:10,end:11},
];

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const normalizeDigits=value=>String(value||'').replace(/[๐-๙]/g,d=>'0123456789'['๐๑๒๓๔๕๖๗๘๙'.indexOf(d)]);
const normalizeOperational=value=>clean(normalizeDigits(String(value||'').normalize('NFKC')))
  .replace(/ใหน/g,'ไหน').replace(/มั่ง/g,'บ้าง');
const integer = value => /^-?\d[\d,]*$/.test(clean(value)) ? Number(clean(value).replaceAll(',', '')) : null;
const dateParts = value => {
  const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(clean(value));
  if(!match)return null;
  const year=Number(match[3])>2400?Number(match[3])-543:Number(match[3]);
  const iso=`${year}-${match[2]}-${match[1]}`;
  return strictDate(year,Number(match[2]),Number(match[1]));
};
const displayDate = iso => {const [y,m,d]=iso.split('-');return `${d}/${m}/${y}`;};

export function allowedProductRequest(url, method, baseUrl) {
  const target=new URL(url),base=new URL(baseUrl);
  if(target.origin!==base.origin)return false;
  if(method==='POST')return [SEARCH_PATH,'/report/get_control_multi_sub_menu'].includes(target.pathname);
  if(method!=='GET')return false;
  return [REPORT_PATH,'/member/login'].includes(target.pathname)
    || /^\/(?:js|css|plugin|plugins|fonts|font-awesome|images|img)\//.test(target.pathname)
      && /\.(?:js|css|woff2?|ttf|eot|svg|png|gif|jpe?g)$/.test(target.pathname);
}

// Runs inside the report page. It projects only the operational columns we allow.
export function projectProductReport(category) {
  const table=document.querySelector('#report_seller table.report_table, #report_seller table');
  const text=element=>(element?.textContent||'').replace(/\s+/g,' ').trim();
  const headers=[...(table?.querySelectorAll('thead tr:first-child th,thead tr:first-child td')||[])].map(text);
  const expected=['ลำดับ','ชื่อโปรแกรมทัวร์','ประเทศ','เส้นทาง','สายการบิน','รหัสทัวร์','เว็บไซต์','วันเดินทาง','วันเดินทางกลับ','ราคาเริ่มต้น','โควต้ารวม','จองรวม','ใช้ตั๋ว','ไม่ใช้ตั๋ว','คงเหลือ'];
  if(!table||headers.length!==expected.length||headers.some((value,index)=>value!==expected[index]))throw Error('Product report table changed');
  const pager=[...document.querySelectorAll('#report_seller a[data-page]')];
  if(pager.some(a=>!a.parentElement.classList.contains('footable-page')&&!a.parentElement.classList.contains('footable-page-arrow'))||!pager.length&&document.querySelector('#report_seller .pagination'))throw Error('Incomplete product pagination');
  const rows=[];let program='';
  for(const row of table.querySelectorAll('tbody tr,tfoot tr')){
    const cells=[...row.cells].map(text);
    // Pivot children may retain an empty cell spanning the index/program columns.
    if(cells.length===14&&cells[0]===''&&row.cells[0].colSpan===2)cells.shift();
    if(!cells.length||cells[0]==='ยอดรวมทั้งหมด'||row.querySelector('a[data-page]'))continue;
    if(cells.length===7&&/^\d+$/.test(cells[0])){
      program=cells[1];
      if(!program)throw Error('Missing product group');
      continue;
    }
    if(cells.length===13){
      if(!program)throw Error('Departure before product group');
      rows.push({program,country:cells[0],route:cells[1],airline:cells[2],tourCode:cells[3],owner:cells[4],
        departureDate:cells[5],returnDate:cells[6],startingPrice:cells[7],quota:cells[8],booked:cells[9],
        useTicket:cells[10],noTicket:cells[11],remaining:cells[12],category});
      continue;
    }
    // Ignore the repeated visible header; reject every other unexpected data row.
    if(cells.join('|')===headers.join('|'))continue;
    if(cells.some(Boolean))throw Error('Unexpected product report row');
  }
  return rows;
}

const queryTargets=query=>query.targets?.length?query.targets:(query.routes||[query.route]).filter(Boolean).map(route=>({scope:'route',country:query.country,menu:query.menu,route,label:route}));
function normalizeRow(row, query) {
  const ownerDomain=clean(row.owner).toLowerCase();
  const owner=OWNERS.get(ownerDomain);
  const departureDate=dateParts(row.departureDate),returnDate=dateParts(row.returnDate);
  const numbers=Object.fromEntries(['startingPrice','quota','booked','useTicket','noTicket','remaining'].map(key=>[key,integer(row[key])]));
  if(!owner||!clean(row.program)||!clean(row.tourCode)||!clean(row.country)||!clean(row.route)||!departureDate||!returnDate
    ||returnDate<departureDate
    ||Object.values(numbers).some(value=>!Number.isSafeInteger(value)||value<0))throw Error('Unrecognized product row');
  const matches=queryTargets(query).some(target=>target.scope==='country'
    ?clean(row.country).toLowerCase()===target.country.toLowerCase()
    :clean(row.route).toLowerCase()===target.route.toLowerCase());
  if(!matches)throw Error('Product filter mismatch');
  if(departureDate<query.departureFrom||departureDate>query.departureTo)throw Error('Product date outside requested range');
  return {...row,owner,ownerDomain,departureDate,returnDate,...numbers};
}

export function summarizeProducts(rawRows, query, baseUrl, readAt) {
  const rows=rawRows.map(row=>normalizeRow(row,query)),seen=new Map(),unique=[];
  for(const row of rows){
    const key=`${row.ownerDomain}|${row.tourCode}|${row.departureDate}`;
    const previous=seen.get(key);
    if(previous){
      const comparable=value=>JSON.stringify(Object.fromEntries(Object.entries(value).filter(([field])=>field!=='route')));
      if(comparable(previous)!==comparable(row))throw Error('Conflicting product departure');
      continue;
    }
    seen.set(key,row);unique.push(row);
  }
  const departures=unique.filter(row=>row.remaining>=query.requiredSeats&&(query.dateMode!=='whole_trip'||row.returnDate<=query.departureTo)).sort((a,b)=>
    (a.category==='open'?0:1)-(b.category==='open'?0:1)||a.departureDate.localeCompare(b.departureDate)||a.startingPrice-b.startingPrice);
  const programs=new Set(departures.map(row=>`${row.ownerDomain}|${row.program}`));
  return {query:{...query},programCount:programs.size,departureCount:departures.length,departures,
    source:new URL(REPORT_PATH,baseUrl).href,readAt};
}

function bangkokParts(clock) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(clock())).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),iso:`${parts.year}-${parts.month}-${parts.day}`};
}

const pad=value=>String(value).padStart(2,'0');
const iso=(year,month,day)=>`${year}-${pad(month)}-${pad(day)}`;
const lastDay=(year,month)=>new Date(Date.UTC(year,month,0)).getUTCDate();
function validIso(year,month,day){
  const value=iso(year,month,day),date=new Date(value+'T00:00:00Z');
  return date.getUTCFullYear()===year&&date.getUTCMonth()+1===month&&date.getUTCDate()===day?value:null;
}
const westernYear=value=>{const year=Number(value);return year>2400?year-543:year<100?year+1957:year;};
const compact=value=>clean(value).toLowerCase().replace(/[.\s]/g,'');
function destinationFrom(text,proposal={}){
  const value=clean(text),known=DESTINATIONS.find(item=>item.pattern.test(value));
  if(known){
    let routes=[...known.routes];
    if(known.city==='ซินเจียง'){
      if(/เหนือ|northern?/i.test(value))routes=['Northern Xinjaing'];
      else if(/ใต้|southern?/i.test(value))routes=['Southern Xinjiang'];
      else if(/ตะวันตก|western?/i.test(value))routes=['Western Xinjiang'];
    }
    return {city:known.city,country:known.country,menu:known.menu,routes};
  }
  const safe=value=>typeof value==='string'&&value.length<=80&&/^[\p{L}\p{N} .,'()&/-]+$/u.test(value)&&!value.includes('..')&&!value.includes('//')&&!value.startsWith('/');
  const routes=Array.isArray(proposal.routes)?proposal.routes:[];
  if(!safe(proposal.country)||!safe(proposal.menu)||!routes.length||routes.length>8||routes.some(route=>!safe(route)))return null;
  return {city:value,country:proposal.country,menu:proposal.menu,routes:[...new Set(routes)]};
}
export function periodFrom(text,clock=Date.now){
  const window=travelWindow(text,clock);if(window)return window.error?null:window.period;
  const value=clean(text),now=bangkokParts(clock);
  const range=/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\s*(?:-|–|ถึง|to)\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/i.exec(value);
  if(range){
    const from=validIso(westernYear(range[3]),Number(range[2]),Number(range[1])),to=validIso(westernYear(range[6]),Number(range[5]),Number(range[4]));
    return from&&to&&from<=to?{departureFrom:from,departureTo:to,periodLabel:'ช่วงวันที่ระบุ'}:null;
  }
  if(/ปีใหม่/i.test(value)){
    const startYear=now.month===1&&now.day<=5?now.year-1:now.year;
    let from=iso(startYear,12,25),to=iso(startYear+1,1,5);if(now.iso>from&&now.iso<=to)from=now.iso;
    return {departureFrom:from,departureTo:to,periodLabel:'ช่วงปีใหม่'};
  }
  const season=SEASONS.find(item=>item.pattern.test(value));
  if(season){
    let startYear=now.year;const crosses=season.end<season.start;
    const inSeason=crosses?(now.month>=season.start||now.month<=season.end):(now.month>=season.start&&now.month<=season.end);
    if(inSeason&&crosses&&now.month<=season.end)startYear--;
    else if(!inSeason&&!crosses&&now.month>season.end)startYear++;
    const endYear=crosses?startYear+1:startYear;
    let from=iso(startYear,season.start,1),to=iso(endYear,season.end,lastDay(endYear,season.end));
    if(inSeason&&now.iso>=from&&now.iso<=to)from=now.iso;
    return {departureFrom:from,departureTo:to,periodLabel:season.label};
  }
  let month,year=now.year;
  if(/เดือนหน้า/.test(value)){month=now.month===12?1:now.month+1;if(month===1)year++;}
  else if(/เดือนนี้/.test(value))month=now.month;
  else {
    const normalized=compact(value);month=MONTHS.findIndex(names=>names.some(name=>normalized.includes(compact(name))))+1;
    if(!month){
      const numeric=/(?:เดือน\s*(1[0-2]|0?[1-9])|(1[0-2]|0?[1-9])\s*(?:[\/]\s*(\d{2,4})|ปี\s*(\d{2,4})))/i.exec(value);
      if(numeric){month=Number(numeric[1]||numeric[2]);if(numeric[3]||numeric[4])year=westernYear(numeric[3]||numeric[4]);}
    }
    const explicitYear=/(?:ปี\s*|พ\.?ศ\.?\s*)(\d{2,4})/.exec(value);if(explicitYear)year=westernYear(explicitYear[1]);
  }
  if(!month&&/(?:ต้น|กลาง|ปลาย)(?:เดือน)?/.test(value))month=now.month;
  if(!month)return null;
  let first=1,last=lastDay(year,month);if(/ต้น(?:เดือน)?/.test(value))last=10;else if(/กลาง(?:เดือน)?/.test(value)){first=11;last=20;}else if(/ปลาย(?:เดือน)?/.test(value))first=21;
  return {departureFrom:iso(year,month,first),departureTo:iso(year,month,last),periodLabel:`ช่วง${new Intl.DateTimeFormat('th-TH',{month:'short',year:'numeric',timeZone:'Asia/Bangkok'}).format(new Date(iso(year,month,1)+'T00:00:00+07:00'))}`};
}

export function resolveProductQuery({destinationText,timeText,seatsText,country,menu,routes}={},context=null,clock=Date.now){
  const routeRefinement=destinationText&&context?.city==='ซินเจียง'&&/เหนือ|ใต้|ตะวันตก|northern?|southern?|western?/i.test(destinationText);
  const refinement=routeRefinement?`ซินเจียง ${destinationText}`:destinationText;
  const destination=refinement?destinationFrom(refinement,{country,menu,routes}):context&&{city:context.city,country:context.country,menu:context.menu,routes:context.routes||[context.route].filter(Boolean)};
  const period=timeText?periodFrom(timeText,clock):context&&{departureFrom:context.departureFrom,departureTo:context.departureTo,periodLabel:context.periodLabel,dateMode:context.dateMode||'departure'};
  if(!destination)return {kind:'product_clarify',message:'กรุณาระบุจุดหมายที่ค้นหา เช่น “ซินเจียง” หรือ “ฮาร์บิน”'};
  if(!period)return {kind:'product_clarify',message:'กรุณาระบุเดือน ฤดูกาล หรือช่วงวันเดินทาง เช่น “ต.ค.” “หน้าหนาว” หรือ 1/10/2569-31/10/2569'};
  let requiredSeats=destinationText&&!routeRefinement?1:context?.requiredSeats||1;
  if(seatsText){const match=/(\d{1,3})/.exec(seatsText),thai={หนึ่ง:1,สอง:2,สาม:3,สี่:4,ห้า:5,หก:6,เจ็ด:7,แปด:8,เก้า:9,สิบ:10};requiredSeats=match?Number(match[1]):Object.entries(thai).find(([word])=>seatsText.includes(word))?.[1];}
  if(!Number.isSafeInteger(requiredSeats)||requiredSeats<1||requiredSeats>999)return {kind:'product_clarify',message:'กรุณาระบุจำนวนผู้เดินทาง 1–999 คน'};
  return {kind:'search_products',...destination,...period,requiredSeats,rangeDisplay:`${displayDate(period.departureFrom)}–${displayDate(period.departureTo)}`};
}

const catalogKey=entry=>entry.key||`${entry.scope}|${entry.scope==='country'?entry.country:`${entry.menu}|${entry.route}`}`;
export function resolveCatalogProductQuery({destinationText,timeText,seatsText,destinationKeys=[],followup=false}={},catalog,context=null,clock=Date.now){
  const byKey=new Map(catalog.map(entry=>[catalogKey(entry),entry]));
  const selected=destinationKeys.map(key=>byKey.get(key));
  if(selected.some(entry=>!entry)||selected.length>4)return {kind:'product_clarify',message:'ไม่พบจุดหมายนี้ในตัวกรองเว็บไซต์ กรุณาระบุชื่ออื่นค่ะ'};
  const targets=selected.length?selected.map(entry=>({scope:entry.scope,country:entry.country||'',menu:entry.menu||'',route:entry.route||'',label:entry.label}))
    :followup&&context?.targets?context.targets:null;
  if(!targets?.length)return {kind:'product_clarify',message:'กรุณาระบุจุดหมายที่ค้นหาค่ะ'};
  const period=timeText?periodFrom(timeText,clock):followup&&context&&{departureFrom:context.departureFrom,departureTo:context.departureTo,periodLabel:context.periodLabel,dateMode:context.dateMode||'departure'};
  if(!period)return {kind:'product_clarify',message:'กรุณาระบุเดือน ฤดูกาล หรือช่วงวันเดินทาง เช่น “ต.ค.” “หน้าหนาว” หรือ 1/10/2569-31/10/2569'};
  let requiredSeats=followup?context?.requiredSeats||1:1;
  if(seatsText){const normalized=normalizeDigits(seatsText),match=/(\d{1,3})/.exec(normalized),thai={หนึ่ง:1,สอง:2,สาม:3,สี่:4,ห้า:5,หก:6,เจ็ด:7,แปด:8,เก้า:9,สิบ:10};requiredSeats=match?Number(match[1]):Object.entries(thai).find(([word])=>normalized.includes(word))?.[1];}
  if(!Number.isSafeInteger(requiredSeats)||requiredSeats<1||requiredSeats>999)return {kind:'product_clarify',message:'กรุณาระบุจำนวนผู้เดินทาง 1–999 คน'};
  const labels=targets.map(target=>target.label||target.route||target.country);
  return {kind:'search_products',city:destinationText||labels.join(', '),targets,routes:labels,...period,requiredSeats,rangeDisplay:`${displayDate(period.departureFrom)}–${displayDate(period.departureTo)}`};
}

function isPureRefinement(value,{routeText,period,seats}){
  let rest=compact(value);
  if(seats)rest=rest.replace(compact(seats),'');
  if(routeText)rest=rest.replace(compact(routeText),'');
  for(const word of ['เปลี่ยนเป็น','เปลี่ยน','เฉพาะ','อย่างน้อย','ต้องการ','เอา','ขอ','เป็น','ครับ','ค่ะ','คะ','นะ','หน่อย'])rest=rest.replaceAll(compact(word),'');
  if(period){
    for(const names of MONTHS)for(const name of names)rest=rest.replaceAll(compact(name),'');
    for(const word of ['ปีใหม่','หน้าหนาว','ฤดูหนาว','ฤดูใบไม้ผลิ','สงกรานต์','หน้าร้อน','ฤดูร้อน','ฤดูใบไม้ร่วง','ใบไม้ร่วง','winter','spring','summer','autumn','fall','เดือนนี้','เดือนหน้า','ต้นเดือน','กลางเดือน','ปลายเดือน','ต้น','กลาง','ปลาย','ช่วงวันที่ระบุ','เดือน','ปีนี้','ปี','พศ','วันที่','วัน','ถึง','to'])rest=rest.replaceAll(compact(word),'');
    rest=rest.replace(/[0-9/\-–]/g,'');
  }
  return rest==='';
}

export function parseProductQuery(text, clock=Date.now, context=null) {
  const window=travelWindow(text,clock);if(window?.error)return {kind:'product_clarify',message:window.error};
  const source=normalizeOperational(text),explicit=/^\/search\b/i.test(source),value=source.replace(/^\/search\s*/i,'');
  const destinations=DESTINATIONS.filter(item=>item.pattern.test(value));
  if(destinations.length>1)return {kind:'product_clarify',message:'กรุณาระบุจุดหมายครั้งละหนึ่งแห่งค่ะ'};
  const destination=destinations[0],destinationText=destination&&value.match(destination.pattern)?.[0];
  const routeText=context?.city==='ซินเจียง'?value.match(/เหนือ|ใต้|ตะวันตก|northern?|southern?|western?/i)?.[0]:null;
  const period=periodFrom(value,clock);
  const seats=/(?:เอา|อย่างน้อย|เหลือ)?\s*(?:\d{1,3}|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*(?:คน|ที่นั่ง|ที่)/.exec(value)?.[0];
  const availability=/(?:โปรแกรม|ทัวร์|รับได้|มีที่|ว่าง|เหลือ)/i.test(value);
  const refinement=Boolean(context&&!destinationText&&(routeText||period||seats)&&isPureRefinement(value,{routeText,period,seats}));
  if(!explicit&&!refinement&&!(destination&&(period||availability)))return null;
  return resolveProductQuery({destinationText:destinationText||routeText,timeText:period?value:null,seatsText:seats},refinement?context:null,clock);
}

async function configure(page, query, category, target) {
  if(target.scope==='route'){
    const menu=page.locator('#frm_search [name="menu[]"]');
    const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/report/get_control_multi_sub_menu'&&r.request().method()==='POST');
    const [response]=await Promise.all([responsePromise,menu.selectOption({label:target.menu},{force:true})]);
    if(!response.ok()||typeof (await response.json()).result!=='string')throw Error('Route options failed');
    await page.waitForFunction(()=>document.querySelectorAll('#frm_search [name="sub_menu[]"] option').length>1);
  }
  const result=await page.evaluate(({query,category,fields,ownerDomains})=>{
    const form=document.querySelector('#frm_search');if(!form)return {error:'Missing report form'};
    const elements=name=>[...form.querySelectorAll(`[name="${name}"]`)];
    const setValues=(name,values)=>{const select=elements(name)[0];if(!select)return false;for(const option of select.options)option.selected=values.includes(option.value);return true;};
    const valuesForLabels=(name,labels,prefix=false)=>{const select=elements(name)[0];if(!select)return null;return labels.map(label=>[...select.options].find(o=>{const actual=o.textContent.replace(/\s+/g,' ').trim().toLowerCase(),expected=label.toLowerCase();return prefix?actual.startsWith(expected):actual===expected;})?.value).filter(Boolean);};
    const setRadio=(name,value)=>{const input=elements(name).find(e=>e.value===value);if(!input)return false;input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));return true;};
    const target=query.target,websites=valuesForLabels('website[]',ownerDomains,true);
    const country=target.scope==='country'?valuesForLabels('country[]',[target.country]):[];
    const menu=target.scope==='route'?valuesForLabels('menu[]',[target.menu]):[];
    const route=target.scope==='route'?valuesForLabels('sub_menu[]',[target.route]):[];
    if(websites?.length!==ownerDomains.length||target.scope==='country'&&country?.length!==1||target.scope==='route'&&(menu?.length!==1||route?.length!==1))return {error:'Required report option unavailable'};
    for(const input of elements('fieldShow[]'))input.checked=fields.includes(input.value);
    setRadio('type_package','jointour');setValues('website[]',websites);setRadio('show_format','advanced');
    setValues('group_show',['package_name']);setValues('country[]',country);setValues('menu[]',menu);setValues('sub_menu[]',route);
    setValues('airline',['']);setValues('package_visible',['1']);setValues('visible[]',[category==='open'?'1':'2']);setValues('status_seat',['1']);
    const start=form.querySelector('[name="start_date"]'),end=form.querySelector('[name="end_date"]');start.value=query.rangeDisplay.split('–')[0];end.value=query.rangeDisplay.split('–')[1];
    return {websites:[...form.querySelector('[name="website[]"]').selectedOptions].map(o=>o.textContent.trim()),routes:[...form.querySelector('[name="sub_menu[]"]').selectedOptions].map(o=>o.textContent.trim())};
  },{query:{...query,target},category,fields:FIELDS,ownerDomains:[...OWNERS.keys()]});
  if(result.error){const error=Error(result.error);error.code='UNKNOWN_DESTINATION';throw error;}
}

export function productReadError(error){
  if(error.code)return error;
  error.code=error.name==='TimeoutError'?'REPORT_TIMEOUT':/net::ERR_|ECONNRESET|ECONNREFUSED/.test(error.message)?'REPORT_TRANSIENT':/Incomplete product pagination/.test(error.message)?'REPORT_INCOMPLETE':'REPORT_INVALID';
  return error;
}

export async function readProductSearch(config,query,clock=Date.now){
  for(let attempt=0;attempt<2;attempt++){
    const started=Date.now();
    config.signal?.throwIfAborted();
    try{return await readProductSearchOnce(config,query,clock);}
    catch(cause){const error=productReadError(cause);console.error(JSON.stringify({event:'product_read_failure',stage:error.stage||'report',code:error.code,durationMs:Date.now()-started,attempt:attempt+1,filters:{routes:query.routes,from:query.departureFrom,to:query.departureTo,mode:query.dateMode||'departure',seats:query.requiredSeats}}));if(config.signal?.aborted||attempt||!['REPORT_TIMEOUT','REPORT_TRANSIENT'].includes(error.code))throw error;}
  }
}

async function readProductSearchOnce(config, query, clock=Date.now) {
  const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true});
  const abort=()=>void browser.close().catch(()=>{});config.signal?.addEventListener('abort',abort,{once:true});
  let stage='session';
  try{
    config.signal?.throwIfAborted();
    const context=await browser.newContext({storageState:config.storageState,serviceWorkers:'block'});
    await context.route('**/*',route=>{const req=route.request();return allowedProductRequest(req.url(),req.method(),config.baseUrl)?route.continue():route.abort();});
    const page=await context.newPage();page.setDefaultTimeout(config.searchTimeoutMs||25000);
    await page.goto(new URL(REPORT_PATH,config.baseUrl).href,{waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('#frm_search, input[type="password"]').first().waitFor({state:'visible'}).catch(()=>{});
    if(new URL(page.url()).pathname.startsWith('/member/login')||await page.locator('input[type="password"]').count()){const error=Error('Booking session expired');error.code='SESSION_EXPIRED';throw error;}
    if(new URL(page.url()).pathname!==REPORT_PATH||await page.locator('#frm_search').count()!==1)throw Error('Product report page changed');
    const raw=[];
    for(const target of queryTargets(query))for(const category of ['open','automatic']){
      stage='configure';await configure(page,query,category,target);stage='search_response';
      await page.locator('#report_seller').evaluate(el=>el.replaceChildren());
      const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname===SEARCH_PATH&&response.request().method()==='POST');
      const [response]=await Promise.all([responsePromise,page.locator('#frm_search .report_search').click()]);
      if([401,403].includes(response.status()))throw Object.assign(Error('Session expired'),{code:'SESSION_EXPIRED'});
      if(!response.ok())throw Object.assign(Error('Product report request failed'),{code:[502,503,504].includes(response.status())?'REPORT_TRANSIENT':'REPORT_INVALID'});
      stage='report_structure';let payload;try{payload=await response.json();}catch{throw Error('Invalid product report response');}
      if(typeof payload.strHtml!=='string'||typeof payload.setting!=='string')throw Error('Invalid product report response');
      const responseText=payload.strHtml.replace(/<[^>]+>/g,' ').replace(/&nbsp;|\s+/g,' ').trim();
      if(!/<table[\s>]/i.test(payload.strHtml)){
        if(!responseText||/^(?:ไม่พบข้อมูล(?:ที่ค้นหา)?|ไม่มีข้อมูล|ไม่พบรายการ|no data|data not found)[.!\s]*$/i.test(responseText))continue;
        throw Error('Invalid product report response');
      }
      // Match the rendered table to this response, never to a previous search.
      await page.waitForFunction(html=>{const template=document.createElement('template');template.innerHTML=html;const expected=template.content.querySelector('table');const actual=document.querySelector('#report_seller table');const rows=table=>JSON.stringify([...table.rows].filter(row=>!row.querySelector('a[data-page]')&&[...row.cells].some(cell=>cell.textContent.trim())).map(row=>[...row.cells].map(cell=>cell.textContent.replace(/\s+/g,' ').trim())));return expected&&actual&&rows(expected)===rows(actual)&&!document.querySelector('#report_seller .spiner-example');},payload.strHtml);
      raw.push(...await page.evaluate(projectProductReport,category));
    }
    stage='validate_rows';return summarizeProducts(raw,query,config.baseUrl,new Date(clock()).toISOString());
  }catch(error){error.stage=stage;throw error;}finally{config.signal?.removeEventListener('abort',abort);await browser.close();}
}

const optionCatalog=select=>[...select.options].map(option=>({value:option.value,label:(option.textContent||'').replace(/\s+/g,' ').trim()})).filter(option=>option.value&&option.label&&!/^[-\s]*เลือก/i.test(option.label));
const optionCatalogHtml=html=>{const template=document.createElement('template');template.innerHTML=html;return [...template.content.querySelectorAll('option')].map(option=>({value:option.value,label:(option.textContent||'').replace(/\s+/g,' ').trim()})).filter(option=>option.value&&option.label&&!/^[-\s]*เลือก/i.test(option.label));};
export async function readProductCatalog(config, clock=Date.now){
  const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true});
  const abort=()=>void browser.close().catch(()=>{});config.signal?.addEventListener('abort',abort,{once:true});
  try{
    const context=await browser.newContext({storageState:config.storageState,serviceWorkers:'block'});
    await context.route('**/*',route=>{const request=route.request();return allowedProductRequest(request.url(),request.method(),config.baseUrl)?route.continue():route.abort();});
    const page=await context.newPage();page.setDefaultTimeout(config.searchTimeoutMs||25000);
    await page.goto(new URL(REPORT_PATH,config.baseUrl).href,{waitUntil:'domcontentloaded',timeout:45000});
    if(new URL(page.url()).pathname.startsWith('/member/login')||await page.locator('input[type="password"]').count()){const error=Error('Booking session expired');error.code='SESSION_EXPIRED';throw error;}
    if(await page.locator('#frm_search').count()!==1)throw Error('Product report page changed');
    const base=await page.locator('#frm_search [name="country[]"]').evaluate(optionCatalog);
    const menus=await page.locator('#frm_search [name="menu[]"]').evaluate(optionCatalog);
    const entries=base.map(item=>({key:`country|${item.label}`,scope:'country',label:item.label,country:item.label,menu:'',route:''}));
    const menuSelect=page.locator('#frm_search [name="menu[]"]');
    for(const menu of menus){
      config.signal?.throwIfAborted();
      let html='';
      for(let attempt=0;attempt<2&&!/<option[\s>]/i.test(html);attempt++){
        await menuSelect.selectOption({index:0},{force:true});await page.waitForTimeout(attempt?300:75);
        const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/report/get_control_multi_sub_menu'&&r.request().method()==='POST');
        const [response]=await Promise.all([responsePromise,menuSelect.selectOption(menu.value,{force:true})]);
        if(!response.ok())continue;
        const responseText=await response.text();html=responseText;
        try{const payload=JSON.parse(responseText);html=payload.result;}catch{}
      }
      if(typeof html==='string'&&/A PHP Error was encountered/i.test(html)&&/Undefined variable:\s*data/i.test(html))continue;
      if(typeof html!=='string'||!/<option[\s>]/i.test(html))throw Error(`Invalid route catalog response for ${menu.label}`);
      const routes=await page.evaluate(optionCatalogHtml,html);
      for(const route of routes)entries.push({key:`route|${menu.label}|${route.label}`,scope:'route',label:route.label,country:'',menu:menu.label,route:route.label});
    }
    const unique=[...new Map(entries.map(entry=>[entry.key,entry])).values()];
    if(!unique.length)throw Error('Empty product catalog');
    return {entries:unique,readAt:new Date(clock()).toISOString()};
  }finally{config.signal?.removeEventListener('abort',abort);await browser.close();}
}

export const PRODUCT_OWNERS=[...OWNERS.values()];
