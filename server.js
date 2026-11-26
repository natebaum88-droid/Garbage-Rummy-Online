const http=require('http'),fs=require('fs'),path=require('path');
const WebSocket=require('ws');
const PORT=Number(process.env.PORT||3000),rooms=new Map();
const types={'/':'text/html; charset=utf-8','/index.html':'text/html; charset=utf-8','/voice.js':'application/javascript','/sw.js':'application/javascript','/manifest.webmanifest':'application/manifest+json','/icon.svg':'image/svg+xml','/icon-192.png':'image/png','/icon-512.png':'image/png'};
const crypto=require('crypto');
const profiles=new Map(), sessions=new Map();
const store=process.env.SOCIAL_STORE||path.join(__dirname,'social-data.json');
try{for(const p of JSON.parse(fs.readFileSync(store,'utf8')))profiles.set(p.id,p)}catch(e){if(e.code!=='ENOENT')console.error('Social storage:',e.message)}
function save(){fs.writeFileSync(store+'.tmp',JSON.stringify([...profiles.values()]));fs.renameSync(store+'.tmp',store)}
async function social(req,res){
 const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 try{
 if(req.method!=='POST')return reply(405,{});
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)return reply(413,{})}
 const d=JSON.parse(raw), token=d.token;
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return reply(400,{error:'Invalid identity'});
 const id=crypto.createHash('sha256').update(token).digest('hex');let p=profiles.get(id);
 if(!p){if(d.action!=='presence')return reply(403,{});p={id,name:'Player',friends:[],requests:[]};profiles.set(id,p);save()}
 if(d.action==='presence'){const name=String(d.name||'').trim().slice(0,24);if(name&&name!==p.name){p.name=name;save()}sessions.set(id,Date.now())}
 const code=q=>q.id.slice(0,12).toUpperCase();
 const matches=d.action==='requestCode'?[...profiles.values()].filter(q=>code(q)===String(d.target||'').trim().toUpperCase().replace(/-/g,'')):[];
 const other=d.action==='requestCode'?(matches.length===1?matches[0]:null):profiles.get(d.target);
 if(d.action==='requestCode'&&(!other||other===p))return reply(400,{error:'Friend code not found or is your own code.'});
 if(other&&other!==p){if(['request','requestCode'].includes(d.action)&&!p.friends.includes(other.id)&&!other.requests.includes(id)){other.requests.push(id);save()}
 if(d.action==='accept'&&p.requests.includes(other.id)){p.requests=p.requests.filter(x=>x!==other.id);other.requests=other.requests.filter(x=>x!==id);if(!p.friends.includes(other.id))p.friends.push(other.id);if(!other.friends.includes(id))other.friends.push(id);save()}
 if(d.action==='decline'){p.requests=p.requests.filter(x=>x!==other.id);save()}
 if(d.action==='remove'){p.friends=p.friends.filter(x=>x!==other.id);other.friends=other.friends.filter(x=>x!==id);save()}}
 const players=[...profiles.values()].filter(q=>q!==p&&(Date.now()-(sessions.get(q.id)||0)<45000||p.friends.includes(q.id)||p.requests.includes(q.id)||q.requests.includes(id))).map(q=>({id:q.id,name:q.name,online:Date.now()-(sessions.get(q.id)||0)<45000,friend:p.friends.includes(q.id),incoming:p.requests.includes(q.id),pending:q.requests.includes(id)}));reply(200,{players,friendCode:code(p),name:p.name}); for(const r of rooms.values()) voicePolicies(r);
 }catch(e){console.error(e.message);reply(500,{error:'Social service unavailable'})}
}
types['/social.js']='application/javascript';
types['/livingroom.png']='image/png';types['/house.js']='application/javascript';
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/api/social')return social(req,res);
 const file=pathname==='/'?'index.html':pathname.slice(1);
 if(!Object.hasOwn(types,pathname)){res.writeHead(404);return res.end('Not found')}
 fs.readFile(path.join(__dirname,file),(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')};res.writeHead(200,{'Content-Type':types[pathname],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data)});
});
const wss=new WebSocket.Server({server,path:'/ws'});
function send(ws,obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))}
function voicePolicies(room){
 const active=[...room.clients].filter(w=>w.voiceIdentity&&w.voicePrefs);
 const allows=(a,b,mode)=>mode==='everyone'||(mode==='friends'&&a.socialId&&b.socialId&&profiles.get(a.socialId)?.friends.includes(b.socialId)&&profiles.get(b.socialId)?.friends.includes(a.socialId));
 for(const a of active){const peers={};for(const b of active)if(a!==b)peers[b.voiceIdentity]={send:!!(allows(a,b,a.voicePrefs.speak)&&allows(b,a,b.voicePrefs.hear)),hear:!!(allows(b,a,b.voicePrefs.speak)&&allows(a,b,a.voicePrefs.hear))};send(a,{type:'event',event:'voice',data:{kind:'policy',data:peers}})}
}
wss.on('connection',ws=>{
 let room=null,isHost=false,identity='';
 ws.on('message',raw=>{
  if(raw.length>300000)return ws.close(1009,'Too large');let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==='join'){
   if(room)return;
   const code=String(m.code||'').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,48);
   if(!code)return send(ws,{type:'error',message:'Invalid room'});
   room=rooms.get(code);
   if(m.host){if(room&&room.hostKey!==m.key)return send(ws,{type:'error',message:'Room already exists'});if(!room){room={host:ws,hostKey:m.key,clients:new Set(),code};rooms.set(code,room)}room.host=ws;isHost=true}
   else if(!room)return send(ws,{type:'error',message:'Host has not created this room'});
   identity=String(m.key||'');ws.identity=identity;room.clients.add(ws);send(ws,{type:'ready'});return;
  }
  if(!room||m.type!=='event')return;
  if(m.event==='act'){
   if(isHost)return;const d=m.data||{};
   if(typeof d.k!=='string'||!d.k||d.k.length>16)return;
   if(!identity){if(d.t!=='hello')return;identity=d.k}
   if(identity!==d.k)return;ws.identity=identity;
   send(room.host,{type:'event',event:'act',data:d});
  }else if(m.event==='st'&&isHost){
   const d=m.data||{};if(!d.to||!d.state)return;
   for(const peer of room.clients)if(peer!==ws&&peer.identity===d.to)send(peer,{type:'event',event:'st',data:d});
  }else if(m.event==='voice'){
   const d=m.data||{};
   if(typeof d.from!=='string'||!/^\w{5,16}$/.test(d.from)||!['hello','offer','answer','ice','bye','prefs'].includes(d.kind))return;
   if(ws.voiceIdentity&&ws.voiceIdentity!==d.from)return;
   if(identity!==d.from)return;
   ws.voiceIdentity=d.from;
   if(d.kind==='hello'||d.kind==='prefs'){
    const v=d.data||{}, valid=x=>['everyone','friends','none'].includes(x)?x:'none';
    ws.socialId=typeof v.token==='string'&&/^[a-f0-9]{64}$/.test(v.token)?crypto.createHash('sha256').update(v.token).digest('hex'):null;
    ws.voicePrefs={speak:valid(v.speak),hear:valid(v.hear)};voicePolicies(room);
    if(d.kind==='prefs')return;
   }
   if(d.kind==='bye'){ws.voicePrefs=null;voicePolicies(room)}
   const payload={type:'event',event:'voice',data:{from:d.from,to:d.to||null,kind:d.kind,data:d.kind==='hello'?null:d.data}};
   for(const peer of room.clients)if(peer!==ws&&(!d.to||peer.voiceIdentity===d.to))send(peer,payload);
  }
 });
 ws.on('close',()=>{if(!room)return;room.clients.delete(ws);voicePolicies(room);if(ws.voiceIdentity)for(const peer of room.clients)send(peer,{type:'event',event:'voice',data:{from:ws.voiceIdentity,kind:'bye'}});if(isHost&&room.host===ws){const saved=room;setTimeout(()=>{if(saved.host===ws&&ws.readyState!==WebSocket.OPEN){for(const peer of saved.clients)peer.close();rooms.delete(saved.code)}},600000).unref()}});
});
server.listen(PORT,()=>console.log('Garbage Rummy running on port '+PORT));
