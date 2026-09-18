import { readFileSync,statSync } from 'node:fs';
import { readLiveList } from './live-booking.mjs';
import { readProductSearch, readProductCatalog, parseProductQuery } from './product-search.mjs';

const BOOKING = /^BK\d{13}$/i;
const TOUR = /^(?:GO[123]|2U|TT|RJ)[A-Z0-9-]{3,60}$/i;
const CODE = /\b(?:BK\d{13}|(?:GO[123]|2U|TT|RJ)[A-Z0-9-]{3,60})\b/gi;
const extractCodes = value => [...new Set([...String(value||'').matchAll(CODE)].map(match=>safeCode(match[0])))];
const safeCode = value => String(value || '').trim().toUpperCase();
const nowIso = clock => new Date(clock()).toISOString();

export class BookingUnavailable extends Error {}

export function createBookingReader(config, { clock = Date.now, fixture } = {}) {
  let queue = Promise.resolve();
  let sessionVersion='',lastReadAt=null,state=config.bookingVerified?'unverified':'disabled';
  let productState=config.productSearchVerified?'unverified':'disabled',productLastReadAt=null;
  function health(){const capabilities=[];if(state==='ready')capabilities.push('tour_totals','booking_status');if(productState==='ready')capabilities.push('product_search');return {state,ready:state==='ready',lastReadAt,productState,productReady:productState==='ready',productLastReadAt,sessionVersion,capabilities};}
  if (!fixture && config.fixtureFile) fixture = JSON.parse(readFileSync(config.fixtureFile, 'utf8'));
  const serial = fn => { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; };
  const stamp = result => ({ ...result, readAt: nowIso(clock), source: config.baseUrl });

  function fromFixture(tool, input) {
    const code = safeCode(input.code || input.query);
    const bookings = fixture?.bookings || [];
    const find = bookings.filter(b => b.code === code || b.tourCode === code);
    if (tool === 'find') return stamp({ matches: find.map(publicBooking) });
    if (tool === 'get') {
      const row = bookings.find(b => b.code === code);
      if (!row) return stamp({ unavailable: 'ไม่พบรหัสการจอง' });
      return stamp(publicBooking(row));
    }
    if (tool === 'by_tour_code') {
      const rows = bookings.filter(b => b.tourCode === code);
      const statusBreakdown = Object.fromEntries([...new Set(rows.map(r => r.status))].map(s => [s, rows.filter(r => r.status === s).length]));
      const adults = rows.reduce((n, r) => n + Number(r.adults || 0), 0);
      const children = rows.reduce((n, r) => n + Number(r.children || 0), 0);
      const allotment = fixture?.departures?.[code]?.allotment ?? null;
      return stamp({ tourCode: code, bookingCount: rows.length, adults, children, allotment,
        impliedRemaining: allotment == null ? null : allotment - adults - children, statusBreakdown,
        bookings: rows.map(({ code, status }) => ({ code, status })) });
    }
    if (tool === 'countdown') {
      const rows = code ? bookings.filter(b => b.code === code || b.tourCode === code) : bookings;
      return stamp({ deadlines: rows.filter(b => b.lapseAt || b.guaranteeDate).map(({ code, status, lapseAt, guaranteeDate }) => ({ code, status, lapseAt, guaranteeDate })) });
    }
    if (tool === 'missing_fields') {
      const rows = bookings.filter(b => (!code || b.code === code || b.tourCode === code) && b.missing?.length);
      return stamp({ bookings: rows.map(({ code, tourCode, missing, incompleteRows = 1 }) => ({ code, tourCode, missing, incompleteRows })) });
    }
    throw new BookingUnavailable('Unknown booking tool');
  }

  async function live(tool, input) {
    if(tool==='search_products'||tool==='product_catalog'){
      if(!config.productSearchVerified)throw new BookingUnavailable('การค้นหาโปรแกรมยังไม่เปิดใช้งาน กรุณาตรวจสอบในเว็บไซต์ Quality B2B');
      if(!config.storageState)throw new BookingUnavailable('ยังไม่ได้เชื่อมต่อเซสชัน Quality B2B');
      let version;try{version=String(statSync(config.storageState).mtimeMs);}catch{productState='missing';throw new BookingUnavailable('ไม่พบเซสชัน Quality B2B กรุณาให้ผู้ดูแลเข้าสู่ระบบบนเซิร์ฟเวอร์');}
      if(version!==sessionVersion){sessionVersion=version;state=config.bookingVerified?'unverified':'disabled';productState='unverified';}
      if(productState==='expired'){const error=new BookingUnavailable('เซสชัน Quality B2B หมดอายุ กรุณาให้ผู้ดูแลเข้าสู่ระบบใหม่');error.code='SESSION_EXPIRED';error.sessionVersion=sessionVersion;throw error;}
      try{const result=tool==='product_catalog'?await readProductCatalog({...config,signal:input.signal},clock):await readProductSearch({...config,signal:input.signal},input,clock);productState='ready';productLastReadAt=result.readAt;return {...result,sessionVersion};}
      catch(error){
        if(error.code==='UNKNOWN_DESTINATION'){const unavailable=new BookingUnavailable('ไม่พบจุดหมายหรือเส้นทางนี้ในตัวกรองเว็บไซต์ กรุณาระบุชื่ออื่นหรือรายละเอียดเพิ่ม');unavailable.code=error.code;throw unavailable;}
        productState=error.code==='SESSION_EXPIRED'?'expired':'unavailable';if(productState==='expired')state='expired';const unavailable=new BookingUnavailable(productState==='expired'?'เซสชัน Quality B2B หมดอายุ กรุณาให้ผู้ดูแลเข้าสู่ระบบบนเซิร์ฟเวอร์ใหม่':'ค้นหาโปรแกรมไม่ได้หรือผลรายงานไม่ครบ กรุณาลองใหม่หรือแจ้งผู้ดูแล');unavailable.code=error.code;unavailable.sessionVersion=sessionVersion;throw unavailable;}
    }
    if(!config.bookingVerified)throw new BookingUnavailable('โบโบ้รับข้อความแล้ว แต่ยังไม่เปิดการอ่านข้อมูลจองจริง กำลังเชื่อมต่อและตรวจสอบระบบ Quality B2B');
    if (!config.storageState) throw new BookingUnavailable('ยังไม่ได้เชื่อมต่อเซสชัน Quality B2B');
    let version;try{version=String(statSync(config.storageState).mtimeMs);}catch{state='missing';throw new BookingUnavailable('ไม่พบเซสชัน Quality B2B กรุณาให้ผู้ดูแลเข้าสู่ระบบบนเซิร์ฟเวอร์');}
    if(version!==sessionVersion){sessionVersion=version;state='unverified';}
    if(state==='expired'){const error=new BookingUnavailable('เซสชัน Quality B2B หมดอายุ กรุณาให้ผู้ดูแลเข้าสู่ระบบใหม่');error.code='SESSION_EXPIRED';error.sessionVersion=sessionVersion;throw error;}
    // Enable only the list-based tools whose live fields have been validated.
    const code=safeCode(input.code||input.query);
    if(!BOOKING.test(code)&&!TOUR.test(code))throw new BookingUnavailable('กรุณาระบุรหัส BK หรือรหัสทัวร์ให้ครบ');
    if(!['by_tour_code','get','find'].includes(tool))throw new BookingUnavailable('ฟังก์ชันกำหนดชำระและตรวจข้อมูลขาดยังอยู่ระหว่างตรวจสอบ กรุณาดูในเว็บไซต์');
    try{
      const result=await readLiveList({...config,signal:input.signal},code,clock);
      state='ready';lastReadAt=result.readAt;
      if(!result.bookingCount)return stamp({unavailable:'ไม่พบรหัสนี้ในรายการจอง'});
      if(tool==='by_tour_code')return result;
      if(tool==='find')return {matches:result.bookings,source:result.source,readAt:result.readAt};
      if(result.bookings.length!==1)throw new BookingUnavailable('พบหลายรายการ กรุณาระบุรหัส BK ให้ตรง');
      const row=result.bookings[0];return {...row,paxTotal:row.seatPax+row.nonSeatPax,source:result.source,readAt:result.readAt};
    }catch(error){
      if(error instanceof BookingUnavailable)throw error;
      state=error.code==='SESSION_EXPIRED'?'expired':'unavailable';
      const unavailable=new BookingUnavailable(state==='expired'?'เซสชัน Quality B2B หมดอายุ กรุณาให้ผู้ดูแลเข้าสู่ระบบบนเซิร์ฟเวอร์ใหม่':'อ่านข้อมูลจองไม่ได้หรือผลค้นหาไม่ครบ กรุณาลองใหม่หรือแจ้งผู้ดูแล');
      unavailable.code=error.code;unavailable.sessionVersion=sessionVersion;throw unavailable;
    }
  }

  const call = (tool, input = {}) => serial(() => {input.signal?.throwIfAborted();return fixture ? fromFixture(tool, input) : live(tool, input);});
  return {
    health,
    find: input => call('find', input), get: input => call('get', input),
    by_tour_code: input => call('by_tour_code', input), countdown: input => call('countdown', input),
    missing_fields: input => call('missing_fields', input),
    search_products: input => call('search_products', input),
    product_catalog: input => call('product_catalog', input),
  };
}

