'use strict';

const DB_NAME='study_flashcards_db';
const DB_VERSION=1;
const DEFAULT_SETTINGS={dailyNew:20,softLimit:50};
let db;
let decks=[];
let cards=[];
let settings={...DEFAULT_SETTINGS};
let session={queue:[],history:[],index:0,flipped:false,mode:'today',title:'今日复习',deckId:null};
let editingFrontImage=null, editingBackImage=null;
let currentDeckViewId=null;
let deckBulkMode=false;
let selectedCardIds=new Set();
let previewCardId=null;let previewFlipped=false;

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const uid=()=>crypto.randomUUID ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(16).slice(2);
const localDate=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays=(iso,n)=>{const [y,m,d]=iso.split('-').map(Number);const x=new Date(y,m-1,d+n);return localDate(x)};
const nowISO=()=>new Date().toISOString();
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800)}
function showModal(id){$('#'+id).classList.add('show')}
function hideModal(id){$('#'+id).classList.remove('show')}
function closeAllModals(){$$('.modal.show').forEach(m=>m.classList.remove('show'))}
function friendlyError(err){const name=err?.name||'';if(name==='QuotaExceededError')return '本机存储空间不足，请先导出备份并删除不需要的大图片卡片。';if(name==='DataError')return '卡片数据格式不正确。';return err?.message||String(err||'未知错误')}
async function safeRenderAll(){try{await renderAll()}catch(err){console.error('界面刷新失败',err);toast('数据已保存，但界面刷新失败；重新打开 App 即可')}}
function showScreen(id){$$('.screen').forEach(x=>x.classList.remove('active'));$('#'+id).classList.add('active');$('#addCardFab').style.display=(id==='studyScreen'||id==='deckScreen')?'none':'block';window.scrollTo(0,0)}

