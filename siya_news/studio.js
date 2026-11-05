(() => {
    'use strict';
    const root=document.getElementById('studio-app');
    if(!root)return;
    const browserWindow=document.defaultView||window;
    const $=id=>document.getElementById(id);
    const K=window.Konva;
    if(!K){
        if($('fatal'))$('fatal').hidden=false;
        return;
    }
    const JsPDF=window.jspdf?.jsPDF||null;
    const api='../api/siya-news-studio.php';
    const FORMATS={
        a4_portrait:{w:794,h:1123,label:'A4 แนวตั้ง'},
        a4_landscape:{w:1123,h:794,label:'A4 แนวนอน'},
        presentation:{w:1280,h:720,label:'สไลด์ 16:9'},
        square:{w:1080,h:1080,label:'โพสต์จัตุรัส'},
        story:{w:1080,h:1920,label:'Story'},
        poster:{w:800,h:1200,label:'โปสเตอร์'},
    };
    const FONTS=['Prompt','Noto Sans Thai','Sarabun','Arial','Georgia','sans-serif'];
    const fontLoads=new Map();
    async function ensureFontFamily(family){
        if(family!=='Sarabun')return;
        if(!fontLoads.has(family)){
            const variants=[['Regular','normal','400'],['Bold','normal','700'],['Italic','italic','400'],['BoldItalic','italic','700']];
            fontLoads.set(family,(async()=>{
                let timer;
                try{
                    const faces=await Promise.race([
                        Promise.all(variants.map(async([file,style,weight])=>{
                            const url=new URL(`../assets/fonts/sarabun/Sarabun-${file}.ttf`,document.baseURI);
                            const face=new FontFace('Sarabun',`url("${url.href}")`,{style,weight});
                            return face.load();
                        })),
                        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('font timeout')),15000);}),
                    ]);
                    for(const face of faces)browserWindow.document.fonts.add(face);
                }catch{
                    fontLoads.delete(family);throw Error('โหลดฟอนต์ Sarabun ไม่สำเร็จ กรุณาลองใหม่');
                }finally{clearTimeout(timer);}
            })());
        }
        await fontLoads.get(family);
    }
    async function prepareFonts(pages){
        const families=new Set();
        for(const page of pages)for(const element of page.elements||[])if(element.type==='Text')families.add(element.fontFamily);
        await Promise.all([...families].map(ensureFontFamily));
    }
    const COLORS=['#4f46e5','#1e293b','#111827','#ffffff','#fbbf24','#fb7185','#34d399','#fef3c7','#bfdbfe'];
    const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const uid=()=>'e'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    const pageUid=()=>'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    const thaiDate=value=>{const text=String(value??'');if(!text)return 'ไม่ระบุวันที่';const date=new Date(text.replace(' ','T'));return Number.isNaN(date.getTime())?text:date.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'});};
    const excerpt=(text,max)=>{const chars=[...String(text??'')];return chars.length>max?chars.slice(0,max-1).join('')+'…':chars.join('');};
    const state={
        layouts:[],layout:null,version:0,pages:[],active:0,zoom:.55,selected:null,
        pool:[],poolMap:new Map(),dirty:false,saving:false,conflict:false,loading:false,exporting:false,
        ready:false,revision:0,saveTimer:null,owner:null,autoFit:true,creating:false,mutating:false,
        stage:null,bgLayer:null,contentLayer:null,uiLayer:null,transformer:null,bgRect:null,
        restoring:false,restoreToken:0,toastTimer:null,imageCache:new Map(),imageFailures:new Set(),
        guides:null,snapGuides:null,cropMode:false,cropDrag:null,canvasPage:null,renderError:false,
    };
    const curr=()=>state.pages[state.active]||null;
    const dims=(page=curr())=>FORMATS[page?.format]||FORMATS.a4_portrait;
    const ownerId=()=>window.eofficeUser?.id;
    function setBusy(busy){root.setAttribute('aria-busy',String(busy));root.inert=busy;}
    function setRenderError(failed){
        state.renderError=failed;
        root.querySelector('.st-app').inert=failed;
        state.contentLayer?.listening(!failed);
        renderSave();
    }
    async function retryRender(){
        if(state.loading||state.exporting||state.restoring||state.mutating)return;
        setBusy(true);
        try{
            // A retry rebuilds nodes from the model. Preserve edits that have
            // not reached debounce-save yet, but never copy an obsolete or
            // failed canvas into the currently selected page.
            if(!state.renderError&&state.canvasPage===curr())syncPage();
            state.imageFailures.clear();await paintPage();fitPage();
            if(!state.imageFailures.size)showMessage('');
            resumeAutosave();
        }catch(error){showMessage('แสดงหน้าไม่สำเร็จ: '+error.message+' · กรุณากดลองแสดงหน้าใหม่',true);}
        finally{setBusy(false);renderSave();}
    }

    function showMessage(text,error=false,details=[]){
        const box=$('studio-message');box.replaceChildren();box.hidden=!text;box.classList.toggle('error',Boolean(error));
        if(!text)return;box.append(document.createTextNode(text));
        if(details.length){const list=document.createElement('ul');for(const detail of details)list.append(Object.assign(document.createElement('li'),{textContent:detail}));box.append(list);}
    }
    function toast(text){
        const box=$('toast');if(!box)return;box.textContent=text;box.classList.add('is-show');
        clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>box.classList.remove('is-show'),2600);
    }
    async function request(url,options={}){
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
        try{
            const response=await fetch(url,{credentials:'same-origin',signal:controller.signal,...options});
            const type=response.headers.get('content-type')||'';
            const data=type.includes('application/json')?await response.json():null;
            if(!response.ok||data?.status==='error'){const error=Error(data?.message||`คำขอไม่สำเร็จ (${response.status})`);error.status=response.status;throw error;}
            if(!data||data.status!=='success')throw Error('คำตอบจากเซิร์ฟเวอร์ไม่สมบูรณ์ กรุณาลองใหม่');
            return data;
        }finally{clearTimeout(timer);}
    }
    function renderSave(){
        const label=$('saveState');if(!label)return;
        let text='พร้อมใช้งาน',mode='idle';
        if(state.conflict){text='มีข้อมูลใหม่จากที่อื่น';mode='error';}
        else if(state.renderError){text='แสดงหน้าไม่สำเร็จ';mode='error';}
        else if(state.saving){text='กำลังบันทึก…';mode='saving';}
        else if(state.dirty){text='มีการแก้ไข — รอบันทึก';mode='dirty';}
        else if(state.layout){text='บันทึกแล้ว';mode='saved';}
        label.textContent=text;label.dataset.state=mode;
        if($('reloadBtn')){
            $('reloadBtn').hidden=!state.conflict&&!state.renderError&&!state.imageFailures.size;
            $('reloadBtn').textContent=state.conflict?'โหลดเวอร์ชันล่าสุด':state.renderError||state.imageFailures.size?'ลองแสดงหน้าใหม่':'โหลดล่าสุด';
        }
        updateHistButtons();
    }
    function markDirty(){
        if(!state.layout)return;
        state.dirty=true;state.revision++;renderSave();
        clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>saveNow(),1400);
    }
    function resumeAutosave(){
        // The original debounce may have fired while a slow page was rendering.
        // Re-arm it only after a safe render; do not retry conflicts or failed
        // network writes in a loop, and never advance the edit revision here.
        if(!state.layout||!state.dirty||state.saving||state.conflict||state.renderError||
            state.restoring||state.loading||state.exporting||state.mutating||
            state.canvasPage!==curr()||state.owner!==ownerId())return;
        clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>saveNow(),1400);
    }
    function recoverLayout(){
        if(!state.layout)return;
        // A local repaint cannot resolve a server version conflict. Always
        // offer the latest server document first, even if images also failed.
        if(state.conflict){
            if(confirm('โหลดเวอร์ชันล่าสุดจากเซิร์ฟเวอร์หรือไม่? การแก้ไขที่ยังไม่บันทึกจะถูกทิ้ง'))return openLayout(state.layout.id,true);
            return;
        }
        if(state.renderError||state.imageFailures.size)return retryRender();
        if(confirm('โหลดเวอร์ชันล่าสุดจากเซิร์ฟเวอร์หรือไม่? การแก้ไขที่ยังไม่บันทึกจะถูกทิ้ง'))return openLayout(state.layout.id,true);
    }
    async function saveNow(){
        if(state.loading||state.restoring||state.exporting||state.mutating||state.renderError)return false;
        if(!state.layout||state.saving||state.conflict||!state.dirty)return !state.dirty;
        if(state.owner!==ownerId()){showMessage('บัญชีเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ก่อนบันทึก',true);return false;}
        state.saving=true;renderSave();
        const revision=state.revision;let succeeded=false;
        try{
            syncPage();
            const document={schema:'siya-studio/2',pages:state.pages.map(page=>pageData(page))};
            const data=await request(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',id:state.layout.id,version:state.layout.version,title:($('docName').value.trim()||'ชุดจัดหน้าใหม่'),document,_expected_owner:ownerId()})});
            state.layout.version=data.version;state.layout.title=data.title;
            const row=state.layouts.find(item=>Number(item.id)===Number(state.layout.id));
            if(row){row.title=data.title;row.version=data.version;row.page_count=document.pages.length;}
            if(state.revision===revision)state.dirty=false;
            if(!$('docName').value.trim())$('docName').value=data.title;
            renderLayouts();succeeded=true;
            return !state.dirty;
        }catch(error){
            if(error.status===409){state.conflict=true;showMessage('ชุดจัดหน้านี้ถูกบันทึกจากที่อื่นแล้ว ระบบหยุดบันทึกอัตโนมัติ กรุณาโหลดเวอร์ชันล่าสุด',true);}
            else showMessage('บันทึกไม่สำเร็จ: '+error.message+' · งานบนหน้าจอยังอยู่',true);
            return false;
        }finally{
            state.saving=false;renderSave();
            if(succeeded&&state.dirty&&!state.conflict){clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>saveNow(),2500);}
        }
    }

    function setPool(rows){state.pool=Array.isArray(rows)?rows:[];state.poolMap=new Map(state.pool.map(item=>[Number(item.id),item]));}
    function mergePool(rows){
        for(const item of Array.isArray(rows)?rows:[]){
            const id=Number(item.id);state.poolMap.set(id,item);
            const index=state.pool.findIndex(row=>Number(row.id)===id);
            if(index>=0)state.pool[index]=item;else state.pool.push(item);
        }
    }
    function referencedNewsIds(pages=state.pages){
        const ids=new Set();
        for(const page of pages)for(const element of page.elements||[])if(element.type==='Image'&&element.newsId)ids.add(Number(element.newsId));
        return [...ids];
    }
    async function fetchReferencedPool(ids){
        const rows=[];
        for(let offset=0;offset<ids.length;offset+=60){
            const result=await request(api+'?action=pool&ids='+ids.slice(offset,offset+60).join(','));
            rows.push(...result.data);
        }
        return rows;
    }
    async function fetchPool(pages=state.pages){
        const [latest,referenced]=await Promise.all([request(api+'?action=pool'),fetchReferencedPool(referencedNewsIds(pages))]);
        return [...new Map([...latest.data,...referenced].map(row=>[Number(row.id),row])).values()];
    }
    async function refreshPool(){
        setPool(await fetchPool());
        renderPool();
    }

    function renderLayouts(){
        const select=$('layoutSelect');select.replaceChildren();
        if(!state.layouts.length){const option=document.createElement('option');option.value='';option.textContent='ยังไม่มีชุดจัดหน้า';select.append(option);return;}
        for(const row of state.layouts){const option=document.createElement('option');option.value=String(row.id);option.textContent=`${row.title||'ชุดจัดหน้า'} · ${row.page_count} หน้า`;if(state.layout&&Number(row.id)===Number(state.layout.id))option.selected=true;select.append(option);}
    }
    function newPage(format=curr()?.format||'a4_portrait'){
        return {id:pageUid(),format:FORMATS[format]?format:'a4_portrait',bg:'#ffffff',safeMargin:38,showSafeMargin:false,snap:true,elements:[],_hist:[],_hi:-1};
    }
    function pageData(page){
        return {id:page.id,format:page.format,bg:page.bg,safeMargin:page.safeMargin??38,showSafeMargin:page.showSafeMargin??false,snap:page.snap??true,elements:page.elements};
    }
    function serializeNode(node){
        const type=node.getClassName();
        const base={id:node.id()||uid(),type,x:node.x(),y:node.y(),rotation:node.rotation(),opacity:node.opacity(),scaleX:node.scaleX(),scaleY:node.scaleY(),visible:node.visible(),locked:!!node.getAttr('locked'),name:node.name()||''};
        if(type==='Text'){const text={...base,width:node.width(),text:node.text(),fontFamily:node.fontFamily(),fontSize:node.fontSize(),fontStyle:node.fontStyle(),align:node.align(),fill:node.fill(),lineHeight:node.lineHeight(),letterSpacing:node.letterSpacing()||0,textDecoration:node.textDecoration()||''};if(node.getAttr('fixedHeight'))text.height=node.height();return text;}
        if(type==='Image'){const image={...base,width:node.width(),height:node.height(),newsId:Number(node.getAttr('newsId')),imageId:node.getAttr('imageId'),stroke:node.stroke()||null,strokeWidth:node.strokeWidth()||0,cornerRadius:node.cornerRadius()||0};if(node.getAttr('cropView'))image.cropView={...node.getAttr('cropView')};return image;}
        if(type==='Rect')return {...base,width:node.width(),height:node.height(),fill:node.fill(),cornerRadius:node.cornerRadius()||0,stroke:node.stroke()||null,strokeWidth:node.strokeWidth()||0};
        if(type==='Circle')return {...base,radius:node.radius(),fill:node.fill(),stroke:node.stroke()||null,strokeWidth:node.strokeWidth()||0};
        if(type==='RegularPolygon')return {...base,sides:node.sides(),radius:node.radius(),fill:node.fill(),stroke:node.stroke()||null,strokeWidth:node.strokeWidth()||0};
        if(type==='Star')return {...base,numPoints:node.numPoints(),innerRadius:node.innerRadius(),outerRadius:node.outerRadius(),fill:node.fill(),stroke:node.stroke()||null,strokeWidth:node.strokeWidth()||0};
        if(type==='Line')return {...base,points:node.points(),stroke:node.stroke()||'#4f46e5',strokeWidth:node.strokeWidth()||6,lineCap:node.lineCap()||'round',lineJoin:node.lineJoin()||'round'};
        return null;
    }
    function syncPage(){
        if(state.restoring)return;
        const page=curr();if(!page||!state.contentLayer)return;
        // Never copy a canvas belonging to another page/layout into this model.
        if(state.canvasPage!==page)return;
        page.elements=state.contentLayer.getChildren().map(serializeNode).filter(Boolean);
    }
    function pageSnapshot(page=curr()){
        return JSON.stringify(pageData(page));
    }
    function record(){
        if(state.restoring||state.renderError||state.canvasPage!==curr())return;
        syncPage();const page=curr();if(!page)return;
        const snapshot=pageSnapshot(page);
        if(page._hist[page._hi]===snapshot)return;
        page._hist=page._hist.slice(0,page._hi+1);page._hist.push(snapshot);
        if(page._hist.length>30)page._hist.shift();
        page._hi=page._hist.length-1;markDirty();updateHistButtons();
    }
    function updateHistButtons(){
        const page=curr();
        if($('undoBtn'))$('undoBtn').disabled=!page||page._hi<=0;
        if($('redoBtn'))$('redoBtn').disabled=!page||page._hi>=page._hist.length-1;
    }
    function undo(dir){
        const page=curr();if(!page)return;
        const target=page._hi+dir;if(target<0||target>=page._hist.length)return;
        page._hi=target;const snapshot=JSON.parse(page._hist[target]);
        Object.assign(page,snapshot);
        paintPage();markDirty();updateHistButtons();
    }

    function setZoom(value){
        state.zoom=Math.max(.15,Math.min(1.5,Number(value)||.55));
        const page=curr();if(!page||!state.stage)return;
        const {w,h}=dims(page);
        state.stage.width(w*state.zoom);state.stage.height(h*state.zoom);state.stage.scale({x:state.zoom,y:state.zoom});
        $('pageWrap').style.width=(w*state.zoom)+'px';$('pageWrap').style.height=(h*state.zoom)+'px';
        $('zoomRange').value=String(Math.round(state.zoom*100/5)*5);$('zoomValue').textContent=Math.round(state.zoom*100)+'%';
        state.stage.batchDraw();updatePageLabel();
    }
    function fitPage(){
        const page=curr();if(!page||!state.stage)return;
        const box=$('canvasScroll'),{w,h}=dims(page);
        const widthFit=(box.clientWidth-(window.innerWidth<=760?24:70))/w;
        const zoom=Math.max(.15,Math.min(1,window.innerWidth<=760?widthFit:Math.min(widthFit,(box.clientHeight-62)/h)));
        setZoom(zoom);
    }
    function fitSettled(){
        let tries=0;
        const run=()=>{if(state.loading||!state.autoFit||!state.layout||!state.stage)return;fitPage();if(tries++<5)setTimeout(run,120);};
        run();
    }
    function updatePageLabel(){
        $('pageLabel').textContent='หน้า '+(state.active+1);
        const page=curr();if(!page)return;
        $('workFormat').textContent=`${FORMATS[page.format]?.label||'A4'} · ${dims(page).w} × ${dims(page).h} px`;
        $('pageSizeDisplay').textContent=`${dims(page).w} × ${dims(page).h} px`;
        if($('formatSelect'))$('formatSelect').value=page.format;
        if($('bgColor'))$('bgColor').value=page.bg;if($('bgColorHex'))$('bgColorHex').value=page.bg;
        if($('bgColorSide'))$('bgColorSide').value=page.bg;if($('bgColorSideHex'))$('bgColorSideHex').value=page.bg;
        $('safeMargin').value=page.safeMargin??38;$('showSafeMargin').checked=page.showSafeMargin??false;$('snapToggle').checked=page.snap??true;
        drawGuides();
    }

    function initFormats(){
        const select=$('formatSelect');select.replaceChildren();
        for(const [value,format] of Object.entries(FORMATS)){const option=document.createElement('option');option.value=value;option.textContent=`${format.label} — ${format.w} × ${format.h} px`;select.append(option);}
    }
    function initStage(){
        const page=curr();const {w,h}=dims(page);
        state.stage=new K.Stage({container:$('stageContainer'),width:w*state.zoom,height:h*state.zoom});
        state.bgLayer=new K.Layer({listening:false});state.contentLayer=new K.Layer();state.uiLayer=new K.Layer();
        state.stage.add(state.bgLayer);state.stage.add(state.contentLayer);state.stage.add(state.uiLayer);
        state.bgRect=new K.Rect({x:0,y:0,width:w,height:h,fill:page.bg,listening:false});state.bgLayer.add(state.bgRect);
        state.transformer=new K.Transformer({rotateEnabled:true,keepRatio:false,borderStroke:'#4f46e5',anchorStroke:'#4f46e5',anchorFill:'#ffffff',anchorSize:9,anchorCornerRadius:3,padding:2,flipEnabled:false});
        state.uiLayer.add(state.transformer);
        state.guides=new K.Group({listening:false});state.snapGuides=new K.Group({listening:false});state.uiLayer.add(state.guides,state.snapGuides);
        state.stage.on('click tap',event=>{if(event.target===state.stage){select(null);return;}const node=event.target;if(state.cropMode&&node===state.selected)return;if(node.getLayer()===state.contentLayer)select(node);});
        state.stage.on('dblclick dbltap',event=>{const node=event.target;if(node.getClassName()==='Text'&&!node.getAttr('locked')&&node.getLayer()===state.contentLayer){select(node);editTextOverlay(node);}});
        state.contentLayer.on('dragend transformend',event=>{if(event.target.getClassName()==='Image')applyCrop(event.target);state.snapGuides.destroyChildren();record();refreshProps();renderLayers();});
        state.contentLayer.on('dragmove',event=>{snapNode(event.target,event.evt?.altKey);refreshPosition();});
        state.contentLayer.on('transform',event=>{if(event.target.getClassName()==='Image')applyCrop(event.target);refreshPosition();});
        state.stage.on('pointerdown',beginCropDrag);state.stage.on('pointermove',moveCropDrag);state.stage.on('pointerup pointercancel pointerleave',endCropDrag);
        setZoom(state.zoom);
        if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(state.stage&&state.autoFit)fitPage();}).observe($('canvasScroll'));
    }
    function editableNodes(){return state.contentLayer?state.contentLayer.getChildren().slice():[];}
    function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
    function cropBox(iw,ih,ratio,view){
        const width=Math.min(iw,ih*ratio)/view.zoom,height=width/ratio;
        return {x:(iw-width)*view.x,y:(ih-height)*view.y,width,height};
    }
    function applyCrop(node){
        const view=node.getAttr('cropView');
        if(!view){node.crop({x:0,y:0,width:0,height:0});return;}
        const image=node.image();
        const ratio=Math.max(.0001,node.width()*Math.abs(node.scaleX())/(node.height()*Math.abs(node.scaleY())));
        node.crop(cropBox(image.naturalWidth||image.width||1,image.naturalHeight||image.height||1,ratio,view));
    }
    function decorateImage(node){
        // Konva's default Image draws the stroke first, then covers its inner
        // half with the bitmap. Draw the bitmap first and stroke the same path
        // last so the configured width is visible in editor and exports alike.
        node.sceneFunc(function(context){
            const w=this.width(),h=this.height(),r=Math.min(this.cornerRadius()||0,w/2,h/2);
            context.beginPath();
            context.moveTo(r,0);context.lineTo(w-r,0);context.quadraticCurveTo(w,0,w,r);
            context.lineTo(w,h-r);context.quadraticCurveTo(w,h,w-r,h);
            context.lineTo(r,h);context.quadraticCurveTo(0,h,0,h-r);
            context.lineTo(0,r);context.quadraticCurveTo(0,0,r,0);context.closePath();
            context.save();context.clip();
            const image=this.image();
            if(image){
                if(this.cropWidth()&&this.cropHeight())context.drawImage(image,this.cropX(),this.cropY(),this.cropWidth(),this.cropHeight(),0,0,w,h);
                else context.drawImage(image,0,0,w,h);
            }
            context.restore();context.strokeShape(this);
        });
        return node;
    }
    function updateCrop(values){
        const node=state.selected;if(!node||node.getClassName()!=='Image'||node.getAttr('locked'))return;
        node.setAttr('cropView',{x:.5,y:.5,zoom:1,...node.getAttr('cropView'),...values});applyCrop(node);state.contentLayer.batchDraw();
    }
    function beginCropDrag(event){
        const node=state.selected;
        if(!state.cropMode||!node||event.target!==node||node.getAttr('locked'))return;
        const pointer=state.stage.getPointerPosition();if(!pointer)return;
        const inverse=node.getAbsoluteTransform().copy().invert();updateCrop({});
        state.cropDrag={node,start:inverse.point(pointer),inverse,view:{...node.getAttr('cropView')},box:node.crop(),pointerId:event.evt?.pointerId};
        try{state.stage.content.setPointerCapture(event.evt.pointerId);}catch{}
    }
    function moveCropDrag(){
        const drag=state.cropDrag,pointer=state.stage.getPointerPosition();if(!drag||!pointer)return;
        const current=drag.inverse.point(pointer),image=drag.node.image();
        const extraX=(image.naturalWidth||image.width)-drag.box.width,extraY=(image.naturalHeight||image.height)-drag.box.height;
        updateCrop({x:clamp(drag.view.x-(current.x-drag.start.x)*drag.box.width/drag.node.width()/Math.max(.001,extraX),0,1),y:clamp(drag.view.y-(current.y-drag.start.y)*drag.box.height/drag.node.height()/Math.max(.001,extraY),0,1)});refreshCropProps();
    }
    function endCropDrag(){
        if(!state.cropDrag)return;
        try{state.stage.content.releasePointerCapture(state.cropDrag.pointerId);}catch{}
        state.cropDrag=null;record();
    }
    function refreshCropProps(){
        const view=state.selected?.getAttr('cropView')||{x:.5,y:.5,zoom:1};
        $('cropZoom').value=view.zoom;$('cropX').value=view.x;$('cropY').value=view.y;
    }
    function drawGuides(){
        if(!state.guides||!curr())return;state.guides.destroyChildren();
        if(curr().showSafeMargin){const {w,h}=dims(),margin=curr().safeMargin??38;state.guides.add(new K.Rect({x:margin,y:margin,width:Math.max(0,w-2*margin),height:Math.max(0,h-2*margin),stroke:'#f43f5e',strokeWidth:1/state.zoom,dash:[5/state.zoom,4/state.zoom],listening:false}));}
        state.uiLayer.batchDraw();
    }
    function alignSelected(direction){
        const node=state.selected;if(!node||node.getAttr('locked'))return;
        const rect=node.getClientRect({relativeTo:state.contentLayer}),{w,h}=dims(),margin=curr().safeMargin??38;
        const targets={left:[margin-rect.x,0],center:[w/2-rect.x-rect.width/2,0],right:[w-margin-rect.x-rect.width,0],top:[0,margin-rect.y],middle:[0,h/2-rect.y-rect.height/2],bottom:[0,h-margin-rect.y-rect.height]};
        const delta=targets[direction];if(!delta)return;node.position({x:node.x()+delta[0],y:node.y()+delta[1]});record();refreshProps();state.contentLayer.batchDraw();
    }
    function snapNode(node,disabled=false){
        state.snapGuides.destroyChildren();
        if(disabled||curr()?.snap===false||state.cropMode||node.getAttr('locked')){state.uiLayer.batchDraw();return;}
        const {w,h}=dims(),margin=curr().safeMargin??38;
        const xTargets=[0,margin,w/2,w-margin,w],yTargets=[0,margin,h/2,h-margin,h];
        for(const other of editableNodes())if(other!==node&&other.visible()){
            const r=other.getClientRect({relativeTo:state.contentLayer});xTargets.push(r.x,r.x+r.width/2,r.x+r.width);yTargets.push(r.y,r.y+r.height/2,r.y+r.height);
        }
        const r=node.getClientRect({relativeTo:state.contentLayer}),threshold=5/state.zoom;
        for(const [axis,targets,positions] of [['x',xTargets,[r.x,r.x+r.width/2,r.x+r.width]],['y',yTargets,[r.y,r.y+r.height/2,r.y+r.height]]]){
            let best=null;
            for(const target of targets)for(const position of positions){const delta=target-position;if(Math.abs(delta)<=threshold&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={target,delta};}
            if(best){node[axis](node[axis]()+best.delta);state.snapGuides.add(new K.Line({points:axis==='x'?[best.target,0,best.target,h]:[0,best.target,w,best.target],stroke:'#4f46e5',strokeWidth:1/state.zoom,dash:[4/state.zoom,3/state.zoom],listening:false}));}
        }
        state.uiLayer.batchDraw();
    }
    function toggleLock(node=state.selected){
        if(!node)return;
        const locked=!node.getAttr('locked');node.setAttr('locked',locked);node.draggable(!locked);
        state.cropMode=false;$('cropMode').checked=false;
        state.transformer.nodes(locked?[]:[node]);record();refreshProps();renderLayers();
    }
    function loadImage(imageId){
        if(state.imageCache.has(imageId))return Promise.resolve(state.imageCache.get(imageId));
        return new Promise(resolve=>{
            const image=new Image();let settled=false;
            const finish=success=>{
                if(settled)return;settled=true;clearTimeout(timer);image.onload=image.onerror=null;
                if(success){state.imageCache.set(imageId,image);state.imageFailures.delete(imageId);resolve(image);}
                else{
                    image.removeAttribute('src');state.imageFailures.add(imageId);
                    const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;resolve(canvas);
                }
            };
            const timer=setTimeout(()=>finish(false),15000);
            image.onload=()=>finish(true);image.onerror=()=>finish(false);
            image.src='../api/siya-news-image.php?id='+encodeURIComponent(imageId);
        });
    }
    async function rehydrate(element,images=null){
        const attrs={...element};
        delete attrs.type;
        if(element.type==='Image'){
            const image=images?.has(element.imageId)?images.get(element.imageId):await loadImage(element.imageId);
            const node=decorateImage(new K.Image({...attrs,image,imageId:element.imageId,newsId:Number(element.newsId),draggable:!element.locked}));applyCrop(node);return node;
        }
        const Constructor=K[element.type];
        if(typeof Constructor!=='function')return null;
        if(element.type==='Text'&&element.height!==undefined)attrs.fixedHeight=true;
        return new Constructor({...attrs,draggable:!element.locked});
    }
    async function paintPage(){
        const page=curr();if(!page||!state.stage)return;
        const token=++state.restoreToken;state.restoring=true;
        const nodes=[];
        try{
            await prepareFonts([page]);
            // Start image requests together, so a page full of stalled images
            // waits one timeout window rather than one window per image.
            const images=new Map();
            await Promise.all([...new Set((page.elements||[]).filter(element=>element.type==='Image').map(element=>element.imageId))].map(async id=>{
                images.set(id,await loadImage(id));
            }));
            for(const element of page.elements||[]){
                const node=await rehydrate(element,images);
                if(!node)throw Error('ไม่สามารถแสดงองค์ประกอบในงานนี้ได้');
                nodes.push(node);
                if(token!==state.restoreToken){nodes.forEach(item=>item.destroy());return;}
            }
            if(token!==state.restoreToken)return;
            select(null);state.contentLayer.destroyChildren();
            state.bgRect.setAttrs({width:dims(page).w,height:dims(page).h,fill:page.bg});
            for(const node of nodes)state.contentLayer.add(node);
            state.canvasPage=page;setRenderError(false);
        }catch(error){nodes.forEach(node=>node.destroy());if(token===state.restoreToken)setRenderError(true);throw error;}
        finally{if(token===state.restoreToken)state.restoring=false;}
        if(token!==state.restoreToken)return;
        if(!page._hist.length){page._hist=[pageSnapshot(page)];page._hi=0;}
        setZoom(state.zoom);state.bgLayer.batchDraw();state.contentLayer.batchDraw();
        updatePageLabel();renderLayers();refreshProps();updateHistButtons();renderPages();
        if(state.imageFailures.size){showMessage('ภาพบางภาพโหลดไม่สำเร็จหรือเกินเวลา 15 วินาที · กดลองแสดงหน้าใหม่ก่อนส่งออก',true);renderSave();}
        resumeAutosave();
    }
    async function loadPage(index){
        if(index<0||index>=state.pages.length)return;
        if(!state.restoring)syncPage();
        const previous=state.active;
        state.active=index;state.selected=null;state.imageFailures=new Set();
        try{await paintPage();}catch(error){state.active=previous;renderPages();showMessage(error.message,true);}
    }

    function select(node){
        if(state.cropDrag)endCropDrag();
        if(state.selected&&state.selected!==node)state.selected.draggable(!state.selected.getAttr('locked'));
        state.cropMode=false;$('cropMode').checked=false;
        state.selected=node||null;
        if(node)node.draggable(!node.getAttr('locked'));
        if(state.transformer)state.transformer.nodes(node&&!node.getAttr('locked')?[node]:[]);
        refreshProps();renderLayers();
    }
    function addNodes(nodes){
        if(!nodes.length)return;
        for(const node of nodes){if(node.getClassName()==='Image')decorateImage(node);node.draggable(true);if(!node.id())node.id(uid());state.contentLayer.add(node);}
        select(nodes[nodes.length-1]);state.contentLayer.batchDraw();record();renderLayers();closeSideOnMobile();
    }
    function addText(kind='body'){
        const page=curr();const {w,h}=dims(page);
        const sizes={heading:64,sub:36,body:24},texts={heading:'เพิ่มหัวเรื่อง',sub:'เพิ่มหัวข้อย่อย',body:'เพิ่มข้อความของคุณ'};
        const node=new K.Text({x:w*.12,y:h*.25+(editableNodes().length%4)*18,width:w*.72,text:texts[kind],fontFamily:'Prompt',fontSize:sizes[kind],fontStyle:kind==='heading'?'bold':'normal',fill:'#1e293b',lineHeight:1.25,wrap:'word',name:'ข้อความ'});
        addNodes([node]);
    }
    function addShape(kind){
        const page=curr();const {w,h}=dims(page);const x=w*.42,y=h*.35,nodes=[];
        if(kind==='rect')nodes.push(new K.Rect({x,y,width:220,height:140,fill:'#4f46e5',name:'สี่เหลี่ยม'}));
        else if(kind==='round')nodes.push(new K.Rect({x,y,width:230,height:150,cornerRadius:26,fill:'#4f46e5',name:'สี่เหลี่ยมมุมมน'}));
        else if(kind==='circle')nodes.push(new K.Circle({x,y,radius:90,fill:'#4f46e5',name:'วงกลม'}));
        else if(kind==='triangle')nodes.push(new K.RegularPolygon({x,y,sides:3,radius:100,fill:'#4f46e5',name:'สามเหลี่ยม'}));
        else if(kind==='star')nodes.push(new K.Star({x,y,numPoints:5,innerRadius:44,outerRadius:100,fill:'#4f46e5',name:'ดาว'}));
        else nodes.push(new K.Line({x,y,points:[0,0,250,150],stroke:'#4f46e5',strokeWidth:8,lineCap:'round',lineJoin:'round',name:'เส้น'}));
        addNodes(nodes);
    }

    async function insertNews(item,imageId=null){
        if(!state.layout||state.loading||state.exporting||state.mutating||state.restoring)return;
        syncPage();const page=curr();const {w,h}=dims(page);
        const activeAtStart=page;
        const margin=Math.round(w*.07);const maxW=w-margin*2;
        let nodes=[];
        const existing=editableNodes();
        const existingBottom=existing.length?Math.max(...existing.map(node=>node.y()+Math.max(0,node.height()||0)*Math.abs(node.scaleY()))):0;
        let y=Math.min(h*.55,Math.max(margin,existingBottom+Math.round(h*.02)));
        if(item.images.length){
            const chosen=imageId?item.images.find(image=>image.id===imageId):item.images[0];
            if(chosen){
                const image=await loadImage(chosen.id);
                if(state.loading||state.exporting||state.mutating||state.restoring){toast('ระบบกำลังทำรายการ กรุณาแทรกภาพอีกครั้ง');return;}
                if(state.pages[state.active]!==activeAtStart){toast('เปลี่ยนหน้าแล้ว ยกเลิกการแทรก');return;}
                const ratio=(image.width||1)/(image.height||1);
                let iw=maxW,ih=iw/ratio;
                const room=Math.max(h*.18,h-y-margin);
                if(ih>room){ih=Math.min(room,h*.42);iw=ih*ratio;}
                const node=new K.Image({x:margin,y,width:iw,height:ih,image,imageId:chosen.id,newsId:item.id,name:'ภาพข่าว'});
                nodes.push(node);
                if(imageId){node.position({x:Math.round((w-iw)/2),y:Math.round(h*.18)});addNodes([node]);toast('แทรกภาพข่าวแล้ว');return;}
                y+=ih+h*.025;
            }
        }
        if(imageId&&!nodes.length){toast('ไม่พบภาพนี้ในข่าว');return;}
        const title=new K.Text({x:margin,y,width:maxW,text:item.title,fontFamily:'Prompt',fontSize:Math.max(18,Math.min(46,w*.05)),fontStyle:'bold',fill:'#1e293b',lineHeight:1.18,wrap:'word',name:'หัวข้อข่าว'});
        nodes.push(title);y+=Math.ceil(title.height())+h*.012;
        const meta=new K.Text({x:margin,y,width:maxW,text:[item.department,thaiDate(item.event_date)].filter(Boolean).join(' · '),fontFamily:'Prompt',fontSize:Math.max(10,Math.min(18,w*.018)),fill:'#64748b',lineHeight:1.4,wrap:'word',name:'ข้อมูลข่าว'});
        nodes.push(meta);y+=Math.ceil(meta.height())+h*.015;
        const body=new K.Text({x:margin,y,width:maxW,text:excerpt(item.body,700),fontFamily:'Prompt',fontSize:Math.max(12,Math.min(24,w*.024)),fill:'#334155',lineHeight:1.55,wrap:'word',name:'เนื้อข่าว'});
        nodes.push(body);
        addNodes(nodes);toast('แทรกข่าวแล้ว');
    }

    function applyTemplate(kind){
        const page=curr();if(!page)return;
        if(editableNodes().length&&!confirm('ใช้เทมเพลตแทนองค์ประกอบบนหน้านี้หรือไม่?'))return;
        select(null);state.contentLayer.destroyChildren();const {w,h}=dims(page);const nodes=[];
        const text=(x,y,width,value,size,color,weight='normal',name='ข้อความ')=>new K.Text({x,y,width,text:value,fontFamily:'Prompt',fontSize:size,fontStyle:weight,fill:color,lineHeight:1.2,wrap:'word',name});
        if(kind==='cover'){
            page.bg='#312e81';nodes.push(new K.Circle({x:w*.88,y:h*.18,radius:w*.18,fill:'#6366f1',opacity:.75,name:'วงกลมตกแต่ง'}));
            nodes.push(new K.Rect({x:w*.08,y:h*.16,width:w*.16,height:6,fill:'#c7d2fe',name:'เส้นตกแต่ง'}));
            nodes.push(text(w*.08,h*.24,w*.72,'SIYA NEWS',Math.max(14,w*.025),'#c7d2fe','bold','หัวเรื่อง'))
            nodes.push(text(w*.08,h*.34,w*.78,$('docName').value||'ชื่อวารสาร',Math.max(30,w*.075),'#ffffff','bold','ชื่อวารสาร'));
            nodes.push(text(w*.08,h*.72,w*.7,'โรงเรียนศรียานุสรณ์',Math.max(12,w*.024),'#e0e7ff','normal','คำโปรย'));
        }else if(kind==='feature'){
            page.bg='#fff7ed';nodes.push(new K.Rect({x:0,y:0,width:w,height:h*.035,fill:'#f97316',name:'แถบสี'}));
            nodes.push(text(w*.08,h*.12,w*.8,'ข่าวเด่น',Math.max(28,w*.065),'#9a3412','bold','หัวข้อ'));
            nodes.push(text(w*.08,h*.26,w*.78,'แทรกข่าวจากคลังด้านซ้าย แล้วปรับภาพและข้อความให้พอดีหน้ากระดาษ',Math.max(11,w*.022),'#7c2d12','normal','คำอธิบาย'));
            nodes.push(new K.Rect({x:w*.08,y:h*.36,width:w*.84,height:h*.46,fill:'#ffedd5',stroke:'#fdba74',strokeWidth:2,cornerRadius:16,name:'พื้นที่ภาพ'}));
        }else{
            page.bg='#ecfdf5';nodes.push(new K.Circle({x:w*.86,y:h*.18,radius:w*.15,fill:'#a7f3d0',name:'วงกลมตกแต่ง'}));
            nodes.push(new K.Circle({x:w*.1,y:h*.82,radius:w*.12,fill:'#6ee7b7',opacity:.7,name:'วงกลมตกแต่ง'}));
            nodes.push(text(w*.08,h*.18,w*.78,'กิจกรรมโรงเรียน',Math.max(26,w*.06),'#065f46','bold','หัวข้อ'));
            nodes.push(text(w*.08,h*.3,w*.72,'เพิ่มรายละเอียดกิจกรรม ภาพบรรยากาศ และข้อมูลที่จำเป็น',Math.max(11,w*.022),'#047857','normal','คำอธิบาย'));
        }
        state.bgRect.fill(page.bg);addNodes(nodes);updatePageLabel();renderPages();
    }

    function editTextOverlay(node){
        const box=$('stageContainer').getBoundingClientRect(),scale=state.zoom;
        const area=document.createElement('textarea');area.value=node.text();area.dataset.studioOverlay='';
        area.style.cssText=`position:fixed;z-index:60;left:${box.left+node.x()*scale}px;top:${box.top+node.y()*scale}px;width:${Math.max(150,node.width()*scale)}px;height:${Math.max(90,Math.min(320,node.height()*scale))}px;padding:6px;box-sizing:border-box;font-family:${node.fontFamily()};font-size:${Math.max(14,node.fontSize()*scale)}px;line-height:1.3;color:${node.fill()};background:#fffdf4;border:2px solid #4f46e5;border-radius:4px;outline:none;resize:both;`;
        document.body.append(area);area.focus();area.select();
        const done=()=>{if(!area.parentNode)return;node.text(area.value);area.remove();state.contentLayer.batchDraw();record();refreshProps();};
        area.addEventListener('blur',done);
        area.addEventListener('keydown',event=>{if(event.key==='Escape')area.remove();else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();done();}});
    }

    function renderPool(){
        const box=$('newsPool');box.replaceChildren();
        const query=($('newsSearch').value||'').trim().toLowerCase();
        const rows=state.pool.filter(item=>!query||[item.title,item.department,item.body].join(' ').toLowerCase().includes(query));
        if(!rows.length){box.append(Object.assign(document.createElement('p'),{className:'st-sub',textContent:state.pool.length?'ไม่พบข่าวตามคำค้น':'ยังไม่มีข่าวที่ผ่านตรวจ'}));return;}
        for(const item of rows){
            const card=document.createElement('article');card.className='st-news';
            const head=document.createElement('button');head.type='button';head.className='st-news-head';
            const strong=document.createElement('strong');strong.textContent=item.title||'ข่าวไม่มีหัวข้อ';
            const small=document.createElement('small');small.textContent=[item.department||'ไม่ระบุกลุ่มงาน',thaiDate(item.event_date)].join(' · ');
            head.append(strong,small);head.addEventListener('click',()=>insertNews(item));card.append(head);
            const thumbs=document.createElement('div');thumbs.className='st-news-thumbs';
            if(item.images.length){
                for(const image of item.images){
                    const button=document.createElement('button');button.type='button';button.className='st-news-thumb';button.title='แทรกเฉพาะภาพนี้';
                    const img=document.createElement('img');img.src=image.url;img.alt='';img.loading='lazy';button.append(img);
                    button.addEventListener('click',event=>{event.stopPropagation();insertNews(item,image.id);});
                    thumbs.append(button);
                }
            }else thumbs.append(Object.assign(document.createElement('span'),{className:'st-news-thumb st-news-thumb--none',textContent:'ไม่มีภาพ'}));
            card.append(thumbs);
            const meta=document.createElement('div');meta.className='st-news-meta';
            const count=document.createElement('span');count.textContent=item.images.length+' ภาพ';
            const insert=document.createElement('button');insert.type='button';insert.textContent='＋ แทรกข่าว';insert.addEventListener('click',()=>insertNews(item));
            meta.append(count,insert);card.append(meta);box.append(card);
        }
    }
    function renderLayers(){
        const box=$('layerList');box.replaceChildren();
        if(!state.contentLayer){return;}
        const nodes=editableNodes().reverse();
        if(!nodes.length){box.append(Object.assign(document.createElement('p'),{className:'st-sub',textContent:'ยังไม่มีเลเยอร์ในหน้านี้'}));return;}
        for(const node of nodes){
            const row=document.createElement('div');row.className='st-layer'+(node===state.selected?' is-active':'');
            const marker=document.createElement('span');marker.textContent=node.getClassName()==='Text'?'T':node.getClassName()==='Image'?'▧':'◆';
            const name=document.createElement('span');name.className='st-layer-name';name.textContent=node.name()||(node.getClassName()==='Text'?node.text().slice(0,24):node.getClassName());
            const visible=document.createElement('button');visible.type='button';visible.title='ซ่อน/แสดง';visible.textContent=node.visible()?'◉':'◌';
            visible.addEventListener('click',event=>{event.stopPropagation();node.visible(!node.visible());record();renderLayers();});
            const up=document.createElement('button');up.type='button';up.title='เลื่อนขึ้น';up.textContent='↑';up.addEventListener('click',event=>{event.stopPropagation();node.moveUp();record();renderLayers();});
            const down=document.createElement('button');down.type='button';down.title='เลื่อนลง';down.textContent='↓';down.addEventListener('click',event=>{event.stopPropagation();node.moveDown();record();renderLayers();});
            const lock=document.createElement('button');lock.type='button';lock.title=node.getAttr('locked')?'ปลดล็อกวัตถุ':'ล็อกวัตถุ';lock.textContent=node.getAttr('locked')?'🔒':'🔓';lock.setAttribute('aria-pressed',String(!!node.getAttr('locked')));
            lock.addEventListener('click',event=>{event.stopPropagation();select(node);toggleLock(node);});
            up.disabled=down.disabled=visible.disabled=!!node.getAttr('locked');
            row.append(marker,name,visible,up,down,lock);
            row.addEventListener('click',()=>select(node));box.append(row);
        }
    }
    function renderPages(){
        const strip=$('pagesStrip');strip.replaceChildren();
        state.pages.forEach((page,index)=>{
            const button=document.createElement('button');button.type='button';button.className='st-page-item'+(index===state.active?' is-active':'');
            button.title=`หน้า ${index+1} · ${FORMATS[page.format]?.label||'หน้า'}`;
            if(index===state.active)button.setAttribute('aria-current','page');
            const thumb=document.createElement('span');thumb.className='st-page-thumb';thumb.style.background=page.bg;thumb.textContent=FORMATS[page.format]?.label||'หน้า';
            const small=document.createElement('small');small.textContent='หน้า '+(index+1);
            button.append(thumb,small);button.addEventListener('click',()=>loadPage(index));strip.append(button);
        });
        const add=document.createElement('button');add.type='button';add.className='st-page-add';add.innerHTML='<span>＋</span>เพิ่มหน้า';add.addEventListener('click',addPage);strip.append(add);
    }
    async function addPage(){
        if(state.pages.length>=40){toast('สูงสุด 40 หน้า');return;}
        syncPage();const page=newPage();state.pages.push(page);state.active=state.pages.length-1;await paintPage();fitPage();markDirty();renderPages();toast('เพิ่มหน้าแล้ว');
    }
    async function duplicatePage(){
        syncPage();if(state.pages.length>=40){toast('สูงสุด 40 หน้า');return;}
        const source=curr();const copy={...JSON.parse(JSON.stringify(pageData(source))),id:pageUid(),_hist:[],_hi:-1};
        copy.elements=copy.elements.map(element=>({...element,id:uid()}));
        state.pages.splice(state.active+1,0,copy);state.active++;await paintPage();fitPage();markDirty();renderPages();toast('ทำสำเนาหน้าแล้ว');
    }
    async function deletePage(){
        if(state.pages.length<=1){toast('ต้องเหลืออย่างน้อย 1 หน้า');return;}
        if(!confirm('ลบหน้านี้หรือไม่?'))return;
        state.pages.splice(state.active,1);state.active=Math.min(state.active,state.pages.length-1);await paintPage();fitPage();markDirty();renderPages();toast('ลบหน้าแล้ว');
    }
    function applyFormat(format){
        const page=curr();if(!page||!FORMATS[format])return;
        page.format=format;state.bgRect.size({width:dims(page).w,height:dims(page).h});state.autoFit=true;setZoom(state.zoom);fitPage();record();updatePageLabel();renderPages();
    }
    function setBackground(color){
        const page=curr();if(!page)return;
        if(!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color))return;
        page.bg=color.toLowerCase();state.bgRect.fill(page.bg);state.bgLayer.batchDraw();updatePageLabel();renderPages();markDirty();
    }

    function refreshPosition(){
        const node=state.selected;if(!node)return;
        $('pX').value=Math.round(node.x());$('pY').value=Math.round(node.y());$('pRotation').value=Math.round(node.rotation());$('pOpacity').value=Math.round(node.opacity()*100);
        const rect=node.getClientRect({skipTransform:true});
        $('pW').value=Math.round((node.width()||rect.width)*Math.abs(node.scaleX()));
        $('pH').value=Math.round((node.height()||rect.height)*Math.abs(node.scaleY()));
    }
    function refreshProps(){
        const node=state.selected;const on=!!node;
        $('noSelection').hidden=on;$('propPanel').hidden=!on;$('pagePanel').hidden=on;
        if(!node)return;
        const locked=!!node.getAttr('locked');
        $('objectEditing').inert=locked;$('objectEditing').classList.toggle('is-locked',locked);$('pName').disabled=locked;
        $('pText').disabled=locked;
        $('lockBtn').textContent=locked?'ปลดล็อกวัตถุ':'ล็อกวัตถุ';$('lockBtn').setAttribute('aria-pressed',String(locked));
        $('pName').value=node.name()||node.getClassName();
        $('pTextWrap').hidden=node.getClassName()!=='Text';
        $('pFontWrap').hidden=node.getClassName()!=='Text';
        $('pFillWrap').hidden=node.getClassName()==='Image';
        $('pImageWrap').hidden=node.getClassName()!=='Image';
        $('cropPanel').hidden=node.getClassName()!=='Image';$('textExtra').hidden=node.getClassName()!=='Text';
        $('borderPanel').hidden=node.getClassName()==='Text';$('cornerWrap').hidden=!['Image','Rect'].includes(node.getClassName());
        if(node.getClassName()!=='Text'){$('pStroke').value=node.stroke()||'#1e293b';$('pStrokeWidth').value=node.strokeWidth()||0;if(['Image','Rect'].includes(node.getClassName()))$('pCorner').value=node.cornerRadius()||0;}
        if(node.getClassName()==='Image'){refreshCropProps();$('cropRatio').value='current';}
        if(node.getClassName()==='Text'){
            $('pText').value=node.text();$('pFont').value=FONTS.includes(node.fontFamily())?node.fontFamily():'Prompt';$('pFontSize').value=Math.round(node.fontSize());$('pFontWeight').value=['normal','bold','italic','italic bold'].includes(node.fontStyle())?node.fontStyle():'normal';$('pAlign').value=node.align()||'left';
            $('pLineHeight').value=node.lineHeight();$('pLetterSpacing').value=node.letterSpacing()||0;$('pUnderline').checked=node.textDecoration()==='underline';
        }
        if(node.getClassName()!=='Image'){
            const color=node.getClassName()==='Line'?node.stroke():node.fill();
            if(/^#[0-9a-f]{6}$/i.test(color||'')){$('pFill').value=color;$('pFillHex').value=color;}
        }
        refreshPosition();
    }
    function updateAttr(id,apply){
        const element=$(id);
        element.addEventListener('input',()=>{if(!state.selected||state.selected.getAttr('locked')||state.restoring||state.exporting||state.loading||state.mutating)return;apply(state.selected,element.value);if(state.selected.getClassName()==='Image')applyCrop(state.selected);state.contentLayer.batchDraw();state.transformer.forceUpdate();refreshPosition();markDirty();});
        element.addEventListener('change',()=>{if(state.selected&&!state.selected.getAttr('locked'))record();});
    }
    function setFill(node,value){
        if(!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value))return;
        if(node.getClassName()==='Line')node.stroke(value);else node.fill(value);
    }
    function deleteSelected(){if(!state.selected||state.selected.getAttr('locked'))return;state.selected.destroy();select(null);record();}
    function duplicateSelected(){
        if(!state.selected||state.selected.getAttr('locked'))return;
        const copy=state.selected.clone({x:state.selected.x()+22,y:state.selected.y()+22,id:uid()});
        if(state.selected.getClassName()==='Image'){copy.image(state.selected.image());copy.setAttrs({imageId:state.selected.getAttr('imageId'),newsId:state.selected.getAttr('newsId')});}
        state.contentLayer.add(copy);select(copy);record();renderLayers();
    }

    async function saveLayout(){await saveNow();}
    async function openLayout(id,force=false){
        if(state.loading||state.saving||state.exporting||state.restoring||state.mutating)return;
        if(!force&&state.layout){
            if(Number(state.layout.id)===Number(id))return;
            if(state.dirty&&!await saveNow()){
                if(!state.conflict)return;
                if(!confirm('มีเวอร์ชันใหม่จากที่อื่นที่ยังไม่ได้โหลด ต้องการทิ้งการแก้ไขและเปิดชุดอื่นหรือไม่?'))return;
            }
        }
        state.loading=true;setBusy(true);
        try{
            const data=await request(api+'?action=detail&id='+encodeURIComponent(id));
            const pages=Array.isArray(data.data.document.pages)?data.data.document.pages:[];
            if(!pages.length)throw Error('ชุดจัดหน้าไม่มีหน้า');
            // Fetch dependencies before committing the new model: a failed pool
            // request must leave both the old document and its canvas intact.
            const pool=await fetchPool(pages);
            await prepareFonts(pages);
            state.layout={id:Number(data.data.id),title:data.data.title,version:Number(data.data.version)};
            const row=state.layouts.find(item=>Number(item.id)===Number(state.layout.id));
            if(row){row.title=state.layout.title;row.version=state.layout.version;row.page_count=pages.length;}
            state.pages=pages.map(page=>({...page,id:page.id||pageUid(),format:FORMATS[page.format]?page.format:'a4_portrait',bg:/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(page.bg||'')?page.bg:'#ffffff',elements:Array.isArray(page.elements)?page.elements:[],_hist:[],_hi:-1}));
            state.active=0;state.selected=null;state.dirty=false;state.conflict=false;state.owner=ownerId();state.imageFailures=new Set();state.autoFit=true;
            $('docName').value=state.layout.title;
            clearTimeout(state.saveTimer);
            setPool(pool);renderPool();
            await paintPage();fitPage();renderLayouts();renderPages();renderSave();if(!state.imageFailures.size)showMessage('');
        }catch(error){showMessage(error.message,true);renderLayouts();}
        finally{state.loading=false;setBusy(false);if(state.layout)fitSettled();}
    }
    async function createLayout(){
        if(state.loading||state.saving||state.creating||state.exporting||state.mutating)return;
        if(state.dirty&&!await saveNow())return;
        if(state.conflict)return;
        state.creating=true;
        try{
            const data=await request(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',title:'ชุดจัดหน้าใหม่',_expected_owner:ownerId()})});
            state.layouts.unshift({id:Number(data.id),title:data.title||'ชุดจัดหน้าใหม่',version:Number(data.version),page_count:1,updated_at:''});
            renderLayouts();await openLayout(data.id,true);toast('สร้างชุดจัดหน้าใหม่แล้ว');
        }catch(error){showMessage(error.message,true);}
        finally{state.creating=false;}
    }
    async function deleteLayout(){
        if(!state.layout||state.loading||state.saving||state.mutating||state.exporting||state.restoring)return;
        if(state.dirty&&!await saveNow())return;
        if(!confirm('ลบชุดจัดหน้านี้ถาวรหรือไม่? ข่าวและภาพต้นฉบับจะไม่ถูกลบ'))return;
        const deleted={...state.layout};let succeeded=false;
        state.mutating=true;setBusy(true);
        try{
            await request(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',id:deleted.id,version:deleted.version,title:deleted.title,_expected_owner:ownerId()})});
            state.layouts=state.layouts.filter(row=>Number(row.id)!==Number(deleted.id));
            if(Number(state.layout?.id)===Number(deleted.id))state.layout=null;
            succeeded=true;
        }catch(error){showMessage(error.message,true);}
        finally{state.mutating=false;setBusy(false);}
        if(succeeded){
            if(!state.layout){if(state.layouts.length)await openLayout(state.layouts[0].id,true);else await createLayout();}
            renderLayouts();toast('ลบชุดจัดหน้าแล้ว');
        }
    }

    async function checkReady(showSuccess=true){
        if(!state.layout||state.loading)return false;
        try{
            syncPage();
            const refs=[];
            for(const [index,page] of state.pages.entries())for(const element of page.elements||[])if(element.type==='Image')refs.push({page:index+1,newsId:Number(element.newsId),imageId:element.imageId});
            const ids=[...new Set(refs.map(ref=>ref.newsId))];
            if(ids.length){
                const rows=await fetchReferencedPool(ids);
                // Missing rows are revoked/deleted, not a reason to reuse cached approval.
                for(const id of ids)state.poolMap.delete(id);
                state.pool=state.pool.filter(item=>!ids.includes(Number(item.id)));
                mergePool(rows);renderPool();
            }
            const issues=[];
            for(const ref of refs){
                const news=state.poolMap.get(ref.newsId);
                if(!news)issues.push(`หน้า ${ref.page}: ข่าวของภาพไม่ได้ผ่านตรวจหรือถูกนำออกจากคลัง`);
                else if(!news.images.some(image=>image.id===ref.imageId))issues.push(`หน้า ${ref.page}: ภาพไม่อยู่ในข่าวเวอร์ชันที่ผ่านตรวจ`);
            }
            if(state.imageFailures.size)issues.push('ภาพบางภาพโหลดจากเซิร์ฟเวอร์ไม่ได้ กรุณารีเฟรชหน้าใหม่ก่อนส่งออก');
            if(issues.length){showMessage('ยังส่งออกไม่ได้',true,issues);return false;}
            if(showSuccess)showMessage('ทุกหน้าพร้อมส่งออก · ตรวจข้อความ ภาพ และขนาดหน้าก่อนเผยแพร่',false);
            return true;
        }catch(error){showMessage('ตรวจความพร้อมไม่สำเร็จ: '+error.message,true);return false;}
    }
    function safeName(){return ($('docName').value.trim()||'siya-news').replace(/[\\/:*?"<>|]+/g,'_').slice(0,80);}
    function download(filename,url){
        const link=document.createElement('a');link.href=url;link.download=filename;link.style.display='none';document.body.append(link);link.click();
        setTimeout(()=>{link.remove();if(url.startsWith('blob:'))URL.revokeObjectURL(url);},500);
    }
    function renderExport(){
        const {w,h}=dims();
        // Render in document coordinates, never in viewport/zoom coordinates.
        // Only artwork layers are copied; transformer, margins and snap guides
        // can never leak into the downloaded raster.
        const container=document.createElement('div');
        const stage=new K.Stage({container,width:w,height:h});
        try{
            stage.add(state.bgLayer.clone({listening:false}),state.contentLayer.clone({listening:false}));
            stage.draw();return stage.toDataURL({pixelRatio:2,mimeType:'image/png'});
        }finally{stage.destroy();}
    }
    async function exportPng(){
        if(state.loading||state.restoring||state.exporting||state.conflict||state.mutating||state.renderError)return;
        if(state.dirty&&!await saveNow())return;
        state.exporting=true;setBusy(true);
        try{
            syncPage();state.imageFailures=new Set();await paintPage();
            if(!await checkReady(false))return;
            state.selected=null;state.transformer.nodes([]);state.contentLayer.batchDraw();
            try{await document.fonts?.ready;}catch{}
            const url=renderExport();
            download(`${safeName()}-page-${state.active+1}.png`,url);toast('ส่งออก PNG แล้ว');
        }catch(error){showMessage('ส่งออก PNG ไม่สำเร็จ: '+error.message,true);}
        finally{state.exporting=false;setBusy(false);}
    }
    async function exportPdf(){
        if(state.loading||state.restoring||state.exporting||state.conflict||state.mutating||state.renderError)return;
        if(!JsPDF){showMessage('ไม่พบไลบรารี jsPDF ในระบบ',true);return;}
        if(state.dirty&&!await saveNow())return;
        syncPage();const old=state.active;state.exporting=true;setBusy(true);
        try{
            state.imageFailures=new Set();
            if(!await checkReady(false))return;
            try{await document.fonts?.ready;}catch{}
            let pdf=null;
            for(let index=0;index<state.pages.length;index++){
                state.active=index;await paintPage();
                // A later page can successfully retry the same image and clear
                // its global failure flag. Reject this page before committing
                // a placeholder raster to the PDF, not only after the loop.
                if(state.imageFailures.size)throw Error(`หน้า ${index+1}: ภาพบางภาพโหลดไม่ได้ กรุณากดลองแสดงหน้าใหม่และส่งออกอีกครั้ง`);
                const page=curr(),{w,h}=dims(page);
                const url=renderExport();
                if(!pdf)pdf=new JsPDF({unit:'px',format:[w,h],orientation:w>h?'landscape':'portrait',hotfixes:['px_scaling'],compress:true});
                else pdf.addPage([w,h],w>h?'landscape':'portrait');
                pdf.addImage(url,'PNG',0,0,w,h,undefined,'FAST');
            }
            if(state.imageFailures.size)throw Error('ภาพบางภาพโหลดไม่ได้ กรุณารีเฟรชหน้าและลองใหม่');
            pdf.save(`${safeName()}.pdf`);toast('ส่งออก PDF แล้ว');
        }catch(error){showMessage('ส่งออก PDF ไม่สำเร็จ: '+error.message,true);}
        finally{
            state.active=old;
            try{await paintPage();fitPage();}
            catch(error){setRenderError(true);showMessage('ไม่สามารถแสดงหน้าก่อนส่งออกได้: '+error.message+' · กดลองแสดงหน้าใหม่',true);}
            finally{state.exporting=false;setBusy(false);}
        }
    }

    async function openHistory(){
        if(!state.layout||state.loading)return;
        if(state.dirty&&!await saveNow())return;
        try{
            const data=await request(api+'?action=detail&id='+state.layout.id);const box=$('historyList');box.replaceChildren();
            for(const row of data.data.history){
                const item=document.createElement('div');item.className='st-history-row';
                const text=document.createElement('div');const strong=document.createElement('strong');strong.textContent='เวอร์ชัน '+Number(row.version)+(Number(row.version)===Number(state.layout.version)?' (ปัจจุบัน)':'');
                const small=document.createElement('small');small.textContent=`${row.actor_name||'สมาชิกเดิม'} · ${new Date(String(row.created_at).replace(' ','T')).toLocaleString('th-TH')}`;
                text.append(strong,small);item.append(text);
                if(Number(row.version)!==Number(state.layout.version)){const button=document.createElement('button');button.type='button';button.className='st-btn st-small';button.textContent='ย้อนกลับ';button.addEventListener('click',()=>restoreRevision(Number(row.version)));item.append(button);}
                box.append(item);
            }
            if(!box.children.length)box.append(Object.assign(document.createElement('p'),{className:'st-sub',textContent:'ยังไม่มีประวัติ'}));
            $('historyDialog').showModal();
        }catch(error){showMessage(error.message,true);}
    }
    async function restoreRevision(revision){
        if(!state.layout||state.mutating||state.loading||state.exporting||state.saving||state.restoring)return;
        if(!confirm(`ย้อนกลับไปเวอร์ชัน ${revision} หรือไม่? ระบบจะสร้างเวอร์ชันใหม่`))return;
        const target={...state.layout};state.mutating=true;setBusy(true);
        try{
            // Load the local family before a server-side restore can commit.
            // A font failure must not leave an already-restored receipt unapplied.
            await ensureFontFamily('Sarabun');
            const data=await request(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'restore',id:target.id,version:target.version,revision,_expected_owner:ownerId()})});
            state.layout.version=data.version;state.layout.title=data.title;state.pages=data.document.pages.map(page=>({...page,elements:page.elements||[],_hist:[],_hi:-1}));
            const row=state.layouts.find(item=>Number(item.id)===Number(state.layout.id));if(row){row.title=data.title;row.version=data.version;row.page_count=state.pages.length;}
            state.active=0;$('docName').value=data.title;state.dirty=false;state.conflict=false;state.imageFailures=new Set();
            await paintPage();fitPage();renderPages();renderLayouts();$('historyDialog').close();toast(`ย้อนกลับเป็นเวอร์ชัน ${revision} แล้ว`);
            try{await refreshPool();}catch(error){showMessage('ย้อนเวอร์ชันแล้ว แต่โหลดคลังข่าวไม่สำเร็จ: '+error.message,true);}
        }catch(error){showMessage(error.message,true);}
        finally{state.mutating=false;setBusy(false);renderSave();}
    }

    function bindUi(){
        root.addEventListener('click',event=>{
            if(state.loading||state.exporting||state.restoring||state.creating||state.mutating||
                (state.renderError&&!event.target.closest?.('#reloadBtn,#layoutSelect,#newLayout,#st-back'))){event.preventDefault();event.stopImmediatePropagation();}
        },true);
        document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>setTab(button.dataset.tab)));
        document.querySelectorAll('[data-text]').forEach(button=>button.addEventListener('click',()=>addText(button.dataset.text)));
        document.querySelectorAll('[data-shape]').forEach(button=>button.addEventListener('click',()=>addShape(button.dataset.shape)));
        document.querySelectorAll('[data-template]').forEach(button=>button.addEventListener('click',()=>applyTemplate(button.dataset.template)));
        document.querySelectorAll('[data-place]').forEach(button=>button.addEventListener('click',()=>alignSelected(button.dataset.place)));
        $('lockBtn').addEventListener('click',()=>toggleLock());
        updateAttr('pLineHeight',(node,value)=>node.lineHeight(clamp(Number(value)||1.25,.8,3)));
        updateAttr('pLetterSpacing',(node,value)=>node.letterSpacing(clamp(Number(value)||0,-20,100)));
        $('pUnderline').addEventListener('change',event=>{if(state.selected&&!state.selected.getAttr('locked')){state.selected.textDecoration(event.target.checked?'underline':'');record();state.contentLayer.batchDraw();}});
        updateAttr('pStroke',(node,value)=>node.stroke(value));
        updateAttr('pStrokeWidth',(node,value)=>{node.stroke(node.stroke()||$('pStroke').value);node.strokeWidth(clamp(Number(value)||0,node.getClassName()==='Line'?1:0,100));});
        updateAttr('pCorner',(node,value)=>node.cornerRadius(clamp(Number(value)||0,0,500)));
        for(const [id,key] of [['cropZoom','zoom'],['cropX','x'],['cropY','y']]){
            $(id).addEventListener('input',event=>{if(state.selected&&!state.selected.getAttr('locked')){updateCrop({[key]:Number(event.target.value)});markDirty();}});
            $(id).addEventListener('change',()=>record());
        }
        $('cropMode').addEventListener('change',event=>{
            const node=state.selected;if(!node||node.getClassName()!=='Image'||node.getAttr('locked'))return;
            state.cropMode=event.target.checked;
            if(state.cropMode){updateCrop({});record();}
            node.draggable(!state.cropMode);state.transformer.nodes(state.cropMode?[]:[node]);
            if(state.cropMode&&window.innerWidth<=1020){$('inspector').classList.remove('is-open');$('inspectorToggle').setAttribute('aria-expanded','false');toast('ลากภาพภายในกรอบ · ปิดโหมดครอปในปรับแต่ง');}
        });
        $('cropRatio').addEventListener('change',event=>{
            const node=state.selected;if(!node||node.getAttr('locked'))return;
            const value=event.target.value;if(value==='current'){updateCrop({});record();return;}
            const image=node.image(),ratio=value==='original'?(image.naturalWidth||image.width)/(image.naturalHeight||image.height):Number(value);
            node.height(clamp(node.width()*Math.abs(node.scaleX())/ratio/Math.abs(node.scaleY()),1,10000));
            updateCrop({x:.5,y:.5,zoom:1});record();refreshProps();state.transformer.forceUpdate();
        });
        $('cropReset').addEventListener('click',()=>{
            const node=state.selected;if(!node||node.getAttr('locked'))return;
            const image=node.image();node.height(clamp(node.width()*Math.abs(node.scaleX())*(image.naturalHeight||image.height)/(image.naturalWidth||image.width)/Math.abs(node.scaleY()),1,10000));
            node.setAttr('cropView',null);applyCrop(node);record();refreshProps();state.contentLayer.batchDraw();state.transformer.forceUpdate();
        });
        for(const id of ['safeMargin','showSafeMargin','snapToggle'])$(id).addEventListener('change',()=>{
            const page=curr();page.safeMargin=clamp(Number($('safeMargin').value)||0,0,200);page.showSafeMargin=$('showSafeMargin').checked;page.snap=$('snapToggle').checked;drawGuides();record();
        });
        $('blankBtn').addEventListener('click',()=>{if(editableNodes().length&&!confirm('ล้างองค์ประกอบทั้งหมดในหน้านี้หรือไม่?'))return;select(null);state.contentLayer.destroyChildren();const page=curr();if(page){page.bg='#ffffff';state.bgRect.fill(page.bg);state.bgLayer.batchDraw();}record();renderPages();updatePageLabel();});
        const swatches=$('swatches');for(const color of COLORS){const button=document.createElement('button');button.type='button';button.className='st-shape';button.style.background=color;button.title=color;button.addEventListener('click',()=>{if(state.selected?.getAttr('locked'))return;if(state.selected&&state.selected.getClassName()!=='Image'){setFill(state.selected,color);record();refreshProps();}else{setBackground(color);record();}});swatches.append(button);}
        $('newsSearch').addEventListener('input',renderPool);
        $('undoBtn').addEventListener('click',()=>undo(-1));$('redoBtn').addEventListener('click',()=>undo(1));
        $('zoomRange').addEventListener('input',event=>{state.autoFit=false;setZoom(Number(event.target.value)/100);});$('fitBtn').addEventListener('click',()=>{state.autoFit=true;fitPage();});
        $('formatSelect').addEventListener('change',event=>applyFormat(event.target.value));
        $('addPageBtn').addEventListener('click',addPage);$('duplicatePageBtn').addEventListener('click',duplicatePage);$('deletePageBtn').addEventListener('click',deletePage);
        $('deleteLayoutBtn').addEventListener('click',deleteLayout);$('newLayout').addEventListener('click',createLayout);
        $('layoutSelect').addEventListener('change',event=>{const id=Number(event.target.value);if(id)openLayout(id);});
        $('historyBtn').addEventListener('click',openHistory);$('historyClose').addEventListener('click',()=>$('historyDialog').close());
        $('checkBtn').addEventListener('click',()=>checkReady());$('exportPngBtn').addEventListener('click',()=>exportPng());
        $('exportPdfBtn').addEventListener('click',()=>exportPdf());
        $('reloadBtn').addEventListener('click',recoverLayout);
        $('sideClose').addEventListener('click',()=>$('side').classList.remove('is-open'));
        $('inspectorToggle').addEventListener('click',()=>{const open=$('inspector').classList.toggle('is-open');$('inspectorToggle').setAttribute('aria-expanded',String(open));});
        $('inspectorClose').addEventListener('click',()=>{$('inspector').classList.remove('is-open');$('inspectorToggle').setAttribute('aria-expanded','false');});
        $('docName').addEventListener('input',markDirty);
        $('pName').addEventListener('input',()=>{if(state.selected&&!state.selected.getAttr('locked')){state.selected.name($('pName').value);renderLayers();markDirty();}});$('pName').addEventListener('change',()=>{if(state.selected&&!state.selected.getAttr('locked'))record();});
        updateAttr('pText',(node,value)=>{if(node.getClassName()==='Text')node.text(value);});
        updateAttr('pX',(node,value)=>node.x(Number(value)||0));updateAttr('pY',(node,value)=>node.y(Number(value)||0));
        updateAttr('pRotation',(node,value)=>node.rotation(Number(value)||0));updateAttr('pOpacity',(node,value)=>node.opacity(Math.max(0,Math.min(1,(Number(value)||0)/100))));
        updateAttr('pW',(node,value)=>{const width=Math.max(node.getClassName()==='Text'?10:1,Number(value)||1);if(['Circle','Star','RegularPolygon','Line'].includes(node.getClassName()))node.scaleX(width/(node.width()||1));else{node.width(width);node.scaleX(1);}});
        updateAttr('pH',(node,value)=>{const height=Math.max(1,Number(value)||1);if(['Circle','Star','RegularPolygon','Line'].includes(node.getClassName()))node.scaleY(height/(node.height()||1));else{node.height(height);node.scaleY(1);if(node.getClassName()==='Text')node.setAttr('fixedHeight',true);}});
        updateAttr('pFill',(node,value)=>{setFill(node,value);$('pFillHex').value=value;});updateAttr('pFillHex',(node,value)=>{setFill(node,value);if(/^#[0-9a-f]{6}$/i.test(value))$('pFill').value=value;});
        $('pFont').addEventListener('change',async event=>{
            const control=event.currentTarget,node=state.selected,family=control.value,page=curr();
            if(!node||node.getAttr('locked')||node.getClassName()!=='Text'||!FONTS.includes(family))return;
            control.disabled=true;
            try{
                await ensureFontFamily(family);
                if(state.selected!==node||node.getAttr('locked')||curr()!==page||state.loading||state.exporting||state.mutating||state.restoring)return;
                if($('studio-message').textContent==='โหลดฟอนต์ Sarabun ไม่สำเร็จ กรุณาลองใหม่')showMessage('');
                node.fontFamily(family);state.transformer.forceUpdate();state.contentLayer.batchDraw();record();refreshProps();
            }catch(error){showMessage(error.message,true);refreshProps();}
            finally{control.disabled=false;}
        });
        updateAttr('pFontSize',(node,value)=>node.fontSize(Math.max(6,Number(value)||24)));updateAttr('pFontWeight',(node,value)=>node.fontStyle(value));updateAttr('pAlign',(node,value)=>node.align(value));
        $('deleteBtn').addEventListener('click',deleteSelected);$('duplicateBtn').addEventListener('click',duplicateSelected);
        $('frontBtn').addEventListener('click',()=>{if(state.selected&&!state.selected.getAttr('locked')){state.selected.moveUp();record();renderLayers();}});$('backBtn').addEventListener('click',()=>{if(state.selected&&!state.selected.getAttr('locked')){state.selected.moveDown();record();renderLayers();}});
        $('bgColor').addEventListener('input',event=>setBackground(event.target.value));$('bgColor').addEventListener('change',record);
        $('bgColorHex').addEventListener('change',event=>{if(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(event.target.value)){setBackground(event.target.value);record();}});
        $('bgColorSide').addEventListener('input',event=>setBackground(event.target.value));$('bgColorSide').addEventListener('change',record);
        $('bgColorSideHex').addEventListener('change',event=>{if(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(event.target.value)){setBackground(event.target.value);record();}});
        const keyHandler=event=>{
            if(document.hidden||state.loading||state.exporting||state.restoring||state.mutating||state.renderError)return;
            if(state.selected?.getAttr('locked')&&!((event.ctrlKey||event.metaKey)&&['s','z','y'].includes(event.key.toLowerCase())))return;
            if((event.composedPath?.()[0]||event.target).closest?.('input,textarea,select,[contenteditable]'))return;
            const mod=event.ctrlKey||event.metaKey;
            if(mod&&event.key.toLowerCase()==='z'){event.preventDefault();undo(event.shiftKey?1:-1);}
            else if(mod&&event.key.toLowerCase()==='y'){event.preventDefault();undo(1);}
            else if(mod&&event.key.toLowerCase()==='s'){event.preventDefault();saveNow();}
            else if(mod&&event.key.toLowerCase()==='d'){event.preventDefault();duplicateSelected();}
            else if((event.key==='Delete'||event.key==='Backspace')&&state.selected){event.preventDefault();deleteSelected();}
            else if(state.selected&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const step=event.shiftKey?10:1;state.selected.x(state.selected.x()+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0));state.selected.y(state.selected.y()+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0));state.contentLayer.batchDraw();refreshPosition();record();}
        };
        const resizeHandler=()=>{if(!state.stage)return;if(window.innerWidth>760)$('side').classList.remove('is-open');if(state.autoFit)fitPage();};
        const beforeUnloadHandler=event=>{if(state.dirty||state.saving||state.conflict||state.exporting||state.mutating){event.preventDefault();event.returnValue='';}};
        browserWindow.addEventListener('keydown',keyHandler);
        browserWindow.addEventListener('resize',resizeHandler);
        browserWindow.addEventListener('beforeunload',beforeUnloadHandler);
        window.addEventListener('eoffice:module-dispose',()=>{
            browserWindow.removeEventListener('keydown',keyHandler);browserWindow.removeEventListener('resize',resizeHandler);browserWindow.removeEventListener('beforeunload',beforeUnloadHandler);
            browserWindow.document.querySelectorAll('[data-studio-overlay]').forEach(element=>element.remove());
            try{state.stage?.destroy();}catch{}
            state.stage=null;
        });
        window.eofficeRegisterModuleChanges?.(()=>state.dirty||state.saving||state.conflict||state.exporting||state.mutating);
    }
    function setTab(tab){
        document.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('is-active',button.dataset.tab===tab));
        document.querySelectorAll('.st-panel').forEach(panel=>panel.classList.toggle('is-active',panel.id==='tab-'+tab));
        if(tab==='layers')renderLayers();
        if(tab==='pages')updatePageLabel();
        if(window.innerWidth<=760)$('side').classList.add('is-open');
    }
    function closeSideOnMobile(){if(window.innerWidth<=760)$('side').classList.remove('is-open');}

    (async()=>{
        if(window.eofficeSessionState?.status==='pending')await new Promise(resolve=>window.addEventListener('eoffice:session-updated',function done(event){if(event.detail?.status!=='pending'){window.removeEventListener('eoffice:session-updated',done);resolve();}}));
        if(!window.eofficeUser){showMessage('กรุณาเข้าสู่ระบบด้วยบัญชีผู้จัดทำวารสาร',true);return;}
        if(!window.eofficeUser.permissions?.includes('news_producer')){showMessage('Admin ต้องมอบสิทธิ์ผู้จัดทำวารสารก่อนใช้ Studio',true);return;}
        state.owner=ownerId();state.pages=[newPage('a4_portrait')];state.active=0;
        initFormats();initStage();renderPages();updatePageLabel();bindUi();
        try{document.fonts?.ready.then(()=>{state.contentLayer?.batchDraw();});}catch{}
        try{
            const data=await request(api+'?action=list');state.layouts=data.data;renderLayouts();
            if(!state.layouts.length)await createLayout();else await openLayout(state.layouts[0].id,true);
        }catch(error){showMessage('โหลด Studio ไม่สำเร็จ: '+error.message,true);}
        state.ready=true;renderSave();
    })().catch(()=>{if($('fatal'))$('fatal').hidden=false;});
})();
