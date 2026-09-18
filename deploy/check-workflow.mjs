import assert from 'node:assert/strict';
import { readProductSearch,parseProductQuery } from '../product-search.mjs';
import { productPage } from '../product-format.mjs';
import { interpret,validatePlan } from '../workflow.mjs';

const config={baseUrl:'https://www.qualityb2bpackage.com',storageState:process.env.B2B_STORAGE_STATE,openaiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-5.4-mini'};
async function verifyLive(text){
  const query=parseProductQuery('/search '+text),facts=await readProductSearch(config,query);
  let offset=0,displayed=0,pages=0;
  while(offset!==null){
    const page=productPage({...query,offset},facts);assert.ok(page.text.length<=4500);assert.ok(page.displayed||facts.departureCount===0);
    for(const code of [...page.text.matchAll(/รหัสทัวร์: ([^\n]+)/g)].map(match=>match[1]))assert.ok(facts.departures.some(row=>row.tourCode===code));
    displayed+=page.displayed;pages++;offset=page.nextOffset;
  }
  assert.equal(displayed,facts.departureCount);
  return {programs:facts.programCount,departures:facts.departureCount,pages,readAt:facts.readAt};
}
const harbin=await verifyLive('ฮาร์บิน ปีใหม่'),xinjiang=await verifyLive('ซินเจียง หน้าหนาว');
console.log(JSON.stringify({liveFormat:'passed',harbin,xinjiang,modelConfigured:Boolean(config.openaiKey)}));
if(!config.openaiKey)throw Error('Workflow model is not configured');
async function plan(text,context=null){
  const draft=await interpret(config,text,context,AbortSignal.timeout(20000));
  const [intent]=validatePlan(draft,text,context,Date.now);assert.equal(intent.kind,'search_products');return intent;
}
const initial=await plan('ขอซินเจียงหน้าหนาว');assert.equal(initial.routes.length,4);
const north=await plan('เฉพาะเหนือ',initial);assert.deepEqual(north.routes,['Northern Xinjaing']);
const october=await plan('เปลี่ยนเป็น ต.ค.',initial);assert.equal(october.departureFrom.slice(5,7),'10');
console.log('THAI_WORKFLOW_MODEL_ACCEPTANCE_PASSED');
