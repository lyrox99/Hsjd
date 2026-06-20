(function(){
"use strict";

/* ======================= UTILITIES ======================= */
function fa(n){ return Math.round(n).toLocaleString('fa-IR'); }
function rand(min,max){ return Math.random()*(max-min)+min; }
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function dist(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return Math.sqrt(dx*dx+dy*dy); }
function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){} }

/* ======================= CANVAS SETUP ======================= */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let W=0,H=0,DPR=1;
function resize(){
  DPR = Math.min(window.devicePixelRatio||1, 2.5);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W*DPR; canvas.height = H*DPR;
  canvas.style.width = W+'px'; canvas.style.height = H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  if(player){
    player.x = clamp(player.x, player.r, W-player.r);
    player.y = clamp(player.y, H*0.45, H-player.r-10);
  }
}
window.addEventListener('resize', resize);

/* ======================= SCREENS ======================= */
const screens = {
  loading: document.getElementById('loadingScreen'),
  menu: document.getElementById('menuScreen'),
  multi: document.getElementById('multiScreen'),
  shop: document.getElementById('shopScreen'),
  pause: document.getElementById('pauseScreen'),
  gameover: document.getElementById('gameOverScreen'),
};
const hud = document.getElementById('hud');
function showScreen(name){
  Object.values(screens).forEach(s=>s.classList.add('hidden'));
  if(name && screens[name]) screens[name].classList.remove('hidden');
  hud.classList.toggle('hidden', name!==null);
}

/* ======================= PERSISTENT STATE ======================= */
let coins = 0;
let bestScore = 0;
let upgrades = { speed:0, damage:0, firerate:0, hp:0 };
const UPGRADE_MAX = 10;
const UPGRADE_DEFS = [
  { key:'hp',       icon:'❤️', name:'جان بیشتر',   desc:'سپر بدن خرپلنگ رو تقویت می‌کنه', base:32 },
  { key:'damage',   icon:'💥', name:'قدرت شلیک',   desc:'به گلوله‌ها آسیب بیشتری می‌ده',  base:38 },
  { key:'firerate', icon:'⚡', name:'سرعت آتش',     desc:'فاصله بین شلیک‌ها رو کم می‌کنه', base:42 },
  { key:'speed',    icon:'🚀', name:'سرعت حرکت',   desc:'خرپلنگ سریع‌تر جا خالی می‌ده',   base:28 },
];
function upgradeCost(key){
  const def = UPGRADE_DEFS.find(d=>d.key===key);
  const lvl = upgrades[def.key];
  return Math.round(def.base * Math.pow(1.42, lvl));
}

function statMaxHp(){ return 100 + upgrades.hp*16; }
function statDamage(){ return 10 + upgrades.damage*4.5; }
function statFireRate(){ return Math.max(120, 430 - upgrades.firerate*30); }
function statSpeed(){ return 330 + upgrades.speed*24; }

/* ======================= MULTIPLAYER STATE ======================= */
let peer = null;
let conn = null;
let isHost = false;
let multiMode = false;
let player2 = null; // remote player state for rendering
let myRoomId = null;

/* ======================= PEERJS SETUP ======================= */
function generateRoomCode(){
  return Math.floor(100000 + Math.random()*900000).toString();
}

function initPeer(customId){
  return new Promise((resolve, reject)=>{
    const p = new Peer(customId, {
      host: '0.peerjs.com', port: 443, path: '/',
      secure: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.relay.metered.ca:80' },
          {
            urls: 'turn:global.relay.metered.ca:80',
            username: 'e9d36d4f2d6e8a0a2d4e1a5b',
            credential: 'uGzMsKd7P3kLvN2Q'
          },
          {
            urls: 'turn:global.relay.metered.ca:443',
            username: 'e9d36d4f2d6e8a0a2d4e1a5b',
            credential: 'uGzMsKd7P3kLvN2Q'
          },
          {
            urls: 'turn:global.relay.metered.ca:443?transport=tcp',
            username: 'e9d36d4f2d6e8a0a2d4e1a5b',
            credential: 'uGzMsKd7P3kLvN2Q'
          }
        ]
      }
    });
    p.on('open', id => { resolve({ peer:p, id }); });
    p.on('error', err => { reject(err); });
    setTimeout(()=>reject(new Error('timeout')), 15000);
  });
}

function setStatus(msg, cls=''){
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className = cls;
}

function updateConnBadge(connected){
  const badge = document.getElementById('connBadge');
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  if(multiMode){
    badge.classList.remove('hidden');
    if(connected){
      dot.className='online';
      label.textContent = 'دوستت وصله 🟢';
    } else {
      dot.className='';
      label.textContent = 'منتظر اتصال...';
    }
  } else {
    badge.classList.add('hidden');
  }
}

