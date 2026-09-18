import { productPage } from './product-format.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function formatWithHermes(config, request, signal) {
  if (!config.openaiKey || !config.hermesPython) return deterministic(request);
  mkdirSync(config.runtimeDir, { recursive: true, mode: 0o700 });
  const home = mkdtempSync(resolve(config.runtimeDir, 'turn-'));
  try {
    return await new Promise((accept, reject) => {
      const child = spawn(config.hermesPython, [fileURLToPath(new URL('./hermes_worker.py', import.meta.url))], {
        cwd: home, signal, killSignal: 'SIGKILL', stdio: ['pipe','pipe','ignore'],
        env: { PATH:'/usr/bin:/bin', HOME:home, HERMES_HOME:home, XDG_CACHE_HOME:home, TMPDIR:home,
          PYTHONDONTWRITEBYTECODE:'1', PYTHONUNBUFFERED:'1', PYTHONPATH:config.hermesSource,
          OPENAI_API_KEY:config.openaiKey, OPENAI_MODEL:config.model },
      });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 100000) child.kill('SIGKILL'); });
      child.on('error', reject);
      child.on('close', code => { try { if (code) throw Error('Hermes failed'); const parsed=JSON.parse(output); accept(parsed.answer); } catch (e) { reject(e); } });
      child.stdin.end(JSON.stringify(request));
    });
  } finally { rmSync(home, { recursive:true, force:true }); }
}

export function deterministic({ intent, result }) {
  const at = new Date(result.readAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'});
  if (result.unavailable) return `${result.unavailable}\nอ่านเมื่อ ${at}`;
  if (intent.kind === 'search_products') return productPage(intent,result).text;
  if (intent.kind === 'get') return [`${result.code} — ${result.status}`,result.tourCode && `ทัวร์ ${result.tourCode}`,
    result.paxTotal!=null?`ยอดจอง ${result.paxTotal} คน\nใช้ตั๋ว ${result.seatPax} คน / ไม่ใช้ตั๋ว ${result.nonSeatPax} คน`:`ผู้ใหญ่ ${result.adults} / เด็ก ${result.children}`,result.balance != null && `คงเหลือ ${result.balance}`,
    result.lapseAt && `หมดเวลา ${result.lapseAt}`,result.guaranteeDate && `ชำระภายใน ${result.guaranteeDate}`,
    result.bookingUrl,`ข้อมูลล่าสุด ${at} น. (เวลาไทย)`].filter(Boolean).join('\n');
  if (intent.kind === 'by_tour_code') return [`ทัวร์ ${result.tourCode}`,
    result.paxTotal!=null?`ยอดจองทั้งหมด ${result.activeBookingCount} บุ๊กกิ้ง รวม ${result.paxTotal} คน`:`ยอดจองทั้งหมด ${result.bookingCount} บุ๊กกิ้ง\nผู้ใหญ่ ${result.adults} / เด็ก ${result.children}`,
    result.paxTotal!=null&&`ใช้ตั๋ว ${result.seatPax} คน / ไม่ใช้ตั๋ว ${result.nonSeatPax} คน`,
    result.allotment!=null&&`ไซส์กรุ๊ป ${result.allotment} ที่นั่ง`,
    result.excludedBookingCount>0&&`มีรายการยกเลิกหรือถูกปฏิเสธอีก ${result.excludedBookingCount} บุ๊กกิ้ง ไม่รวมในยอดจองข้างต้น`,
    '\nสถานะการจอง',
    ...Object.entries(result.statusBreakdown).map(([k,v])=>`• ${k}: ${v} บุ๊กกิ้ง${result.statusPax?` (${result.statusPax[k]} คน)`:''}`),
    `\nข้อมูลล่าสุด ${at} น. (เวลาไทย)`,result.source&&`ดูรายการจอง: ${result.source}`].filter(Boolean).join('\n');
  if (intent.kind === 'countdown') return [result.deadlines.length ? 'กำหนดเวลาที่พบ:' : 'ไม่พบรายการใกล้กำหนด',
    ...result.deadlines.map(d=>`${d.code} · ${d.status} · ${d.lapseAt ? `หมดเวลา ${d.lapseAt}` : `ชำระภายใน ${d.guaranteeDate}`}`),`อ่านเมื่อ ${at}`].join('\n');
  if (intent.kind === 'missing_fields') return [result.bookings.length ? 'ข้อมูลผู้เดินทางไม่ครบ:' : 'ไม่พบรายการข้อมูลไม่ครบ',
    ...result.bookings.map(b=>`${b.code} · ${b.missing.join(', ')} · ${b.incompleteRows} แถว`),`อ่านเมื่อ ${at}`].join('\n');
  return 'ไม่สามารถสรุปผลได้';
}
