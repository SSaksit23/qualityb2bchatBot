import {createHmac,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const id='smoke-'+randomUUID();
const body=JSON.stringify({destination:process.env.LINE_BOT_USER_ID,events:[{webhookEventId:id,timestamp:Date.now(),type:'message',source:{type:'user',userId:process.env.PILOT_OWNER_ID},message:{id,type:'text',text:'/help'}}]});
const headers={'x-line-signature':createHmac('sha256',process.env.LINE_CHANNEL_SECRET).update(body).digest('base64')};
for(let n=0;n<2;n++){const response=await fetch('https://srv1925838.hstgr.cloud/bobo/webhook',{method:'POST',headers,body});if(response.status!==200)throw Error('Webhook HTTP '+response.status);}
await new Promise(r=>setTimeout(r,3000));
const db=new DatabaseSync('/var/lib/qualityb2b-bobo/bobo.sqlite',{readOnly:true});
console.log(JSON.stringify(db.prepare('SELECT status,attempts FROM jobs WHERE event_id=?').all(id)));db.close();
