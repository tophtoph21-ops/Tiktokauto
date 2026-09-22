
function friendlyStatus(s){
  return ({
    SCRIPTED:'Prête à créer',
    RENDERING:'Création…',
    READY:'Prête',
    SCHEDULED:'Planifiée',
    SUBMITTED:'Envoyée',
    PUBLISHED:'Publiée',
    ERROR:'Erreur'
  })[s]||s||'';
}

const $=s=>document.querySelector(s);let state;
const toast=m=>{const e=$('#toast');e.textContent=m;e.style.display='block';clearTimeout(e.t);e.t=setTimeout(()=>e.style.display='none',4200)};
async function api(url,opts={}){const r=await fetch(url,{headers:{'content-type':'application/json',...(opts.headers||{})},...opts}),d=await r.json();if(!r.ok)throw new Error(d.error||'Erreur');return d}
const money=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(Number(n||0));
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function load(){state=await api('/api/state');render()}
function render(){const s=state.settings,d=state.dashboard,setup=state.setup;
for(const k of ['niche','format','daily_count','variants_per_product','schedule_gap_minutes','optimization_mode','autopilot_hour','min_views_to_optimize'])if($('#'+k))$('#'+k).value=s[k];for(const k of ['auto_render','autopilot_enabled','auto_visuals'])$('#'+k).checked=!!s[k];$('#demo_mode').checked=setup.demo;$('#zero_cost_mode').checked=!!setup.zeroCost;$('#agnes_enabled').checked=setup.agnesEnabled!==false;$('#agnes_video_enabled').checked=!!setup.agnesVideoEnabled;$('#TIKTOK_REDIRECT_URI').placeholder=setup.redirectUri;if(!$('#TIKTOK_REDIRECT_URI').value)$('#TIKTOK_REDIRECT_URI').value=setup.redirectUri;$('#TIKTOK_SCOPES').value=setup.scopes;
$('#autoBadge').textContent=s.autopilot_enabled?'ACTIF':'PAUSE';$('#autoBadge').className='pill '+(s.autopilot_enabled?'connected':'');
$('#revenue').textContent=money(d.revenue);$('#summary').textContent=`${d.contents} contenus • ${d.published} publiés • ${d.ready} prêts`;
$('#kpis').innerHTML=[['Vues',Number(d.views).toLocaleString('fr-FR')],['Clics',Number(d.clicks).toLocaleString('fr-FR')],['Commandes',d.orders],['RPM',money(d.rpm)],['Conversion',`${d.conversion}%`]].map(([a,b])=>`<div class="kpi"><span>${a}</span><strong>${b}</strong></div>`).join('');
$('#connection').innerHTML=setup.demo?`<span class="pill demo">MODE DÉMO</span>`:state.tiktok.connected?`<span class="pill connected">TikTok connecté</span> <button onclick="disconnect()">Déconnecter</button>`:setup.tiktokApp?`<a class="btn primary" href="/oauth/tiktok/start">Connecter TikTok</a>`:`<span class="pill">Configurer TikTok</span>`;
$('#setupStatus').innerHTML=[['Agnes',setup.agnes],['Mode 0 €',setup.zeroCost],['TikTok',setup.tiktokApp]].map(([n,v])=>`<span class="setupchip ${v?'good':'bad'}">${v?'✓':'•'} ${n}</span>`).join('');
$('#products').innerHTML=state.products.length?state.products.map((p,i)=>`<div class="product">${p.image_url?`<img class="thumb" src="${p.image_url}">`:`<div class="thumb"></div>`}<div class="rank">#${i+1}</div><div class="grow"><strong>${esc(p.name)}</strong><div class="meta">${esc(p.category||'Sans catégorie')} • ${money(p.price)} • ${p.commission_rate||0}% commission</div><div class="metrics"><span>Score ${Number(p.score||0).toFixed(2)}</span><span>👁 ${p.total_views||0}</span><span>↗ ${p.total_clicks||0}</span><span>🛒 ${p.total_orders||0}</span><span>${money(p.total_revenue||0)}</span></div></div><button onclick="delProduct('${p.id}')">Supprimer</button></div>`).join(''):`<div class="empty">Ajoute au moins un produit affilié autorisé à la promotion pour orienter l’Autopilot vers les ventes.</div>`;
$('#contents').innerHTML=state.contents.length?state.contents.map(c=>`<article class="contentitem"><div class="contentgrid"><div><div class="contenttop"><div><span class="status">${esc(friendlyStatus(c.status))}</span> ${c.variant_group?`<span class="status">Essai ${Number(c.variant_index)+1}</span>`:''} ${c.tiktok_status?`<span class="status">${esc(c.tiktok_status)}</span>`:''}<h4>${esc(c.title||'Sans titre')}</h4></div><span class="hookscore">Score ${Math.round(c.hook_score||0)}/100</span></div><p><strong>${esc(c.hook||'')}</strong></p><p>${esc(c.caption||'')}</p>${c.product?`<div class="meta">Produit : ${esc(c.product.name)}</div>`:''}<div class="metrics"><span>👁 ${c.views||0}</span><span>❤ ${c.likes||0}</span><span>💬 ${c.comments||0}</span><span>↗ ${c.clicks||0}</span><span>🛒 ${c.orders||0}</span><span>${money(c.revenue||0)}</span></div>${c.scheduled_at?`<div class="meta">Planifié : ${new Date(c.scheduled_at).toLocaleString('fr-FR')}</div>`:''}${c.error?`<p class="error">${esc(c.error)}</p>`:''}<div class="contentactions">${['SCRIPTED','ERROR'].includes(c.status)?`<button onclick="renderVideo('${c.id}')">Créer la vidéo</button>`:''}${c.status==='READY'?`<button class="primary" onclick="approve('${c.id}')">Valider & planifier</button>`:''}${['READY','SCHEDULED'].includes(c.status)?`<button onclick="publishNow('${c.id}')">Publier maintenant</button>`:''}<button onclick="metrics('${c.id}',${c.views||0},${c.clicks||0},${c.orders||0},${c.revenue||0})">Résultats</button><button onclick="cloneWinner('${c.id}')">Nouvel essai</button><button class="danger" onclick="deleteVideo('${c.id}')">Supprimer</button></div></div><div class="preview">${c.video_url?`<video src="${c.video_url}" controls playsinline></video>`:c.image_url?`<img src="${c.image_url}">`:''}</div></div></article>`).join(''):`<div class="empty">Aucun contenu. Clique sur “Générer maintenant”.</div>`;
$('#events').innerHTML=state.events.length?state.events.map(e=>`<div class="event"><strong>${esc(e.type)}</strong> — ${esc(e.message)} <span class="meta">${new Date(e.created_at).toLocaleString('fr-FR')}</span></div>`).join(''):`<div class="empty">Aucun événement.</div>`}
$('#saveSettings').onclick=async()=>{try{await api('/api/settings',{method:'POST',body:JSON.stringify({niche:$('#niche').value,format:$('#format').value,daily_count:+$('#daily_count').value,variants_per_product:+$('#variants_per_product').value,schedule_gap_minutes:+$('#schedule_gap_minutes').value,optimization_mode:$('#optimization_mode').value,autopilot_hour:+$('#autopilot_hour').value,min_views_to_optimize:+$('#min_views_to_optimize').value,autopilot_enabled:$('#autopilot_enabled').checked,auto_render:$('#auto_render').checked,auto_visuals:$('#auto_visuals').checked})});toast('Autopilot enregistré');await load()}catch(e){toast(e.message)}};
$('#saveSetup').onclick=async()=>{try{const b={demo_mode:$('#demo_mode').checked,zero_cost_mode:$('#zero_cost_mode').checked,agnes_enabled:$('#agnes_enabled').checked,agnes_video_enabled:$('#agnes_video_enabled').checked,AGNES_API_KEY:$('#AGNES_API_KEY').value,TIKTOK_REDIRECT_URI:$('#TIKTOK_REDIRECT_URI').value||undefined,TIKTOK_SCOPES:$('#TIKTOK_SCOPES').value};for(const k of ['OPENAI_API_KEY','TIKTOK_CLIENT_KEY','TIKTOK_CLIENT_SECRET'])if($('#'+k).value)b[k]=$('#'+k).value;await api('/api/setup',{method:'POST',body:JSON.stringify(b)});['OPENAI_API_KEY','TIKTOK_CLIENT_KEY','TIKTOK_CLIENT_SECRET'].forEach(k=>$('#'+k).value='');toast('Configuration enregistrée');await load()}catch(e){toast(e.message)}};
$('#testSetup').onclick=async()=>{try{const r=await api('/api/setup/test',{method:'POST',body:'{}'});toast(`FFmpeg: ${r.ffmpeg?'OK':'MANQUANT'} • Mode 0 € actif • TikTok: ${r.tiktokApp?'OK':'à configurer'}`)}catch(e){toast(e.message)}};
function fileData(file){return new Promise((res,rej)=>{if(!file)return res(null);const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)})}
$('#productForm').onsubmit=async e=>{e.preventDefault();try{const fd=new FormData(e.target),b=Object.fromEntries(fd.entries());b.image_data=await fileData(fd.get('image'));delete b.image;await api('/api/products',{method:'POST',body:JSON.stringify(b)});e.target.reset();toast('Produit ajouté');await load()}catch(e){toast(e.message)}};
$('#importCsv').onclick=async()=>{try{const r=await api('/api/products/import',{method:'POST',body:JSON.stringify({csv:$('#csv').value})});toast(`${r.imported} produit(s) importé(s)`);$('#csv').value='';await load()}catch(e){toast(e.message)}};
$('#autopilot').onclick=async()=>{try{$('#autopilot').disabled=true;toast('Génération + montage en cours…');const d=await api('/api/autopilot/run',{method:'POST',body:JSON.stringify({count:+$('#daily_count').value})});toast(`${d.contents.length} contenu(s) créés`);await load()}catch(e){toast(e.message)}finally{$('#autopilot').disabled=false}};
$('#sync').onclick=async()=>{try{const r=await api('/api/sync-metrics',{method:'POST',body:'{}'});toast(state.setup.demo?'Mode démo':`${r.updated} vidéo(s) synchronisée(s)`);await load()}catch(e){toast(e.message)}};$('#optimize').onclick=async()=>{try{const r=await api('/api/optimize',{method:'POST',body:'{}'});toast(`${r.created} nouvelle(s) variante(s) issue(s) des gagnants`);await load()}catch(e){toast(e.message)}};$('#refresh').onclick=load;$('#statusBtn').onclick=async()=>{try{await api('/api/refresh-status',{method:'POST',body:'{}'});toast('Statuts actualisés');await load()}catch(e){toast(e.message)}};
window.delProduct=async id=>{if(!confirm('Supprimer ce produit ?'))return;try{await api('/api/products/'+id,{method:'DELETE'});await load()}catch(e){toast(e.message)}};window.renderVideo=async id=>{try{toast('Création de la vidéo…');await api(`/api/contents/${id}/render`,{method:'POST',body:'{}'});toast('Vidéo créée');await load()}catch(e){toast(e.message)}};
async function privacy(){if(state.setup.demo)return'SELF_ONLY';const info=await api('/api/tiktok/creator-info'),def=info.privacy_level_options.includes('PUBLIC_TO_EVERYONE')?'PUBLIC_TO_EVERYONE':'SELF_ONLY',p=prompt(`Compte @${info.creator_username||''}\nVisibilités disponibles : ${info.privacy_level_options.join(', ')}\nChoisis :`,def)||def;if(!info.privacy_level_options.includes(p))throw new Error('Visibilité non autorisée');return p}
window.approve=async id=>{try{const p=await privacy(),future=new Date(Date.now()+Number(state.settings.schedule_gap_minutes||180)*60000),raw=prompt('Date/heure de publication (ISO)',future.toISOString());if(raw===null)return;const scheduled=new Date(raw||future).toISOString();if(!confirm(`Valider l’envoi de cette vidéo à TikTok en ${p}, planifié le ${new Date(scheduled).toLocaleString('fr-FR')} ?`))return;await api(`/api/contents/${id}/approve`,{method:'POST',body:JSON.stringify({privacy_level:p,scheduled_at:scheduled})});toast('Validé et planifié');await load()}catch(e){toast(e.message)}};
window.publishNow=async id=>{try{const p=await privacy();if(!confirm(`Tu autorises l’envoi de cette vidéo à TikTok maintenant en ${p} ?`))return;await api(`/api/contents/${id}/publish`,{method:'POST',body:JSON.stringify({privacy_level:p})});toast('Envoi lancé');await load()}catch(e){toast(e.message)}};
window.metrics=async(id,v,c,o,r)=>{const views=prompt('Vues',v),clicks=prompt('Clics affiliés',c),orders=prompt('Commandes',o),revenue=prompt('Commission (€)',r);if([views,clicks,orders,revenue].some(x=>x===null))return;try{await api(`/api/contents/${id}/metrics`,{method:'POST',body:JSON.stringify({views,clicks,orders,revenue})});toast('Ventes enregistrées');await load()}catch(e){toast(e.message)}};window.cloneWinner=async id=>{try{const d=await api(`/api/contents/${id}/clone-winner`,{method:'POST',body:'{}'});toast(`${d.contents.length} variante(s) créées`);await load()}catch(e){toast(e.message)}};window.disconnect=async()=>{await api('/api/tiktok/disconnect',{method:'POST',body:'{}'});load()};load().catch(e=>toast(e.message));


