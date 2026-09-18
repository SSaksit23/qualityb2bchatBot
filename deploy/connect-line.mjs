const endpoint='https://srv1925838.hstgr.cloud/bobo/webhook';
let token=process.env.LINE_CHANNEL_ACCESS_TOKEN;
if(!token){const response=await fetch('https://api.line.me/v2/oauth/accessToken',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:process.env.LINE_CHANNEL_ID,client_secret:process.env.LINE_CHANNEL_SECRET})});if(!response.ok)throw Error(`Token HTTP ${response.status}`);token=(await response.json()).access_token;}
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
const base='https://api.line.me/v2/bot';
const bot=await fetch(base+'/info',{headers}).then(async r=>{if(!r.ok)throw Error(`Bot info HTTP ${r.status}`);return r.json();});
if(bot.userId!=='U72707de51c9321546199e9c039bbdbd5'||bot.basicId!=='@719xcwgl')throw Error('Unexpected bot; refusing to change webhook');
const current=await fetch(base+'/channel/webhook/endpoint',{headers});
if(current.ok){const data=await current.json();if(data.endpoint&&data.endpoint!==endpoint)throw Error('Existing unrelated webhook; refusing to replace');}
else if(current.status!==404)throw Error(`Read webhook HTTP ${current.status}`);
const update=await fetch(base+'/channel/webhook/endpoint',{method:'PUT',headers,body:JSON.stringify({endpoint})});
if(!update.ok)throw Error(`Set webhook HTTP ${update.status}`);
const verify=await fetch(base+'/channel/webhook/test',{method:'POST',headers,body:JSON.stringify({endpoint})});
if(!verify.ok)throw Error(`Verify webhook HTTP ${verify.status}`);
console.log(JSON.stringify(await verify.json()));
