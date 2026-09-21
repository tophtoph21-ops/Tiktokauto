import {spawn} from 'node:child_process';
const p=spawn(process.execPath,['--experimental-sqlite','server.mjs'],{env:{...process.env,PORT:'3210'},stdio:['ignore','pipe','pipe']});
let err='';p.stderr.on('data',d=>err+=d);await new Promise(r=>setTimeout(r,1200));
try{
  let r=await fetch('http://127.0.0.1:3210/api/state');if(!r.ok)throw new Error('state '+r.status);let s=await r.json();
  r=await fetch('http://127.0.0.1:3210/api/setup/test',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});let h=await r.json();if(!h.ffmpeg)throw new Error('FFmpeg absent');
  r=await fetch('http://127.0.0.1:3210/api/autopilot/run',{method:'POST',headers:{'content-type':'application/json'},body:'{"count":1}'});if(!r.ok)throw new Error(await r.text());let a=await r.json();if(!a.contents?.length)throw new Error('aucun contenu');
  s=await (await fetch('http://127.0.0.1:3210/api/state')).json();const v=s.contents.find(x=>x.video_url);if(!v)throw new Error('aucune vidéo rendue');
  console.log(`OK • API • DB • FFmpeg • rendu vidéo • ${v.video_url}`);
}finally{p.kill('SIGTERM')}
