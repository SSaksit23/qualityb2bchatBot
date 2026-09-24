import {travelWindow} from './travel-window.mjs';
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { containsSensitive,productFailureMessage } from './booking.mjs';
import { resolveProductQuery, resolveCatalogProductQuery, periodFrom } from './product-search.mjs';

process.env.LANGSMITH_TRACING='false';
process.env.LANGCHAIN_TRACING_V2='false';
process.env.LANGCHAIN_TRACING='false';

export const CLARIFY='กรุณาระบุรหัสบุ๊กกิ้ง รหัสทัวร์ หรือจุดหมายพร้อมเดือน ฤดูกาล หรือช่วงวันเดินทาง โดยไม่ใส่ข้อมูลผู้เดินทางค่ะ';
const CODE=/\b(?:BK\d{13}|(?:GO[123]|2U|TT|RJ)[A-Z0-9-]{3,60})\b/gi;
// Closed operational vocabulary: unknown text is clarified locally, never sent to a model.
const WORDS=('ฮาร์บิน ฮาร์บิ้น harbin ซินเจียง ซินเกียง xinjiang xinjaing เหนือ ใต้ ตะวันตก northern southern western เฉพาะ เปลี่ยนเป็น เปลี่ยน เที่ยว อยาก ปีใหม่ หน้าหนาว ฤดูหนาว ฤดูใบไม้ผลิ สงกรานต์ หน้าร้อน ฤดูร้อน ฤดูใบไม้ร่วง ใบไม้ร่วง winter spring summer autumn fall โปรแกรม ให้น ใหน ไหน ทัวร์ กรุ๊ป กลุ่ม บุ๊กกิ้ง บุ๊คกิ้ง บุ๊ค บุ๊ก จอง บุคกิ้ง booking สถานะ ยอด รวม ทั้งหมด ใช้ตั๋ว ไม่ใช้ตั๋ว ที่นั่งคงเหลือ ที่นั่ง เหลือ อย่างน้อย รับได้ รับ มีที่ว่าง ที่ว่าง ว่าง มี กี่คน กี่ คน ที่ รอบ วันออกเดินทาง วันเดินทาง เดินทาง ตั้งแต่ ถึง วันที่ วัน เดือน เดือนนี้ เดือนหน้า ต้นเดือน กลางเดือน ปลายเดือน ต้น กลาง ปลาย ปี ปีนี้ พศ พ.ศ ราคา เริ่มต้น เท่าไหร่ เท่าไร ได้ไหม ไหม มั้ย หรือ และ แล้ว ด้วย บ้าง ให้ ดู ขอ ช่วย ค้นหา ค้น ตรวจสอบ เช็ค นี้ นั้น ล่าสุด ต่อ เอา เป็น สำหรับ ครับ ค่ะ คะ นะ หน่อย จำนวน ผู้เดินทาง ตั๋ว เปิดรับ ทั้ง แสดง สรุป กับ ข้อมูล คนจอง มกราคม มกรา มค กุมภาพันธ์ กุมภา กพ มีนาคม มีนา มีค เมษายน เมษา เมย พฤษภาคม พฤษภา พค มิถุนายน มิถุนา มิย กรกฎาคม กรกฎา กค สิงหาคม สิงหา สค กันยายน กันยา กย ตุลาคม ตุลา ตค พฤศจิกายน พฤศจิกา พย ธันวาคม ธันวา ธค jan january feb february mar march apr april may jun june jul july aug august sep september oct october nov november dec december สอง สาม สี่ ห้า หก เจ็ด แปด เก้า สิบ หนึ่ง').split(' ').sort((a,b)=>b.length-a.length);
export function safeModelText(text,context=null){
  if(typeof text!=='string'||text.length>1000||containsSensitive(text)||/https?:|@|password|secret|token|ชื่อ|นามสกุล|พาสปอร์ต|ยกเลิก|ยืนยัน|ลบ|แก้ไข|บันทึก|cancel|delete|print|paid/i.test(text))return null;
  const untypedNumbers=text.replace(CODE,'').replace(/\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/g,'').replace(/เดือน\s*\d{1,2}/g,'').replace(/\d{1,2}\s*\/\s*\d{2,4}/g,'').replace(/(?:ปี|พ\.?ศ\.?)\s*\d{2,4}/g,'').replace(/\d{1,3}\s*(?:คน|ที่นั่ง|ที่)/g,'');
  if(/\d/.test(untypedNumbers)||!text.trim())return null;
  let rest=text.replace(CODE,' ').toLowerCase().replaceAll('.','');
  rest=rest.replaceAll('ช่วง','');
  for(const word of WORDS)rest=rest.split(word).join('');
  if(/^[\s\d.,/–—\-?!:]*$/.test(rest))return text.trim();
  const unknown=rest.replace(/[\s\d.,/–—\-?!:]/g,'');
  const dated=/(?:เดือน|ปีใหม่|ฤดู|หน้าหนาว|สงกรานต์|[ก-ฮ]\.?[ก-ฮ]\.?|\d{1,2}\s*\/)/.test(text);
  const destinationRequest=dated&&(/(?:ขอ|เที่ยว|หา|โปรแกรม)/.test(text)||context?.kind==='search_products');
  return destinationRequest&&/^[ก-๙]{2,30}$/.test(unknown)?text.trim():null;
}
const nullableString={type:['string','null']};
export const PLAN_SCHEMA={type:'object',additionalProperties:false,required:['tasks'],properties:{tasks:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,
  required:['kind','code','destinationText','timeText','seatsText','country','menu','routes','followup'],properties:{
    kind:{type:'string',enum:['get','by_tour_code','search_products']},code:nullableString,destinationText:nullableString,timeText:nullableString,seatsText:nullableString,
    country:nullableString,menu:nullableString,routes:{type:'array',maxItems:8,items:{type:'string'}},followup:{type:'boolean'}
  }}}}};
