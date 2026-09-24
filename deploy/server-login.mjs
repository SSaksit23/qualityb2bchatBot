import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,renameSync,chmodSync,existsSync,unlinkSync} from 'node:fs';
const base='https://www.qualityb2bpackage.com';
const directory='/var/lib/qualityb2b-bobo/auth';
const output=directory+'/state.json',candidate=directory+'/pending-state.json';
const status='/run/qualityb2b-bobo-login/status';
const report=s=>{writeFileSync(status,s+'\n',{mode:0o644});chmodSync(status,0o644);console.log(s);};
const save=(path,state)=>{mkdirSync(directory,{recursive:true,mode:0o700});writeFileSync(path+'.new',JSON.stringify(state),{mode:0o600});chmodSync(path+'.new',0o600);renameSync(path+'.new',path);};
let stage='open_browser';
const browser=await chromium.launch({headless:false,args:['--disable-dev-shm-usage'],timeout:30000});
try{
  // Reuse candidate cookies after a verification failure; never discard the active state.
  const context=await browser.newContext({viewport:{width:1280,height:900},...(existsSync(candidate)?{storageState:candidate}:existsSync(output)?{storageState:output}:{})});
  const page=await context.newPage();
  await page.goto(base+'/booking',{waitUntil:'domcontentloaded',timeout:45000});
  report('WAITING_FOR_OFFICIAL_LOGIN');
  const end=Date.now()+20*60000;
  let attempted=false,verified=false;
  while(Date.now()<end){
    await new Promise(r=>setTimeout(r,1000));
    if(page.isClosed())throw Error('LOGIN_WINDOW_CLOSED');
    // A temporary URL during login is not proof of successful authentication.
    const authenticated=await page.locator('a[href="/member/logout"],a[href="'+base+'/member/logout"]').count();
    if(!authenticated||attempted)continue;
    attempted=true;stage='save_candidate';save(candidate,await context.storageState());
    const verifier=await chromium.launch({headless:true});
    try{
      const check=await verifier.newContext({storageState:candidate});const tab=await check.newPage();
      for(const path of ['/booking','/report/report_seat']){
        stage=path==='/booking'?'booking_verification':'report_verification';
        await tab.goto(base+path,{waitUntil:'domcontentloaded',timeout:45000});
        await tab.locator('#frm_search').waitFor({state:'attached',timeout:20000});
        if(new URL(tab.url()).pathname!==path||await tab.locator('input[type="password"]').count())throw Error('SESSION_REJECTED');
        const selectors=path==='/booking'?['#frm_search input[name="tourcode"]','#booking_list']:['#frm_search [name="website[]"]','#frm_search [name="start_date"]','#frm_search [name="end_date"]'];
        for(const selector of selectors)await tab.locator(selector).waitFor({state:'attached',timeout:20000});
      }
      save(output,await check.storageState());unlinkSync(candidate);verified=true;report('SESSION_SAVED_AND_HEADLESS_VERIFIED');
    }catch(error){
      report(`LOGIN_VERIFICATION_PENDING stage=${stage} code=${error.name==='TimeoutError'?'TIMEOUT':error.message==='SESSION_REJECTED'?'SESSION_REJECTED':'BROWSER_ERROR'}`);
      // Keep the authenticated browser and candidate for inspection, without retrying credentials.
    }finally{await verifier.close();}
    if(verified)break;
  }
  if(!verified){report(attempted?'LOGIN_CANDIDATE_SAVED_NOT_VERIFIED':'LOGIN_TIMED_OUT');process.exitCode=1;}
}catch(error){report(`LOGIN_NOT_VERIFIED stage=${stage} code=${error.name==='TimeoutError'?'TIMEOUT':error.message==='LOGIN_WINDOW_CLOSED'?'WINDOW_CLOSED':'BROWSER_ERROR'}`);process.exitCode=1;}
finally{await browser.close();}
