import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';


const AGNES_BASE='https://apihub.agnes-ai.com/v1';

function stripJsonFence(s=''){
  return String(s).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
}
async function agnesFetch(pathname, opts={}, retries=3){
  const key=process.env.AGNES_API_KEY;
  if(!key) throw new Error('AGNES_API_KEY manquante');
  let last;
  for(let i=0;i<retries;i++){
    const r=await fetch(`${AGNES_BASE}${pathname}`,{
      ...opts,
      headers:{
        authorization:`Bearer ${key}`,
        'content-type':'application/json',
        ...(opts.headers||{})
      }
    });
    if(r.ok) return r;
    const body=(await r.text()).slice(0,1200);
    last=new Error(`Agnes ${r.status}: ${body}`);
    if(![429,500,502,503,520].includes(r.status)) throw last;
    await new Promise(res=>setTimeout(res,700*(2**i)));
  }
  throw last;
}

async function agnesJson(prompt){
  const r=await agnesFetch('/chat/completions',{
    method:'POST',
    body:JSON.stringify({
      model:process.env.AGNES_TEXT_MODEL||'agnes-2.0-flash',
      messages:[
        {role:'system',content:'Réponds uniquement avec du JSON valide. Pas de markdown.'},
        {role:'user',content:prompt}
      ],
      stream:false,
      temperature:0.8
    })
  });
  const d=await r.json();
  const raw=d?.choices?.[0]?.message?.content;
  if(!raw) throw new Error('Réponse Agnes texte vide');
  return JSON.parse(stripJsonFence(raw));
}

async function agnesImage(prompt,outFile){
  const r=await agnesFetch('/images/generations',{
    method:'POST',
    body:JSON.stringify({
      model:process.env.AGNES_IMAGE_MODEL||'agnes-image-2.1-flash',
      prompt,
      size:'1024x1792'
    })
  });
  const d=await r.json();
  const item=d?.data?.[0]||d?.output?.[0]||d;
  const b64=item?.b64_json||item?.b64||item?.base64;
  const url=item?.url||item?.image_url;
  if(b64){
    fs.mkdirSync(path.dirname(outFile),{recursive:true});
    fs.writeFileSync(outFile,Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/,''),'base64'));
    return outFile;
  }
  if(url){
    const img=await fetch(url);
    if(!img.ok) throw new Error(`Téléchargement image Agnes ${img.status}`);
    fs.mkdirSync(path.dirname(outFile),{recursive:true});
    fs.writeFileSync(outFile,Buffer.from(await img.arrayBuffer()));
    return outFile;
  }
  throw new Error('Format image Agnes non reconnu');
}

export async function createAgnesVideoTask(prompt){
  const r=await agnesFetch('/videos',{
    method:'POST',
    body:JSON.stringify({
      model:process.env.AGNES_VIDEO_MODEL||'agnes-video-v2.0',
      prompt,
      height:1280,
      width:720,
      num_frames:Number(process.env.AGNES_VIDEO_FRAMES||121),
      frame_rate:24
    })
  });
  const d=await r.json();
  const videoId=d?.video_id||d?.id||d?.data?.video_id;
  if(!videoId) throw new Error('Agnes n’a pas renvoyé de video_id');
  return {video_id:videoId,raw:d};
}