export async function interpret(config,text,context,signal){
  if(!config.openaiKey)throw Error('Planner unavailable');
  const instructions=`Interpret approved Thai operational text into at most 3 read-only tasks. Return no prose.
Use get for a BK code, by_tour_code for a tour code, and search_products for product availability.
For search_products, destinationText, timeText, and seatsText must be exact substrings of the current user text. On a follow-up, set every source field not present in the current message to null; never copy a value or span from context. Propose the website country/menu/routes in English; local code verifies them.
If the current message names a destination, it replaces the destination in context. Never reuse the previous destination when a new destination phrase is present.
Known mappings: ฮาร์บิน=>China/China/Harbin. ซินเจียง=>China/China/Xinjiang,Northern Xinjaing,Southern Xinjiang,Western Xinjiang. เฉพาะเหนือ=>Northern Xinjaing; เฉพาะใต้=>Southern Xinjiang; ตะวันตก=>Western Xinjiang.
Examples: ขอซินเจียงหน้าหนาว => destinationText ซินเจียง, timeText หน้าหนาว. ซินเจียง ต.ค. ปีนี้ 4 คน => destinationText ซินเจียง, timeText ต.ค. ปีนี้, seatsText 4 คน. ขอโปรแกรม ชิงเต่า ต.ค. => destinationText ชิงเต่า, timeText ต.ค., country China, menu China, routes [Qingdao]. เปลี่ยนเป็น ต.ค. => followup true, destinationText null, timeText ต.ค., seatsText null. เฉพาะเหนือ => followup true, destinationText เหนือ, timeText null, seatsText null.
Month/date/season normalization is local. Never invent a code, source substring, date, route, or passenger count. Use empty tasks when unclear or unsupported.`;
  const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),headers:{Authorization:`Bearer ${config.openaiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,store:false,messages:[{role:'system',content:instructions},{role:'user',content:JSON.stringify({text,context})}],response_format:{type:'json_schema',json_schema:{name:'bobo_plan',strict:true,schema:PLAN_SCHEMA}}})});
  if(!response.ok)throw Error('Planner unavailable');
  const data=await response.json();return JSON.parse(data.choices?.[0]?.message?.content||'null');
}
export function validatePlan(plan,text,context,clock=Date.now){
  if(!plan||Object.keys(plan).join()!=='tasks'||!Array.isArray(plan.tasks)||!plan.tasks.length||plan.tasks.length>3)throw Error('Invalid plan');
  const codes=(text.match(CODE)||[]).map(x=>x.toUpperCase());let searches=0;
  return plan.tasks.map(task=>{
    if(!task||Object.keys(task).sort().join()!=='code,country,destinationText,followup,kind,menu,routes,seatsText,timeText'||typeof task.followup!=='boolean')throw Error('Invalid task');
    if(task.followup&&!context)throw Error('Missing context');
    if(task.kind==='search_products'){
      if(++searches>1||task.code!==null)throw Error('Ambiguous searches');
      if(task.followup&&context.kind!=='search_products')throw Error('Invalid followup');
      for(const field of ['destinationText','timeText','seatsText'])if(task[field]!==null&&(typeof task[field]!=='string'||!text.includes(task[field])))throw Error('Invented source text');
      if(!task.followup&&(!task.destinationText||!task.timeText))throw Error('Incomplete search');
      const query=resolveProductQuery(task,task.followup?context:null,clock);
      if(query.kind!=='search_products')throw Error('Invalid product query');
      if(!task.followup&&task.routes.some(route=>!query.routes.includes(route)))throw Error('Unverified route');
      for(const date of [query.departureFrom,query.departureTo])if(new Date(date).toISOString().slice(0,10)!==date)throw Error('Invalid date');
      return {...query,offset:0};
    }
    if(!['get','by_tour_code'].includes(task.kind)||task.destinationText!==null||task.timeText!==null||task.seatsText!==null||task.country!==null||task.menu!==null||task.routes.length)throw Error('Unsupported tool');
    const code=task.code?.toUpperCase()||(task.followup?context.code:null);
    if(!code||!codes.includes(code)&&!(task.followup&&context.code===code))throw Error('Invented code');
    if(!(task.kind==='get'?/^BK\d{13}$/:/^(?:GO[123]|2U|TT|RJ)[A-Z0-9-]{3,60}$/).test(code))throw Error('Wrong code type');
    return {kind:task.kind,code};
  });
}

export async function runWorkflow({config,text,context,clock,signal,planner=interpret,savedPlan,savePlan,execute}){
  const safe=safeModelText(text,context);if(!safe)return CLARIFY;
  const State=Annotation.Root({draft:Annotation(),tasks:Annotation(),replies:Annotation()});
  const graph=new StateGraph(State)
    .addNode('interpret',async()=>{signal.throwIfAborted();return {draft:savedPlan||await planner(config,safe,context,signal)};})
    .addNode('validate',async state=>{signal.throwIfAborted();const tasks=validatePlan(state.draft,safe,context,clock);await savePlan(state.draft);return {tasks};})
    .addNode('read',async state=>{const replies=[];for(const task of state.tasks){signal.throwIfAborted();replies.push(await execute(task));}return {replies};})
    .addNode('format',state=>{signal.throwIfAborted();if(state.replies.some(x=>typeof x!=='string'||!x.length||x.length>4500))throw Error('Invalid reply');return {};})
    .addEdge(START,'interpret').addEdge('interpret','validate').addEdge('validate','read').addEdge('read','format').addEdge('format',END).compile();
  try{const result=await graph.invoke({}, {signal,callbacks:[],recursionLimit:10});return result.replies.length===1?result.replies[0]:result.replies;}
  catch{return signal.aborted?'ใช้เวลาค้นหานานเกินไป กรุณาลองใหม่ค่ะ':CLARIFY;}
}

const TIME_PATTERNS=[
  /\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\s*(?:-|–|ถึง|to)\s*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/i,
  /(?:ปีใหม่|หน้าหนาว|ฤดูหนาว|ฤดูใบไม้ผลิ|สงกรานต์|หน้าร้อน|ฤดูร้อน|ฤดูใบไม้ร่วง|ใบไม้ร่วง|winter|spring|summer|autumn|fall)(?:\s*(?:ปีนี้|ปี\s*\d{2,4}))?/i,
  /(?:ต้น|กลาง|ปลาย)?\s*เดือน(?:นี้|หน้า)/i,
  /(?:ต้น|กลาง|ปลาย)?\s*(?:เดือน\s*)?(?:มกราคม|มกรา|ม\.?ค\.?|กุมภาพันธ์|กุมภา|ก\.?พ\.?|มีนาคม|มีนา|มี\.?ค\.?|เมษายน|เมษา|เม\.?ย\.?|พฤษภาคม|พฤษภา|พ\.?ค\.?|มิถุนายน|มิถุนา|มิ\.?ย\.?|กรกฎาคม|กรกฎา|ก\.?ค\.?|สิงหาคม|สิงหา|ส\.?ค\.?|กันยายน|กันยา|ก\.?ย\.?|ตุลาคม|ตุลา|ต\.?ค\.?|พฤศจิกายน|พฤศจิกา|พ\.?ย\.?|ธันวาคม|ธันวา|ธ\.?ค\.?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*(?:ปีนี้|ปี\s*\d{2,4}|\/?\s*\d{2,4}))?/i,
  /(?:เดือน\s*)?(?:1[0-2]|0?[1-9])(?:\s*(?:\/\s*\d{2,4}|ปี\s*\d{2,4}))?/i,
  /(?:ต้น|กลาง|ปลาย)(?:เดือน)?/i,
];
const SEAT_PATTERN=/(?:เอา|จอง|อย่างน้อย|เหลือ|ต้องการ)?\s*(?:[0-9๐-๙]{1,3}|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*(?:คน|ที่นั่ง|ที่)/i;
const BLOCKED=/https?:|@|password|secret|token|ชื่อ|นามสกุล|พาสปอร์ต|ยกเลิก|ยืนยัน|ลบ|แก้ไข|บันทึก|cancel|delete|print|paid|<[^>]+>|ignore\s+instructions|system\s+prompt/i;
const FILLER=/(?:^|\s)(?:ขอ|หา|ค้นหา|ค้น|ช่วย|ดู|เช็ค|ตรวจสอบ|โปรแกรม|ทัวร์|กรุ๊ป|เที่ยว|มี|ที่ว่าง|ว่าง|รับได้|ไหม|มั้ย|บ้าง|หน่อย|ครับ|ค่ะ|คะ|นะ)(?=\s|$)/gi;
const compactOperational=value=>String(value||'').normalize('NFKC').replace(/[๐-๙]/g,d=>'0123456789'['๐๑๒๓๔๕๖๗๘๙'.indexOf(d)]).replace(/\s+/g,' ').trim();
const span=(source,match)=>{if(!match)return null;const trimmed=match[0].trim(),start=match.index+match[0].indexOf(trimmed),end=start+trimmed.length;return {text:source.slice(start,end),start,end};};

export function catalogContainer(text,context=null,clock=Date.now){
  if(typeof text!=='string'||text.length>1000||!text.trim()||containsSensitive(text)||BLOCKED.test(text))return null;
  const window=travelWindow(text,clock);if(window?.error)return {clarification:window.error};
  const source=String(text).replace(/[๐-๙]/g,d=>'0123456789'['๐๑๒๓๔๕๖๗๘๙'.indexOf(d)]),seatMatch=SEAT_PATTERN.exec(source);
  const timeMatch=window?.match||TIME_PATTERNS.map(pattern=>pattern.exec(source)).find(m=>m&&(!seatMatch||m.index+m[0].length<=seatMatch.index||m.index>=seatMatch.index+seatMatch[0].length));
  if([...source.matchAll(new RegExp(SEAT_PATTERN.source,'gi'))].length>1)return {clarification:'กรุณาระบุจำนวนที่นั่งเพียงจำนวนเดียวค่ะ'};
  if(timeMatch&&!periodFrom(timeMatch[0],clock))return null;
  let destination=source;
  for(const match of [timeMatch,seatMatch].filter(Boolean).sort((a,b)=>b.index-a.index))destination=destination.slice(0,match.index)+' '+destination.slice(match.index+match[0].length);
  destination=destination.replace(/(?:ออกเดินทาง|เดินทาง|มีที่(?:ไหน|ใหน|ใด)รับได้(?:บ้าง|มั่ง)?|มีที่(?:ไหน|ใหน|ใด)บ้าง)/g,' ').replace(FILLER,' ').replace(/(?:เปลี่ยนเป็น|เปลี่ยน|เฉพาะ)/g,' ').replace(/[.,!?()]/g,' ').replace(/\s+/g,' ').trim();
  const explicitRefinement=/(?:เปลี่ยน(?:เป็น)?|เฉพาะ)/.test(source)||!destination&&Boolean(context?.kind==='search_products');
  if(!destination&&!explicitRefinement)return null;
  if(!context?.kind&&!destination||!context?.kind&&!timeMatch&&!seatMatch)return null;
  const destinationIndex=destination?source.indexOf(destination):-1;
  if(destination&&destinationIndex<0)return {clarification:'กรุณาระบุจุดหมายและช่วงวันเดินทางให้ชัดเจนอีกครั้งค่ะ'};
  return {destinationPhrase:destination?{text:destination,start:destinationIndex,end:destinationIndex+destination.length}:null,
    timePhrase:span(text,timeMatch),seatPhrase:span(text,seatMatch),previousSearch:context?.kind==='search_products'?{
      targets:context.targets||[],departureFrom:context.departureFrom,departureTo:context.departureTo,periodLabel:context.periodLabel,dateMode:context.dateMode||'departure',requiredSeats:context.requiredSeats}:null,
    followup:explicitRefinement,catalogVersion:null};
}

const catalogSchema=catalog=>({type:'object',additionalProperties:false,required:['destinationIndexes','suggestionIndexes','ambiguous'],properties:{
  destinationIndexes:{type:'array',maxItems:4,items:{type:'integer',minimum:0,maximum:catalog.length-1}},
  suggestionIndexes:{type:'array',maxItems:3,items:{type:'integer',minimum:0,maximum:catalog.length-1}},ambiguous:{type:'boolean'}}});

export async function interpretCatalog(config,container,catalog,signal){
  if(!config.openaiKey)throw Error('Planner unavailable');
  const visible=catalog.map(({key,scope,label,country,menu,route},index)=>({index,key,scope,label,country,menu,route}));
  const instructions=`Map the Thai or English destination phrase to indexes in the current Quality B2B catalog. Return JSON only. City requests must select route entries only. Country requests must select a country entry. Prefer an exact city/route meaning and do not add nearby cities, provinces, regions, or broader menus. Never infer dates or passenger counts. Select at most four indexes only when the user clearly requests multiple scopes. If one phrase has multiple plausible meanings, set ambiguous true and put up to three likely indexes in suggestionIndexes. If absent, return no destinationIndexes and up to three close suggestions. A follow-up without a destination returns no indexes; local code preserves prior filters.`;
  const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),headers:{Authorization:`Bearer ${config.openaiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,temperature:0,store:false,messages:[{role:'system',content:instructions},{role:'user',content:JSON.stringify({container,catalog:visible})}],response_format:{type:'json_schema',json_schema:{name:'bobo_catalog_match',strict:true,schema:catalogSchema(catalog)}}})});
  if(!response.ok){let detail='';try{const body=await response.json();detail=` ${body.error?.code||''} ${body.error?.message||''}`.trimEnd().slice(0,500);}catch{}throw Error(`Planner unavailable HTTP ${response.status}${detail}`);}
  const data=await response.json();return JSON.parse(data.choices?.[0]?.message?.content||'null');
}

