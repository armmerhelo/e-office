(() => {
    // Only create-form text is restored. Passwords, snapshots and file bytes are never persisted.
    const form = document.getElementById('maintenanceForm') ||
        (location.pathname.endsWith('/room_booking/new_room.html') ? document.getElementById('bookingForm') : null);
    if (!form) return;

    let key = null, ownerId = null, sessionUser = null, acceptedRevision = -1, verification = 'pending';
    let pageReady = false, initialized = false, ownerConflict = false, hasDraft = false, completedDraft = false;
    let baseline = new Map(), baselineReady = false, discardStored = false, notice = null, message = '', restoring = false;
    const touched = new Map();
    let discardedVersion = null;
    const beforeChanges = new WeakMap();
    form.dataset.eofficeDraftState = 'pending';
    const fields = () => [...form.elements].filter(node => ['INPUT','TEXTAREA','SELECT'].includes(node.tagName) &&
        (node.id || node.name) && !['password','hidden','file','submit','button'].includes(node.type));
    const fieldKey = (node,index) => node.id || `${node.name}:${index}`;
    const snapshot = () => fields().map((node,index) => ({id:fieldKey(node,index), type:node.type,
        value:['checkbox','radio'].includes(node.type) ? node.checked : node.value}));
    const report = text => {
        message = text;
        if (notice) {notice.textContent = text;notice.hidden = !text;}
    };
    const ownerIsCurrent = () => verification === 'authenticated' && !ownerConflict &&
        !window.eofficeFormOwner?.hasConflict() && String(sessionUser?.id) === ownerId;
    const save = () => {
        form.dataset.eofficeDraftState = 'pending';
        if (!key || !ownerIsCurrent()) return;
        if (!baselineReady) {form.dataset.eofficeDraftState = 'unavailable';return;}
        try {
            if (form.dataset.eofficeDraftEditor && !window.eofficeDraftCommits.currentEditor(ownerId,location.pathname,form.id,form.dataset.eofficeDraftEditor)) {
                form.dataset.eofficeDraftState='unavailable';
                report(window.eofficeDraftCommits.usableEditor(ownerId,location.pathname,form.id,form.dataset.eofficeDraftEditor)
                    ? 'เก็บสิทธิ์ร่างใน storage ไม่ได้ ข้อมูลใหม่ยังอยู่ในหน้านี้ กรุณาบันทึกฟอร์มก่อนออก'
                    : 'มีหน้าแก้ไขร่างใหม่กว่า กรุณาโหลดหน้าใหม่ก่อนใช้งาน');return;
            }
            const expectedVersion=discardStored ? discardedVersion : form.dataset.eofficeDraftVersion;
            if (expectedVersion && window.eofficeDraftCommits && !window.eofficeDraftCommits.current(ownerId,location.pathname,form.id,expectedVersion)) {
                form.dataset.eofficeDraftState='unavailable';report('มีร่างใหม่กว่าของฟอร์มนี้ กรุณาโหลดหน้าใหม่ก่อนใช้งาน');return;
            }
            if (discardStored) window.eofficeDraftCommits?.version(ownerId,location.pathname,form.id,form.dataset.eofficeDraftVersion);
            if (form.dataset.eofficeDraftVersion && window.eofficeDraftCommits && !window.eofficeDraftCommits.current(ownerId,location.pathname,form.id,form.dataset.eofficeDraftVersion)) {
                form.dataset.eofficeDraftState='unavailable';report('เก็บเวอร์ชันร่างใน storage ไม่ได้ ข้อมูลใหม่ยังอยู่ในหน้านี้ กรุณาบันทึกฟอร์มก่อนออก');return;
            }
            // Until restoration finishes, blank/default DOM values are not authoritative
            // for untouched fields. Preserve them from the stored draft instead.
            const merged = snapshot().map(field => initialized ? field :
                (touched.get(field.id) || baseline.get(field.id) || field));
            if (window.eofficeDraftCommits?.removeCommittedDraft(ownerId,location.pathname,form.id,JSON.stringify(merged),form.dataset.eofficeDraftVersion)) {
                hasDraft=false;form.dataset.eofficeDraftState='committed';
                report('ข้อมูลชุดนี้บันทึกสำเร็จแล้ว กรุณาตรวจรายการก่อนส่งซ้ำ');return;
            }
            sessionStorage.setItem(key, JSON.stringify(merged));
            baseline = new Map(merged.map(field => [field.id,field]));
            hasDraft = true;
            discardStored = false;
            form.dataset.eofficeDraftState = 'saved';
            report('บันทึกร่างข้อความล่าสุดในแท็บนี้แล้ว — ไฟล์แนบต้องเลือกใหม่เมื่อกลับมาหน้าเดิม');
        } catch {
            hasDraft = false;
            form.dataset.eofficeDraftState = 'unavailable';
            report('ไม่สามารถเก็บร่างได้ กรุณาบันทึกฟอร์มก่อนออกจากหน้า');
        }
    };
    const clear = event => {
        const reset=event?.type==='reset';
        if (!discardStored || (reset && ownerIsCurrent() && window.eofficeDraftCommits?.current(ownerId,location.pathname,form.id,form.dataset.eofficeDraftVersion))) {
            discardedVersion=form.dataset.eofficeDraftVersion || null;
        }
        if ((!discardStored || reset) && window.eofficeDraftCommits) form.dataset.eofficeDraftVersion=window.eofficeDraftCommits.newVersion();
        discardStored = true;
        touched.clear();baseline.clear();baselineReady = true;hasDraft = false;
        completedDraft=false;
        form.dataset.eofficeDraftState = 'pending';
        // Reset/save requests made while verifying are staged too: they must not
        // delete the last owner's draft until that same owner is confirmed.
        if (key && ownerIsCurrent()) {
            try {
                if (form.dataset.eofficeDraftEditor && !window.eofficeDraftCommits.currentEditor(ownerId,location.pathname,form.id,form.dataset.eofficeDraftEditor)) {
                    if (window.eofficeDraftCommits.usableEditor(ownerId,location.pathname,form.id,form.dataset.eofficeDraftEditor)) {
                        window.eofficeDraftCommits.stageVersion(ownerId,location.pathname,form.id,form.dataset.eofficeDraftVersion);
                    }
                    form.dataset.eofficeDraftState='unavailable';
                    report(window.eofficeDraftCommits.usableEditor(ownerId,location.pathname,form.id,form.dataset.eofficeDraftEditor)
                        ? 'storage ยังเก็บสิทธิ์ร่างไม่ได้ ข้อมูลใหม่ยังอยู่ในหน้านี้ กรุณาบันทึกฟอร์มก่อนออก'
                        : 'มีหน้าแก้ไขร่างใหม่กว่า กรุณาโหลดหน้าใหม่ก่อนใช้งาน');return;
                }
                if (discardedVersion && window.eofficeDraftCommits && !window.eofficeDraftCommits.current(ownerId,location.pathname,form.id,discardedVersion)) {
                    form.dataset.eofficeDraftState='unavailable';report('มีร่างใหม่กว่าของฟอร์มนี้ กรุณาโหลดหน้าใหม่ก่อนใช้งาน');return;
                }
                sessionStorage.removeItem(key);
                window.eofficeDraftCommits?.version(ownerId,location.pathname,form.id,form.dataset.eofficeDraftVersion);
                if (form.dataset.eofficeDraftVersion && window.eofficeDraftCommits && !window.eofficeDraftCommits.current(ownerId,location.pathname,form.id,form.dataset.eofficeDraftVersion)) {
                    form.dataset.eofficeDraftState='unavailable';report('เก็บเวอร์ชันร่างใน storage ไม่ได้ กรุณาบันทึกฟอร์มก่อนออก');return;
                }
                discardedVersion=form.dataset.eofficeDraftVersion || null;
                window.eofficeDraftCommits?.forget(ownerId,location.pathname,form.id);
            } catch {baselineReady = false;form.dataset.eofficeDraftState = 'unavailable';}
        }
        report('');
    };
    const applyMergedFields = () => {
        fields().forEach((node,index) => {
            const field = touched.get(fieldKey(node,index)) || baseline.get(fieldKey(node,index));
            if (!field) return;
            if (['checkbox','radio'].includes(node.type)) node.checked = field.value;
            else node.value = field.value;
        });
    };
    const captureChange = event => {
        if (restoring || !event) return;
        // Until module handlers are ready, stage edits without partially filling
        // the DOM. Initialization restores values and conditional UI together.
        beforeChanges.set(event,snapshot());
    };
    const edit = event => {
        if (restoring) return;
        const current = snapshot(), nodes = fields(), previous = new Map((event && beforeChanges.get(event) || []).map(field => [field.id,field]));
        const target = event?.target;
        current.forEach((field,index) => {
            const node = nodes[index];
            // Disabling a conditional field is an explicit discard even when the
            // not-yet-restored DOM was already blank. Record it after its handler.
            if (event?.type === 'change' && node.dataset.draftClearWhen && node.dataset.draftClearWhen === target?.id &&
                (target.type === 'checkbox' ? !target.checked : target.value !== node.dataset.draftActiveValue)) {
                touched.set(field.id,field);return;
            }
            // A composed text field mixes user text with checkbox-generated labels.
            // Before restoration, those labels cannot replace the saved custom text.
            // Direct text edits and explicitly disabling its custom-text toggle win.
            if (!initialized && node.dataset.draftComposed && target && node !== target) {
                if (target.id === node.dataset.draftComposed && target.checked === false) touched.set(field.id,field);
                return;
            }
            // Track the directly edited field, radio peers, and fields changed by
            // the module's conditional handlers between capture and bubbling.
            if (!target || node === target || (target.type === 'radio' && node.type === 'radio' && node.name === target.name) ||
                (previous.has(field.id) && previous.get(field.id).value !== field.value)) touched.set(field.id,field);
        });
        if (event) beforeChanges.delete(event);
        save();
    };
    form.addEventListener('input',captureChange,true);form.addEventListener('change',captureChange,true);
    form.addEventListener('input',edit);form.addEventListener('change',edit);
    form.addEventListener('reset',clear);form.addEventListener('eoffice:form-saved',clear);
    form.addEventListener('eoffice:form-committed', event => {
        if (String(event.detail?.owner) !== ownerId || event.detail.version !== form.dataset.eofficeDraftVersion || JSON.stringify(snapshot()) !== event.detail.signature) return;
        form.dataset.eofficeDraftState='committed';
        report('ข้อมูลชุดนี้บันทึกสำเร็จแล้ว กำลังรอยืนยันบัญชีเพื่ออัปเดตฟอร์ม ไม่ต้องส่งซ้ำ');
    });
    if (form.dataset.eofficeDraftResetBeforeReady === 'true') {
        delete form.dataset.eofficeDraftResetBeforeReady;clear();
    }
    const availableEarly=new Map(snapshot().map(field=>[field.id,field.type]));
    const earlyEdits=window.eofficeCreateFormLifecycle?.takeEarlyEdits(form)||[];
    for (const field of earlyEdits) {
        if (availableEarly.get(field.id)===field.type) touched.set(field.id,field);
    }
    if (earlyEdits.length || [...form.elements].some(node=>node.type==='file' && node.files?.length)) {
        form.dispatchEvent(new CustomEvent('eoffice:form-dirty',{bubbles:true,detail:{replayed:true}}));
    }

    function loadBaseline() {
        baseline = new Map();
        if (form.dataset.eofficeDraftEditor && !window.eofficeDraftCommits.usableEditor(ownerId,location.pathname,form.id,form.dataset.eofficeDraftEditor)) {
            baselineReady=false;form.dataset.eofficeDraftState='unavailable';report('มีหน้าแก้ไขร่างใหม่กว่า กรุณาโหลดหน้าใหม่ก่อนใช้งาน');return;
        }
        const expectedVersion=discardStored ? discardedVersion : form.dataset.eofficeDraftVersion;
        if (expectedVersion && window.eofficeDraftCommits && !window.eofficeDraftCommits.current(ownerId,location.pathname,form.id,expectedVersion) &&
            window.eofficeDraftCommits.usableVersion(ownerId,location.pathname,form.id,expectedVersion)) {
            baselineReady=true;report('storage ยังเก็บเวอร์ชันร่างไม่ได้ กรุณาบันทึกฟอร์มก่อนออก');return;
        }
        if (expectedVersion && window.eofficeDraftCommits && !window.eofficeDraftCommits.current(ownerId,location.pathname,form.id,expectedVersion)) {
            baselineReady=false;form.dataset.eofficeDraftState='unavailable';report('มีร่างใหม่กว่าของฟอร์มนี้ กรุณาโหลดหน้าใหม่ก่อนใช้งาน');return;
        }
        if (discardStored) {baselineReady = true;return;}
        if (window.eofficeDraftCommits) form.dataset.eofficeDraftVersion=window.eofficeDraftCommits.version(ownerId,location.pathname,form.id,form.dataset.eofficeDraftVersion);
        try {
            const stored = JSON.parse(sessionStorage.getItem(key) || 'null');
            baselineReady = true;
            if (!Array.isArray(stored)) return;
            const matchesCommit=window.eofficeDraftCommits?.matches(ownerId,location.pathname,form.id,JSON.stringify(stored),form.dataset.eofficeDraftVersion);
            if (matchesCommit) {
                completedDraft=true;
                if (window.eofficeDraftCommits.currentEditor(ownerId,location.pathname,form.id,form.dataset.eofficeDraftEditor)) {
                    window.eofficeDraftCommits.removeCommittedDraft(ownerId,location.pathname,form.id,JSON.stringify(stored),form.dataset.eofficeDraftVersion);
                    form.dataset.eofficeDraftVersion=window.eofficeDraftCommits.version(ownerId,location.pathname,form.id,window.eofficeDraftCommits.newVersion());
                }
                report('คำขอจากร่างเดิมบันทึกสำเร็จแล้ว จึงไม่กู้ข้อมูลชุดนั้นกลับมาส่งซ้ำ');return;
            }
            const available = new Map(snapshot().map(field => [field.id,field.type]));
            for (const field of stored) {
                if (!field || available.get(field.id) !== field.type) continue;
                const check = ['checkbox','radio'].includes(field.type);
                if (typeof field.value === (check ? 'boolean' : 'string')) baseline.set(field.id,field);
            }
        } catch {
            baselineReady = false;
            form.dataset.eofficeDraftState = 'unavailable';
            report('ไม่สามารถอ่านร่างได้ กรุณาบันทึกฟอร์มก่อนออกจากหน้า');
        }
    }
    function initializeDraft() {
        if (!pageReady || !key || !ownerIsCurrent() || !baselineReady) return;
        if (!notice) {
            notice = document.createElement('p');notice.className = 'eoffice-draft-notice';notice.setAttribute('role','status');
            notice.textContent = message;notice.hidden = !message;form.before(notice);
        }
        if (initialized) return;
        if (discardStored) {initialized = true;form.dataset.eofficeDraftInitialized='true';return;}
        const restored = baseline.size > 0;
        if (restored) {
            applyMergedFields();
        }
        // Also finish deferred dependent calculations on a fresh form whose
        // first edits preceded draft initialization. Never count them as edits.
        restoring = true;form.dataset.eofficeDraftRestoring = 'true';
        try {
            if (restored) for (const node of fields()) if (node.tagName === 'SELECT' || ['checkbox','radio'].includes(node.type))
                node.dispatchEvent(new Event('change',{bubbles:true}));
            form.dispatchEvent(new Event('eoffice:draft-restored'));
        } finally {restoring = false;delete form.dataset.eofficeDraftRestoring;}
        initialized = true;
        form.dataset.eofficeDraftInitialized='true';
        if (restored || touched.size) {
            save();
            if (restored && form.dataset.eofficeDraftState === 'saved') report('กู้คืนร่างข้อความและรวมการแก้ไขล่าสุดแล้ว — กรุณาเลือกไฟล์แนบใหม่หากมี');
        }
    }
    function updateSession(user) {
        verification = user?.id ? 'authenticated' : 'guest';
        sessionUser = user ?? null;
        if (!user?.id) {
            form.dataset.eofficeDraftState = 'unavailable';
            report('ยังตรวจสอบบัญชีไม่ได้ ร่างใหม่จะยังไม่ถูกเก็บจนกว่าจะตรวจสอบบัญชีสำเร็จ');return;
        }
        const nextOwner = String(user.id);
        if (window.eofficeFormOwner?.hasConflict()) ownerConflict=true;
        if (ownerConflict || (ownerId && ownerId !== nextOwner)) {
            ownerConflict = true;form.dataset.eofficeDraftState = 'unavailable';
            report('บัญชีผู้ใช้เปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ก่อนใช้ระบบร่าง');return;
        }
        if (!key) {
            ownerId = nextOwner;
            key = `eoffice-draft:${ownerId}:${location.pathname}:${form.id}`;
            form.dataset.eofficeDraftUser = ownerId;
            if (window.eofficeDraftCommits && !form.dataset.eofficeDraftEditor) form.dataset.eofficeDraftEditor=window.eofficeDraftCommits.claimEditor(ownerId,location.pathname,form.id);
            loadBaseline();
        }
        else if (!baselineReady) loadBaseline();
        if (!baselineReady) return;
        if (discardStored && !touched.size) clear();
        else if (touched.size || hasDraft) save();
        else if (!initialized) {form.dataset.eofficeDraftState = completedDraft ? 'committed' : 'pending';if (!completedDraft) report('');}
        initializeDraft();
    }
    function acceptSession(state) {
        if (!state || !Number.isInteger(state.revision) || state.revision <= 0 || state.revision <= acceptedRevision) return false;
        acceptedRevision = state.revision;
        // Keep the page's first verified owner even across a logout. A consumer
        // loaded later must not treat another account's existing DOM as fresh data.
        const pageOwner = state.pageOwnerId ? String(state.pageOwnerId) : null;
        if (pageOwner && !ownerId) {ownerId=pageOwner;form.dataset.eofficeDraftUser=ownerId;}
        else if (pageOwner && ownerId !== pageOwner) ownerConflict=true;
        const status = state.status || (state.user?.id ? 'authenticated' : 'guest');
        if (status === 'pending' || status === 'unavailable') {
            verification = status;
            sessionUser = null;
            // A late subscriber can retain the previously verified owner's identity
            // as a boundary without reading or writing storage during verification.
            const previousOwner = pageOwner || (state.user?.id ? String(state.user.id) : null);
            if (previousOwner && !ownerId) {
                ownerId = previousOwner;
                form.dataset.eofficeDraftUser = ownerId;
            } else if (previousOwner && ownerId !== previousOwner) ownerConflict = true;
            form.dataset.eofficeDraftState = status === 'pending' ? 'pending' : 'unavailable';
            report(status === 'pending'
                ? 'กำลังตรวจสอบบัญชี การแก้ไขใหม่ยังไม่ถูกเขียนลงร่างจนกว่าจะยืนยันบัญชีเดิม'
                : 'ตรวจสอบบัญชีไม่สำเร็จ การแก้ไขใหม่ยังอยู่ในหน้านี้และยังไม่ถูกเขียนลงร่าง');
            return true;
        }
        updateSession(state.user);return true;
    }
    window.addEventListener('eoffice:session-updated', event => {
        // The retained snapshot is authoritative, even if an older event is delivered later.
        acceptSession(window.eofficeSessionState || event.detail);
    });
    // Subscribe first, then replay: events emitted before this script loaded are not lost.
    acceptSession(window.eofficeSessionState);
    const ready = window.sessionReady || (window.eofficeSessionState ? Promise.resolve(null) :
        fetch(new URL('../api/me.php', document.currentScript.src), {credentials:'same-origin'})
            .then(response => response.ok ? response.json() : null).then(data => data?.user).catch(() => null));
    Promise.resolve(ready).then(user => {
        acceptSession(window.eofficeSessionState);
        // Only the shared producer may initialize consumers when it exists.
        if (acceptedRevision < 0 && !window.eofficeSessionState)
            updateSession(window.eofficeUser === undefined ? user : window.eofficeUser);
    }).catch(() => {if (acceptedRevision < 0 && !window.eofficeSessionState) updateSession(null);});
    // Modules announce when their conditional handlers are attached. This can be
    // earlier than window.load, which also waits for remote images and fonts.
    form.addEventListener('eoffice:form-ready', () => {pageReady = true;initializeDraft();});
    const loaded = form.dataset.eofficeDraftReady === 'true' || document.readyState === 'complete' ? Promise.resolve() :
        new Promise(resolve => window.addEventListener('load',resolve,{once:true}));
    loaded.then(() => {pageReady = true;initializeDraft();});
})();
