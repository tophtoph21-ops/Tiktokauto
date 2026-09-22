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

export async function probeVideoQuality(file,{minSeconds=1}={}){
  if(!file||!fs.existsSync(file))return{ok:false,reason:'Fichier vidéo absent'};
  const size=fs.statSync(file).size;if(size<50000)return{ok:false,reason:'Fichier vidéo trop petit',size};
  const out=await runCapture('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',file]);
  const d=JSON.parse(out||'{}'),streams=d?.streams||[],v=streams.find(x=>x.codec_type==='video')||{};
  const duration=Number(d?.format?.duration||0),hasVideo=streams.some(x=>x.codec_type==='video'),hasAudio=streams.some(x=>x.codec_type==='audio');
  const ok=hasVideo&&hasAudio&&duration>=minSeconds&&Number(v.width)>=540&&Number(v.height)>=960;
  return{ok,duration,size,hasVideo,hasAudio,width:Number(v.width||0),height:Number(v.height||0),reason:ok?'OK':!hasVideo?'Pas de piste vidéo':!hasAudio?'Pas de piste audio':duration<minSeconds?'Vidéo trop courte':'Résolution invalide'}
}
async function runCapture(cmd,args){return await new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',(code,signal)=>code===0?resolve(out):reject(new Error(`${cmd} code=${code} signal=${signal||'none'} ${err.slice(-900)}`)))})}
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

const VIRAL_TOPICS=[
  {kind:'curiosite',topic:'un fait étonnant du quotidien qu’on remarque rarement'},
  {kind:'mystere',topic:'un petit mystère réel ou phénomène étrange expliqué sans sensationnalisme'},
  {kind:'quiz',topic:'un quiz visuel simple avec une réponse surprenante'},
  {kind:'histoire',topic:'une mini-histoire insolite mais crédible avec chute'},
  {kind:'top',topic:'un top 5 de faits ou objets inattendus'},
  {kind:'science',topic:'un phénomène scientifique facile à comprendre'},
  {kind:'psychologie',topic:'un biais ou comportement humain expliqué simplement'},
  {kind:'scenario',topic:'un scénario hypothétique absurde mais logique, par exemple que se passerait-il si…'}
];

function localViralConcept(style='random',topic=''){
  const pick=style==='random'
    ? VIRAL_TOPICS[Math.floor(Math.random()*VIRAL_TOPICS.length)]
    : (VIRAL_TOPICS.find(x=>x.kind===style)||VIRAL_TOPICS[0]);
  const subject=topic?.trim()||pick.topic;
  const hooks=[
    `Tu vas probablement regarder ça jusqu’au bout.`,
    `Ce détail paraît banal, mais attends la fin.`,
    `Question rapide : tu aurais trouvé la réponse ?`,
    `Ça semble faux, pourtant l’explication est toute simple.`,
    `Une minute pour apprendre un truc complètement inattendu.`
  ];
  const hook=hooks[Math.floor(Math.random()*hooks.length)];
  const paragraphs=[
    `On part de quelque chose de très simple : ${subject}. Au début, ça paraît presque inutile. Pourtant, quand on regarde comment ça fonctionne vraiment, il y a un détail qui change complètement la façon de le voir.`,
    `Imagine la situation pendant quelques secondes. La plupart des gens donnent la première réponse qui leur vient. Mais il manque généralement une information importante. C’est précisément là que ça devient intéressant.`,
    `Le premier indice est facile à rater. Il faut regarder la cause plutôt que le résultat. Une fois qu’on fait ça, le phénomène devient beaucoup plus logique et on comprend pourquoi notre intuition se trompe.`,
    `Deuxième détail : ce n’est pas forcément exceptionnel. Des choses similaires arrivent régulièrement dans la vie quotidienne, simplement on n’y prête presque jamais attention.`,
    `Et voilà la partie satisfaisante : quand on rassemble les indices, la réponse paraît évidente. C’est souvent ce qui rend ce genre de curiosité agréable à regarder jusqu’au bout.`,
    `La prochaine fois que tu vois quelque chose de similaire, essaie de repérer ce détail avant les autres.`
  ];
  return {
    mode:'viral',
    title:`Viral — ${pick.kind}`,
    hook,
    hook_score:82,
    script:paragraphs.join(' '),
    caption:`Une minute de curiosité. Tu avais trouvé ? #curiosite #tusavais #pourtoi`,
    cta:'Tu avais deviné avant la fin ?',
    visual_beats:['Question','Indice 1','Indice 2','Explication','Réponse','Question finale'],
    viral_style:pick.kind,
    topic:subject,
    target_duration:70
  };
}

export async function generateViralConcept({style='random',topic='',trends=[],avoid=[]}={}){
  if(process.env.AGNES_API_KEY && process.env.AGNES_ENABLED!=='false'){
    try{
      const d=await agnesJson(`Crée UNE vidéo TikTok originale en français, sans produit à vendre, conçue pour durer 65 à 85 secondes à voix normale.
Style: ${style}. Sujet demandé: ${topic||'choisis toi-même un sujet facile à regarder'}. Tendances récentes disponibles: ${Array.isArray(trends)?trends.join(', '):''}. Évite de refaire ces sujets récents: ${Array.isArray(avoid)?avoid.join(' | '):''}.
Le contenu doit être exact, non trompeur, familial, simple à comprendre, avec un hook immédiat, une progression qui donne envie de connaître la suite et une vraie conclusion. Évite les affirmations médicales, financières ou historiques incertaines.
JSON strict:
{"title":"","hook":"","hook_score":0,"script":"un script de 170 à 220 mots","caption":"","cta":"","visual_beats":["","","","","",""],"viral_style":"","topic":"","target_duration":70}`);
      if(d?.script){
        d.mode='viral';
        d.target_duration=Math.max(60,Math.min(90,Number(d.target_duration||70)));
        return d;
      }
    }catch(e){
      console.error('Agnes viral fallback local:',e.message);
    }
  }
  return localViralConcept(style,topic);
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
export async function generateVisual({product,concept,outFile}){
  fs.mkdirSync(path.dirname(outFile),{recursive:true});
  const agnesOk=!!process.env.AGNES_API_KEY && process.env.AGNES_ENABLED!=='false';
  if(agnesOk){
    const subject=product
      ? `${product.name||''}. ${product.category||''}. ${product.notes||''}`
      : `${concept.title||''}. ${concept.topic||''}`;
    const prompt=product
      ? `Vertical social media background inspired by this product description: ${subject}. Do not invent brand logos or text. Clean realistic composition, room for captions, 9:16.`
      : `Create ONE cinematic vertical 9:16 background image for a short educational social video. Topic: ${subject}. IMPORTANT: absolutely NO visible words, letters, numbers, captions, subtitles, labels, UI, signs, documents with readable writing, logos or watermarks anywhere. Purely visual storytelling, realistic/editorial, strong central subject, clean composition, safe for general audiences, leave negative space for captions added later.`;
    try{return await agnesImage(prompt,outFile)}catch(e){console.error('Agnes image fallback:',e.message)}
  }
  return null;
}

function splitScriptScenes(text,count=8){
  const clean=String(text||'').replace(/\s+/g,' ').trim();
  const sentences=clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  if(!sentences.length)return Array.from({length:count},(_,i)=>`abstract visual scene ${i+1}`);
  const groups=Array.from({length:Math.min(count,Math.max(4,sentences.length))},()=>[]);
  sentences.forEach((s,i)=>groups[Math.min(groups.length-1,Math.floor(i*groups.length/sentences.length))].push(s));
  return groups.map(g=>g.join(' ').slice(0,260)).filter(Boolean);
}

async function visualShotPlan(concept,count=8){
  const local=splitScriptScenes(concept.script,count).map((s,i)=>({
    prompt:`Cinematic vertical 9:16 visual scene illustrating this idea: ${s}. No text, no letters, no numbers, no captions, no subtitles, no labels, no UI, no logos, no watermarks. Pure visual storytelling, realistic/editorial, dynamic composition, distinct from previous scenes.`,
    seconds:8
  }));
  if(!(process.env.AGNES_API_KEY&&process.env.AGNES_ENABLED!=='false'))return local;
  try{
    const d=await agnesJson(`Create a shot list for a vertical social video.
Title: ${concept.title||''}
Hook: ${concept.hook||''}
Script: ${concept.script||''}
Return exactly ${count} visually DIFFERENT shots that can be generated as images or very short clips.
Each shot must describe ONLY what should be seen, never text to display.
Absolutely forbid visible words, captions, labels, UI screens, logos, signs, documents, subtitles or watermarks.
JSON strict: {"shots":[{"prompt":"","seconds":8}]}`);
    const shots=Array.isArray(d?.shots)?d.shots.slice(0,count):[];
    if(shots.length>=4)return shots.map((x,i)=>({
      prompt:`${String(x.prompt||local[i%local.length]?.prompt||'cinematic visual scene')}. Absolutely no visible text, letters, numbers, captions, labels, UI, logos or watermarks.`,
      seconds:Math.max(5,Math.min(12,Number(x.seconds||8)))
    }));
  }catch(e){console.error('Agnes shot plan fallback:',e.message)}
  return local;
}

export async function generateVisualSequence({concept,outDir,count=8,useVideoClips=false}){
  fs.mkdirSync(outDir,{recursive:true});
  const shots=await visualShotPlan(concept,count);
  const assets=[];
  for(let i=0;i<shots.length;i++){
    const shot=shots[i];
    let made=null;
    if(useVideoClips && process.env.AGNES_API_KEY && process.env.AGNES_ENABLED!=='false' && i<2){
      try{
        const file=path.join(outDir,`shot-${String(i+1).padStart(2,'0')}.mp4`);
        await generateAgnesVideo(`${shot.prompt} Short 5-7 second vertical cinematic clip, smooth motion, no visible text or UI.`,file);
        made={type:'video',path:file,seconds:Math.max(5,Math.min(8,shot.seconds||7)),prompt:shot.prompt};
      }catch(e){console.error('Agnes video shot fallback image:',e.message)}
    }
    if(!made){
      try{
        const file=path.join(outDir,`shot-${String(i+1).padStart(2,'0')}.jpg`);
        await agnesImage(shot.prompt,file);
        made={type:'image',path:file,seconds:Math.max(5,Math.min(12,shot.seconds||8)),prompt:shot.prompt};
      }catch(e){console.error('Agnes image shot failed:',e.message)}
    }
    if(made)assets.push(made);
  }
  return assets;
}

async function renderSceneSegments({assets,duration,tmpDir}){
  if(!assets?.length)return null;
  fs.mkdirSync(tmpDir,{recursive:true});
  const per=Math.max(4,duration/assets.length);
  const segments=[];
  for(let i=0;i<assets.length;i++){
    const a=assets[i],seg=path.join(tmpDir,`seg-${String(i+1).padStart(2,'0')}.mp4`);
    const seconds=Math.min(per+0.15,Math.max(4,Number(a.seconds||per)));
    let args;
    if(a.type==='video'){
      args=['-y','-i',a.path,'-t',String(seconds),
        '-vf',"scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=24",
        '-an','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-r','24',seg];
    }else{
      args=['-y','-loop','1','-framerate','24','-i',a.path,'-t',String(seconds),
        '-vf',"scale=900:1600:force_original_aspect_ratio=increase,crop=720:1280,zoompan=z='min(zoom+0.0010,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=24,eq=brightness=-0.08:saturation=1.08",
        '-an','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-r','24',seg];
    }
    await run('ffmpeg',args);
    segments.push(seg);
  }
  const listFile=path.join(tmpDir,'concat.txt');
  fs.writeFileSync(listFile,segments.map(p=>`file '${p.replace(/'/g,"'\\''")}'`).join('\n'),'utf8');
  const combined=path.join(tmpDir,'visual-track.mp4');
  await run('ffmpeg',['-y','-f','concat','-safe','0','-i',listFile,'-c','copy',combined]);
  return combined;
}

function plainText(s=''){return String(s).replace(/[\r\n]+/g,' ').replace(/[^\p{L}\p{N}\s.,!?;:'’()\-–—]/gu,' ').replace(/\s+/g,' ').trim()}
function wrapWords(text,max=24,maxLines=3){const words=plainText(text).split(/\s+/).filter(Boolean),lines=[];let cur='';for(const w of words){if(/^[!?.,;:]$/.test(w)&&cur){cur+=w;continue}const next=cur?cur+' '+w:w;if(next.length>max&&cur){lines.push(cur);cur=w}else cur=next;if(lines.length===maxLines)break}if(cur&&lines.length<maxLines)lines.push(cur);return lines.slice(0,maxLines)}
function writeOverlayText(base,key,text){const f=path.join(path.dirname(base),`.${path.basename(base)}.${key}.txt`);fs.writeFileSync(f,plainText(text),'utf8');return f.replace(/\\/g,'/').replace(/:/g,'\\:')}
function lineDrawFiles(base,lines,{key='txt',y=100,size=42,gap=52,box='black@0.72',border=18,font='DejaVuSans-Bold.ttf',enable='' }={}){return lines.map((line,i)=>{const tf=writeOverlayText(base,`${key}-${i}`,line);return `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/${font}:textfile='${tf}':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=${y+i*gap}:box=1:boxcolor=${box}:boxborderw=${border}${enable?`:enable='${enable}'`:''}`})}
function subtitleFilters(text,duration=18,base='out.mp4'){
  const words=plainText(text).split(/\s+/).filter(Boolean);if(!words.length)return[];
  const chunks=[];let cur='';for(const w of words){const n=cur?cur+' '+w:w;if(n.length>44&&cur){chunks.push(cur);cur=w}else cur=n}if(cur)chunks.push(cur);
  const slot=Math.max(1.9,duration/Math.max(1,chunks.length)),filters=[];
  chunks.forEach((chunk,i)=>{const lines=wrapWords(chunk,25,2),st=(i*slot).toFixed(2),en=Math.min(duration,(i+1)*slot).toFixed(2);filters.push(...lineDrawFiles(base,lines,{key:`sub-${i}`,y:970,size:32,gap:42,box:'black@0.72',border:14,enable:`between(t,${st},${en})`}))});return filters;
}
export async function audioDuration(file){return new Promise((resolve)=>{const p=spawn('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file]);let s='';p.stdout.on('data',d=>s+=d);p.on('close',()=>resolve(Math.max(6,Math.min(95,Number(s)||18))));p.on('error',()=>resolve(18))})}
export async function renderVerticalVideo({concept,audioFile,outFile,product,imageFile,visualAssets=[]}){
  fs.mkdirSync(path.dirname(outFile),{recursive:true});
  const duration=await audioDuration(audioFile);
  const isViral=concept.content_mode==='viral'||concept.mode==='viral'||!product;
  const overlays=[
    ...lineDrawFiles(outFile,wrapWords(concept.hook||concept.title||'',25,3),{
      key:'hook',y:95,size:40,gap:50,box:'black@0.74',border:16
    }),
    ...subtitleFilters(concept.script,duration,outFile)
  ];

  if(!isViral){
    overlays.push(...lineDrawFiles(outFile,wrapWords(product?.name||concept.title||'',26,2),{
      key:'title',y:710,size:34,gap:44,box:'black@0.48',border:14
    }));
  }

  overlays.push(...lineDrawFiles(outFile,wrapWords(concept.cta||'Tu connaissais ?',28,2),{
    key:'cta',y:1130,size:24,gap:34,box:'black@0.55',border:10,font:'DejaVuSans.ttf',
    enable:`gte(t,${Math.max(0,duration-3.2).toFixed(2)})`
  }));

  const tmpDir=path.join(path.dirname(outFile),`.${path.basename(outFile)}-scenes`);
  let visualTrack=null;
  try{
    if(isViral&&Array.isArray(visualAssets)&&visualAssets.length>=2){
      visualTrack=await renderSceneSegments({assets:visualAssets,duration,tmpDir});
    }

    let args;
    if(visualTrack&&fs.existsSync(visualTrack)){
      args=['-y','-stream_loop','-1','-i',visualTrack,'-i',audioFile,
        '-vf',`drawbox=x=0:y=0:w=iw:h=250:color=black@0.16:t=fill,drawbox=x=0:y=900:w=iw:h=380:color=black@0.16:t=fill,${overlays.join(',')}`,
        '-map','0:v','-map','1:a','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-r','24',
        '-c:a','aac','-b:a','96k','-t',String(duration),'-movflags','+faststart',outFile];
    }else if(imageFile&&fs.existsSync(imageFile)){
      args=['-y','-loop','1','-framerate','24','-i',imageFile,'-i',audioFile,
        '-vf',`scale=900:1600:force_original_aspect_ratio=increase,crop=720:1280,zoompan=z='min(zoom+0.0007,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=24,eq=brightness=-0.10:saturation=1.05,drawbox=x=0:y=0:w=iw:h=250:color=black@0.16:t=fill,drawbox=x=0:y=900:w=iw:h=380:color=black@0.16:t=fill,${overlays.join(',')}`,
        '-map','0:v','-map','1:a','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-r','24',
        '-c:a','aac','-b:a','96k','-t',String(duration),'-movflags','+faststart',outFile];
    }else{
      args=['-y','-f','lavfi','-i','color=c=0x10131b:s=720x1280:r=24','-i',audioFile,
        '-vf',`drawbox=x=0:y=0:w=iw:h=1280:color=0x10131b@1:t=fill,${overlays.join(',')}`,
        '-map','0:v','-map','1:a','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-r','24',
        '-c:a','aac','-b:a','96k','-t',String(duration),'-movflags','+faststart',outFile];
    }
    await run('ffmpeg',args);
    return outFile;
  }finally{
    for(const f of fs.readdirSync(path.dirname(outFile))){
      if(f.startsWith(`.${path.basename(outFile)}.`)&&f.endsWith('.txt')){
        try{fs.unlinkSync(path.join(path.dirname(outFile),f))}catch{}
      }
    }
    try{fs.rmSync(tmpDir,{recursive:true,force:true})}catch{}
  }
}

export function run(cmd,args){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe']});let err='';p.stderr.on('data',d=>err+=d.toString());p.on('error',reject);p.on('close',code=>code===0?resolve():reject(new Error(`${cmd} exited ${code}: ${err.slice(-1800)}`)))})}
export async function commandExists(cmd){return new Promise(resolve=>{const p=spawn(cmd,['-version']);p.on('error',()=>resolve(false));p.on('close',c=>resolve(c===0))})}

export async function tiktokExchangeCode(code){const form=new URLSearchParams({client_key:process.env.TIKTOK_CLIENT_KEY||'',client_secret:process.env.TIKTOK_CLIENT_SECRET||'',code,grant_type:'authorization_code',redirect_uri:process.env.TIKTOK_REDIRECT_URI||''}),r=await fetch('https://open.tiktokapis.com/v2/oauth/token/',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form}),d=await r.json();if(!r.ok||d.error)throw new Error(d.error_description||d.error||`TikTok OAuth ${r.status}`);return d}
export async function tiktokRefresh(refreshToken){const form=new URLSearchParams({client_key:process.env.TIKTOK_CLIENT_KEY||'',client_secret:process.env.TIKTOK_CLIENT_SECRET||'',grant_type:'refresh_token',refresh_token:refreshToken}),r=await fetch('https://open.tiktokapis.com/v2/oauth/token/',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form}),d=await r.json();if(!r.ok||d.error)throw new Error(d.error_description||d.error||`TikTok refresh ${r.status}`);return d}
export async function tiktokCreatorInfo(token){const r=await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json; charset=UTF-8'},body:'{}'}),d=await r.json();if(!r.ok||d?.error?.code!=='ok')throw new Error(d?.error?.message||`Creator info ${r.status}`);return d.data}
export async function tiktokInitVideo(token,{fileSize,title,privacyLevel='SELF_ONLY',disableComment=false,disableDuet=false,disableStitch=false}){const body={post_info:{title,privacy_level:privacyLevel,disable_comment:disableComment,disable_duet:disableDuet,disable_stitch:disableStitch,is_aigc:true},source_info:{source:'FILE_UPLOAD',video_size:fileSize,chunk_size:fileSize,total_chunk_count:1}},r=await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json; charset=UTF-8'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok||d?.error?.code!=='ok')throw new Error(d?.error?.message||`TikTok init ${r.status}`);return d.data}
export async function tiktokUploadVideo(uploadUrl,filePath){const buf=fs.readFileSync(filePath),size=buf.length,r=await fetch(uploadUrl,{method:'PUT',headers:{'content-type':'video/mp4','content-length':String(size),'content-range':`bytes 0-${size-1}/${size}`},body:buf});if(!r.ok)throw new Error(`TikTok upload ${r.status}: ${(await r.text()).slice(0,300)}`)}
export async function tiktokPostStatus(token,publishId){const r=await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json; charset=UTF-8'},body:JSON.stringify({publish_id:publishId})}),d=await r.json();if(!r.ok||d?.error?.code!=='ok')throw new Error(d?.error?.message||`TikTok status ${r.status}`);return d.data}
export async function tiktokQueryVideos(token,ids){const fields='id,view_count,like_count,comment_count,share_count,title,create_time,is_aigc',r=await fetch(`https://open.tiktokapis.com/v2/video/query/?fields=${encodeURIComponent(fields)}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({filters:{video_ids:ids.slice(0,20)}})}),d=await r.json();if(!r.ok||!(d?.error?.code==='ok'||d?.error?.code===0))throw new Error(d?.error?.message||`TikTok video query ${r.status}`);return d.data||{videos:[]}}
