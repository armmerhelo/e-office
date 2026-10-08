const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const StampRenderQueue=require('../assets/stamp-render-queue.js');
const source=fs.readFileSync('e-sign/e-sign.php','utf8');
const save=source.slice(source.indexOf('        async function saveToServer() {'),source.indexOf('        async function downloadDocument() {')).replace(/<\?=.*?\?>/g,'1');
const undo=source.slice(source.indexOf('        function undoLastAction() {'),source.indexOf('        function redrawCanvas(pageNum'));
const drawing=source.slice(source.indexOf('        function setupDrawingEvents(canvas, pageNum) {'),source.indexOf('        function undoLastAction() {'));
const redraw=source.slice(source.indexOf('        function redrawCanvas(pageNum'),source.indexOf('        // --- 5. SAVE & DOWNLOAD ---'));
const scopesSource=source.slice(source.indexOf('        async function loadReceiptScopes() {'),source.indexOf('        // --- 2. INITIALIZATION ---')).replace(/<\?=.*?\?>/g,'1');
const history={};let writes=[],fail=false,release,delay=false,consent=true,scopes=['กลุ่มบริหารวิชาการ'],scopeFailure=false,scopeReads=0,acknowledge=true;
const context={history,console:{log(){},error(){}},FormData:class {constructor(){this.data={};}append(key,value){this.data[key]=value;}},
    generatePDFBlob:async()=>{if(delay)await new Promise(resolve=>{release=resolve;});return 'pdf';},
    fetch:async(url,options)=>{
        if(url.startsWith('receipt_scopes.php')) {
            scopeReads++;assert.equal(options.cache,'no-store');
            if(scopeFailure) throw Error('scope network failure');
            return {ok:true,json:async()=>({status:'success',departments:scopes})};
        }
        writes.push(options.body.data);
        return {ok:!fail,status:500,json:async()=>({status:'success',revision:'next',auto_sent_user_ids:[3],registered_receipt_departments:acknowledge?JSON.parse(options.body.data.receipt_departments):[]})};
    },
    showLoading(){},showToast(){},redrawCanvas(page,actions){history[page]=actions;return Promise.resolve(true);},getCookie(){return '';},setTimeout,StampRenderQueue,confirm:()=>consent};
