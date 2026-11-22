const http=require('http'),fs=require('fs'),path=require('path');
const WebSocket=require('ws');
const PORT=Number(process.env.PORT||3000);
const page=fs.readFileSync(path.join(__dirname,'index.html'));
const rooms=new Map();
const server=http.createServer((req,res)=>{
 if(req.url==='/'||req.url.startsWith('/?')||req.url==='/index.html'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(page);
 }else{res.writeHead(404);res.end('Not found')}
});
const wss=new WebSocket.Server({server,path:'/ws'});
function send(ws,obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))}
wss.on('connection',ws=>{
 let code='',room=null,isHost=false,identity='';
 ws.on('message',raw=>{
  if(raw.length>300000)return ws.close(1009,'Too large');
  let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==='join'){
   if(room)return;
   code=String(m.code||'').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,48);
   if(!code)return send(ws,{type:'error',message:'Invalid room'});
   room=rooms.get(code);
   if(m.host){if(room)return send(ws,{type:'error',message:'Room already exists'});room={host:ws,clients:new Set()};rooms.set(code,room);isHost=true}
   else if(!room)return send(ws,{type:'error',message:'Host has not created this room'});
   room.clients.add(ws);send(ws,{type:'ready'});return;
  }
  if(!room||m.type!=='event')return;
  if(m.event==='act'){
   if(isHost)return;
   const d=m.data||{};
   if(typeof d.k!=='string'||!d.k||d.k.length>16)return;
   if(!identity){if(d.t!=='hello')return;identity=d.k}
   if(identity!==d.k)return;
   ws.identity=identity;
   send(room.host,{type:'event',event:'act',data:d});
  }else if(m.event==='st'&&isHost){
   const d=m.data||{};
   if(!d.to||!d.state)return;
   for(const peer of room.clients)if(peer!==ws&&peer.identity===d.to)
    send(peer,{type:'event',event:'st',data:d});
  }
 });
 ws.on('close',()=>{if(!room)return;room.clients.delete(ws);if(isHost){for(const peer of room.clients){send(peer,{type:'error',message:'Host disconnected'});peer.close()}rooms.delete(code)}});
});
server.listen(PORT,()=>console.log('Garbage Rummy running on port '+PORT));