async function openMultiScreen(){
  state='multi';
  showScreen('multi');
  setStatus('در حال اتصال به سرور...');
  document.getElementById('waitForGuestBtn').disabled=true;
  document.getElementById('codeText').textContent='...';
  document.getElementById('joinBtn').disabled=true;

  try {
    const code = generateRoomCode();
    const result = await initPeer('kp-' + code);
    peer = result.peer;
    myRoomId = code;
    document.getElementById('codeText').textContent = code;
    document.getElementById('waitForGuestBtn').disabled=false;
    setStatus('آماده! کد رو برای دوستت بفرست 📋', 'ok');
    document.getElementById('joinBtn').disabled=false;

    // Listen for incoming connection (as host)
    peer.on('connection', (c)=>{
      conn = c;
      isHost = true;
      setupConnection();
      setStatus('دوستت وصل شد! در حال شروع...', 'ok');
      updateConnBadge(true);
      setTimeout(()=>{
        // Host starts game and tells guest
        startGame(true);
        sendToPeer({ type:'start' });
      }, 800);
    });
  } catch(e){
    setStatus('خطا در اتصال: ' + (e.message||'دوباره امتحان کن'), 'err');
    document.getElementById('joinBtn').disabled=false;
  }
}

async function joinRoom(){
  const code = document.getElementById('joinCodeInput').value.trim();
  if(code.length!==6 || isNaN(code)){ setStatus('کد ۶ رقمی وارد کن', 'err'); return; }
  setStatus('در حال وصل شدن...', '');
  document.getElementById('joinBtn').disabled=true;

  try {
    if(!peer){
      const result = await initPeer('kp-guest-' + Date.now());
      peer = result.peer;
    }
    conn = peer.connect('kp-' + code, { reliable:true });
    isHost = false;
    conn.on('open', ()=>{
      setupConnection();
      setStatus('وصل شدی! منتظر شروع بازی...', 'ok');
      updateConnBadge(true);
    });
    conn.on('error', ()=>{ setStatus('اتصال ناموفق بود', 'err'); document.getElementById('joinBtn').disabled=false; });
    setTimeout(()=>{ if(!conn.open){ setStatus('پیدا نشد. کد رو چک کن', 'err'); document.getElementById('joinBtn').disabled=false; } }, 15000);
  } catch(e){
    setStatus('خطا: ' + (e.message||'دوباره امتحان کن'), 'err');
    document.getElementById('joinBtn').disabled=false;
  }
}

function copyRoomCode(){
  if(!myRoomId) return;
  const el = document.getElementById('codeText');
  const orig = el.textContent;

  function showCopied(){ el.textContent = '✅ کپی شد!'; setTimeout(()=>{ el.textContent = orig; }, 1800); }
  function fallbackCopy(text){
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try{ document.execCommand('copy'); showCopied(); }catch(e){ el.textContent = myRoomId; }
    document.body.removeChild(ta);
  }

  const textToCopy = myRoomId; // فقط کد ۶ رقمی
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(textToCopy).then(showCopied).catch(()=>fallbackCopy(textToCopy));
  } else {
    fallbackCopy(textToCopy);
  }
}

function setupConnection(){
  conn.on('data', handlePeerData);
  conn.on('close', ()=>{
    updateConnBadge(false);
    player2 = null;
    document.getElementById('p2HpWrap').classList.add('hidden');
    if(state==='playing'){
      spawnFloat(W/2, H*0.4, 'دوستت قطع شد!', '#ff3da6');
    }
  });
}

function sendToPeer(data){
  if(conn && conn.open){ try{ conn.send(data); }catch(e){} }
}