vm.createContext(context);
vm.runInContext(`let currentPDF=true,isDrawing=false,savingDocument=false,documentHistory=history,documentRevision='old';const stampRenderQueue=new StampRenderQueue();this.queue=stampRenderQueue;\n${scopesSource}\n${save}\n${undo}\nthis.save=saveToServer;this.undo=undoLastAction;`,context);
async function run(){
    history[1]=[{tool:'pen'},{tool:'stamp',department:'กลุ่มบริหารวิชาการ',saved:false}];
    context.undo();await context.save();assert.deepEqual(JSON.parse(writes.at(-1).receipt_departments),[]);
    console.log('PASS undoing a stamp before saving leaves no automatic routing metadata');
    const stamp={tool:'stamp',department:'กลุ่มบริหารวิชาการ',saved:false};
    history[1].push(stamp,{tool:'stamp',department:'กลุ่มบริหารวิชาการ',saved:false},{tool:'stamp',department:'',saved:false});
    fail=true;await context.save();assert.equal(stamp.saved,false);
    console.log('PASS failed PDF saves retain unsent stamps for retry');
    fail=false;await context.save();assert.deepEqual(JSON.parse(writes.at(-1).receipt_departments),['กลุ่มบริหารวิชาการ']);assert.equal(stamp.saved,true);
    assert.equal(writes.at(-1).confirm_receipt,'1');assert.equal(writes.at(-1).stamp_departments,undefined);
    await context.save();assert.deepEqual(JSON.parse(writes.at(-1).receipt_departments),[]);
    console.log('PASS only new named department stamps route; repeated PDF saves do not route them again');
    delay=true;const pending=context.save();await Promise.resolve();const count=history[1].length;
    context.undo();assert.equal(history[1].length,count);await context.save();const previous=writes.length;release();await pending;
    assert.equal(writes.length,previous+1);
    console.log('PASS saving blocks duplicate submissions and undo until the PDF save finishes');
    delay=false;
    let render;
    context.queue.add(()=>new Promise(resolve=>{render=()=>{history[1].push({tool:'stamp',department:'กลุ่มบริหารวิชาการ',saved:false});resolve();};}));
    await Promise.resolve();const countBefore=writes.length;const waiting=context.save();await Promise.resolve();await Promise.resolve();
    assert.equal(writes.length,countBefore);render();await waiting;
    assert.equal(writes.length,countBefore+1);assert.deepEqual(JSON.parse(writes.at(-1).receipt_departments),['กลุ่มบริหารวิชาการ']);
    console.log('PASS immediate save waits for pending stamp rendering before capturing the PDF and receipt');
    context.queue.add(()=>Promise.reject(Error('decode failure')));await context.save();assert.equal(writes.length,countBefore+1);
    console.log('PASS image decoding failure blocks upload instead of silently dropping the stamp');
    history[1].push({tool:'stamp',department:'กลุ่มบริหารวิชาการ',saved:false});consent=false;await context.save();assert.equal(writes.length,countBefore+1);
    console.log('PASS declining the explicit receipt confirmation does not upload or auto-send');
    consent=true;
    const images=[],events={};let painted=false;
    context.Image=class {constructor(){images.push(this);}naturalWidth=400;naturalHeight=200;};
    context.clearTimeout=clearTimeout;
    context.canvas={width:1000,height:1000,getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000}),getContext:()=>({drawImage(){painted=true;}}),addEventListener:(name,handler)=>{events[name]=handler;}};
    vm.runInContext(`let currentTool='stamp',currentStampDepartment='กลุ่มบริหารวิชาการ',scale=2.5;const CONFIG={STAMP_URL:'data:image/png;base64,test'};${drawing};setupDrawingEvents(canvas,1);`,context);
    events.mousedown({clientX:200,clientY:200});await Promise.resolve();
    const beforeDrawingSave=writes.length;const pendingDrawingSave=context.save();await Promise.resolve();await Promise.resolve();
    assert.equal(writes.length,beforeDrawingSave);assert.equal(painted,false);
    images[0].onload();await pendingDrawingSave;
    assert.equal(painted,true);assert.equal(writes.length,beforeDrawingSave+1);
    assert.deepEqual(JSON.parse(writes.at(-1).receipt_departments),['กลุ่มบริหารวิชาการ']);
    console.log('PASS actual stamp image onload paints and records the stamp even while save waits');
    history[1]=[{tool:'stamp',department:'กลุ่มบริหารวิชาการ',saved:false,receiptRegistered:false}];
    scopes=[];await context.save();
    assert.deepEqual(JSON.parse(writes.at(-1).receipt_departments),[]);
    assert.equal(history[1][0].saved,true);assert.equal(history[1][0].receiptRegistered,false);
    const readsBefore=scopeReads;scopes=['กลุ่มบริหารวิชาการ'];await context.save();
    assert.equal(scopeReads,readsBefore+1);assert.deepEqual(JSON.parse(writes.at(-1).receipt_departments),scopes);
    assert.equal(history[1][0].receiptRegistered,true);
    await context.save();assert.deepEqual(JSON.parse(writes.at(-1).receipt_departments),[]);
    console.log('PASS new secretary assignment registers previously saved stamps without repeating confirmed receipts');
    history[1]=[{tool:'stamp',department:'กลุ่มบริหารวิชาการ',saved:false,receiptRegistered:false}];
    scopes=[];await context.save();assert.deepEqual(JSON.parse(writes.at(-1).receipt_departments),[]);
    assert.equal(history[1][0].saved,true);assert.equal(history[1][0].receiptRegistered,false);
    console.log('PASS revoked scopes are refreshed and allow PDF saving without an unauthorized receipt');
    history[1]=[{tool:'stamp',department:'กลุ่มบริหารวิชาการ',saved:false,receiptRegistered:false},{tool:'pen',points:[{x:10,y:20}]}];
    scopes=['กลุ่มบริหารวิชาการ'];scopeFailure=true;const countBeforeFailure=writes.length;
    await context.save();assert.equal(writes.length,countBeforeFailure);assert.equal(history[1].length,2);assert.equal(history[1][0].saved,false);assert.equal(history[1][0].receiptRegistered,false);
    assert.deepEqual(history[1][1].points,[{x:10,y:20}]);
    scopeFailure=false;await context.save();assert.equal(writes.length,countBeforeFailure+1);assert.equal(history[1][0].receiptRegistered,true);
    console.log('PASS scope loading failure retries on the next Save without losing annotations or reloading');
    history[1]=[{tool:'stamp',department:'กลุ่มบริหารวิชาการ',saved:false,receiptRegistered:false}];
    acknowledge=false;await context.save();assert.equal(history[1][0].saved,true);assert.equal(history[1][0].receiptRegistered,false);
    acknowledge=true;await context.save();assert.equal(history[1][0].receiptRegistered,true);
    console.log('PASS only server-confirmed registration completes a pending receipt');
    // Run the actual redraw rather than the earlier focused tests' mock.
    function makeCanvas(marks=[]) {
        const canvas={width:1000,height:1000,marks:[...marks]};
        const ctx={clearRect(){canvas.marks=[];},drawImage(image){
            if(image.marks)canvas.marks.push(...image.marks);
            else {assert.equal(image.decoded,true,'stamp cannot be painted before decoding');canvas.marks.push('stamp');}
        },beginPath(){},moveTo(){},quadraticCurveTo(){},stroke(){canvas.marks.push('pen');},closePath(){}};
        canvas.getContext=()=>ctx;return canvas;
    }
    context.document={getElementById:()=>context.canvas,createElement:()=>makeCanvas()};
    const redrawImages=[];
    context.Image=class {constructor(){redrawImages.push(this);}};
    let captured;
    context.generatePDFBlob=async()=>{captured=[...context.canvas.marks];return 'pdf';};
    vm.runInContext(`${redraw}`,context);
    const receiptStamp=()=>({tool:'stamp',department:'กลุ่มบริหารวิชาการ',src:'stamp-data',x:10,y:10,w:100,h:50,saved:false,receiptRegistered:false});
    const pen=()=>({tool:'pen',points:[{x:10,y:20},{x:20,y:30}],width:2,color:'#000000'});
    history[1]=[receiptStamp(),pen()];context.canvas=makeCanvas(['stamp','pen']);
    context.undo();await Promise.resolve();
    const beforeUndoSave=writes.length;const saveAfterUndo=context.save();await Promise.resolve();await Promise.resolve();
    assert.equal(writes.length,beforeUndoSave);assert.deepEqual(context.canvas.marks,['stamp','pen']);assert.equal(history[1].length,2);
    redrawImages.at(-1).decoded=true;redrawImages.at(-1).onload();await saveAfterUndo;
    assert.deepEqual(captured,['stamp']);assert.equal(history[1].length,1);
    assert.deepEqual(JSON.parse(writes.at(-1).receipt_departments),['กลุ่มบริหารวิชาการ']);
    console.log('PASS stamp -> pen -> Undo -> immediate Save waits for actual redraw and captures the surviving stamp');
    history[1]=[receiptStamp(),pen()];context.canvas=makeCanvas(['stamp','pen']);
    context.undo();await Promise.resolve();const failureCount=writes.length;
    const failedRedrawSave=context.save();redrawImages.at(-1).onerror();await failedRedrawSave;
    assert.equal(writes.length,failureCount);assert.equal(history[1].length,2);assert.deepEqual(context.canvas.marks,['stamp','pen']);
    context.undo();await Promise.resolve();const retryRedrawSave=context.save();
    redrawImages.at(-1).decoded=true;redrawImages.at(-1).onload();await retryRedrawSave;
    assert.equal(writes.length,failureCount+1);assert.deepEqual(captured,['stamp']);assert.equal(history[1].length,1);
    console.log('PASS failed Undo image decode preserves canvas/history and a retry successfully redraws before saving');
    history[1]=[receiptStamp(),pen()];context.canvas=makeCanvas(['stamp','pen']);
    context.undo();await Promise.resolve();const staleImage=redrawImages.at(-1);
    const replacement=makeCanvas(['new-document']);context.canvas=replacement;
    vm.runInContext('documentHistory = {};',context);
    staleImage.decoded=true;staleImage.onload();await context.queue.wait();
    assert.deepEqual(replacement.marks,['new-document']);assert.equal(history[1].length,2);
    console.log('PASS a redraw completing after document replacement cannot overwrite the new page or history');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
