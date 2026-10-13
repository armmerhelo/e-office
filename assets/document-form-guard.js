(() => {
    const form = document.getElementById('document-form');
    if (!form) return;
    let dirty = false, approved = false, approvedDiscard = false, revision = 0, generation = 0;
    const edited = () => {dirty = true;approved = false;revision++;};
    const clean = () => {dirty = false;approved = false;revision++;};
    form.addEventListener('input', edited);
    form.addEventListener('change', edited);
    form.addEventListener('eoffice:form-dirty', edited);
    form.addEventListener('reset', () => {generation++;clean();});
    form.addEventListener('eoffice:form-saved', event => {
        if (event.detail?.revision === undefined || event.detail.revision === revision) clean();
    });
    window.eofficeDocumentRevision = () => revision;
    window.eofficeDocumentGeneration = () => generation;
    window.eofficeDiscardDocumentEdits = () => {
        if (dirty && !window.confirm('ต้องการทิ้งข้อมูลเอกสารที่ยังไม่ได้บันทึกหรือไม่?')) return false;
        generation++;clean();form.dispatchEvent(new Event('eoffice:form-discarded'));return true;
    };
    // Structural edits emit eoffice:form-dirty directly from their handlers.
    // A capture-phase microtask may run before native click's inline handler.
    window.eofficeApproveDocumentLeaving = (discardDrafts = false) => {
        let storedDrafts=false;
        if (discardDrafts) try {
            for (let i=0;i<sessionStorage.length;i++) if (sessionStorage.key(i)?.startsWith('eoffice-draft:')) {storedDrafts=true;break;}
        } catch { /* A dirty document still warns even if draft storage cannot be read. */ }
        if ((!dirty && !storedDrafts) || (approved && (!discardDrafts || approvedDiscard))) return true;
        const warning = discardDrafts
            ? 'มีข้อมูลที่ยังไม่ได้บันทึกหรือร่างในแท็บนี้ ต้องการออกจากระบบหรือไม่? ข้อมูลที่ยังไม่ได้บันทึกและร่างทั้งหมดในแท็บนี้จะถูกล้าง'
            : 'มีข้อมูลเอกสารที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่? ข้อมูลที่ยังไม่ได้บันทึกจะสูญหาย';
        if (!window.confirm(warning)) {approved=false;return false;}
        approved = true;approvedDiscard=discardDrafts;return true;
    };
    window.eofficeCancelDocumentLeaving = () => {approved = false;};
    window.addEventListener('pageshow', window.eofficeCancelDocumentLeaving);
    window.addEventListener('beforeunload', event => {
        if (dirty && !approved) {event.preventDefault();event.returnValue = '';}
    });
    document.addEventListener('click', event => {
        const link = event.target.closest?.('a[href]');
        if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
            (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
        const target = new URL(link.href, location.href);
        if (!['http:', 'https:'].includes(target.protocol) ||
            (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search)) return;
        if (!window.eofficeApproveDocumentLeaving()) {event.preventDefault();event.stopImmediatePropagation();}
    }, true);
})();