/* ======================= PEER DATA HANDLER ======================= */
function handlePeerData(data){
  switch(data.type){
    case 'start':
      startGame(true);
      break;
    case 'pos':
      // Remote player position update
      if(!player2) player2 = { x:data.x, y:data.y, r:26, hp:data.hp, maxHp:data.maxHp, invuln:data.invuln||0, isDead:false };
      else { player2.x=data.x; player2.y=data.y; player2.hp=data.hp; player2.maxHp=data.maxHp; player2.invuln=data.invuln||0; }
      document.getElementById('p2HpWrap').classList.remove('hidden');
      document.getElementById('p2HpBar').style.width = clamp(player2.hp/player2.maxHp*100,0,100)+'%';
      break;
    case 'bullet':
      // Remote player fired a bullet - render on our canvas
      if(multiMode) bullets.push({ x:data.x, y:data.y, r:5, speed:640, dmg:data.dmg, fromP2:true });
      break;
    case 'enemyHit':
      // Remote player hit an enemy - apply damage
      if(isHost){
        const e = enemies.find(en=>en._id===data.id);
        if(e){ e.hp -= data.dmg; if(e.hp<=0){ spawnParticles(e.x,e.y,e.type.color,16); score += e.type.points; coins += e.type.coin; runCoins += e.type.coin; enemies.splice(enemies.indexOf(e),1); } }
        const bossTarget = boss;
        if(data.targetBoss && bossTarget){ bossTarget.hp -= data.dmg; spawnParticles(data.bx,data.by,'#b14dff',6); if(bossTarget.hp<=0) defeatBoss(); }
      }
      break;
    case 'gameState':
      // Host sends authoritative game state to guest
      if(!isHost){
        // Sync enemies, score
        score = data.score;
        level = data.level;
        coins = data.coins;
        runCoins = data.runCoins;
        // Sync enemies array
        const remoteEnemies = data.enemies;
        // Update existing, remove gone
        const remoteIds = new Set(remoteEnemies.map(e=>e._id));
        enemies = enemies.filter(e=>remoteIds.has(e._id));
        remoteEnemies.forEach(re=>{
          const local = enemies.find(e=>e._id===re._id);
          if(local){ local.x=re.x; local.y=re.y; local.hp=re.hp; }
          else {
            const type = ENEMY_TYPES.find(t=>t.key===re.typeKey)||ENEMY_TYPES[0];
            enemies.push({ _id:re._id, type, x:re.x, y:re.y, hp:re.hp, maxHp:re.maxHp, speed:re.speed, size:re.size, shootTimer:re.shootTimer||1 });
          }
        });
        // Sync boss
        if(data.boss){
          if(!boss){ boss={...data.boss}; document.getElementById('bossWrap').classList.remove('hidden'); document.getElementById('bossName').textContent=boss.name; }
          else { boss.x=data.boss.x; boss.y=data.boss.y; boss.hp=data.boss.hp; boss.maxHp=data.boss.maxHp; }
        } else if(boss){ boss=null; document.getElementById('bossWrap').classList.add('hidden'); }
        // HUD
        document.getElementById('coinVal').textContent = fa(coins);
        document.getElementById('scoreVal').textContent = fa(Math.floor(score));
        document.getElementById('levelVal').textContent = fa(level);
        if(boss) document.getElementById('bossBar').style.width = clamp(boss.hp/boss.maxHp*100,0,100)+'%';
      }
      break;
    case 'gameover':
      if(!isHost){
        // Guest: game over triggered by host death (both die together in co-op)
        endRun();
      }
      break;
    case 'enemyBullet':
      if(!isHost){
        enemyBullets.push({ x:data.x, y:data.y, r:6, vx:data.vx, vy:data.vy });
      }
      break;
  }
}

/* ======================= GAME STATE ======================= */
let state = 'loading';
let player = null;
let bullets = [], enemyBullets = [], enemies = [], particles = [], floats = [];
let stars = [];
let score = 0, runCoins = 0;
let spawnTimer = 0, spawnInterval = 1000;
let shotTimer = 0;
let level = 1;
let boss = null, bossesDefeated = 0, nextBossScore = 700, bossWarnTimer = 0;
let lastTime = 0;
let enemyIdCounter = 0;
let syncTimer = 0;

const ENEMY_TYPES = [
  { key:'meteor', name:'سنگ فضایی', hp:1, speed:95,  size:30, color:'#9097a3', points:10, coin:1, shoot:false, unlock:0 },
  { key:'scout',  name:'کاوشگر سبز', hp:2, speed:115, size:32, color:'#36d676', points:18, coin:2, shoot:false, unlock:120 },
  { key:'hunter', name:'شکارچی قرمز',hp:4, speed:135, size:34, color:'#ff4d6d', points:32, coin:3, shoot:true,  bulletSpeed:230, unlock:380 },
  { key:'robot',  name:'ربات فضایی', hp:7, speed:100, size:40, color:'#5b6ee8', points:50, coin:5, shoot:true,  bulletSpeed:250, unlock:750 },
  { key:'phantom',name:'شبح بنفش',  hp:11,speed:155, size:36, color:'#b14dff', points:75, coin:7, shoot:true,  bulletSpeed:300, unlock:1200 },
];
const BOSS_NAMES = ['فرمانده تاریکی','کریستال‌شکن','اژدهای کهکشان','شبح بی‌پایان','حاکم سیاه‌چاله'];

/* ======================= STARS ======================= */
function initStars(){
  stars = [];
  const count = Math.floor((W*H)/9000);
  for(let i=0;i<count;i++){
    stars.push({ x:rand(0,W), y:rand(0,H), r:rand(0.6,2.2), s:rand(20,90), a:rand(0.3,1) });
  }
}
function updateStars(dt){
  for(const st of stars){ st.y += st.s*dt; if(st.y>H){ st.y=-2; st.x=rand(0,W); } }
}
function drawStars(){
  ctx.save();
  for(const st of stars){ ctx.globalAlpha=st.a; ctx.fillStyle='#cdd6ff'; ctx.beginPath(); ctx.arc(st.x,st.y,st.r,0,Math.PI*2); ctx.fill(); }
  ctx.restore();
}

