(() => {
	const canvas = document.getElementById('game');
	const ctx = canvas.getContext('2d');

	// World config
	const WIDTH = canvas.width;
	const HEIGHT = canvas.height;
	const FIELD_PADDING = 60;
	let GOAL_WIDTH = 140;
	const GOAL_DEPTH = 14;
	const DT = 1 / 60; // simulation step

	// Stadium themes (unchanged existing)
	const STADIUMS = {
		orange: { name:'Klasik Turuncu', fieldLine:'#ff9f5a', midCircle:'#ffa45b', goalLine:'#ffd4ad', accentGlow:'#ff8c42', crowdA:'#2a2f3b', crowdB:'#353b49', goalWidth:140, bounce:0.82, ballColor:'#ffb703', kickSound:{type:'square',f0:240,f1:900,t:0.12,g:0.13}, goalSound:{type:'triangle',f0:440,f1:660,t:0.5,g:0.16}, trail:{color:'rgba(255,183,3,0.2)'} },
		neon:   { name:'Gece Neon',       fieldLine:'#35ffe0', midCircle:'#55b7ff', goalLine:'#ffd93d', accentGlow:'#35ffe0', crowdA:'#10131a', crowdB:'#171c25', goalWidth:160, bounce:0.88, ballColor:'#5ef9ff', kickSound:{type:'sawtooth',f0:320,f1:1200,t:0.09,g:0.12}, goalSound:{type:'sine',f0:520,f1:880,t:0.45,g:0.14}, trail:{color:'rgba(94,249,255,0.25)'} },
		grass:  { name:'Gündüz Çim',      fieldLine:'#ddf7d0', midCircle:'#b7efc5', goalLine:'#fcefb4', accentGlow:'#b7efc5', crowdA:'#233018', crowdB:'#2b3a1f', goalWidth:120, bounce:0.78, ballColor:'#ffffff', kickSound:{type:'triangle',f0:200,f1:520,t:0.1,g:0.12}, goalSound:{type:'square',f0:300,f1:480,t:0.4,g:0.12}, trail:{color:'rgba(255,255,255,0.18)'} },
		retro:  { name:'Retro Koyu',       fieldLine:'#e6c79c', midCircle:'#f2d6b3', goalLine:'#ffd07b', accentGlow:'#ffd07b', crowdA:'#1c1713', crowdB:'#221d18', goalWidth:150, bounce:0.8, ballColor:'#ffd07b', kickSound:{type:'square',f0:180,f1:700,t:0.11,g:0.13}, goalSound:{type:'triangle',f0:380,f1:560,t:0.5,g:0.15}, trail:{color:'rgba(255,208,123,0.22)'} }
	};
	let currentStadiumKey = 'orange';
	let S = STADIUMS[currentStadiumKey];

	// Game modes
	const MODES = {
		classic: { label: 'Klasik', playerAccel: 360, playerMax: 130, ballMax: 600, ballFriction: 0.98, playerFrictionActive: 0.955, playerFrictionIdle: 0.88, kickPower: 460, dribbleMax: 200 },
		ice:     { label: 'Buz Paten', playerAccel: 280, playerMax: 140, ballMax: 700, ballFriction: 0.995, playerFrictionActive: 0.985, playerFrictionIdle: 0.97, kickPower: 420, dribbleMax: 240 },
		heavy:   { label: 'Ağır Top', playerAccel: 340, playerMax: 120, ballMax: 450, ballFriction: 0.985, playerFrictionActive: 0.955, playerFrictionIdle: 0.9, kickPower: 320, dribbleMax: 140 },
		turbo:   { label: 'Turbo Şut', playerAccel: 380, playerMax: 135, ballMax: 700, ballFriction: 0.98, playerFrictionActive: 0.955, playerFrictionIdle: 0.88, kickPower: 700, dribbleMax: 200 }
	};
	let currentModeKey = 'classic';
	let M = MODES[currentModeKey];

	// Particles
	const particles = [];
	function spawnKickParticles(x, y, nx, ny, color) { const count = 14; for (let i=0;i<count;i++){ const spread=(Math.random()-0.5)*Math.PI/2; const speed=220+Math.random()*220; const a=Math.atan2(ny,nx)+spread; particles.push({x,y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:0.35+Math.random()*0.2,radius:2+Math.random()*2,color}); } }
	function updateParticles(dt){ for(let i=particles.length-1;i>=0;i--){const p=particles[i]; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vx*=0.96; p.vy*=0.96; p.life-=dt; if(p.life<=0) particles.splice(i,1);} }
	function drawParticles(){ for(const p of particles){ ctx.globalAlpha=Math.max(0,Math.min(1,p.life*3)); ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(p.x,p.y,p.radius,0,Math.PI*2); ctx.fill(); } ctx.globalAlpha=1; }

	// Ball trail
	const trail=[]; function pushTrail(x,y){ trail.push({ x, y, life: 0.35 }); if(trail.length>60) trail.shift(); }
	function updateTrail(dt){ for(const t of trail) t.life -= dt; }
	function drawTrail(){ if(!S.trail) return; ctx.save(); for(const t of trail){ if(t.life<=0) continue; ctx.globalAlpha=Math.max(0,t.life)*0.9; ctx.fillStyle=S.trail.color; ctx.beginPath(); ctx.arc(t.x,t.y,10*t.life,0,Math.PI*2); ctx.fill(); } ctx.restore(); ctx.globalAlpha=1; }

	// Audio
	let audioCtx=null; function ensureAudio(){ if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); }
	function blip(spec){ try{ ensureAudio(); const t=audioCtx.currentTime; const o=audioCtx.createOscillator(); const g=audioCtx.createGain(); o.type=spec.type; o.frequency.setValueAtTime(spec.f0,t); o.frequency.exponentialRampToValueAtTime(spec.f1,t+Math.max(0.01,spec.t*0.6)); g.gain.setValueAtTime(spec.g,t); g.gain.exponentialRampToValueAtTime(0.0001,t+spec.t); o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+spec.t);}catch{} }
	function playKick(){ blip(S.kickSound); } function playGoal(){ blip(S.goalSound); }

	// Entities
	function createDisc(x,y,radius,color){ return { x, y, vx:0, vy:0, radius, color, maxSpeed:M.playerMax, accel:M.playerAccel, kickPower:M.kickPower, kickRadius:36, lastKickMs:0, kickCooldownMs:250, isInputActive:false }; }
	function createBall(){ return { x:WIDTH/2, y:HEIGHT/2, vx:0, vy:0, radius:12, color:S.ballColor, maxSpeed:M.ballMax, dribbleMax:M.dribbleMax, lastKickedAt:0 }; }
	const left=createDisc(WIDTH*0.25, HEIGHT/2, 18, '#ff9f1c');
	const right=createDisc(WIDTH*0.75, HEIGHT/2, 18, '#f95738');
	const ball=createBall();

	let leftScore=0, rightScore=0, paused=true; let leftName='Sol', rightName='Sağ';
	const $leftName=document.getElementById('leftName'); const $rightName=document.getElementById('rightName'); function updateNames(){ $leftName.textContent=leftName; $rightName.textContent=rightName; }
	const $modeBadge=document.getElementById('modeBadge'); function updateModeBadge(){ $modeBadge.textContent = M.label; }
	updateNames(); updateModeBadge();

	// Start modal
	const $modal=document.getElementById('startModal'); const $leftInput=document.getElementById('leftNameInput'); const $rightInput=document.getElementById('rightNameInput'); const $stadiumSelect=document.getElementById('stadiumSelect'); const $modeSelect=document.getElementById('modeSelect'); const $startBtn=document.getElementById('startBtn');
	const $playTypeSelect=document.getElementById('playTypeSelect'); const $roomInput=document.getElementById('roomInput');
	function applyStadium(){ S=STADIUMS[currentStadiumKey]||STADIUMS.orange; GOAL_WIDTH=S.goalWidth; ball.color=S.ballColor; }
	function applyMode(){ M=MODES[currentModeKey]||MODES.classic; left.accel=M.playerAccel; right.accel=M.playerAccel; left.maxSpeed=M.playerMax; right.maxSpeed=M.playerMax; ball.maxSpeed=M.ballMax; ball.dribbleMax=M.dribbleMax; left.kickPower=right.kickPower=M.kickPower; updateModeBadge(); }

	// Online networking
	let playType='local'; let roomId='default'; let ws=null; let mySide=null; let netState=null; let inputTimer=null; function wsUrl(){ const proto=location.protocol==='https:'?'wss':'ws'; return `${proto}://${location.host}?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(mySide==='left'?leftName:rightName)}`; }
	function connectOnline(){ try{ if(ws) { try{ws.close();}catch{} } mySide=null; netState=null; const url=wsUrl(); ws=new WebSocket(url); ws.onopen=()=>{}; ws.onmessage=(ev)=>{ try{ const msg=JSON.parse(ev.data); if(msg.t==='join'){ mySide=msg.side; } if(msg.t==='state'){ netState=msg.s; // update scoreboard
			leftScore=netState.leftScore||0; rightScore=netState.rightScore||0; updateScore(); } }catch{} }; ws.onclose=()=>{ if(inputTimer) { clearInterval(inputTimer); inputTimer=null; } }; // start input loop
		if(inputTimer) clearInterval(inputTimer); inputTimer=setInterval(sendInput, 1000/30); } catch(e){} }
	function sendInput(){ if(!ws || ws.readyState!==WebSocket.OPEN || !mySide) return; const dir = getInputDir(mySide); ws.send(JSON.stringify({ t:'input', side: mySide, dx: dir.dx, dy: dir.dy })); }
	function sendKick(){ if(!ws || ws.readyState!==WebSocket.OPEN || !mySide) return; ws.send(JSON.stringify({ t:'kick', side: mySide })); playKick(); }
	function getInputDir(side){ let dx=0, dy=0; if(side==='left'){ if(keys.has('w')) dy-=1; if(keys.has('s')) dy+=1; if(keys.has('a')) dx-=1; if(keys.has('d')) dx+=1; } else { if(keys.has('ğ')) dy-=1; if(keys.has('ç')) dy+=1; if(keys.has('o')) dx-=1; if(keys.has('p')) dx+=1; } const l=Math.hypot(dx,dy)||1; return { dx: dx/l, dy: dy/l }; }

	function startGame(){ leftName=($leftInput.value||'Sol').trim(); rightName=($rightInput.value||'Sağ').trim(); currentStadiumKey=$stadiumSelect.value||'orange'; currentModeKey=$modeSelect.value||'classic'; applyStadium(); applyMode(); playType=$playTypeSelect.value||'local'; roomId=($roomInput.value||'default').trim(); updateNames(); $modal.classList.remove('show'); paused=false; resetPositions(true); if(playType==='online'){ connectOnline(); } }
	$startBtn.addEventListener('click',()=>{ ensureAudio(); startGame(); }); $leftInput.addEventListener('keydown',(e)=>{ if(e.key==='Enter') startGame(); }); $rightInput.addEventListener('keydown',(e)=>{ if(e.key==='Enter') startGame(); });

	// Chat
	const $chatMessages=document.getElementById('chatMessages'); const $chatInput=document.getElementById('chatInput'); const $chatSend=document.getElementById('chatSend'); const $chatFrom=document.getElementById('chatFrom');
	function pushMessage(from,text){ const wrap=document.createElement('div'); wrap.className='msg'; const fromEl=document.createElement('span'); fromEl.className='from '+from; fromEl.textContent=(from==='left'?leftName:rightName)+':'; const textEl=document.createElement('span'); textEl.className='text'; textEl.textContent=text; wrap.appendChild(fromEl); wrap.appendChild(textEl); $chatMessages.appendChild(wrap); $chatMessages.scrollTop=$chatMessages.scrollHeight; }
	function sendChat(){ const txt=($chatInput.value||'').trim(); if(!txt) return; pushMessage($chatFrom.value, txt); $chatInput.value=''; }
	$chatSend.addEventListener('click', sendChat); $chatInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') sendChat(); });

	// Input
	const keys=new Set(); window.addEventListener('keydown',(e)=>{ if(e.repeat) return; const keyLower=(e.key||'').toLowerCase(); keys.add(keyLower); if(e.key==='Escape'){ paused=!paused; return; } if(keyLower==='r'){ resetPositions(true); return; } if(playType==='online'){ if((e.code==='Space'||e.key===' ') && mySide==='left'){ sendKick(); } if(keyLower==='ç' && mySide==='right'){ sendKick(); } } else { if(e.code==='Space'||e.key===' ') { attemptKick(left);} if(keyLower==='ç'){ attemptKick(right);} } }); window.addEventListener('keyup',(e)=> keys.delete((e.key||'').toLowerCase()));

	function resetPositions(centerKickoff){ left.x=WIDTH*0.25; left.y=HEIGHT/2; left.vx=0; left.vy=0; right.x=WIDTH*0.75; right.y=HEIGHT/2; right.vx=0; right.vy=0; ball.x=WIDTH/2; ball.y=HEIGHT/2; ball.vx=0; ball.vy=0; trail.length=0; if(centerKickoff){} }

	// Spectators (precomputed)
	let spectators=[]; function buildSpectators(){ spectators=[]; const standWidth=FIELD_PADDING-12; const top=FIELD_PADDING-6; const bottom=HEIGHT-FIELD_PADDING+6; for(let i=0;i<160;i++){ const isLeft=i%2===0; const xBase=isLeft?10:WIDTH-standWidth-6; const x=xBase+6+Math.random()*(standWidth-18); const y=top+10+Math.random()*(bottom-top-20); spectators.push({x,y}); } }
	buildSpectators();

	function drawCrowd(){ const standWidth=FIELD_PADDING-12; const top=FIELD_PADDING-6; const bottom=HEIGHT-FIELD_PADDING+6; ctx.fillStyle=S.crowdA; ctx.fillRect(6,top,standWidth,bottom-top); ctx.fillStyle=S.crowdB; for(let y=top+6;y<bottom;y+=14){ ctx.fillRect(10,y,standWidth-8,3);} ctx.fillStyle=S.crowdA; ctx.fillRect(WIDTH-standWidth-6,top,standWidth,bottom-top); ctx.fillStyle=S.crowdB; for(let y=top+6;y<bottom;y+=14){ ctx.fillRect(WIDTH-standWidth-2,y,standWidth-8,3);} ctx.fillStyle='rgba(255,255,255,0.12)'; for(const h of spectators){ ctx.beginPath(); ctx.arc(h.x,h.y,1.2,0,Math.PI*2); ctx.fill(); } }

	function drawField(){ ctx.clearRect(0,0,WIDTH,HEIGHT); drawCrowd(); ctx.strokeStyle=S.fieldLine; ctx.lineWidth=2; ctx.strokeRect(FIELD_PADDING,FIELD_PADDING,WIDTH-FIELD_PADDING*2,HEIGHT-FIELD_PADDING*2); ctx.beginPath(); ctx.moveTo(WIDTH/2,FIELD_PADDING); ctx.lineTo(WIDTH/2,HEIGHT-FIELD_PADDING); ctx.stroke(); ctx.save(); ctx.strokeStyle=S.midCircle; ctx.shadowBlur=12; ctx.shadowColor=S.accentGlow; ctx.beginPath(); ctx.arc(WIDTH/2,HEIGHT/2,70,0,Math.PI*2); ctx.stroke(); ctx.restore(); ctx.fillStyle='#1a1d26'; ctx.fillRect(FIELD_PADDING-GOAL_DEPTH,(HEIGHT-GOAL_WIDTH)/2,GOAL_DEPTH,GOAL_WIDTH); ctx.fillRect(WIDTH-FIELD_PADDING,(HEIGHT-GOAL_WIDTH)/2,GOAL_DEPTH,GOAL_WIDTH); ctx.save(); ctx.strokeStyle=S.goalLine; ctx.shadowBlur=10; ctx.shadowColor=S.goalLine; ctx.beginPath(); ctx.moveTo(FIELD_PADDING,(HEIGHT-GOAL_WIDTH)/2); ctx.lineTo(FIELD_PADDING,(HEIGHT+GOAL_WIDTH)/2); ctx.moveTo(WIDTH-FIELD_PADDING,(HEIGHT-GOAL_WIDTH)/2); ctx.lineTo(WIDTH-FIELD_PADDING,(HEIGHT+GOAL_WIDTH)/2); ctx.stroke(); ctx.restore(); }

	function drawDisc(d){ ctx.save(); ctx.fillStyle=d.color; ctx.shadowBlur=d===ball?24:16; ctx.shadowColor=d.color; ctx.beginPath(); ctx.arc(d.x,d.y,d.radius,0,Math.PI*2); ctx.fill(); ctx.restore(); }

	function applyInput(d,up,l,down,r){ let ix=0,iy=0; if(keys.has(up)) iy-=1; if(keys.has(down)) iy+=1; if(keys.has(l)) ix-=1; if(keys.has(r)) ix+=1; const len=Math.hypot(ix,iy); d.isInputActive=len>0; if(len>0){ ix/=len; iy/=len; d.vx+=ix*d.accel*DT; d.vy+=iy*d.accel*DT; } const sp=Math.hypot(d.vx,d.vy); if(sp>d.maxSpeed){ const k=d.maxSpeed/sp; d.vx*=k; d.vy*=k; } }

	function attemptKick(d){ const now=performance.now(); if(now-d.lastKickMs<d.kickCooldownMs) return; const dx=ball.x-d.x, dy=ball.y-d.y; const dist=Math.hypot(dx,dy); if(dist>d.radius+ball.radius+d.kickRadius) return; const nx=dx/(dist||1), ny=dy/(dist||1); ball.vx+=nx*d.kickPower; ball.vy+=ny*d.kickPower; ball.vx+=d.vx*0.2; ball.vy+=d.vy*0.2; const bs=Math.hypot(ball.vx,ball.vy); if(bs>ball.maxSpeed){ const k=ball.maxSpeed/bs; ball.vx*=k; ball.vy*=k; } d.lastKickMs=now; ball.lastKickedAt=now; spawnKickParticles(ball.x,ball.y,nx,ny,S.ballColor); playKick(); }

	function physicsStep(){
		// If online, use server state only
		if (playType==='online') {
			if (netState) {
				left.x = netState.left.x; left.y = netState.left.y;
				right.x = netState.right.x; right.y = netState.right.y;
				ball.x = netState.ball.x; ball.y = netState.ball.y;
			}
			pushTrail(ball.x, ball.y); updateParticles(DT); updateTrail(DT);
			return;
		}
		// Local mode physics
		applyInput(left,'w','a','s','d'); applyInput(right,'ğ','o','ç','p');
		for(const b of [left,right,ball]){ b.x+=b.vx*DT; b.y+=b.vy*DT; if(b===ball){ b.vx*=0.99*M.ballFriction; b.vy*=0.99*M.ballFriction; } else { const f=(b.isInputActive?M.playerFrictionActive:M.playerFrictionIdle); b.vx*=0.99*f; b.vy*=0.99*f; } }
		const minX=FIELD_PADDING,maxX=WIDTH-FIELD_PADDING,minY=FIELD_PADDING,maxY=HEIGHT-FIELD_PADDING; const goalTop=(HEIGHT-GOAL_WIDTH)/2, goalBottom=(HEIGHT+GOAL_WIDTH)/2;
		function collideWalls(e,allowGoal){ if(e.x-e.radius<minX){ const inGoal=e.y>goalTop && e.y<goalBottom && allowGoal; if(!inGoal){ e.x=minX+e.radius; e.vx=-e.vx*S.bounce; } } if(e.x+e.radius>maxX){ const inGoal=e.y>goalTop && e.y<goalBottom && allowGoal; if(!inGoal){ e.x=maxX-e.radius; e.vx=-e.vx*S.bounce; } } if(e.y-e.radius<minY){ e.y=minY+e.radius; e.vy=-e.vy*S.bounce; } if(e.y+e.radius>maxY){ e.y=maxY-e.radius; e.vy=-e.vy*S.bounce; } }
		collideWalls(left,false); collideWalls(right,false); collideWalls(ball,true);
		function collideDiscs(a,b,restitution=0.88){ const dx=b.x-a.x, dy=b.y-a.y; const dist=Math.hypot(dx,dy); const minDist=a.radius+b.radius; if(dist===0||dist>=minDist) return; const nx=dx/dist, ny=dy/dist, overlap=minDist-dist; a.x-=nx*overlap*0.5; a.y-=ny*overlap*0.5; b.x+=nx*overlap*0.5; b.y+=ny*overlap*0.5; const rvx=b.vx-a.vx, rvy=b.vy-a.vy; const velAlongNormal=rvx*nx+rvy*ny; if(velAlongNormal>0) return; const j=-(1+restitution)*velAlongNormal/2; const ix=j*nx, iy=j*ny; a.vx-=ix; a.vy-=iy; b.vx+=ix; b.vy+=iy; }
		function collidePlayerBall(p,br){ const dx=br.x-p.x, dy=br.y-p.y; const dist=Math.hypot(dx,dy), minDist=p.radius+br.radius; if(dist===0||dist>=minDist) return; const nx=dx/(dist||1), ny=dy/(dist||1), overlap=minDist-dist; p.x-=nx*overlap; p.y-=ny*overlap; const vn=p.vx*nx+p.vy*ny; if(vn>0){ p.vx-=vn*nx; p.vy-=vn*ny; } const now=performance.now(); const recentlyKicked=(now-br.lastKickedAt)<150; if(!recentlyKicked){ br.vx+=p.vx*0.06+nx*20; br.vy+=p.vy*0.06+ny*20; const bs=Math.hypot(br.vx,br.vy); if(bs>br.dribbleMax){ const k=br.dribbleMax/bs; br.vx*=k; br.vy*=k; } } }
		collideDiscs(left,right,0.88); collidePlayerBall(left,ball); collidePlayerBall(right,ball);
		const scoredLeft=ball.y>goalTop && ball.y<goalBottom && (ball.x+ball.radius>WIDTH-FIELD_PADDING); const scoredRight=ball.y>goalTop && ball.y<goalBottom && (ball.x-ball.radius<FIELD_PADDING); if(scoredLeft){ leftScore+=1; updateScore(); playGoal(); resetPositions(true);} if(scoredRight){ rightScore+=1; updateScore(); playGoal(); resetPositions(true);} pushTrail(ball.x,ball.y); updateParticles(DT); updateTrail(DT); }

	function updateScore(){ document.getElementById('leftScore').textContent=String(leftScore); document.getElementById('rightScore').textContent=String(rightScore); }
	function render(){ drawField(); drawTrail(); drawParticles(); drawDisc(ball); drawDisc(left); drawDisc(right); }
	let lastTime=performance.now(); function loop(now){ const dtMs=now-lastTime; lastTime=now; if(!paused){ let acc=Math.min(0.25,dtMs/1000); while(acc>0){ physicsStep(); acc-=DT; } } render(); requestAnimationFrame(loop); }
	resetPositions(false); requestAnimationFrame(loop);
})(); 