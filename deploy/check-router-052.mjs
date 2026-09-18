import assert from 'node:assert/strict';
import { parseProductQuery,readProductSearch,resolveProductQuery } from '../product-search.mjs';
import { interpret,validatePlan } from '../workflow.mjs';

const clock=()=>Date.parse('2026-09-18T09:00:00Z');
const config={baseUrl:'https://www.qualityb2bpackage.com',storageState:process.env.B2B_STORAGE_STATE,openaiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-5.4-mini'};
const text='ขอโปรแกรม ชิงเต่า ต.ค.';
const previous=resolveProductQuery({destinationText:'ซินเจียง',timeText:'ต.ค.',seatsText:'4 ที่'},null,clock);

assert.equal(parseProductQuery(text,clock,previous),null);
const draft=await interpret(config,text,previous,AbortSignal.timeout(20000));
const [query]=validatePlan(draft,text,previous,clock);
assert.equal(query.city,'ชิงเต่า');
assert.equal(query.departureFrom,'2026-10-01');
assert.equal(query.departureTo,'2026-10-31');
assert.equal(query.requiredSeats,1);
assert.deepEqual(query.routes,['Qingdao']);

const facts=await readProductSearch(config,query,clock);
assert.ok(facts.departures.every(row=>row.route==='Qingdao'));
console.log(JSON.stringify({city:query.city,routes:query.routes,requiredSeats:query.requiredSeats,programs:facts.programCount,departures:facts.departureCount}));
console.log('ROUTER_052_LIVE_ACCEPTANCE_PASSED');
