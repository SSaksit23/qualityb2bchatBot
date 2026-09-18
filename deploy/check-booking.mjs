import {readLiveList} from '../live-booking.mjs';
const result=await readLiveList({baseUrl:'https://www.qualityb2bpackage.com',storageState:process.env.B2B_STORAGE_STATE},process.argv[2]||'TTTAO5NTAOQW261105');
console.log(JSON.stringify({tourCode:result.tourCode,bookingCount:result.bookingCount,paxTotal:result.paxTotal,allotment:result.allotment,statusPax:result.statusPax,readAt:result.readAt}));
