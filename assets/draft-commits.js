(() => {
    const memory = new Map();
    const memoryOnly = new Set();
    const versions = new Map();
    const editors = new Map();
    const unpersisted = new Set();
    const failedBaseline = new Map();
    const failedEditorAuthority = new Map();
    const failedVersionAuthority = new Map();
    const markerKey = (owner,path,id) => `eoffice-committed:${owner}:${path}:${id}`;
    const draftKey = (owner,path,id) => `eoffice-draft:${owner}:${path}:${id}`;
    const versionKey = (owner,path,id) => `eoffice-draft-version:${owner}:${path}:${id}`;
    const editorKey = (owner,path,id) => `eoffice-draft-editor:${owner}:${path}:${id}`;
    const writeIdentity = (key,value,cache) => {
        cache.set(key,value);
        try {sessionStorage.setItem(key,value);unpersisted.delete(key);failedBaseline.delete(key);} catch {
            unpersisted.add(key);
            try {failedBaseline.set(key,sessionStorage.getItem(key));} catch {failedBaseline.delete(key);}
        }
        return value;
    };
    const currentIdentity = (key,value,cache) => {
        try {
            const saved=sessionStorage.getItem(key);
            return (saved || (unpersisted.has(key) ? cache.get(key) : null)) === value;
        } catch {return cache.get(key) === value;}
    };
    const usableIdentity = (key,value,cache) => {
        try {
            const saved=sessionStorage.getItem(key);
            return saved === value || (unpersisted.has(key) && cache.get(key) === value && saved === failedBaseline.get(key));
        } catch {return cache.get(key) === value;}
    };
    const read = key => {
        try {
            const marker = JSON.parse(sessionStorage.getItem(key) || 'null');
            if (memoryOnly.has(key)) {
                const remembered=memory.get(key);
                const editorSlot=key.replace(/^eoffice-committed:/,'eoffice-draft-editor:');
                if (!remembered?.editor || usableIdentity(editorSlot,remembered.editor,editors)) return remembered;
            }
            return marker && typeof marker.signature === 'string' ? marker : null;
        } catch {return memory.get(key) || null;}
    };
    const editorAuthority = (owner,path,id) => {
        const slot=editorKey(owner,path,id);
        try {
            const persisted=sessionStorage.getItem(slot);
            const marker=JSON.parse(sessionStorage.getItem(markerKey(owner,path,id)) || 'null');
            if (marker?.editor && marker.replacesEditor === persisted) return marker.editor;
            return persisted;
        } catch {return editors.get(slot) || null;}
    };
    const versionAuthority = (owner,path,id) => {
        const slot=versionKey(owner,path,id);
        try {
            const persisted=sessionStorage.getItem(slot);
            const marker=JSON.parse(sessionStorage.getItem(markerKey(owner,path,id)) || 'null');
            if (marker?.version && marker.replacesVersion === persisted) return marker.version;
            return persisted;
        } catch {return versions.get(slot) || null;}
    };
    const matchesStoredDraft = (key,signature) => {
        try {return JSON.stringify(JSON.parse(sessionStorage.getItem(key) || 'null')) === signature;} catch {return false;}
    };
    window.eofficeDraftCommits = Object.freeze({
        newVersion() {return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;},
        stageVersion(owner,path,id,value) {
            const slot=versionKey(owner,path,id);versions.set(slot,value);unpersisted.add(slot);
            failedVersionAuthority.set(slot,versionAuthority(owner,path,id));
            try {failedBaseline.set(slot,sessionStorage.getItem(slot));} catch {failedBaseline.delete(slot);}
            return value;
        },
        version(owner,path,id,replacement) {
            const key=versionKey(owner,path,id);
            const previous=versionAuthority(owner,path,id);
            let value=replacement;
            if (!value) value=versionAuthority(owner,path,id);
            if (!value) value=versions.get(key);
            if (!value) value=this.newVersion();
            const localEditor=editors.get(editorKey(owner,path,id));
            if (localEditor && !this.currentEditor(owner,path,id,localEditor) && this.usableEditor(owner,path,id,localEditor)) return this.stageVersion(owner,path,id,value);
            const result=writeIdentity(key,value,versions);
            if (unpersisted.has(key)) failedVersionAuthority.set(key,previous);
            else failedVersionAuthority.delete(key);
            return result;
        },
        current(owner,path,id,version) {
            const authority=versionAuthority(owner,path,id);
            if (authority) return authority === version;
            return currentIdentity(versionKey(owner,path,id),version,versions);
        },
        usableVersion(owner,path,id,version) {
            const slot=versionKey(owner,path,id),authority=versionAuthority(owner,path,id);
            return this.current(owner,path,id,version) ||
                (unpersisted.has(slot) && versions.get(slot)===version && authority===failedVersionAuthority.get(slot) && usableIdentity(slot,version,versions));
        },
        claimEditor(owner,path,id) {
            const slot=editorKey(owner,path,id),previous=editorAuthority(owner,path,id);
            const editor=writeIdentity(slot,this.newVersion(),editors);
            if (unpersisted.has(slot)) failedEditorAuthority.set(slot,previous);
            else failedEditorAuthority.delete(slot);
            return editor;
        },
        currentEditor(owner,path,id,editor) {
            const slot=editorKey(owner,path,id),authority=editorAuthority(owner,path,id);
            if (authority) return authority === editor;
            return currentIdentity(slot,editor,editors);
        },
        usableEditor(owner,path,id,editor) {
            // A failed claim may still submit to the API, but cannot write/delete
            // a previous editor's draft. A subsequent successful claim revokes it.
            const slot=editorKey(owner,path,id),authority=editorAuthority(owner,path,id);
            return this.currentEditor(owner,path,id,editor) ||
                (unpersisted.has(slot) && editors.get(slot)===editor && authority===failedEditorAuthority.get(slot) && usableIdentity(slot,editor,editors));
        },
        // Same field schema as module-drafts; excludes secrets and file bytes.
        signature(form) {
            const fields = [...form.elements].filter(node => ['INPUT','TEXTAREA','SELECT'].includes(node.tagName) &&
                (node.id || node.name) && !['password','hidden','file','submit','button'].includes(node.type));
            return JSON.stringify(fields.map((node,index) => ({id:node.id || `${node.name}:${index}`,type:node.type,
                value:['checkbox','radio'].includes(node.type) ? node.checked : node.value})));
        },
        matches(owner,path,id,signature,version) {
            const marker=read(markerKey(owner,path,id));
            return marker?.signature === signature && marker.version === version;
        },
        record(owner,path,id,signature,requestId,version,editor) {
            const key = markerKey(owner,path,id);
            if (!this.usableVersion(owner,path,id,version)) return true; // A newer draft owns this slot now.
            const previous=read(key);
            if (previous?.editor && previous.editor !== editor && !this.usableEditor(owner,path,id,editor)) return true;
            const marker = {signature,requestId,version,editor};
            try {
                const persisted=sessionStorage.getItem(editorKey(owner,path,id));
                const editorSlot=editorKey(owner,path,id);
                if (persisted !== editor && unpersisted.has(editorSlot) && editors.get(editorSlot)===editor &&
                    editorAuthority(owner,path,id)===failedEditorAuthority.get(editorSlot) && usableIdentity(editorSlot,editor,editors)) marker.replacesEditor=persisted;
                const persistedVersion=sessionStorage.getItem(versionKey(owner,path,id));
                if (persistedVersion !== version && this.usableVersion(owner,path,id,version) && this.usableEditor(owner,path,id,editor)) marker.replacesVersion=persistedVersion;
            } catch { /* No cross-document authority is available while storage is blocked. */ }
            memory.set(key,marker);
            try {
                if (!sessionStorage.getItem(versionKey(owner,path,id))) sessionStorage.setItem(versionKey(owner,path,id),version);
                sessionStorage.setItem(key,JSON.stringify(marker));memoryOnly.delete(key);return true;
            } catch {memoryOnly.add(key);return false;}
        },
        removeCommittedDraft(owner,path,id,signature,version) {
            if (!this.matches(owner,path,id,signature,version)) return false;
            const key=draftKey(owner,path,id);
            if (this.current(owner,path,id,version) && matchesStoredDraft(key,signature)) sessionStorage.removeItem(key);
            return true;
        },
        forget(owner,path,id) {
            const key=markerKey(owner,path,id),marker=read(key),slot=editorKey(owner,path,id);
            const persisted=sessionStorage.getItem(slot);
            const versionSlot=versionKey(owner,path,id),persistedVersion=sessionStorage.getItem(versionSlot);
            let versionHandoff=false;
            if (marker?.version && marker.replacesVersion===persistedVersion) {
                try {sessionStorage.setItem(versionSlot,marker.version);unpersisted.delete(versionSlot);}
                catch {versionHandoff=true;}
            }
            let editorHandoff=false;
            if (marker?.editor && marker.replacesEditor===persisted) {
                try {sessionStorage.setItem(slot,marker.editor);unpersisted.delete(slot);}
                catch {editorHandoff=true;}
            }
            if (versionHandoff || editorHandoff) {
                // Retain metadata authority while its normal slot is read-only.
                const handoff={signature:'',version:marker.version,editor:marker.editor};
                if (editorHandoff) handoff.replacesEditor=persisted;
                if (versionHandoff) handoff.replacesVersion=persistedVersion;
                sessionStorage.setItem(key,JSON.stringify(handoff));memory.set(key,handoff);memoryOnly.delete(key);return;
            }
            memory.delete(key);memoryOnly.delete(key);sessionStorage.removeItem(key);
        }
    });
})();