export function validateCatalogPlan(plan,container,catalog,context,clock=Date.now){
  if(!plan||Object.keys(plan).sort().join()!=='ambiguous,destinationIndexes,suggestionIndexes'||!Array.isArray(plan.destinationIndexes)||!Array.isArray(plan.suggestionIndexes)||typeof plan.ambiguous!=='boolean')throw Error('Invalid catalog plan');
  const indexes=[...plan.destinationIndexes,...plan.suggestionIndexes];
  if(plan.destinationIndexes.length>4||plan.suggestionIndexes.length>3||indexes.some(index=>!Number.isInteger(index)||index<0||index>=catalog.length))throw Error('Invalid catalog index');
  if(plan.ambiguous||!plan.destinationIndexes.length&&container.destinationPhrase){const error=Error('Catalog destination unresolved');error.code=plan.ambiguous?'AMBIGUOUS_DESTINATION':'UNKNOWN_DESTINATION';error.suggestions=plan.suggestionIndexes.map(index=>catalog[index]?.label).filter(Boolean);throw error;}
  const destinationKeys=plan.destinationIndexes.map(index=>catalog[index].key);
  const result=resolveCatalogProductQuery({destinationText:container.destinationPhrase?.text,timeText:container.timePhrase?.text,seatsText:container.seatPhrase?.text,destinationKeys,followup:container.followup||!container.destinationPhrase},catalog,context,clock);
  if(result.kind!=='search_products'){const error=Error(result.message);error.code='PRODUCT_CLARIFY';throw error;}
  return result;
}

