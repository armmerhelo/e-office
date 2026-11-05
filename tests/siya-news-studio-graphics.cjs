// Real browser raster regressions, without a preview server or database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const source=fs.readFileSync(path.join(__dirname,'../siya_news/studio.js'),'utf8');
const start=source.indexOf('    function decorateImage(');
assert.ok(start>=0);
const decorate=source.slice(start,source.indexOf('\n    }',start)+6);
const konva=fs.readFileSync(path.join(__dirname,'../assets/vendor/konva.min.js'),'utf8');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'opencode','studio-graphics-'));
const browser=cp.spawn(process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
 '--headless=new','--remote-debugging-port=0',`--user-data-dir=${directory}`,'--no-first-run','about:blank',
],{stdio:['ignore','ignore','pipe']});
let socket,sequence=0;const pending=new Map();
function send(method,params={}){
 const id=++sequence;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},20000);
  pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});
  socket.send(JSON.stringify({id,method,params}));
 });
}
async function run(){
 const endpoint=await new Promise((resolve,reject)=>{
  let output='';const timer=setTimeout(()=>reject(Error('Chrome startup timeout')),20000);
  browser.on('error',error=>{clearTimeout(timer);reject(error);});
  browser.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
 });
 const origin=new URL(endpoint),targets=await fetch(`http://${origin.host}/json`).then(r=>r.json());
 socket=new WebSocket(targets.find(page=>page.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const result=JSON.parse(event.data),entry=pending.get(result.id);if(entry){pending.delete(result.id);result.error?entry.reject(Error(JSON.stringify(result.error))):entry.resolve(result.result);}});
 const result=await send('Runtime.evaluate',{returnByValue:true,expression:konva+'\n'+decorate+`
 (()=>{
  const stage=new Konva.Stage({container:document.createElement('div'),width:120,height:120}),layer=new Konva.Layer();stage.add(layer);
  const image=document.createElement('canvas');image.width=image.height=60;
  const pixels=image.getContext('2d');pixels.fillStyle='#0000ff';pixels.fillRect(0,0,60,60);
  const node=decorateImage(new Konva.Image({image,x:30,y:30,width:60,height:60,stroke:'#ff0000',strokeWidth:10}));layer.add(node);
  const sample=(ctx,x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);
  function render(){stage.draw();return stage.toCanvas({pixelRatio:1}).getContext('2d');}
  const ctx=render(),red=[];for(let x=20;x<45;x++){const p=sample(ctx,x,60);if(p[0]===255&&p[1]===0&&p[2]===0)red.push(x);}
  const cloneStage=new Konva.Stage({container:document.createElement('div'),width:120,height:120});cloneStage.add(layer.clone());cloneStage.draw();
  const cloneMatches=cloneStage.toDataURL({pixelRatio:2})===stage.toDataURL({pixelRatio:2});cloneStage.destroy();
  node.cornerRadius(20);node.crop({x:0,y:0,width:30,height:30});
  const rounded=render(),corner=sample(rounded,30,30),centre=sample(rounded,60,60);
  const result={redColumns:red,cloneMatches,corner,centre};stage.destroy();return result;
 })()`});
 if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
 const data=result.result.value;
 assert.deepEqual(data.redColumns,[25,26,27,28,29,30,31,32,33,34]);
 assert.equal(data.cloneMatches,true);
 assert.equal(data.corner[3],0);assert.deepEqual(data.centre,[0,0,255,255]);
 console.log('PASS image border: configured 10 px renders 10 px, not 5 px');
 console.log('PASS artwork clones preserve identical borders at export resolution');
 console.log('PASS rounded image clipping and cropped bitmap preserve transparent corners');
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
 else browser.kill();
});
