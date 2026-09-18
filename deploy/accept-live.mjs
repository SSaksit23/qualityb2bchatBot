import assert from 'node:assert/strict';
import {readLiveList} from '../live-booking.mjs';
const config={baseUrl:'https://www.qualityb2bpackage.com',storageState:'/var/lib/qualityb2b-bobo/auth/state.json'};
// Reference examples verified 2026-09-18. Business values may change; review fresh results.
for(const code of ['TTTAO5NTAOQW261105','BK2026000375477','TTUNKNOWN999999','TTNGO4NNRTXJ261006A','BK2026000378928']){
 const {bookings,...r}=await readLiveList(config,code);
 assert.equal(r.seatPax+r.nonSeatPax,r.paxTotal);
 if(code==='TTUNKNOWN999999')assert.equal(r.bookingCount,0);
 if(code.startsWith('BK'))assert.equal(bookings.length,1);
 console.log(JSON.stringify(r));
}
await assert.rejects(readLiveList({...config,storageState:{cookies:[],origins:[]}},'TTTAO5NTAOQW261105'),e=>e.code==='SESSION_EXPIRED');
console.log('EMPTY_SESSION_REJECTED');
