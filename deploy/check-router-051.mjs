import assert from 'node:assert/strict';
import { parseIntent } from '../booking.mjs';
import { readLiveList } from '../live-booking.mjs';
import { readProductSearch } from '../product-search.mjs';
import { productPage } from '../product-format.mjs';

const clock=()=>Date.parse('2026-09-18T09:00:00Z');
const config={baseUrl:'https://www.qualityb2bpackage.com',storageState:process.env.B2B_STORAGE_STATE};
const shorthand=parseIntent('ซินเจียง ต.ค.',clock);
assert.equal(shorthand.kind,'search_products');
assert.equal(shorthand.departureFrom,'2026-10-01');
assert.equal(shorthand.departureTo,'2026-10-31');
assert.equal(shorthand.requiredSeats,1);

const typo=parseIntent('ซินเจียง ต.ค. 4 ที่ มีที่เรียดใหนรับได้มั่ง',clock);
assert.equal(typo.kind,'search_products');
assert.equal(typo.requiredSeats,4);
const products=await readProductSearch(config,typo,clock);
const first=productPage(typo,products);
assert.ok(first.text.length<=4500);
assert.match(first.text,/ต้องการที่นั่ง: อย่างน้อย 4 ที่นั่ง/);
assert.ok(products.departures.every(row=>row.remaining>=4));

const codeText='2UURC7NURCCA261226\nจองแล้วกี่ที่';
const tourIntent=parseIntent(codeText,clock);
assert.deepEqual(tourIntent,{kind:'by_tour_code',code:'2UURC7NURCCA261226'});
const tour=await readLiveList(config,tourIntent.code,clock);
assert.equal(tour.tourCode,tourIntent.code);
assert.ok(Number.isSafeInteger(tour.activeBookingCount));
assert.ok(Number.isSafeInteger(tour.seatPax));
assert.ok(Number.isSafeInteger(tour.nonSeatPax));

console.log(JSON.stringify({router:'passed',productPrograms:products.programCount,productDepartures:products.departureCount,tour:{activeBookings:tour.activeBookingCount,passengers:tour.paxTotal,seatPassengers:tour.seatPax,nonSeatPassengers:tour.nonSeatPax},readAt:{product:products.readAt,tour:tour.readAt}}));
