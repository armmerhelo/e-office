const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const StampRenderQueue = require('../assets/stamp-render-queue.js');
const source = fs.readFileSync('e-sign/e-sign.php', 'utf8');
const validation = source.slice(source.indexOf('        function hasVisibleSignature() {'), source.indexOf('        // UPDATE: Function to Save to Server'));
const save = source.slice(source.indexOf('        async function saveToServer() {'), source.indexOf('        async function downloadDocument() {')).replace(/<\?=.*?\?>/g, '1');
const pen = {tool:'pen', points:[{x:1,y:1},{x:2,y:2}]};

(async () => {
    for (const [name, actions, alpha, expected] of [
        ['untouched PDF', [], 0, false],
        ['Undo all ink', [], 0, false],
        ['eraser only', [{tool:'eraser'}], 0, false],
        ['single pen tap', [{tool:'pen',points:[{x:1,y:1}]}], 0, false],
        ['stationary pen', [{tool:'pen',points:[{x:1,y:1},{x:1,y:1}]}], 0, false],
        ['fully erased ink', [pen,{tool:'eraser'}], 0, false],
        ['visible pen', [pen], 255, true],
        ['visible stamp', [{tool:'stamp'}], 255, true],
        ['invisible stamp', [{tool:'stamp'}], 0, false],
    ]) {
        const writes = [], messages = [];
        const context = vm.createContext({
            document: {getElementById: () => ({width:1,height:1,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray([0,0,0,alpha])})})})},
            history: {1:actions}, StampRenderQueue,
            FormData: class {constructor(){this.fields=new Map();}append(key,value){this.fields.set(key,value);}}, getCookie:()=>'',
            generatePDFBlob:async()=> 'pdf',
            fetch:async (...args)=>{writes.push(args);return {ok:true,json:async()=>({status:'success'})};},
            showLoading(){},showToast:message=>messages.push(message),console:{log(){},error(){}},
        });
        vm.runInContext(`let currentPDF=true,savingDocument=false,isDrawing=false,documentHistory=history,documentRevision='old';const stampRenderQueue=new StampRenderQueue();${validation}\n${save}`,context);
        await context.saveToServer();
        assert.equal(writes.length,expected?1:0,name);
        if (expected) assert.equal(writes[0][1].body.fields.get('confirm_signature'),'1',name);
        if (!expected) assert.ok(messages.some(message=>message.includes('กรุณาลงนาม')),name);
    }
    console.log('PASS signing presence: untouched PDF, Undo, eraser, stationary pen and blank layers cannot complete signing; visible pen/stamp can save');
})().catch(error=>{console.error(error);process.exitCode=1;});
