import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,renameSync,chmodSync} from 'node:fs';
const base='https://www.qualityb2bpackage.com';
const output='/var/lib/qualityb2b-bobo/auth/state.json';
const status='/run/qualityb2b-bobo-login/status';
const report=s=>{writeFileSync(status,s+'\n',{mode:0o644});chmodSync(status,0o644);console.log(s);};
const browser=await chromium.launch({headless:false,args:['--disable-dev-shm-usage'],timeout:30000});
try{
  const context=await browser.newContext({viewport:{width:1100,height:760}});
  const page=await context.newPage();
  await page.goto(base+'/member/login',{waitUntil:'domcontentloaded'});report('WAITING_FOR_OFFICIAL_LOGIN');
  const end=Date.now()+20*60000;
  while(Date.now()<end){
    await new Promise(r=>setTimeout(r,1000));
    if(page.isClosed())throw Error('LOGIN_WINDOW_CLOSED');
    const url=new URL(page.url());
    if(url.origin!==base||url.pathname.startsWith('/member/login'))continue;
    await page.goto(base+'/booking',{waitUntil:'domcontentloaded',timeout:45000});
    if(new URL(page.url()).pathname!=='/booking')continue;
    await page.locator('#frm_search #tourcode').waitFor({state:'visible',timeout:20000});
    await page.locator('#booking_list').waitFor({state:'attached',timeout:20000});
    const state=await context.storageState();
    const verifier=await chromium.launch({headless:true});
    try{
      const check=await verifier.newContext({storageState:state});const tab=await check.newPage();
      await tab.goto(base+'/booking',{waitUntil:'domcontentloaded',timeout:45000});
      await tab.locator('#frm_search #tourcode').waitFor({state:'visible',timeout:20000});
      if(new URL(tab.url()).pathname!=='/booking')throw Error('HEADLESS_SESSION_REJECTED');
    }finally{await verifier.close();}
    mkdirSync('/var/lib/qualityb2b-bobo/auth',{recursive:true,mode:0o700});
    writeFileSync(output+'.new',JSON.stringify(state),{mode:0o600});renameSync(output+'.new',output);
    report('SESSION_SAVED_AND_HEADLESS_VERIFIED');process.exitCode=0;break;
  }
  if(Date.now()>=end)report('LOGIN_TIMED_OUT');
}catch{report('LOGIN_NOT_VERIFIED');process.exitCode=1;}
finally{await browser.close();}
