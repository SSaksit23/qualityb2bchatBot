import assert from 'node:assert/strict';
import { readProductCatalog,readProductSearch } from '../product-search.mjs';
import { catalogContainer,interpretCatalog,validateCatalogPlan } from '../workflow.mjs';

const clock=()=>Date.parse('2026-09-18T09:00:00Z');
const config={baseUrl:'https://www.qualityb2bpackage.com',storageState:process.env.B2B_STORAGE_STATE,openaiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-5.4-mini'};
const catalog=(await readProductCatalog(config,clock)).entries;
assert.ok(catalog.length>10);

for(const [text,expected] of [['ปักกิ่ง ปีใหม่ จอง 5 ที่','Beijing'],['โปรแกรม ฉงชิ่ง ต.ค. จอง 5 ที่','Chongqing'],['โอซาก้า เดือนหน้า 2 ที่','Osaka']]){
  const container=catalogContainer(text,null,clock);assert.ok(container);
  const plan=await interpretCatalog(config,{...container,catalogVersion:'live'},catalog,AbortSignal.timeout(20000));
  const query=validateCatalogPlan(plan,container,catalog,null,clock);
  console.log(JSON.stringify({text,selected:query.targets.map(target=>({menu:target.menu,route:target.route,label:target.label}))}));
  assert.ok(query.targets.length>=1&&query.targets.length<=4);assert.ok(query.targets.every(target=>target.scope==='route'&&target.route===expected));
  const facts=await readProductSearch(config,query,clock);
  assert.ok(facts.departures.every(row=>row.route===expected&&row.remaining>=query.requiredSeats));
  console.log(JSON.stringify({text,route:expected,menus:query.targets.map(target=>target.menu),programs:facts.programCount,departures:facts.departureCount}));
}
console.log(JSON.stringify({catalogEntries:catalog.length}));
console.log('ROUTER_060_LIVE_ACCEPTANCE_PASSED');