export async function pollAgnesVideo(videoId,{timeoutMs=180000,intervalMs=5000}={}){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    const r=await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${encodeURIComponent(videoId)}`,{
      headers:{authorization:`Bearer ${process.env.AGNES_API_KEY}`}
    });
    const d=await r.json().catch(()=>({}));
    if(r.ok){
      const url=d?.url||d?.video_url||d?.data?.url||d?.data?.video_url||d?.result?.url||d?.output?.url;
      const status=String(d?.status||d?.data?.status||'').toLowerCase();
      if(url) return {url,raw:d};
      if(['failed','error','cancelled'].includes(status)) throw new Error(`Vidéo Agnes échouée: ${JSON.stringify(d).slice(0,700)}`);
    }
    await new Promise(res=>setTimeout(res,intervalMs));
  }
  throw new Error('Timeout génération vidéo Agnes');
}

export async function generateAgnesVideo(prompt,outFile){
  const task=await createAgnesVideoTask(prompt);
  const result=await pollAgnesVideo(task.video_id);
  const r=await fetch(result.url);
  if(!r.ok) throw new Error(`Téléchargement vidéo Agnes ${r.status}`);
  fs.mkdirSync(path.dirname(outFile),{recursive:true});
  fs.writeFileSync(outFile,Buffer.from(await r.arrayBuffer()));
  return {outFile,video_id:task.video_id};
}


export function loadEnv(file){if(!fs.existsSync(file))return;for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'')}}
export const uid=()=>crypto.randomBytes(9).toString('base64url');
export const nowIso=()=>new Date().toISOString();
export function json(res,status,data){const b=Buffer.from(JSON.stringify(data));res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':b.length});res.end(b)}
export async function bodyJson(req,limit=15_000_000){let s='';for await(const c of req){s+=c;if(s.length>limit)throw new Error('Requête trop volumineuse')}if(!s)return{};return JSON.parse(s)}
function key(secret){return crypto.createHash('sha256').update(secret).digest()}
export function encrypt(v,secret){if(!v)return'';const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(secret),iv),enc=Buffer.concat([c.update(v,'utf8'),c.final()]),tag=c.getAuthTag();return [iv,tag,enc].map(x=>x.toString('base64url')).join('.')}
export function decrypt(v,secret){if(!v)return'';try{const [a,b,c]=v.split('.').map(x=>Buffer.from(x,'base64url')),d=crypto.createDecipheriv('aes-256-gcm',key(secret),a);d.setAuthTag(b);return Buffer.concat([d.update(c),d.final()]).toString('utf8')}catch{return''}}

const demoHooks=[
'Personne ne te montre ce détail…',
'J’aurais aimé connaître ça avant.',
'Ce petit objet règle un problème pénible.',
'Le test le plus simple pour savoir si ça vaut le coup.',
'Je pensais que c’était gadget… jusqu’à ce test.'
];

function freeConcept(product,niche,format,i=0){
  const name=product?.name||`astuce ${niche}`;
  const notes=(product?.notes||'Montre uniquement ce qui est réellement visible ou vérifié.').trim();
  const hooks=[
    `Tu connais ce problème ? Voilà une solution simple.`,
    `Avant d’acheter ${name}, regarde ça.`,
    `${name} : utile ou juste gadget ?`,
    `Le détail à vérifier sur ${name}.`,
    `Une façon simple d’utiliser ${name}.`
  ];
  const hook=hooks[i%hooks.length];
  const bodies=[
    `On part d’un problème concret et on montre directement ${name}. ${notes} Pas de promesse exagérée : on montre le produit, son usage et le résultat observable. Si ça correspond à ton besoin, regarde les détails du produit avant de décider.`,
    `Voici ${name}. L’idée est simple : montrer en quelques secondes à quoi il sert, comment il s’utilise et ce qu’on peut réellement constater. ${notes} Le but est de rester clair, rapide et honnête.`,
    `Petit test rapide de ${name}. D’abord le problème, ensuite la démonstration, puis le résultat. ${notes} Vérifie toujours les caractéristiques et le prix avant achat.`
  ];
  return {
    title:`${name} — vidéo ${i+1}`,
    hook,
    hook_score:78-i*3,
    script:bodies[i%bodies.length],
    caption:`${name} — démonstration rapide. #${String(niche).replace(/\s+/g,'')} #astuce #produit`,
    cta:'Les détails du produit sont disponibles depuis la fiche associée.',
    visual_beats:['Problème','Produit','Utilisation','Résultat','CTA']
  };
}
function demoConcept(product,niche,format,i=0){return freeConcept(product,niche,format,i)}
async function openaiJson(prompt){const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_TEXT_MODEL||'gpt-5.6-luna',input:prompt,text:{format:{type:'json_object'}}})});const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||`OpenAI ${r.status}`);const text=d.output_text||d.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;if(!text)throw new Error('OpenAI n’a retourné aucun JSON');return JSON.parse(text)}
export async function testOpenAI(){if(!process.env.OPENAI_API_KEY)throw new Error('Clé OpenAI absente');const r=await fetch('https://api.openai.com/v1/models',{headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`}});if(!r.ok)throw new Error(`Clé OpenAI refusée (${r.status})`);return true}
export async function generateConceptVariants({product,niche,format,count=3}){
  count=Math.max(1,Math.min(5,count));
  const useAgnes=!!process.env.AGNES_API_KEY && process.env.AGNES_ENABLED!=='false';
  if(useAgnes){
    try{
      const facts=product?JSON.stringify({
        name:product.name,
        category:product.category,
        price:product.price,
        commission_rate:product.commission_rate,
        notes:product.notes
      }):'aucun produit';
      const d=await agnesJson(`Tu crées des scripts TikTok faceless courts, crédibles, originaux et non trompeurs.
Faits produit autorisés: ${facts}
Niche: ${niche}
Format: ${format}
Génère exactement ${count} variantes en français.
JSON strict:
{"variants":[{"title":"","hook":"","hook_score":0,"script":"","caption":"","cta":"","visual_beats":["","","","",""]}]}`);
      if(Array.isArray(d?.variants)&&d.variants.length) return d.variants.slice(0,count);
    }catch(e){
      console.error('Agnes texte indisponible, fallback local:',e.message);
    }
  }
  return Array.from({length:count},(_,i)=>freeConcept(product,niche,format,i));
}
export async function synthesizeSpeech(text,outFile){
  fs.mkdirSync(path.dirname(outFile),{recursive:true});
  const paid=process.env.ZERO_COST_MODE==='false' && process.env.OPENAI_API_KEY && process.env.DEMO_MODE!=='true';
  if(!paid){
    const wav=outFile+'.wav';
    try{
      await run('espeak-ng',['-v','fr','-s','165','-p','48','-w',wav,String(text).slice(0,2500)]);
      await run('ffmpeg',['-y','-i',wav,'-af','loudnorm','-c:a','libmp3lame','-b:a','128k',outFile]);
      try{fs.unlinkSync(wav)}catch{}
      return outFile;
    }catch(e){
      try{fs.unlinkSync(wav)}catch{}
      await run('ffmpeg',['-y','-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t','12','-c:a','libmp3lame',outFile]);
      return outFile;
    }
  }
  const r=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_TTS_MODEL||'gpt-4o-mini-tts',voice:process.env.OPENAI_TTS_VOICE||'coral',input:text,format:'mp3'})});
  if(!r.ok)throw new Error(`TTS ${r.status}: ${(await r.text()).slice(0,400)}`);
  fs.writeFileSync(outFile,Buffer.from(await r.arrayBuffer()));
  return outFile
}
export async function generateVisual({product,concept,outFile}){fs.mkdirSync(path.dirname(outFile),{recursive:true});if(process.env.ZERO_COST_MODE!=='false'||process.env.DEMO_MODE==='true'||!process.env.OPENAI_API_KEY)return null;const facts=[product?.name,product?.category,product?.notes].filter(Boolean).join(' — ');const prompt=`Create a clean vertical commercial-style background image for a short social video. Subject: ${facts||concept.title}. Show only details supported by the description. No text, no logos, no watermark, no people making endorsements. Modern realistic product-demo composition, neutral background, room for captions, vertical 1024x1536.`;const r=await fetch('https://api.openai.com/v1/images/generations',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_IMAGE_MODEL||'gpt-image-2.5-flare',prompt,size:'1024x1536',quality:'medium',output_format:'jpeg'})});const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||`Image OpenAI ${r.status}`);const b64=d?.data?.[0]?.b64_json;if(!b64)return null;fs.writeFileSync(outFile,Buffer.from(b64,'base64'));return outFile}
function escDrawtext(s=''){return String(s).replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/'/g,"\\'").replace(/%/g,'\\%').replace(/\n/g,' ')}
function subtitleFilters(text,duration=18){const parts=String(text||'').split(/(?<=[.!?])\s+/).filter(Boolean).slice(0,6);if(!parts.length)return[];const slot=duration/parts.length;return parts.map((p,i)=>`drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${escDrawtext(p.slice(0,115))}':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=1380:box=1:boxcolor=black@0.62:boxborderw=18:enable='between(t,${(i*slot).toFixed(2)},${((i+1)*slot).toFixed(2)})'`)}
export async function audioDuration(file){return new Promise((resolve)=>{const p=spawn('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file]);let s='';p.stdout.on('data',d=>s+=d);p.on('close',()=>resolve(Math.max(6,Math.min(60,Number(s)||18))));p.on('error',()=>resolve(18))})}
export async function renderVerticalVideo({concept,audioFile,outFile,product,imageFile}){fs.mkdirSync(path.dirname(outFile),{recursive:true});const duration=await audioDuration(audioFile),hook=escDrawtext(concept.hook.slice(0,100)),name=escDrawtext((product?.name||concept.title).slice(0,72));const overlays=[`drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${hook}':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=170:box=1:boxcolor=black@0.62:boxborderw=24`,`drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${name}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=1040:box=1:boxcolor=black@0.42:boxborderw=18`,...subtitleFilters(concept.script,duration)].join(',');let args;if(imageFile&&fs.existsSync(imageFile)){args=['-y','-loop','1','-i',imageFile,'-i',audioFile,'-vf',`scale=720:1280:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0005,1.08)':d=1:s=720x1280:fps=30,${overlays}`,'-map','0:v','-map','1:a','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-t',String(duration),'-movflags','+faststart',outFile]}else{args=['-y','-f','lavfi','-i','color=c=0x16171c:s=720x1280:r=30','-i',audioFile,'-vf',overlays,'-map','0:v','-map','1:a','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart',outFile]}await run('ffmpeg',args);return outFile}
export function run(cmd,args){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe']});let err='';p.stderr.on('data',d=>err+=d.toString());p.on('error',reject);p.on('close',code=>code===0?resolve():reject(new Error(`${cmd} exited ${code}: ${err.slice(-1800)}`)))})}
export async function commandExists(cmd){return new Promise(resolve=>{const p=spawn(cmd,['-version']);p.on('error',()=>resolve(false));p.on('close',c=>resolve(c===0))})}

export async function tiktokExchangeCode(code){const form=new URLSearchParams({client_key:process.env.TIKTOK_CLIENT_KEY||'',client_secret:process.env.TIKTOK_CLIENT_SECRET||'',code,grant_type:'authorization_code',redirect_uri:process.env.TIKTOK_REDIRECT_URI||''}),r=await fetch('https://open.tiktokapis.com/v2/oauth/token/',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form}),d=await r.json();if(!r.ok||d.error)throw new Error(d.error_description||d.error||`TikTok OAuth ${r.status}`);return d}
export async function tiktokRefresh(refreshToken){const form=new URLSearchParams({client_key:process.env.TIKTOK_CLIENT_KEY||'',client_secret:process.env.TIKTOK_CLIENT_SECRET||'',grant_type:'refresh_token',refresh_token:refreshToken}),r=await fetch('https://open.tiktokapis.com/v2/oauth/token/',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form}),d=await r.json();if(!r.ok||d.error)throw new Error(d.error_description||d.error||`TikTok refresh ${r.status}`);return d}
export async function tiktokCreatorInfo(token){const r=await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json; charset=UTF-8'},body:'{}'}),d=await r.json();if(!r.ok||d?.error?.code!=='ok')throw new Error(d?.error?.message||`Creator info ${r.status}`);return d.data}
export async function tiktokInitVideo(token,{fileSize,title,privacyLevel='SELF_ONLY',disableComment=false,disableDuet=false,disableStitch=false}){const body={post_info:{title,privacy_level:privacyLevel,disable_comment:disableComment,disable_duet:disableDuet,disable_stitch:disableStitch,is_aigc:true},source_info:{source:'FILE_UPLOAD',video_size:fileSize,chunk_size:fileSize,total_chunk_count:1}},r=await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json; charset=UTF-8'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok||d?.error?.code!=='ok')throw new Error(d?.error?.message||`TikTok init ${r.status}`);return d.data}
export async function tiktokUploadVideo(uploadUrl,filePath){const buf=fs.readFileSync(filePath),size=buf.length,r=await fetch(uploadUrl,{method:'PUT',headers:{'content-type':'video/mp4','content-length':String(size),'content-range':`bytes 0-${size-1}/${size}`},body:buf});if(!r.ok)throw new Error(`TikTok upload ${r.status}: ${(await r.text()).slice(0,300)}`)}
export async function tiktokPostStatus(token,publishId){const r=await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json; charset=UTF-8'},body:JSON.stringify({publish_id:publishId})}),d=await r.json();if(!r.ok||d?.error?.code!=='ok')throw new Error(d?.error?.message||`TikTok status ${r.status}`);return d.data}
export async function tiktokQueryVideos(token,ids){const fields='id,view_count,like_count,comment_count,share_count,title,create_time,is_aigc',r=await fetch(`https://open.tiktokapis.com/v2/video/query/?fields=${encodeURIComponent(fields)}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({filters:{video_ids:ids.slice(0,20)}})}),d=await r.json();if(!r.ok||!(d?.error?.code==='ok'||d?.error?.code===0))throw new Error(d?.error?.message||`TikTok video query ${r.status}`);return d.data||{videos:[]}}
