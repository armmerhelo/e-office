(() => {
    const states = new WeakMap();
    const snapshot = form => JSON.stringify([...form.elements].map(node => [node.id || node.name, node.type,
        node.type === 'file' ? [...node.files].map(file => [file.name,file.size,file.lastModified]) : node.value, node.checked]));
    const stateFor = form => {
        if (!states.has(form)) {
            const state = {revision:0,generation:0,busy:false,newDraft:false,early:new Map(),earlyFile:false,leavingConfirmed:false,before:new WeakMap()};states.set(form,state);
            const capture = event => {
                if (!form.dataset.eofficeDraftState) state.before.set(event,JSON.parse(window.eofficeDraftCommits.signature(form)));
            };
            const edited = event => {
                if (form.dataset.eofficeDraftRestoring === 'true') return;
                if (event.detail?.replayed) return;
                state.revision++;state.leavingConfirmed=false;
                if (form.dataset.eofficeDraftState) return;
                const previous=new Map((state.before.get(event)||[]).map(field=>[field.id,field]));
                const nodes=[...form.elements].filter(node=>['INPUT','TEXTAREA','SELECT'].includes(node.tagName) &&
                    (node.id||node.name) && !['password','hidden','file','submit','button'].includes(node.type));
                const target=event.target;
                if (target?.type==='file' && target.files?.length) state.earlyFile=true;
                JSON.parse(window.eofficeDraftCommits.signature(form)).forEach((field,index)=>{
                    const node=nodes[index];
                    if (event.type==='change' && node.dataset.draftClearWhen===target?.id && node.dataset.draftClearWhen &&
                        (target.type==='checkbox'?!target.checked:target.value!==node.dataset.draftActiveValue)) {
                        state.early.set(field.id,{...field,value:''});return;
                    }
                    if (node.dataset.draftComposed && node!==target) {
                        if (target?.id===node.dataset.draftComposed && target.checked===false) state.early.set(field.id,field);
                        return;
                    }
                    if (node===target || (target?.type==='radio' && node.type==='radio' && node.name===target.name) ||
                        (previous.has(field.id) && previous.get(field.id).value!==field.value)) state.early.set(field.id,field);
                });
                state.before.delete(event);
            };
            form.addEventListener('input',capture,true);form.addEventListener('change',capture,true);
            window.addEventListener?.('beforeunload',event=>{
                if (!state.leavingConfirmed && !form.dataset.eofficeDraftState && (state.early.size || state.earlyFile)) {event.preventDefault();event.returnValue='';}
            });
            window.addEventListener?.('eoffice:leaving-confirmed',()=>{state.leavingConfirmed=true;});
            window.addEventListener?.('eoffice:leaving-cancelled',()=>{state.leavingConfirmed=false;});
            window.addEventListener?.('pageshow',()=>{state.leavingConfirmed=false;});
            form.addEventListener('submit',event=>{
                if (form.dataset.eofficeRequiresDraft==='true' && form.dataset.eofficeDraftInitialized!=='true' && form.dataset.eofficeDraftState!=='unavailable') {
                    event.preventDefault();event.stopImmediatePropagation();
                    window.alert?.('กำลังเตรียมร่างของฟอร์ม กรุณารอสักครู่ก่อนส่งข้อมูล');
                }
            },true);
            form.addEventListener('input',edited);form.addEventListener('change',edited);
            form.addEventListener('eoffice:form-dirty',edited);
            form.addEventListener('reset',() => {
                state.generation++;state.revision++;
                state.newDraft=true;
                state.early.clear();
                state.earlyFile=false;
                if (!form.dataset.eofficeDraftState) form.dataset.eofficeDraftResetBeforeReady='true';
            });
            // HTML keeps controls inert until these early-edit listeners exist.
            const bootstrap=form.querySelector?.('fieldset[data-eoffice-bootstrap]');
            if (bootstrap?.tagName==='FIELDSET') bootstrap.disabled=false;
        }
        return states.get(form);
    };
    window.eofficeCreateFormLifecycle = {
        busy(form) {return stateFor(form).busy;},
        takeEarlyEdits(form) {
            const state=stateFor(form),fields=[...state.early.values()];state.early.clear();return fields;
        },
        begin(form) {
            const state = stateFor(form);
            if (state.busy) return null;
            const currentOwner = window.eofficeFormOwner.capture();
            if (!currentOwner) return null;
            if (form.dataset.eofficeRequiresDraft==='true' && form.dataset.eofficeDraftInitialized!=='true' && form.dataset.eofficeDraftState!=='unavailable') {
                window.alert?.('กำลังเตรียมร่างของฟอร์ม กรุณารอสักครู่ก่อนส่งข้อมูล');return null;
            }
            if (!form.dataset.eofficeDraftEditor) form.dataset.eofficeDraftEditor=window.eofficeDraftCommits.claimEditor(currentOwner,location.pathname,form.id);
            if (!window.eofficeDraftCommits.usableEditor(currentOwner,location.pathname,form.id,form.dataset.eofficeDraftEditor)) {
                window.alert?.('มีหน้าแก้ไขร่างใหม่กว่า กรุณาโหลดหน้าใหม่ก่อนส่งข้อมูล');return null;
            }
            if (form.dataset.eofficeDraftVersion && !window.eofficeDraftCommits.usableVersion(currentOwner,location.pathname,form.id,form.dataset.eofficeDraftVersion)) {
                window.alert?.('มีร่างใหม่กว่าของฟอร์มนี้ กรุณาโหลดหน้าใหม่ก่อนส่งข้อมูล');return null;
            }
            const draftSignature = window.eofficeDraftCommits.signature(form);
            const draftVersion = window.eofficeDraftCommits.version(currentOwner,location.pathname,form.id,state.newDraft?window.eofficeDraftCommits.newVersion():form.dataset.eofficeDraftVersion);
            state.newDraft=false;
            form.dataset.eofficeDraftVersion=draftVersion;
            if (window.eofficeDraftCommits.matches(currentOwner,location.pathname,form.id,draftSignature,draftVersion)) {
                window.alert?.('ข้อมูลชุดนี้บันทึกสำเร็จแล้ว กรุณาตรวจรายการก่อนส่งซ้ำ หรือล้างฟอร์มเพื่อเริ่มคำขอใหม่');return null;
            }
            const token = {form,revision:state.revision,generation:state.generation,owner:currentOwner,values:snapshot(form),
                draftSignature,draftVersion,editor:form.dataset.eofficeDraftEditor,path:location.pathname,
                controls:[...form.elements].map(node => [node,node.disabled])};
            state.busy = true;
            for (const [node] of token.controls) node.disabled = true;
            return token;
        },
        unchanged(token) {
            const state = stateFor(token.form);
            return state.revision === token.revision && state.generation === token.generation &&
                window.eofficeDraftCommits.usableEditor(token.owner,token.path,token.form.id,token.editor) &&
                window.eofficeDraftCommits.usableVersion(token.owner,token.path,token.form.id,token.draftVersion) &&
                window.eofficeFormOwner.matches(token.owner) && snapshot(token.form) === token.values;
        },
        async applyCommitted(token, apply) {
            let applied = false;
            await window.eofficeFormOwner.applyVerified(token.owner, {
                target:token.form,cancelled:() => stateFor(token.form).generation !== token.generation
            }, () => {
                if (this.unchanged(token)) {apply();applied=true;}
            });
            return applied;
        },
        recordCommitted(token,result) {
            const stored=window.eofficeDraftCommits.record(token.owner,token.path,token.form.id,token.draftSignature,result.id,token.draftVersion,token.editor);
            token.form.dispatchEvent(new CustomEvent('eoffice:form-committed', {detail:{owner:token.owner,signature:token.draftSignature,version:token.draftVersion}}));
            if (!stored) window.alert?.('ข้อมูลบันทึกสำเร็จแล้ว แต่เก็บสถานะกันส่งซ้ำในแท็บนี้ไม่ได้ กรุณาตรวจรายการก่อนโหลดหน้าใหม่หรือส่งซ้ำ');
        },
        end(token) {
            stateFor(token.form).busy = false;
            for (const [node,disabled] of token.controls) node.disabled = disabled;
        }
    };
    for (const id of ['maintenanceForm','bookingForm']) {
        const form = document.getElementById(id);
        if (form) stateFor(form);
    }
})();