export async function runCatalogWorkflow({config,text,context,clock,signal,catalog,catalogVersion,planner=interpretCatalog,savedPlan,savePlan,execute,onFailure=()=>{}}){
  const container=catalogContainer(text,context,clock);if(container?.clarification){onFailure('local_rejection');return container.clarification;}if(!container){onFailure('local_rejection');return CLARIFY;}container.catalogVersion=catalogVersion;
  let validatedTask;
  const State=Annotation.Root({draft:Annotation(),task:Annotation(),reply:Annotation()});
  const graph=new StateGraph(State).addNode('interpret',async()=>({draft:savedPlan||await planner(config,container,catalog,signal)}))
    .addNode('validate',async state=>{const task=validateCatalogPlan(state.draft,container,catalog,context,clock);validatedTask=task;await savePlan(state.draft);return {task};})
    .addNode('read',async state=>({reply:await execute(state.task)})).addEdge(START,'interpret').addEdge('interpret','validate').addEdge('validate','read').addEdge('read',END).compile();
  try{const result=await graph.invoke({},{signal,callbacks:[],recursionLimit:8});onFailure('search_success');return result.reply;}
  catch(error){
    if(signal.aborted)return productFailureMessage('REPORT_TIMEOUT',validatedTask);
    const stage=error.code==='UNKNOWN_DESTINATION'||error.code==='AMBIGUOUS_DESTINATION'?'catalog_mismatch':error.code==='PRODUCT_CLARIFY'?'local_rejection':error.code==='BROWSER_FAILURE'||error.code==='SESSION_EXPIRED'||error.code?.startsWith('REPORT_')?'browser_failure':'model_failure';onFailure(stage);
    if(['UNKNOWN_DESTINATION','AMBIGUOUS_DESTINATION'].includes(error.code))return `ไม่พบจุดหมายที่ตรงกันเพียงรายการเดียวในตัวกรองเว็บไซต์${error.suggestions?.length?`\nตัวเลือกใกล้เคียง: ${error.suggestions.join(', ')}`:''}\nกรุณาระบุจุดหมายอีกครั้งค่ะ`;
    if(error.code==='PRODUCT_CLARIFY')return error.message;
    if(stage==='browser_failure'&&error.message)return error.message;
    return CLARIFY;
  }
}
