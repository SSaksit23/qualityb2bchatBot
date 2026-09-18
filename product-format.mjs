export function orderedDepartures(rows) {
  const result=[];
  for(const category of ['open','automatic']){
    const groups=new Map();
    for(const row of rows.filter(r=>r.category===category)){
      const key=JSON.stringify([row.owner,row.program]);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(row);
    }
    const compare=(a,b)=>a.departureDate.localeCompare(b.departureDate)||a.startingPrice-b.startingPrice||a.tourCode.localeCompare(b.tourCode);
    const sorted=[...groups.values()].map(group=>group.sort(compare)).sort((a,b)=>compare(a[0],b[0])||a[0].program.localeCompare(b[0].program));
    result.push(...sorted.flat());
  }
  return result;
}

export function productPage(intent,result,budget=4500) {
  const date=value=>new Date(value+'T00:00:00+07:00').toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'short',year:'numeric'});
  const at=new Date(result.readAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'});
  const rows=orderedDepartures(result.departures),offset=intent.offset||0;
  const header=[`${result.query.city}${result.query.periodLabel?' '+result.query.periodLabel:''}`,
    `วันออกเดินทาง: ${date(result.query.departureFrom)}–${date(result.query.departureTo)}`,
    `ค้นเส้นทาง: ${(result.query.routes||[result.query.route]).join(', ')}`,
    'ค้นเฉพาะ: Go365, 2U Center และ Teetiao',
    `พบทั้งหมด: ${result.programCount} โปรแกรม รวม ${rows.length} รอบเดินทาง`,
    result.query.requiredSeats>1?`ต้องการที่นั่ง: อย่างน้อย ${result.query.requiredSeats} ที่นั่ง`:null].filter(Boolean).join('\n');
  const footer=count=>`${offset+count<rows.length?`\n\nยังมีอีก ${rows.length-offset-count} รอบ\nพิมพ์ “ดูต่อ” เพื่อดูรอบถัดไป`:''}\n\nตรวจสอบเมื่อ: ${at} น. (เวลาไทย)\nดูรายงาน: ${result.source}\n\nที่นั่งเป็นข้อมูลขณะตรวจ ยังไม่ได้กันที่นั่ง`;
  let body=header,count=0,priorCategory='',priorGroup='';
  for(const row of rows.slice(offset,offset+5)){
    const group=JSON.stringify([row.owner,row.program]);let block='';
    if(row.category!==priorCategory){block+='\n\n'+(row.category==='open'?'เปิดรับจองตามรายงาน':'ต้องตรวจสอบเงื่อนไขกับเว็บไซต์\nรอบต่อไปนี้ใช้สถานะตรวจสอบเงื่อนไขอัตโนมัติ');priorGroup='';}
    if(group!==priorGroup)block+=(priorGroup?'\n\n\n':'\n\n')+`${row.program} — ${row.owner}\n\n`;
    else block+='\n\n';
    block+=[`วันเดินทาง: ${date(row.departureDate)}–${date(row.returnDate)}`,`สายการบิน: ${row.airline||'ไม่ระบุ'}`,`ที่นั่งคงเหลือ: ${row.remaining} ที่นั่ง`,`ราคาเริ่มต้น: ${row.startingPrice.toLocaleString('th-TH')} บาท`,`รหัสทัวร์: ${row.tourCode}`].join('\n');
    if((body+block+footer(count+1)).length>budget)break;
    body+=block;count++;priorCategory=row.category;priorGroup=group;
  }
  if(!count){
    const reason=rows.length===0?'ไม่พบรอบที่ตรงเงื่อนไขนี้':offset>=rows.length?'ไม่มีผลชุดถัดไป':'รายละเอียดโปรแกรมยาวเกินข้อความ LINE กรุณาดูรายงานจากลิงก์';
    return {text:`${header}\n\n${reason}\n\nตรวจสอบเมื่อ: ${at} น. (เวลาไทย)\nดูรายงาน: ${result.source}\n\nที่นั่งเป็นข้อมูลขณะตรวจ ยังไม่ได้กันที่นั่ง`,nextOffset:null,displayed:0};
  }
  return {text:body+footer(count),displayed:count,nextOffset:offset+count<rows.length?offset+count:null};
}
