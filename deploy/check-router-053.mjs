import assert from 'node:assert/strict';
import { readProductSearch,resolveProductQuery } from '../product-search.mjs';
import { interpret,safeModelText,validatePlan } from '../workflow.mjs';

const clock=()=>Date.parse('2026-09-18T09:00:00Z');
const config={baseUrl:'https://www.qualityb2bpackage.com',storageState:process.env.B2B_STORAGE_STATE,openaiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-5.4-mini'};
const text='ฉงชิ่ง ต.ค.';
const previous=resolveProductQuery({destinationText:'ชิงเต่า',timeText:'ต.ค.',country:'China',menu:'China',routes:['Qingdao']},null,clock);

assert.equal(safeModelText(text),null);
assert.equal(safeModelText(text,previous),text);
const draft=await interpret(config,text,previous,AbortSignal.timeout(20000));
const [query]=validatePlan(draft,text,previous,clock);
assert.equal(query.city,'ฉงชิ่ง');
assert.equal(query.departureFrom,'2026-10-01');
assert.equal(query.departureTo,'2026-10-31');
assert.deepEqual(query.routes,['Chongqing']);

const facts=await readProductSearch(config,query,clock);
assert.ok(facts.departures.every(row=>row.route==='Chongqing'));
console.log(JSON.stringify({city:query.city,routes:query.routes,programs:facts.programCount,departures:facts.departureCount}));
console.log('ROUTER_053_LIVE_ACCEPTANCE_PASSED');