// Mobile/PWA helpers
let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;const b=document.querySelector('#installApp');if(b)b.hidden=false});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;const b=document.querySelector('#installApp');if(b)b.hidden=true});
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
const installBtn=document.querySelector('#installApp');if(installBtn)installBtn.onclick=async()=>{if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;installBtn.hidden=true}else{toast(/iphone|ipad|ipod/i.test(navigator.userAgent)?'Sur iPhone : Partager → Sur l’écran d’accueil':'Dans le menu du navigateur : Ajouter à l’écran d’accueil')}};
for(const b of document.querySelectorAll('.bottomnav [data-go]')) b.onclick=()=>document.getElementById(b.dataset.go)?.scrollIntoView({behavior:'smooth',block:'start'});
const mg=document.querySelector('#mobileGenerate');if(mg)mg.onclick=()=>document.querySelector('#autopilot')?.click();
const mr=document.querySelector('#mobileReady');if(mr)mr.onclick=()=>document.querySelector('#contents')?.scrollIntoView({behavior:'smooth',block:'start'});
const ms=document.querySelector('#mobileStats');if(ms)ms.onclick=()=>document.querySelector('#top')?.scrollIntoView({behavior:'smooth',block:'start'});

$('#testAgnes')?.addEventListener('click',async()=>{
  try{
    const r=await api('/api/agnes/test',{method:'POST'});
    toast(r.ok?'Agnes AI : OK':('Agnes : '+(r.error||r.preview||'erreur')));
  }catch(e){toast('Agnes : '+e.message)}
});


const settingsPanel=$('#settingsPanel');
$('#openSettings')?.addEventListener('click',()=>settingsPanel?.classList.add('open'));
$('#closeSettings')?.addEventListener('click',()=>settingsPanel?.classList.remove('open'));
settingsPanel?.addEventListener('click',e=>{if(e.target===settingsPanel)settingsPanel.classList.remove('open')});


window.deleteVideo=async id=>{
  if(!confirm('Supprimer définitivement cette vidéo ?'))return;
  try{
    await api(`/api/contents/${id}`,{method:'DELETE'});
    toast('Vidéo supprimée');
    await load();
  }catch(e){toast(e.message)}
};