/* ======================= PLAYER ======================= */
function newPlayer(){
  return { x:W/2, y:H-120, r:26, targetX:W/2, targetY:H-120, hp:statMaxHp(), maxHp:statMaxHp(), invuln:0, dragging:false };
}
function drawPlayer(p, isP2){
  ctx.save();
  ctx.translate(p.x,p.y);
  const flameLen = 12+Math.random()*8;
  ctx.fillStyle = 'rgba(255,180,60,'+(0.45+Math.random()*0.3).toFixed(2)+')';
  ctx.beginPath(); ctx.ellipse(0,p.r*0.85+flameLen*0.4,6,flameLen,0,0,Math.PI*2); ctx.fill();
  if(p.invuln>0 && Math.floor(p.invuln*12)%2===0){
    ctx.globalAlpha=0.35;
    ctx.fillStyle = isP2 ? '#3dffb4' : '#28e8ff';
    ctx.beginPath(); ctx.ellipse(0,0,p.r*1.25,p.r*1.05,0,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
  }
  // ears
  ctx.fillStyle = isP2 ? '#52b0ff' : '#ff8c52';
  ctx.beginPath(); ctx.ellipse(-p.r*0.55,-p.r*0.9,7,17,-0.35,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(p.r*0.55,-p.r*0.9,7,17,0.35,0,Math.PI*2); ctx.fill();
  // body
  ctx.fillStyle = isP2 ? '#3db4ff' : '#ff7a3d';
  ctx.beginPath(); ctx.ellipse(0,0,p.r*0.95,p.r*0.78,0,0,Math.PI*2); ctx.fill();
  // spots
  ctx.fillStyle = isP2 ? '#1a5a8a' : '#8a431a';
  [[-11,-7],[9,-10],[1,7],[-15,5],[13,5],[-3,-2]].forEach(([dx,dy])=>{ ctx.beginPath(); ctx.arc(dx,dy,3,0,Math.PI*2); ctx.fill(); });
  // belly
  ctx.fillStyle = isP2 ? '#a8ddff' : '#ffb27a';
  ctx.beginPath(); ctx.ellipse(0,8,p.r*0.5,p.r*0.32,0,0,Math.PI*2); ctx.fill();
  // eyes
  ctx.fillStyle='#fff';
  ctx.beginPath(); ctx.arc(-7,-3,5.2,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(7,-3,5.2,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#13182c';
  ctx.beginPath(); ctx.arc(-6,-3,2.5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(8,-3,2.5,0,Math.PI*2); ctx.fill();
  // snout
  ctx.fillStyle = isP2 ? '#a8ddff' : '#ffb27a';
  ctx.beginPath(); ctx.ellipse(0,4,6,4,0,0,Math.PI*2); ctx.fill();
  // P2 indicator
  if(isP2){
    ctx.fillStyle='#3dffb4';
    ctx.font='bold 9px Vazirmatn, sans-serif';
    ctx.textAlign='center';
    ctx.fillText('P2', 0, -p.r-4);
  }
  ctx.restore();
}

/* ======================= INPUT ======================= */
function pointerToTarget(clientX, clientY){
  player.targetX = clamp(clientX, player.r+4, W-player.r-4);
  player.targetY = clamp(clientY-30, H*0.42, H-player.r-12);
}
canvas.addEventListener('pointerdown', e=>{ if(state!=='playing') return; player.dragging=true; pointerToTarget(e.clientX, e.clientY); });
window.addEventListener('pointermove', e=>{ if(state!=='playing'||!player||!player.dragging) return; pointerToTarget(e.clientX, e.clientY); });
window.addEventListener('pointerup', ()=>{ if(player) player.dragging=false; });
window.addEventListener('pointercancel', ()=>{ if(player) player.dragging=false; });

/* ======================= BULLETS / ENEMIES ======================= */
function spawnPlayerBullet(){
  const b = { x:player.x, y:player.y-player.r*0.7, r:5, speed:640, dmg:statDamage() };
  bullets.push(b);
  if(multiMode) sendToPeer({ type:'bullet', x:b.x, y:b.y, dmg:b.dmg });
}
function spawnEnemy(){
  const pool = ENEMY_TYPES.filter(t=>t.unlock<=score);
  const type = pool[Math.floor(Math.random()*pool.length)];
  const lvlScale = 1+(level-1)*0.16;
  const e = {
    _id: ++enemyIdCounter,
    type, x:rand(40,W-40), y:-40,
    hp:Math.ceil(type.hp*lvlScale), maxHp:Math.ceil(type.hp*lvlScale),
    speed:type.speed*(1+(level-1)*0.035),
    size:type.size, shootTimer:rand(0.6,1.8),
  };
  enemies.push(e);
}
function spawnEnemyBullet(x,y,speed,vx,vy){
  const b = { x, y, r:5, vx:vx||0, vy:vy||speed };
  enemyBullets.push(b);
  if(multiMode && isHost) sendToPeer({ type:'enemyBullet', x, y, vx:b.vx, vy:b.vy });
}
function spawnParticles(x,y,color,count){
  for(let i=0;i<count;i++){
    const ang=rand(0,Math.PI*2), spd=rand(40,180);
    particles.push({ x,y, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd, life:rand(0.3,0.7), maxLife:0.7, color });
  }
}
function spawnFloat(x,y,text,color){ floats.push({ x,y, text, life:1.1, color:color||'#ffce45' }); }

/* ======================= BOSS ======================= */
function triggerBossWarning(){
  bossWarnTimer=2.4;
  spawnFloat(W/2,H*0.3,'هشدار! باس در راهه','#ff3da6');
}
function spawnBoss(){
  const scale=1+bossesDefeated*0.55;
  boss={
    name:BOSS_NAMES[bossesDefeated%BOSS_NAMES.length],
    x:W/2, y:-80, targetY:110,
    hp:Math.round(160*scale), maxHp:Math.round(160*scale),
    size:95, t:0, shootTimer:1.2,
    reward:280+bossesDefeated*90, coinReward:55+bossesDefeated*18,
  };
  document.getElementById('bossWrap').classList.remove('hidden');
  document.getElementById('bossName').textContent=boss.name;
}
function defeatBoss(){
  if(!boss) return;
  score+=boss.reward; coins+=boss.coinReward; runCoins+=boss.coinReward;
  spawnParticles(boss.x,boss.y,'#b14dff',40);
  spawnFloat(boss.x,boss.y-30,'باس شکست خورد! +'+fa(boss.reward),'#ff3da6');
  bossesDefeated++;
  nextBossScore=score+750+bossesDefeated*120;
  boss=null;
  document.getElementById('bossWrap').classList.add('hidden');
}

/* ======================= LEVEL & DIFFICULTY ======================= */
function computeLevel(){ return Math.floor(score/110)+1; }
function computeSpawnInterval(){ return clamp(1150-level*32,260,1150); }

/* ======================= GAME FLOW ======================= */
function resetRun(){
  player=newPlayer();
  bullets=[]; enemyBullets=[]; enemies=[]; particles=[]; floats=[];
  score=0; runCoins=0; spawnTimer=0; shotTimer=0; syncTimer=0;
  level=1; spawnInterval=computeSpawnInterval();
  boss=null; bossesDefeated=0; nextBossScore=700; bossWarnTimer=0; enemyIdCounter=0;
  player2=null;
  document.getElementById('bossWrap').classList.add('hidden');
  document.getElementById('p2HpWrap').classList.add('hidden');
}
function startGame(isMulti){
  multiMode = !!isMulti;
  resetRun();
  state='playing';
  showScreen(null);
  updateConnBadge(multiMode && conn && conn.open);
}
function pauseGame(){ if(state!=='playing') return; state='paused'; showScreen('pause'); }
function resumeGame(){ state='playing'; showScreen(null); }
function goMenu(){
  state='menu';
  multiMode=false;
  document.getElementById('connBadge').classList.add('hidden');
  document.getElementById('bestScoreVal').textContent=fa(bestScore);
  document.getElementById('coinValMenu').textContent=fa(coins);
  showScreen('menu');
}
function openShop(from){ state='shop'; renderShop(); showScreen('shop'); openShop._from=from; }
function closeShop(){ if(openShop._from==='pause'){state='paused';showScreen('pause');}else{goMenu();} }
function endRun(){
  state='gameover';
  if(score>bestScore) bestScore=score;
  document.getElementById('finalScoreVal').textContent=fa(score);
  document.getElementById('finalBestVal').textContent=fa(bestScore);
  document.getElementById('finalCoinsVal').textContent=fa(runCoins);
  document.getElementById('bossWrap').classList.add('hidden');
  showScreen('gameover');
  vibrate(120);
  if(multiMode && isHost) sendToPeer({ type:'gameover' });
}

/* ======================= SHOP ======================= */
function renderShop(){
  document.getElementById('coinValShop').textContent=fa(coins);
  const list=document.getElementById('shopList');
  list.innerHTML='';
  UPGRADE_DEFS.forEach(def=>{
    const lvl=upgrades[def.key];
    const maxed=lvl>=UPGRADE_MAX;
    const cost=upgradeCost(def.key);
    const card=document.createElement('div');
    card.className='upgrade-card';
    const dots=Array.from({length:UPGRADE_MAX}).map((_,i)=>`<div class="dot ${i<lvl?'filled':''}"></div>`).join('');
    card.innerHTML=`
      <div class="upgrade-info">
        <div class="upgrade-name">${def.icon} ${def.name}</div>
        <div class="upgrade-level">${def.desc}</div>
        <div class="level-dots">${dots}</div>
      </div>
      <button class="buy-btn" ${maxed||coins<cost?'disabled':''}>${maxed?'حداکثر':('خرید · '+fa(cost))}</button>
    `;
    card.querySelector('.buy-btn').addEventListener('click',()=>{
      if(maxed||coins<cost) return;
      coins-=cost; upgrades[def.key]++;
      if(player) player.maxHp=statMaxHp();
      renderShop();
    });
    list.appendChild(card);
  });
}

/* ======================= UPDATE ======================= */
function update(dt){
  updateStars(dt);
  if(state!=='playing') return;

  if(bossWarnTimer>0){ bossWarnTimer-=dt; if(bossWarnTimer<=0&&!boss) spawnBoss(); }

  // player movement
  const sp=statSpeed();
  const dx=player.targetX-player.x, dy=player.targetY-player.y;
  const d=Math.sqrt(dx*dx+dy*dy);
  if(d>1){ const move=Math.min(d,sp*dt); player.x+=dx/d*move; player.y+=dy/d*move; }
  if(player.invuln>0) player.invuln-=dt;

  // shooting
  shotTimer+=dt*1000;
  if(shotTimer>=statFireRate()){ shotTimer=0; spawnPlayerBullet(); }

  // HOST-only: spawn enemies & sync state
  if(!multiMode || isHost){
    if(!boss&&bossWarnTimer<=0){
      spawnTimer+=dt*1000;
      if(spawnTimer>=spawnInterval&&enemies.length<16){ spawnTimer=0; spawnEnemy(); }
    }
    score+=dt*3;
    const newLevel=computeLevel();
    if(newLevel>level){ level=newLevel; spawnInterval=computeSpawnInterval(); spawnFloat(player.x,player.y-50,'مرحله '+fa(level),'#28e8ff'); }
    if(!boss&&bossWarnTimer<=0&&score>=nextBossScore) triggerBossWarning();

    // Sync to guest
    if(multiMode){
      syncTimer+=dt;
      if(syncTimer>=0.05){ // 20 times/sec
        syncTimer=0;
        sendToPeer({
          type:'gameState',
          score, level, coins, runCoins,
          enemies: enemies.map(e=>({ _id:e._id, typeKey:e.type.key, x:e.x, y:e.y, hp:e.hp, maxHp:e.maxHp, speed:e.speed, size:e.size })),
          boss: boss ? { name:boss.name, x:boss.x, y:boss.y, hp:boss.hp, maxHp:boss.maxHp, size:boss.size, t:boss.t } : null,
        });
      }
    }
  }

  // Send my position to peer
  if(multiMode){
    syncTimer+=dt;
    if(syncTimer>=0.05){
      syncTimer=0;
      sendToPeer({ type:'pos', x:player.x, y:player.y, hp:player.hp, maxHp:player.maxHp, invuln:player.invuln });
    }
  }

  // Update bullets (my bullets hit enemies)
  for(let i=bullets.length-1;i>=0;i--){
    const b=bullets[i];
    b.y-=b.speed*dt;
    if(b.y<-20){ bullets.splice(i,1); continue; }
    let hit=false;
    for(let j=enemies.length-1;j>=0;j--){
      const e=enemies[j];
      if(dist(b.x,b.y,e.x,e.y)<b.r+e.size*0.5){
        if(!multiMode||isHost){
          e.hp-=b.dmg;
          hit=true;
          if(e.hp<=0){ score+=e.type.points; coins+=e.type.coin; runCoins+=e.type.coin; spawnParticles(e.x,e.y,e.type.color,16); spawnFloat(e.x,e.y,'+'+fa(e.type.points)); enemies.splice(j,1); }
        } else {
          // Guest: tell host about hit
          sendToPeer({ type:'enemyHit', id:e._id, dmg:b.dmg, targetBoss:false });
          hit=true;
        }
        break;
      }
    }
    if(!hit&&boss&&dist(b.x,b.y,boss.x,boss.y)<b.r+boss.size*0.45){
      if(!multiMode||isHost){
        boss.hp-=b.dmg; hit=true; spawnParticles(b.x,b.y,'#b14dff',6);
        if(boss.hp<=0) defeatBoss();
      } else {
        sendToPeer({ type:'enemyHit', id:-1, dmg:b.dmg, targetBoss:true, bx:b.x, by:b.y });
        hit=true;
      }
    }
    if(hit) bullets.splice(i,1);
  }

  // update enemy bullets
  for(let i=enemyBullets.length-1;i>=0;i--){
    const b=enemyBullets[i];
    b.x+=b.vx*dt; b.y+=b.vy*dt;
    if(b.y>H+20||b.x<-20||b.x>W+20){ enemyBullets.splice(i,1); continue; }
    if(player.invuln<=0&&dist(b.x,b.y,player.x,player.y)<b.r+player.r*0.75){
      enemyBullets.splice(i,1); damagePlayer(12);
    }
  }

  // update enemies (host only moves them)
  if(!multiMode||isHost){
    for(let i=enemies.length-1;i>=0;i--){
      const e=enemies[i];
      e.y+=e.speed*dt;
      if(e.type.shoot){ e.shootTimer-=dt; if(e.shootTimer<=0){ e.shootTimer=rand(1.1,2.0); spawnEnemyBullet(e.x,e.y+e.size*0.3, e.type.bulletSpeed,0,e.type.bulletSpeed); } }
      if(e.y>H+50){ enemies.splice(i,1); continue; }
      // collide with local player
      if(player.invuln<=0&&dist(e.x,e.y,player.x,player.y)<player.r*0.85+e.size*0.45){
        damagePlayer(16); spawnParticles(e.x,e.y,e.type.color,14); enemies.splice(i,1); continue;
      }
      // collide with P2
      if(multiMode&&player2&&player2.invuln<=0&&dist(e.x,e.y,player2.x,player2.y)<26*0.85+e.size*0.45){
        // just do particle effect, guest handles their own damage
        spawnParticles(e.x,e.y,e.type.color,8);
      }
    }

    // Boss update
    if(boss){
      boss.t+=dt;
      if(boss.y<boss.targetY) boss.y+=90*dt;
      else {
        boss.x=W/2+Math.sin(boss.t*0.6)*(W*0.32);
        boss.shootTimer-=dt;
        if(boss.shootTimer<=0){
          boss.shootTimer=1.3;
          [-0.32,0,0.32].forEach(off=>{
            const b = { x:boss.x, y:boss.y+30, r:6, vx:Math.sin(off)*220, vy:Math.cos(off)*220 };
            enemyBullets.push(b);
            if(multiMode) sendToPeer({ type:'enemyBullet', x:b.x, y:b.y, vx:b.vx, vy:b.vy });
          });
        }
      }
      if(player.invuln<=0&&dist(boss.x,boss.y,player.x,player.y)<player.r*0.8+boss.size*0.4) damagePlayer(22);
    }
  } else {
    // Guest: still check enemy/boss collision with local player
    for(const e of enemies){
      if(player.invuln<=0&&dist(e.x,e.y,player.x,player.y)<player.r*0.85+e.size*0.45){
        damagePlayer(16); spawnParticles(e.x,e.y,e.type.color,14); break;
      }
    }
    if(boss&&player.invuln<=0&&dist(boss.x,boss.y,player.x,player.y)<player.r*0.8+boss.size*0.4) damagePlayer(22);
  }

  // particles & floats
  for(let i=particles.length-1;i>=0;i--){ const p=particles[i]; p.x+=p.vx*dt; p.y+=p.vy*dt; p.life-=dt; if(p.life<=0) particles.splice(i,1); }
  for(let i=floats.length-1;i>=0;i--){ const f=floats[i]; f.y-=30*dt; f.life-=dt; if(f.life<=0) floats.splice(i,1); }

  // HUD (only host updates score/coins HUD; guest gets it from gameState)
  if(!multiMode||isHost){
    document.getElementById('coinVal').textContent=fa(coins);
    document.getElementById('scoreVal').textContent=fa(Math.floor(score));
    document.getElementById('levelVal').textContent=fa(level);
  }
  document.getElementById('hpBar').style.width=clamp(player.hp/player.maxHp*100,0,100)+'%';
  if(boss) document.getElementById('bossBar').style.width=clamp(boss.hp/boss.maxHp*100,0,100)+'%';
}

function damagePlayer(amount){
  player.hp-=amount; player.invuln=0.7; vibrate(40);
  if(player.hp<=0){ player.hp=0; spawnParticles(player.x,player.y,'#ff7a3d',26); endRun(); }
}

/* ======================= DRAW ======================= */
function drawEnemy(e){
  ctx.save(); ctx.translate(e.x,e.y);
  ctx.fillStyle=e.type.color;
  ctx.beginPath(); ctx.arc(0,0,e.size*0.5,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(0,e.size*0.12,e.size*0.5,0,Math.PI,false); ctx.fill();
  ctx.fillStyle='#0d0f1c'; ctx.beginPath(); ctx.arc(0,-2,e.size*0.16,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(-e.size*0.06,-4,e.size*0.05,0,Math.PI*2); ctx.fill();
  if(e.maxHp>1){
    const w=e.size*0.9;
    ctx.fillStyle='rgba(0,0,0,.4)'; ctx.fillRect(-w/2,-e.size*0.7,w,4);
    ctx.fillStyle='#ff4d6d'; ctx.fillRect(-w/2,-e.size*0.7,w*clamp(e.hp/e.maxHp,0,1),4);
  }
  ctx.restore();
}
function drawBoss(b){
  ctx.save(); ctx.translate(b.x,b.y);
  ctx.fillStyle='#2a1640'; ctx.beginPath(); ctx.arc(0,0,b.size*0.5,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#b14dff'; ctx.beginPath(); ctx.arc(0,0,b.size*0.36,0,Math.PI*2); ctx.fill();
  [-1,1].forEach(side=>{
    ctx.fillStyle='#ff3da6'; ctx.beginPath(); ctx.arc(side*b.size*0.22,-4,8,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#1a0a26'; ctx.beginPath(); ctx.arc(side*b.size*0.22,-4,3.5,0,Math.PI*2); ctx.fill();
  });
  ctx.fillStyle='#4a2766'; ctx.fillRect(-10,b.size*0.32,20,16);
  ctx.restore();
}
function drawBullets(){
  ctx.save();
  ctx.fillStyle='#28e8ff';
  for(const b of bullets){ if(!b.fromP2){ ctx.beginPath(); ctx.ellipse(b.x,b.y,b.r*0.7,b.r*1.4,0,0,Math.PI*2); ctx.fill(); } }
  // P2 bullets in green
  ctx.fillStyle='#3dffb4';
  for(const b of bullets){ if(b.fromP2){ ctx.beginPath(); ctx.ellipse(b.x,b.y,b.r*0.7,b.r*1.4,0,0,Math.PI*2); ctx.fill(); } }
  ctx.fillStyle='#ff3da6';
  for(const b of enemyBullets){ ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill(); }
  ctx.restore();
}
function drawParticles(){
  ctx.save();
  for(const p of particles){ ctx.globalAlpha=clamp(p.life/p.maxLife,0,1); ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fill(); }
  ctx.globalAlpha=1; ctx.restore();
}
function drawFloats(){
  ctx.save(); ctx.textAlign='center'; ctx.font='bold 15px Vazirmatn, sans-serif';
  for(const f of floats){ ctx.globalAlpha=clamp(f.life,0,1); ctx.fillStyle=f.color; ctx.fillText(f.text,f.x,f.y); }
  ctx.globalAlpha=1; ctx.restore();
}
function draw(){
  ctx.clearRect(0,0,W,H);
  drawStars();
  if(state==='playing'||state==='paused'){
    drawParticles();
    for(const e of enemies) drawEnemy(e);
    if(boss) drawBoss(boss);
    drawBullets();
    if(player2) drawPlayer(player2, true);
    if(player) drawPlayer(player, false);
    drawFloats();
  }
}

/* ======================= MAIN LOOP ======================= */
function loop(ts){
  if(!lastTime) lastTime=ts;
  let dt=(ts-lastTime)/1000;
  lastTime=ts;
  dt=Math.min(dt,0.05);
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

/* ======================= LOADING ======================= */
const loadTips=['بارگذاری سفینه...','چیدن ستاره‌ها...','تیز کردن چنگال‌ها...','روشن کردن موتور جت...','آماده‌سازی موجودات فضایی...','برقراری ارتباط فضایی...'];
function runLoading(){
  let p=0;
  const bar=document.getElementById('loadBar');
  const tip=document.getElementById('loadTip');
  const timer=setInterval(()=>{
    p+=rand(6,16);
    if(p>=100){ p=100; bar.style.width='100%'; clearInterval(timer); setTimeout(()=>{ goMenu(); checkAutoJoin(); },250); return; }
    bar.style.width=p+'%';
    tip.textContent=loadTips[Math.floor(p/100*loadTips.length)]||loadTips[0];
  },180);
}

// Auto-join from URL
function checkAutoJoin(){
  const params = new URLSearchParams(window.location.search);
  const joinCode = params.get('join');
  if(joinCode && joinCode.length===6){
    document.getElementById('joinCodeInput').value = joinCode;
    openMultiScreen().then(()=>{
      setTimeout(()=>{ joinRoom(); }, 500);
    });
  }
}

/* ======================= EVENTS ======================= */
document.getElementById('startBtn').addEventListener('click', ()=>startGame(false));
document.getElementById('multiBtn').addEventListener('click', openMultiScreen);
document.getElementById('shopBtnMenu').addEventListener('click', ()=>openShop('menu'));
document.getElementById('shopBackBtn').addEventListener('click', closeShop);
document.getElementById('pauseBtn').addEventListener('click', pauseGame);
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('shopBtnPause').addEventListener('click', ()=>openShop('pause'));
document.getElementById('restartBtnPause').addEventListener('click', ()=>startGame(multiMode));
document.getElementById('menuBtnPause').addEventListener('click', goMenu);
document.getElementById('retryBtn').addEventListener('click', ()=>startGame(multiMode));
document.getElementById('shopBtnOver').addEventListener('click', ()=>openShop('menu'));
document.getElementById('menuBtnOver').addEventListener('click', goMenu);
document.getElementById('joinBtn').addEventListener('click', joinRoom);
document.getElementById('multiBackBtn').addEventListener('click', ()=>{ if(peer){ peer.destroy(); peer=null; conn=null; } goMenu(); });
document.getElementById('joinCodeInput').addEventListener('keydown', e=>{ if(e.key==='Enter') joinRoom(); });

/* ======================= INIT ======================= */
resize();
initStars();
showScreen('loading');
requestAnimationFrame(loop);
runLoading();

})();
