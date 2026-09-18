import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync('/var/lib/qualityb2b-bobo/bobo.sqlite',{readOnly:true});
console.log(JSON.stringify({recent:db.prepare('SELECT received,status,attempts FROM jobs ORDER BY received DESC LIMIT 5').all(),pending:db.prepare("SELECT count(*) count,min(received) oldest FROM jobs WHERE status IN ('pending','processing','ready')").get()}));db.close();
console.log(await(await fetch('http://127.0.0.1:3212/health')).text());
