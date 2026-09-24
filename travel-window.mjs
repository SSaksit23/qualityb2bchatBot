const aliases=[['มกราคม','มกรา','มค'],['กุมภาพันธ์','กุมภา','กพ'],['มีนาคม','มีนา','มีค'],['เมษายน','เมษา','เมย'],['พฤษภาคม','พฤษภา','พค'],['มิถุนายน','มิถุนา','มิย'],['กรกฎาคม','กรกฎา','กค'],['สิงหาคม','สิงหา','สค'],['กันยายน','กันยา','กย'],['ตุลาคม','ตุลา','ตค'],['พฤศจิกายน','พฤศจิกา','พย'],['ธันวาคม','ธันวา','ธค']];
const monthPattern=aliases.flat().sort((a,b)=>b.length-a.length).map(s=>[...s].join('\\.?\\s*')+'\\.?').join('|');
const yearPattern='(?:(?:พ\\.?ศ\\.?|ค\\.?ศ\\.?|ปี)\\s*)?([0-9]{4})(?![0-9])';
const named=new RegExp(`(?<![0-9])([0-9]{1,2})\\s*(?:(${monthPattern})\\s*(?:${yearPattern})?)?\\s*(?:-|–|—|ถึง|to)\\s*([0-9]{1,2})\\s*(${monthPattern})(?:\\s*${yearPattern})?`,'gi');
const numeric=/(?<![0-9])([0-9]{1,2})[/.\-]([0-9]{1,2})[/.\-]([0-9]{4})\s*(?:-|–|—|ถึง|to)\s*([0-9]{1,2})[/.\-]([0-9]{1,2})[/.\-]([0-9]{4})/gi;
const digits=s=>String(s).replace(/[๐-๙]/g,d=>'0123456789'['๐๑๒๓๔๕๖๗๘๙'.indexOf(d)]);
const year=y=>Number(y)>2400?Number(y)-543:Number(y);
const month=s=>aliases.findIndex(a=>a.includes(s.replace(/[.\s]/g,'')))+1;
export function strictDate(y,m,d){
  const value=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const date=new Date(value+'T00:00:00Z');
  return y>=1900&&y<=2200&&!Number.isNaN(+date)&&date.toISOString().slice(0,10)===value?value:null;
}
export function travelWindow(text,clock=Date.now){
  const value=digits(text),matches=[...value.matchAll(named),...value.matchAll(numeric)].sort((a,b)=>a.index-b.index);
  if(!matches.length)return null;
  const error='กรุณาระบุช่วงวันที่ที่ถูกต้องเพียงช่วงเดียว เช่น 10–20 ต.ค. 2569';
  if(matches.length!==1)return {error};
  const match=matches[0],current=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',year:'numeric'}).format(new Date(clock())));
  const isNamed=!!month(match[5]||''),m1=isNamed?month(match[2]||match[5]):Number(match[2]),m2=isNamed?month(match[5]):Number(match[5]);
  const y1=year(match[3]||match[6]||current),y2=year(match[6]||match[3]||current);
  const from=strictDate(y1,m1,Number(match[1])),to=strictDate(y2,m2,Number(match[4]));
  if(!from||!to||from>to)return {error};
  const before=value.slice(0,match.index),cue=/(?:ออกเดินทาง|เดินทางและกลับ|เดินทาง)\s*$/.exec(before);
  const start=cue?cue.index:match.index;let end=match.index+match[0].length;
  const thisYear=/^\s*ปีนี้/.exec(value.slice(end));if(thisYear){if(y1!==current||y2!==current)return {error};end+=thisYear[0].length;}
  const remaining=value.slice(0,start)+' '+value.slice(end);
  if(new RegExp(monthPattern,'i').test(remaining)||/เดือนนี้|เดือนหน้า|ปีใหม่|หน้าหนาว/.test(remaining))return {error};
  return {match:{0:text.slice(start,end),index:start},period:{departureFrom:from,departureTo:to,periodLabel:'ช่วงวันที่ระบุ',dateMode:cue?.[0].includes('ออกเดินทาง')?'departure':'whole_trip'}};
}