function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('decks'))d.createObjectStore('decks',{keyPath:'id'});if(!d.objectStoreNames.contains('cards'))d.createObjectStore('cards',{keyPath:'id'});if(!d.objectStoreNames.contains('meta'))d.createObjectStore('meta',{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
function idbAll(store){return new Promise((res,rej)=>{const r=tx(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function idbPut(store,obj){return new Promise((res,rej)=>{const r=tx(store,'readwrite').put(obj);r.onsuccess=()=>res(obj);r.onerror=()=>rej(r.error)})}
function idbDelete(store,id){return new Promise((res,rej)=>{const r=tx(store,'readwrite').delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function idbClear(store){return new Promise((res,rej)=>{const r=tx(store,'readwrite').clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
async function getMeta(key,def=null){return new Promise((res,rej)=>{const r=tx('meta').get(key);r.onsuccess=()=>res(r.result?.value??def);r.onerror=()=>rej(r.error)})}
const setMeta=(key,value)=>idbPut('meta',{key,value});

function normalizeCardRecord(c){const created=c.createdAt||c.updatedAt||nowISO();return {...c,front:String(c.front||''),back:String(c.back||''),tags:Array.isArray(c.tags)?c.tags:[],source:String(c.source||''),note:String(c.note||''),frontImage:c.frontImage||null,backImage:c.backImage||null,createdAt:created,updatedAt:c.updatedAt||created,review:{...emptyReview(),...(c.review||{})}}}
async function loadAll(){decks=(await idbAll('decks')).map(d=>({...d,createdAt:d.createdAt||d.updatedAt||nowISO(),updatedAt:d.updatedAt||d.createdAt||nowISO()})).sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));cards=(await idbAll('cards')).map(normalizeCardRecord);settings={...DEFAULT_SETTINGS,...await getMeta('settings',{})};await renderAll()}
function cardDeckName(c){return decks.find(d=>d.id===c.deckId)?.name||'未分类'}
function isDue(c){return c.review?.state!=='new' && c.review?.due && c.review.due<=localDate()}
function isWeak(c){return !!c.review?.weak}
function newCards(){return cards.filter(c=>(c.review?.state||'new')==='new')}
async function getIntroducedToday(){const t=localDate();let x=await getMeta('introducedToday',{date:t,ids:[]});if(!x||x.date!==t||!Array.isArray(x.ids)){x={date:t,ids:[]};await setMeta('introducedToday',x);return x}const validIds=x.ids.filter(id=>cards.some(c=>c.id===id));if(validIds.length!==x.ids.length){x={date:t,ids:validIds};await setMeta('introducedToday',x)}return x}
async function todayCounts(deckId=null){const filtered=deckId?cards.filter(c=>c.deckId===deckId):cards;const due=filtered.filter(isDue).length;const intro=await getIntroducedToday();const introducedIds=intro.ids.filter(id=>filtered.some(c=>c.id===id && (c.review?.state||'new')==='new'));
  const newRemaining=Math.max(0,Math.min(settings.dailyNew-introducedIds.length,filtered.filter(c=>(c.review?.state||'new')==='new'&&!intro.ids.includes(c.id)).length))+introducedIds.length;
  return {due,newRemaining};
}

async function renderAll(){
  const {due,newRemaining}=await todayCounts();
  $('#dueCount').textContent=due;$('#weakCount').textContent=cards.filter(isWeak).length;$('#totalCount').textContent=cards.length;
  $('#todaySummary').textContent=`今日：到期 ${due} + 新卡 ${newRemaining}`;
  const w=$('#softWarn');if(settings.softLimit>0&&due>settings.softLimit){w.textContent=`到期卡 ${due} 张，已超过你设置的 ${settings.softLimit} 张提醒值；不会截断复习。`;w.classList.add('show')}else w.classList.remove('show');
  $('#startReviewBtn').disabled=cards.length===0;
  renderDecks();renderDeckSelects();if($('#browseScreen').classList.contains('active'))renderBrowse();if($('#deckScreen').classList.contains('active'))renderDeckCards();
}
function renderDecks(){const el=$('#deckList');if(!decks.length){el.innerHTML='<div class="empty">还没有卡组。先新建一个卡组，再添加第一张闪卡。</div>';return}el.innerHTML=decks.map(d=>{const cs=cards.filter(c=>c.deckId===d.id),due=cs.filter(isDue).length,weak=cs.filter(isWeak).length;return `<div class="deck" data-open-deck="${d.id}"><div class="deck-main"><div class="deck-name">${esc(d.name)}</div><div class="deck-meta">${cs.length} 张 · 今日到期 ${due}${weak?` · 模糊 ${weak}`:''}</div></div><div class="deck-actions"><button class="mini" data-study-deck="${d.id}">复习</button><button class="mini" data-edit-deck="${d.id}">•••</button><button class="mini add-card-mini" data-add-card-deck="${d.id}" aria-label="给${esc(d.name)}添加卡片">＋</button></div></div>`}).join('')}
function renderDeckSelects(){const opts=decks.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');$('#cardDeck').innerHTML=opts;$('#deckFilter').innerHTML='<option value="">全部卡组</option>'+opts}

async function ensureDeck(){if(decks.length)return decks[0].id;const d={id:uid(),name:'默认卡组',createdAt:nowISO(),updatedAt:nowISO()};await idbPut('decks',d);decks.push(d);await safeRenderAll();return d.id}
function emptyReview(){return {state:'new',due:null,level:0,interval:0,lastReviewed:null,lastRating:null,weak:false,goodStreak:0,lapses:0,reviews:0}}
async function saveCard(card){await idbPut('cards',card);const i=cards.findIndex(c=>c.id===card.id);if(i>=0)cards[i]=card;else cards.push(card);return card}

function openCardModal(id=null,presetDeck=null){
  const c=id?cards.find(x=>x.id===id):null;$('#cardModalTitle').textContent=c?'编辑闪卡':'添加闪卡';$('#cardId').value=c?.id||'';$('#frontText').value=c?.front||'';$('#backText').value=c?.back||'';$('#tagsInput').value=(c?.tags||[]).join(', ');$('#sourceInput').value=c?.source||'';$('#noteInput').value=c?.note||'';editingFrontImage=c?.frontImage||null;editingBackImage=c?.backImage||null;setPreview('#frontPreview',editingFrontImage);setPreview('#backPreview',editingBackImage);$('#deleteCardBtn').style.display=c?'block':'none';
  ensureDeck().then(()=>{renderDeckSelects();$('#cardDeck').value=c?.deckId||presetDeck||decks[0]?.id||'';showModal('cardModal')}).catch(err=>{console.error(err);alert('打开卡片编辑页失败：'+friendlyError(err))});
}
function setPreview(sel,data){const el=$(sel);if(data){el.src=data;el.classList.add('show')}else{el.removeAttribute('src');el.classList.remove('show')}}
async function compressImage(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{const im=new Image();im.onload=()=>{let {width:w,height:h}=im,max=1400;if(Math.max(w,h)>max){const r=max/Math.max(w,h);w=Math.round(w*r);h=Math.round(h*r)}const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(im,0,0,w,h);resolve(c.toDataURL('image/jpeg',.82))};im.onerror=reject;im.src=reader.result};reader.onerror=reject;reader.readAsDataURL(file)})}

async function buildTodaySession(deckId=null){
  const pool=deckId?cards.filter(c=>c.deckId===deckId):cards;
  let queue=pool.filter(isDue).sort((a,b)=>(a.review.due||'').localeCompare(b.review.due||''));
  let intro=await getIntroducedToday();let todayIds=intro.ids.filter(id=>pool.some(c=>c.id===id&&(c.review?.state||'new')==='new'));
  const fresh=pool.filter(c=>(c.review?.state||'new')==='new'&&!intro.ids.includes(c.id)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const room=Math.max(0,settings.dailyNew-intro.ids.length);const added=fresh.slice(0,room);if(added.length){intro.ids.push(...added.map(c=>c.id));await setMeta('introducedToday',intro);todayIds.push(...added.map(c=>c.id))}
  const todaysNew=todayIds.map(id=>cards.find(c=>c.id===id)).filter(Boolean);
  queue=[...queue,...todaysNew];
  startSession(queue,{mode:'today',title:deckId?`${decks.find(d=>d.id===deckId)?.name||'卡组'} · 今日复习`:'今日复习',deckId});
}
function startWeakSession(){startSession(cards.filter(isWeak),{mode:'weak',title:'模糊卡复习',deckId:null})}
function startSession(queue,opts){if(!queue.length){toast('现在没有需要复习的卡片');return}closeAllModals();session={queue:[...queue],history:[],index:0,flipped:false,returnToDeck:false,...opts};$('#studyTitle').textContent=session.title;showScreen('studyScreen');renderStudy()}
function currentCard(){return session.queue[session.index]}
function renderStudy(){const c=currentCard();if(!c){finishSession();return}session.flipped=false;$('#flashCard').classList.remove('backside');$('#cardSide').textContent='正面';$('#cardText').textContent=c.front||'（看图回答）';setStudyImage(c.frontImage);$('#cardExtra').style.display='none';$('#tapHint').textContent='轻点卡片翻面';$('#ratingRow').classList.add('hidden');$('#studyProgress').textContent=`${session.index+1} / ${session.queue.length}`;$('#studyDeckName').textContent=cardDeckName(c)}
function setStudyImage(src){const el=$('#cardImage');if(src){el.src=src;el.style.display='block'}else{el.removeAttribute('src');el.style.display='none'}}
function flipCard(){const c=currentCard();if(!c)return;session.flipped=!session.flipped;$('#flashCard').classList.toggle('backside',session.flipped);$('#cardSide').textContent=session.flipped?'背面':'正面';$('#cardText').textContent=session.flipped?(c.back||'（无文字答案）'):(c.front||'（看图回答）');setStudyImage(session.flipped?c.backImage:c.frontImage);if(session.flipped){const bits=[];if(c.note)bits.push(`<div><b>备注：</b>${esc(c.note).replace(/\n/g,'<br>')}</div>`);if(c.source)bits.push(`<div><b>来源：</b>${esc(c.source)}</div>`);if(c.tags?.length)bits.push(`<div><b>标签：</b>${c.tags.map(t=>`<span class="badge">${esc(t)}</span>`).join('')}</div>`);$('#cardExtra').innerHTML=bits.join('');$('#cardExtra').style.display=bits.length?'grid':'none';$('#tapHint').textContent='根据记忆情况选择';$('#ratingRow').classList.remove('hidden')}else{$('#cardExtra').style.display='none';$('#tapHint').textContent='轻点卡片翻面';$('#ratingRow').classList.add('hidden')}}
function nextInterval(level){const seq=[1,3,7,14,30,60,120,180];return seq[Math.min(level,seq.length-1)]}
async function rateCurrent(rating){const c=currentCard();if(!c)return;const r={...emptyReview(),...(c.review||{})};r.reviews=(r.reviews||0)+1;r.lastReviewed=nowISO();r.lastRating=rating;r.state='review';
  if(rating==='again'){r.level=0;r.interval=1;r.due=addDays(localDate(),1);r.weak=true;r.goodStreak=0;r.lapses=(r.lapses||0)+1;reinsertCurrent(4)}
  else if(rating==='hard'){r.level=Math.max(0,r.level||0);r.interval=Math.max(1,Math.round(nextInterval(r.level)*.65));r.due=addDays(localDate(),r.interval);r.weak=true;r.goodStreak=0;reinsertCurrent(6)}
  else{r.level=Math.min((r.level||0)+1,7);r.interval=nextInterval((r.level||1)-1);r.due=addDays(localDate(),r.interval);if(r.weak){r.goodStreak=(r.goodStreak||0)+1;if(r.goodStreak>=2){r.weak=false;r.goodStreak=0}}}
  c.review=r;await saveCard(c);const stat=await getMeta('dailyStats',{});const t=localDate();const s=stat.date===t?stat:{date:t,reviews:0};s.reviews++;await setMeta('dailyStats',s);session.history.push(c.id);session.index++;renderStudy();
}
function reinsertCurrent(offset){const c=currentCard();const pos=Math.min(session.queue.length,session.index+offset+1);session.queue.splice(pos,0,c)}
function finishSession(){const returnDeckId=session.returnToDeck?session.deckId:null;if(returnDeckId&&decks.some(d=>d.id===returnDeckId)){currentDeckViewId=returnDeckId;showScreen('deckScreen');renderDeckCards();toast('这一轮完成了');renderAll()}else{showScreen('homeScreen');toast('这一轮完成了');renderAll()}}

function getDeckCardsInDisplayOrder(deckId,q=''){q=String(q||'').trim().toLowerCase();const arr=cards.filter(c=>c.deckId===deckId&&(!q||[c.front,c.back,c.note,c.source,...(c.tags||[])].join(' ').toLowerCase().includes(q)));arr.sort((a,b)=>(b.updatedAt||b.createdAt||'').localeCompare(a.updatedAt||a.createdAt||''));return arr}
function compactCardRow(c,{showDeck=true,selectable=false}={}){const checked=selectedCardIds.has(c.id)?'checked':'';return `<div class="card-row">${selectable?`<input class="select-box" type="checkbox" data-select-card="${c.id}" ${checked} />`:''}<div class="card-row-main" ${selectable?'':`data-preview-card="${c.id}"`}><div class="card-front">${esc(c.front||'（图片卡）')}</div><div class="card-sub">${showDeck?`<span class="badge">${esc(cardDeckName(c))}</span>`:''}${isWeak(c)?'<span class="badge">模糊</span>':''}${c.back?` ${esc(c.back)}`:''}</div></div><div class="row-actions"><button class="row-btn" data-edit-card="${c.id}">编辑</button><button class="row-btn delete" data-delete-card="${c.id}">删除</button></div></div>`}
function renderBrowse(){const q=$('#searchInput').value.trim().toLowerCase(),deckId=$('#deckFilter').value;let arr=cards.filter(c=>(!deckId||c.deckId===deckId)&&(!q||[c.front,c.back,c.note,c.source,...(c.tags||[])].join(' ').toLowerCase().includes(q)));arr.sort((a,b)=>(b.updatedAt||b.createdAt||'').localeCompare(a.updatedAt||a.createdAt||''));$('#browseList').innerHTML=arr.length?arr.map(c=>compactCardRow(c)).join(''):'<div class="empty">没有匹配的卡片。</div>'}
function openDeckScreen(deckId){const d=decks.find(x=>x.id===deckId);if(!d)return;currentDeckViewId=deckId;deckBulkMode=false;selectedCardIds.clear();$('#deckScreenTitle').textContent=d.name;$('#deckSearchInput').value='';showScreen('deckScreen');renderDeckCards()}
function renderDeckCards(){const d=decks.find(x=>x.id===currentDeckViewId);if(!d){showScreen('homeScreen');return}$('#deckScreenTitle').textContent=d.name;const arr=getDeckCardsInDisplayOrder(currentDeckViewId,$('#deckSearchInput').value);$('#bulkBar').classList.toggle('show',deckBulkMode);$('#bulkCount').textContent=`已选 ${selectedCardIds.size} 张`;$('#selectAllCards').checked=arr.length>0&&arr.every(c=>selectedCardIds.has(c.id));$('#deckCardList').innerHTML=arr.length?arr.map(c=>compactCardRow(c,{showDeck:false,selectable:deckBulkMode})).join(''):'<div class="empty">这个卡组还没有卡片。点“＋ 新卡”添加第一张。</div>'}
function setPreviewModalImage(sel,src){const el=$(sel);if(src){el.src=src;el.style.display='block'}else{el.removeAttribute('src');el.style.display='none'}}
function renderCardPreviewFace(){const c=cards.find(x=>x.id===previewCardId);if(!c)return;$('#previewSide').textContent=previewFlipped?'背面':'正面';$('#previewText').textContent=previewFlipped?(c.back||'（无文字答案）'):(c.front||'（无文字，查看图片）');setPreviewModalImage('#previewImage',previewFlipped?c.backImage:c.frontImage);$('#previewFlipHint').textContent=previewFlipped?'轻点卡片返回正面':'轻点卡片查看背面';const meta=[];if(c.tags?.length)meta.push(`标签：${c.tags.join('、')}`);if(c.source)meta.push(`来源：${c.source}`);if(c.note)meta.push(`备注：${c.note}`);$('#previewMeta').textContent=meta.join('\n');$('#previewMeta').style.display=previewFlipped&&meta.length?'block':'none'}
function openCardPreview(id){const c=cards.find(x=>x.id===id);if(!c)return;previewCardId=id;previewFlipped=false;$('#previewDeckName').textContent=cardDeckName(c);let arr=getDeckCardsInDisplayOrder(c.deckId);if($('#deckScreen').classList.contains('active')&&currentDeckViewId===c.deckId)arr=getDeckCardsInDisplayOrder(c.deckId,$('#deckSearchInput').value);const pos=arr.findIndex(x=>x.id===id);$('#previewPosition').textContent=pos>=0?`当前列表第 ${pos+1} / ${arr.length} 张`:`${cardDeckName(c)}`;renderCardPreviewFace();showModal('cardPreviewModal')}
function startSequentialFromCard(id){const c=cards.find(x=>x.id===id);if(!c){toast('找不到这张卡片');return}let q='';if($('#deckScreen').classList.contains('active')&&currentDeckViewId===c.deckId)q=$('#deckSearchInput').value;const arr=getDeckCardsInDisplayOrder(c.deckId,q);const pos=arr.findIndex(x=>x.id===id);if(pos<0){toast('这张卡不在当前列表中');return}const queue=arr.slice(pos);startSession(queue,{mode:'sequence',title:`${cardDeckName(c)} · 顺序复习`,deckId:c.deckId,returnToDeck:true})}
function exitBulkMode(){deckBulkMode=false;selectedCardIds.clear();renderDeckCards()}
async function deleteOneCard(id){const c=cards.find(x=>x.id===id);if(!c)return;if(!confirm(`删除这张卡？\n\n${(c.front||'图片卡').slice(0,45)}`))return;await idbDelete('cards',id);cards=cards.filter(x=>x.id!==id);selectedCardIds.delete(id);await renderAll();toast('卡片已删除')}
async function deleteSelectedCards(){const ids=[...selectedCardIds];if(!ids.length){toast('请先选择要删除的卡片');return}if(!confirm(`确定删除选中的 ${ids.length} 张卡片？此操作不能撤销。`))return;for(const id of ids)await idbDelete('cards',id);cards=cards.filter(c=>!selectedCardIds.has(c.id));exitBulkMode();await renderAll();toast(`已删除 ${ids.length} 张卡片`)}

function parseImportText(text){text=text.trim();if(!text)return[];try{const x=JSON.parse(text);const arr=Array.isArray(x)?x:(x.cards||[]);return arr.map(v=>normalizeImported(v,{allowImages:false})).filter(validImported)}catch(e){}
  const blocks=[...text.matchAll(/#CARD\s*([\s\S]*?)(?:#END|(?=#CARD)|$)/gi)].map(m=>m[1].trim());return blocks.map(b=>{const obj={};let key=null;for(const line of b.split(/\r?\n/)){const m=line.match(/^\s*(卡组|标题|正面|正面文字|背面|背面文字|标签|来源|备注)\s*[:：]\s*(.*)$/);if(m){key=m[1];obj[key]=m[2]}else if(key)obj[key]+='\n'+line}return normalizeImported({deck:obj['卡组'],front:obj['正面']||obj['正面文字']||obj['标题'],back:obj['背面']||obj['背面文字'],tags:obj['标签'],source:obj['来源'],note:obj['备注']},{allowImages:false})}).filter(validImported)}
function cleanEmbeddedImage(v){return typeof v==='string'&&v.startsWith('data:image/')?v:null}
function normalizeImported(x,{allowImages=true}={}){x=x||{};const front=String(x.front??x['正面']??x['正面文字']??x.title??x['标题']??'').trim();const back=String(x.back??x['背面']??x['背面文字']??'').trim();const fi=x.frontImage??x['正面图片']??null,bi=x.backImage??x['背面图片']??null;return {deck:String(x.deck??x.deckName??x['卡组']??'默认卡组').trim(),front,back,tags:Array.isArray(x.tags)?x.tags.map(String):Array.isArray(x['标签'])?x['标签'].map(String):String(x.tags??x['标签']??'').split(/[,，]/).map(s=>s.trim()).filter(Boolean),source:String(x.source??x['来源']??'').trim(),note:String(x.note??x['备注']??'').trim(),frontImage:allowImages?cleanEmbeddedImage(fi):null,backImage:allowImages?cleanEmbeddedImage(bi):null,frontImageFile:String(x.frontImageFile??x['正面图片文件']??(!cleanEmbeddedImage(fi)&&typeof fi==='string'?fi:'')??'').trim(),backImageFile:String(x.backImageFile??x['背面图片文件']??(!cleanEmbeddedImage(bi)&&typeof bi==='string'?bi:'')??'').trim()}}
function validImported(x){return !!(x.front||x.back||x.frontImage||x.backImage||x.frontImageFile||x.backImageFile)}
async function importCards(arr){let madeDecks=0;for(const raw of arr){const x=normalizeImported(raw,{allowImages:true});let d=decks.find(d=>d.name===x.deck);if(!d){d={id:uid(),name:x.deck||'默认卡组',createdAt:nowISO(),updatedAt:nowISO()};await idbPut('decks',d);decks.push(d);madeDecks++}const c={id:uid(),deckId:d.id,front:x.front,back:x.back,tags:x.tags||[],source:x.source||'',note:x.note||'',frontImage:x.frontImage||null,backImage:x.backImage||null,createdAt:nowISO(),updatedAt:nowISO(),review:emptyReview()};await idbPut('cards',c);cards.push(c)}await safeRenderAll();return {cards:arr.length,decks:madeDecks}}
async function importCardsFromFiles(fileList){const files=[...fileList];const jsonFiles=files.filter(f=>f.name.toLowerCase().endsWith('.json')||f.type==='application/json');if(!jsonFiles.length)throw new Error('请至少选择一个 JSON 文件');const imageFiles=files.filter(f=>f.type.startsWith('image/'));const imageMap=new Map();for(const f of imageFiles){imageMap.set(f.name,await compressImage(f))}let all=[];for(const jf of jsonFiles){const data=JSON.parse(await jf.text());const raw=Array.isArray(data)?data:(data.cards||[]);for(const item of raw){const x=normalizeImported(item,{allowImages:true});const base=n=>String(n||'').split(/[\\/]/).pop();if(!x.frontImage&&x.frontImageFile)x.frontImage=imageMap.get(x.frontImageFile)||imageMap.get(base(x.frontImageFile))||null;if(!x.backImage&&x.backImageFile)x.backImage=imageMap.get(x.backImageFile)||imageMap.get(base(x.backImageFile))||null;all.push(x)}}all=all.filter(validImported);if(!all.length)throw new Error('JSON 中没有可导入的卡片');return importCards(all)}

function downloadJSON(obj,name){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
async function fullBackup(){return {app:'学习闪卡',version:2,exportedAt:nowISO(),settings,decks,cards,meta:{introducedToday:await getMeta('introducedToday',null),dailyStats:await getMeta('dailyStats',null)}}}
async function restoreBackup(data){if(!data?.decks||!data?.cards)throw new Error('不是有效备份');await Promise.all(['decks','cards','meta'].map(idbClear));for(const d of data.decks)await idbPut('decks',d);for(const c of data.cards)await idbPut('cards',c);await setMeta('settings',{...DEFAULT_SETTINGS,...data.settings});if(data.meta?.introducedToday)await setMeta('introducedToday',data.meta.introducedToday);if(data.meta?.dailyStats)await setMeta('dailyStats',data.meta.dailyStats);await loadAll()}

function openDeckModal(id=null){const d=id?decks.find(x=>x.id===id):null;$('#deckModalTitle').textContent=d?'编辑卡组':'新建卡组';$('#deckId').value=d?.id||'';$('#deckNameInput').value=d?.name||'';$('#deleteDeckBtn').style.display=d?'block':'none';showModal('deckModal')}

async function init(){db=await openDB();await loadAll();if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  $$('#cardModal input[type=file],#importModal input[type=file]').forEach(i=>i.addEventListener('click',e=>e.stopPropagation()));
}

// Global UI events
$$('[data-go-home]').forEach(b=>b.addEventListener('click',()=>{showScreen('homeScreen');renderAll()}));
$('#studyBackBtn').onclick=()=>{if(session.returnToDeck&&session.deckId&&decks.some(d=>d.id===session.deckId)){openDeckScreen(session.deckId);renderAll()}else{showScreen('homeScreen');renderAll()}};
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>hideModal(b.dataset.close)));
$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)hideModal(m.id)}));
$('#settingsBtn').onclick=()=>{$('#dailyNewInput').value=settings.dailyNew;$('#softLimitInput').value=settings.softLimit;showModal('settingsModal')};
$('#newDeckBtn').onclick=()=>openDeckModal();$('#importBtn').onclick=()=>showModal('importModal');$('#addCardFab').onclick=()=>openCardModal();
$('#startReviewBtn').onclick=()=>buildTodaySession().catch(err=>{console.error(err);alert('开始复习失败：'+friendlyError(err))});$('#weakBtn').onclick=()=>{try{startWeakSession()}catch(err){console.error(err);alert('开始模糊卡复习失败：'+friendlyError(err))}};$('#browseBtn').onclick=()=>{showScreen('browseScreen');renderBrowse()};
$('#flashCard').onclick=flipCard;$$('[data-rating]').forEach(b=>b.onclick=()=>rateCurrent(b.dataset.rating));
$('#prevStudy').onclick=()=>{if(session.index>0){session.index--;renderStudy()}else toast('已经是第一张')};
$('#nextStudy').onclick=()=>{if(session.index<session.queue.length-1){session.index++;renderStudy()}else finishSession()};
$('#searchInput').oninput=renderBrowse;$('#deckFilter').onchange=renderBrowse;
$('#deckSearchInput').oninput=renderDeckCards;
$('#deckAddCardBtn').onclick=()=>openCardModal(null,currentDeckViewId);
$('#deckBatchBtn').onclick=()=>{deckBulkMode=true;selectedCardIds.clear();renderDeckCards()};
$('#cancelBulkBtn').onclick=exitBulkMode;
$('#deleteSelectedBtn').onclick=deleteSelectedCards;
$('#selectAllCards').onchange=e=>{const q=$('#deckSearchInput').value.trim().toLowerCase();const visible=cards.filter(c=>c.deckId===currentDeckViewId&&(!q||[c.front,c.back,c.note,c.source,...(c.tags||[])].join(' ').toLowerCase().includes(q)));if(e.target.checked)visible.forEach(c=>selectedCardIds.add(c.id));else visible.forEach(c=>selectedCardIds.delete(c.id));renderDeckCards()};
$('#previewFace').onclick=()=>{if(!previewCardId)return;previewFlipped=!previewFlipped;renderCardPreviewFace()};
$('#previewStartBtn').onclick=()=>{if(previewCardId)startSequentialFromCard(previewCardId)};
$('#previewEditBtn').onclick=()=>{const id=previewCardId;hideModal('cardPreviewModal');if(id)openCardModal(id)};

document.addEventListener('click',e=>{const ac=e.target.closest('[data-add-card-deck]');if(ac){openCardModal(null,ac.dataset.addCardDeck);return}const sd=e.target.closest('[data-study-deck]');if(sd){buildTodaySession(sd.dataset.studyDeck).catch(err=>{console.error(err);alert('开始复习失败：'+friendlyError(err))});return}const ed=e.target.closest('[data-edit-deck]');if(ed){openDeckModal(ed.dataset.editDeck);return}const od=e.target.closest('[data-open-deck]');if(od){openDeckScreen(od.dataset.openDeck);return}const ec=e.target.closest('[data-edit-card]');if(ec){openCardModal(ec.dataset.editCard);return}const dc=e.target.closest('[data-delete-card]');if(dc){deleteOneCard(dc.dataset.deleteCard);return}const sc=e.target.closest('[data-select-card]');if(sc){if(sc.checked)selectedCardIds.add(sc.dataset.selectCard);else selectedCardIds.delete(sc.dataset.selectCard);renderDeckCards();return}const pc=e.target.closest('[data-preview-card]');if(pc){openCardPreview(pc.dataset.previewCard);return}});

$('#deckForm').onsubmit=async e=>{e.preventDefault();const id=$('#deckId').value;const name=$('#deckNameInput').value.trim();if(!name)return;let d=id?decks.find(x=>x.id===id):null;if(d){d.name=name;d.updatedAt=nowISO()}else d={id:uid(),name,createdAt:nowISO(),updatedAt:nowISO()};await idbPut('decks',d);hideModal('deckModal');await loadAll();toast('卡组已保存')};
$('#deleteDeckBtn').onclick=async()=>{const id=$('#deckId').value,d=decks.find(x=>x.id===id);if(!d)return;if(!confirm(`删除“${d.name}”及其中所有卡片？此操作不能撤销。`))return;for(const c of cards.filter(c=>c.deckId===id))await idbDelete('cards',c.id);await idbDelete('decks',id);hideModal('deckModal');await loadAll();toast('卡组已删除')};

$('#frontImageInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{editingFrontImage=await compressImage(f);setPreview('#frontPreview',editingFrontImage)}catch(err){alert('正面图片处理失败：'+friendlyError(err))}finally{e.target.value=''}};
$('#backImageInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{editingBackImage=await compressImage(f);setPreview('#backPreview',editingBackImage)}catch(err){alert('背面图片处理失败：'+friendlyError(err))}finally{e.target.value=''}};
$('#removeFrontImage').onclick=()=>{editingFrontImage=null;setPreview('#frontPreview',null)};$('#removeBackImage').onclick=()=>{editingBackImage=null;setPreview('#backPreview',null)};
$('#cardForm').onsubmit=async e=>{e.preventDefault();const btn=$('#saveCardBtn');if(btn.disabled)return;btn.disabled=true;const oldLabel=btn.textContent;btn.textContent='保存中…';try{const deckId=$('#cardDeck').value||await ensureDeck(),front=$('#frontText').value.trim(),back=$('#backText').value.trim();if(!front&&!editingFrontImage)throw new Error('正面至少需要文字或图片');if(!back&&!editingBackImage)throw new Error('背面至少需要文字或图片');const id=$('#cardId').value;const existing=id?cards.find(x=>x.id===id):null;if(id&&!existing)throw new Error('找不到要编辑的卡片，请关闭后重试');const common={deckId,front,back,frontImage:editingFrontImage,backImage:editingBackImage,tags:$('#tagsInput').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean),source:$('#sourceInput').value.trim(),note:$('#noteInput').value.trim(),updatedAt:nowISO()};const c=existing?{...existing,...common}:{id:uid(),createdAt:nowISO(),review:emptyReview(),...common};await saveCard(c);hideModal('cardModal');toast(existing?'修改已保存':'新卡已保存');await safeRenderAll()}catch(err){console.error('保存卡片失败',err);alert('保存失败：'+friendlyError(err))}finally{btn.disabled=false;btn.textContent=oldLabel}};
$('#deleteCardBtn').onclick=async()=>{const id=$('#cardId').value;if(!id||!confirm('删除这张卡？'))return;await idbDelete('cards',id);hideModal('cardModal');await loadAll();toast('卡片已删除')};

$$('.tab').forEach(t=>t.onclick=()=>{$$('.tab').forEach(x=>x.classList.remove('active'));$$('.tabpane').forEach(x=>x.classList.remove('active'));t.classList.add('active');$('#'+t.dataset.tab).classList.add('active')});
$('#importText').oninput=()=>{const a=parseImportText($('#importText').value);$('#parseResult').textContent=a.length?`已识别 ${a.length} 张卡片。`:'支持 #CARD 格式或 JSON。'};
$('#pasteImportBtn').onclick=async()=>{try{const arr=parseImportText($('#importText').value);if(!arr.length)throw new Error('没有识别到可导入的卡片');const r=await importCards(arr);$('#importText').value='';$('#parseResult').textContent='导入完成。';hideModal('importModal');toast(`已导入 ${r.cards} 张文字卡片`)}catch(err){alert('导入失败：'+friendlyError(err))}};
$('#copyPromptBtn').onclick=async()=>{await navigator.clipboard.writeText($('#chatgptPrompt').textContent);toast('提示词已复制')};
$('#cardsFileInput').onchange=async e=>{const fs=[...e.target.files];if(!fs.length)return;$('#fileImportResult').textContent='正在读取并导入…';try{const r=await importCardsFromFiles(fs);$('#fileImportResult').textContent=`导入完成：${r.cards} 张卡片。`;hideModal('importModal');toast(`已导入 ${r.cards} 张卡片`)}catch(err){console.error(err);$('#fileImportResult').textContent='导入失败：'+friendlyError(err);alert('导入失败：'+friendlyError(err))}e.target.value=''};
$('#downloadImportTemplateBtn').onclick=()=>downloadJSON({version:2,cards:[{deck:'言语错题',front:'先自己做题，再翻面看解析',back:'结论 + 极短解释 + 错因 + 下次',frontImageFile:'题目截图.jpg',backImageFile:'解析截图.jpg',tags:['言语','细节判断'],source:'2026-08-08',note:''}]},'学习闪卡_图片导入模板.json');
$('#backupFileInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(!confirm('恢复完整备份会覆盖当前所有数据，继续吗？')){e.target.value='';return}try{await restoreBackup(JSON.parse(await f.text()));hideModal('importModal');toast('备份已恢复')}catch(err){alert('恢复失败：'+err.message)}e.target.value=''};

$('#dailyNewInput').onchange=async()=>{settings.dailyNew=Math.max(0,Math.min(200,Number($('#dailyNewInput').value)||0));await setMeta('settings',settings);renderAll()};
$('#softLimitInput').onchange=async()=>{settings.softLimit=Math.max(0,Math.min(999,Number($('#softLimitInput').value)||0));await setMeta('settings',settings);renderAll()};
$('#exportBackupBtn').onclick=async()=>downloadJSON(await fullBackup(),`学习闪卡_完整备份_${localDate()}.json`);
$('#exportCardsBtn').onclick=()=>downloadJSON({version:2,cards:cards.map(c=>({deck:cardDeckName(c),front:c.front,back:c.back,frontImage:c.frontImage||null,backImage:c.backImage||null,tags:c.tags,source:c.source,note:c.note}))},`学习闪卡_全部卡片_含图片_${localDate()}.json`);
$('#resetAllBtn').onclick=async()=>{if(!confirm('确定清空所有卡组、卡片和学习记录？建议先导出备份。'))return;if(!confirm('再次确认：清空后无法撤销。'))return;await Promise.all(['decks','cards','meta'].map(idbClear));hideModal('settingsModal');await loadAll();toast('已清空全部数据')};

init().catch(err=>{console.error(err);alert('应用初始化失败：'+err.message)});
