const http=require('http'),fs=require('fs'),path=require('path');
const WebSocket=require('ws');
const PORT=Number(process.env.PORT||3000),rooms=new Map();
const types={'/':'text/html; charset=utf-8','/index.html':'text/html; charset=utf-8','/voice.js':'application/javascript','/sw.js':'application/javascript','/manifest.webmanifest':'application/manifest+json','/icon.svg':'image/svg+xml','/icon-192.png':'image/png','/icon-512.png':'image/png'};
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=pathname==='/'?'index.html':pathname.slice(1);
 if(!Object.hasOwn(types,pathname)){res.writeHead(404);return res.end('Not found')}
 fs.readFile(path.join(__dirname,file),(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')};res.writeHead(200,{'Content-Type':types[pathname],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data)});
});
const wss=new WebSocket.Server({server,path:'/ws'});
function send(ws,obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))}
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
   if(typeof d.from!=='string'||!/^\w{5,16}$/.test(d.from)||!['hello','offer','answer','ice','bye'].includes(d.kind))return;
   if(ws.voiceIdentity&&ws.voiceIdentity!==d.from)return;
   ws.voiceIdentity=d.from;
   const payload={type:'event',event:'voice',data:{from:d.from,to:d.to||null,kind:d.kind,data:d.data}};
   for(const peer of room.clients)if(peer!==ws&&(!d.to||peer.voiceIdentity===d.to))send(peer,payload);
  }
 });
 ws.on('close',()=>{if(!room)return;room.clients.delete(ws);if(ws.voiceIdentity)for(const peer of room.clients)send(peer,{type:'event',event:'voice',data:{from:ws.voiceIdentity,kind:'bye'}});if(isHost&&room.host===ws){const saved=room;setTimeout(()=>{if(saved.host===ws&&ws.readyState!==WebSocket.OPEN){for(const peer of saved.clients)peer.close();rooms.delete(saved.code)}},600000).unref()}});
});
server.listen(PORT,()=>console.log('Garbage Rummy running on port '+PORT));
