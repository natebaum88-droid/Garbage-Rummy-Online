/* Opt-in peer-to-peer voice chat; WebSocket signaling via same game room. */
(()=>{
let room=null, token='', stream=null, peers=new Map(), muted=false, joining=false, queue=Promise.resolve();
const bar=document.getElementById('voicebar'),button=document.getElementById('voice-toggle'),status=document.getElementById('voice-status');
let lastSpeak='everyone';let prefs={speak:'everyone',hear:'everyone'},policy={};
try{const saved=JSON.parse(localStorage.getItem('gr-voice-prefs')||'null');if(saved&&['everyone','friends','none'].includes(saved.speak)&&['everyone','friends','none'].includes(saved.hear))prefs=saved}catch{}
const settings=document.createElement('button');settings.textContent='⚙ Voice';bar.append(settings);
const panel=document.createElement('div');panel.style.cssText='display:none;position:fixed;inset:auto 12px 90px;z-index:110;background:#24170f;color:white;padding:16px;border:1px solid #e4b45d;border-radius:14px';document.body.append(panel);
const controls={};for(const [key,label] of [['speak','Who can hear me?'],['hear','Who can I hear?']]){const l=document.createElement('label');l.textContent=label;const select=document.createElement('select');select.style.cssText='display:block;width:100%;padding:10px;margin:8px 0 16px';for(const [v,t] of [['everyone','Everyone in this game'],['friends','Friends only'],['none','Nobody (mute)']]){const o=document.createElement('option');o.value=v;o.textContent=t;select.append(o)}select.value=prefs[key];controls[key]=select;l.append(select);panel.append(l);select.onchange=()=>{prefs[key]=select.value;if(key==='speak'&&select.value!=='none')lastSpeak=select.value;muted=prefs.speak==='none';try{localStorage.setItem('gr-voice-prefs',JSON.stringify(prefs))}catch{};policy={};applyPolicy();if(stream)send(null,'prefs',details());update()}}
const close=document.createElement('button');close.textContent='Done';close.onclick=()=>panel.style.display='none';panel.append(close);settings.onclick=()=>panel.style.display=panel.style.display==='none'?'block':'none';
function details(){let socialToken='';try{socialToken=localStorage.getItem('gr-social-token')||''}catch{}return {...prefs,token:socialToken}}
function applyPolicy(){for(const [id,p] of peers){const v=policy[id];p.audio.muted=!(v?.hear&&prefs.hear!=='none');p.sender.replaceTrack(v?.send&&prefs.speak!=='none'&&!muted?stream?.getAudioTracks()[0]||null:null).catch(console.warn)}}
const config={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]};
function update(){button.textContent=!stream?'🎤 Join voice':muted?'🔇 Unmute':'🎙️ Mute';status.textContent=!stream?'Off':`${[...peers.values()].filter(p=>p.pc.connectionState==='connected').length} connected`;}
function closePeer(id){let p=peers.get(id);if(!p)return;p.pc.close();p.audio.remove();peers.delete(id);update()}
function send(to,kind,data){if(room)room.emit('voice',{from:token,to,kind,data}).catch(()=>{});}
function peer(id){if(peers.has(id))return peers.get(id);const pc=new RTCPeerConnection(config),audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;audio.style.display='none';document.body.appendChild(audio);
const p={pc,audio,pending:[]};peers.set(id,p);p.sender=pc.addTransceiver('audio',{direction:'sendrecv'}).sender;audio.muted=true;applyPolicy();pc.onicecandidate=e=>{if(e.candidate)send(id,'ice',e.candidate.toJSON())};pc.ontrack=e=>{audio.srcObject=e.streams[0]||new MediaStream([e.track]);audio.play().catch(()=>{})};pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(pc.connectionState))closePeer(id);else update()};update();return p;}
async function offer(id){const p=peer(id);if(p.pc.localDescription||p.pc.remoteDescription)return;await p.pc.setLocalDescription(await p.pc.createOffer());send(id,'offer',p.pc.localDescription.toJSON());}
async function handle(m){if(m?.kind==='policy'){policy=m.data||{};applyPolicy();return}if(!stream||!m||m.from===token||m.to&&m.to!==token)return;const id=m.from;
try{if(m.kind==='hello'){if(!m.to)send(id,'hello',details());if(token<id)await offer(id)}
else if(m.kind==='offer'){const p=peer(id);await p.pc.setRemoteDescription(m.data);await p.pc.setLocalDescription(await p.pc.createAnswer());send(id,'answer',p.pc.localDescription.toJSON());for(const c of p.pending.splice(0))await p.pc.addIceCandidate(c)}
else if(m.kind==='answer'){const p=peers.get(id);if(!p)return;await p.pc.setRemoteDescription(m.data);for(const c of p.pending.splice(0))await p.pc.addIceCandidate(c)}
else if(m.kind==='ice'){const p=peer(id);if(p.pc.remoteDescription)await p.pc.addIceCandidate(m.data);else p.pending.push(m.data)}
else if(m.kind==='bye')closePeer(id);
}catch(err){console.warn('Voice connection:',err)} }
window.addEventListener('gr-room',e=>{room=e.detail.room;token=e.detail.token;bar.style.display='flex';room.on('voice',m=>{queue=queue.then(()=>handle(m.data)).catch(console.warn)});room.on('disconnect',()=>{for(const id of [...peers.keys()])closePeer(id)});room.on('reconnect',()=>{if(stream)send(null,'hello',details())});update();});
button.addEventListener('click',async()=>{if(!room||joining)return;
if(!stream){joining=true;button.disabled=true;try{if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone requires HTTPS');stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});muted=prefs.speak==='none';send(null,'hello',details())}catch(e){alert('Microphone unavailable: '+e.message);return}finally{joining=false;button.disabled=false}}
else{if(!muted&&prefs.speak!=='none')lastSpeak=prefs.speak;muted=!muted;prefs.speak=muted?'none':lastSpeak;controls.speak.value=prefs.speak;try{localStorage.setItem('gr-voice-prefs',JSON.stringify(prefs))}catch{}policy={};applyPolicy();send(null,'prefs',details())}update();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&stream){send(null,'hello',details());for(const p of peers.values())p.audio.play().catch(()=>{})}});
window.addEventListener('pagehide',()=>{send(null,'bye',null);for(const id of [...peers.keys()])closePeer(id);stream?.getTracks().forEach(t=>t.stop());stream=null;update()});
})();