function publicBooking(b) {
  return { code: b.code, tourCode: b.tourCode, status: b.status, adults: Number(b.adults || 0), children: Number(b.children || 0),
    total: b.total ?? null, paid: b.paid ?? null, balance: b.balance ?? null, lapseAt: b.lapseAt || null,
    guaranteeDate: b.guaranteeDate || null, missing: b.missing || [], bookingUrl: b.bookingUrl || null };
}

export function parseIntent(text, clock=Date.now, context=null) {
  const value = String(text || '').trim();
  if (value === '/help') return { kind: 'help' };
  if (value === '/privacy') return { kind: 'privacy' };
  const codes=extractCodes(value);
  if(codes.length>1)return {kind:'product_clarify',message:'กรุณาส่งรหัสบุ๊กกิ้งหรือรหัสทัวร์ครั้งละหนึ่งรหัสค่ะ'};
  const code=codes[0]||'';
  if (/^\/deadlines$|ใกล้หมดเวลา|กำหนดชำระ|เดดไลน์/i.test(value)) return { kind: 'countdown', code };
  if (/^\/missing\b|ข้อมูล.*ไม่ครบ|ขาดข้อมูล/i.test(value)) return { kind: 'missing_fields', code };
  if(BOOKING.test(code))return {kind:'get',code};
  if(TOUR.test(code))return {kind:'by_tour_code',code};
  const product=parseProductQuery(value,clock,context);if(product)return product;
  if (/^\/tour\b|เหลือ.*ที่นั่ง|กี่บุ๊ค|departure/i.test(value)) return { kind: 'by_tour_code', code };
  if (/^\/bk\b|สถานะ|ยอด|booking/i.test(value)) return { kind: 'get', code };
  return { kind: 'unknown' };
}

export function containsSensitive(text) {
  const value = String(text || '');
  return /passport|หนังสือเดินทาง|เลขบัตร|บัตรประชาชน|โทร(?:ศัพท์)?|email|อีเมล/i.test(value)
    || /\b\d{13}\b/.test(value) || /\b0\d{8,9}\b/.test(value);
}
