/* Opt-in peer-to-peer voice chat; WebSocket signaling via same game room. */
(()=>{
let room=null, token='', stream=null, peers=new Map(), muted=false;
const bar=document.getElementById('voicebar'),button=document.getElementById('voice-toggle'),status=document.getElementById('voice-status');
const config={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]};
function update(){button.textContent=!stream?'🎤 Join voice':muted?'🔇 Unmute':'🎙️ Mute';status.textContent=!stream?'Off':`${peers.size} connected`;}
function closePeer(id){let p=peers.get(id);if(!p)return;p.pc.close();p.audio.remove();peers.delete(id);update()}
function send(to,kind,data){if(room)room.emit('voice',{from:token,to,kind,data}).catch(()=>{});}
function peer(id){if(peers.has(id))return peers.get(id);const pc=new RTCPeerConnection(config),audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;audio.style.display='none';document.body.appendChild(audio);
const p={pc,audio,pending:[]};peers.set(id,p);stream.getTracks().forEach(track=>pc.addTrack(track,stream));pc.onicecandidate=e=>{if(e.candidate)send(id,'ice',e.candidate.toJSON())};pc.ontrack=e=>{audio.srcObject=e.streams[0];audio.play().catch(()=>{})};pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(pc.connectionState))closePeer(id)};update();return p;}
async function offer(id){const p=peer(id);await p.pc.setLocalDescription(await p.pc.createOffer());send(id,'offer',p.pc.localDescription.toJSON());}
async function handle(m){if(!stream||!m||m.from===token||m.to&&m.to!==token)return;const id=m.from;
try{if(m.kind==='hello'){if(token<id)await offer(id)}
else if(m.kind==='offer'){const p=peer(id);await p.pc.setRemoteDescription(m.data);await p.pc.setLocalDescription(await p.pc.createAnswer());send(id,'answer',p.pc.localDescription.toJSON());for(const c of p.pending.splice(0))await p.pc.addIceCandidate(c)}
else if(m.kind==='answer'){const p=peers.get(id);if(!p)return;await p.pc.setRemoteDescription(m.data);for(const c of p.pending.splice(0))await p.pc.addIceCandidate(c)}
else if(m.kind==='ice'){const p=peer(id);if(p.pc.remoteDescription)await p.pc.addIceCandidate(m.data);else p.pending.push(m.data)}
else if(m.kind==='bye')closePeer(id);
}catch(err){console.warn('Voice connection:',err)} }
window.addEventListener('gr-room',e=>{room=e.detail.room;token=e.detail.token;bar.style.display='flex';room.on('voice',m=>handle(m.data));update();});
button.addEventListener('click',async()=>{if(!room)return;
if(!stream){try{if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone requires HTTPS');stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});muted=false;send(null,'hello',null)}catch(e){alert('Microphone unavailable: '+e.message);return}}
else{muted=!muted;stream.getAudioTracks().forEach(t=>t.enabled=!muted)}update();});
window.addEventListener('pagehide',()=>{send(null,'bye',null);for(const id of [...peers.keys()])closePeer(id);stream?.getTracks().forEach(t=>t.stop())});
})();
