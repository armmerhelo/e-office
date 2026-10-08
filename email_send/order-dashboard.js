(() => {
    const U = OrderUI, el = id => document.getElementById(id);
    const quickFilters = [...document.querySelectorAll('[data-state]')];
    const number = value => Number(value || 0).toLocaleString('th-TH');
    function dateTime(value, fallback = '—') {
        if (!value) return fallback;
        // SQL timestamps are server-local; preserve their displayed clock time.
        const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
        if (!parts) return value;
        const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
        return date.toLocaleDateString('th-TH', {day: 'numeric', month: 'short', year: 'numeric'}) + ` · ${parts[4]}:${parts[5]} น.`;
    }
    let page = 1, total = 0, activeDoc = null, busy = false, loading = false;
    let listRequest = 0, detailRequest = 0, detailReady = false, detailLoading = false;
    // Auto-refresh uses submitted filters, leaving unfinished search text alone.
    let filters = {year: 'all', search: '', state: ''};

    function placeholder(target, columns, title, description, retry) {
        const tr = U.node('tr', undefined, 'placeholder-row');
        const td = U.node('td'), content = U.node('div', undefined, 'empty-state');
        td.colSpan = columns;
        content.append(U.node('span', retry ? '↻' : '≡', 'empty-icon'), U.node('strong', title));
        if (description) content.append(U.node('p', description));
        if (retry) content.append(U.button('ลองอีกครั้ง', retry));
        td.append(content); tr.append(td); el(target).replaceChildren(tr);
    }

    function updateControls() {
        el('prev').disabled = loading || busy || page <= 1;
        el('next').disabled = loading || busy || page * 20 >= total;
        el('refresh-list').disabled = loading || busy;
        el('search-button').disabled = busy;
        el('refresh-list').textContent = loading ? 'กำลังโหลด…' : 'รีเฟรช';
        el('list-content').setAttribute('aria-busy', String(loading));
        document.querySelectorAll('#rows button, #recipient-rows button').forEach(button => { button.disabled = busy; });
        ['reanalyze', 'cancel-job', 'recipient-email', 'add-recipient-button'].forEach(id => {
            el(id).disabled = busy || !detailReady;
        });
        el('refresh-detail').disabled = busy || detailLoading || !activeDoc;
        if (activeDoc?.status === 'cancelled') el('cancel-job').disabled = true;
    }

    function syncQuickFilters() {
        quickFilters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.state === filters.state)));
    }

    function renderCounts(cell, item) {
        const success = Number(item.success_count || 0), pending = Number(item.pending_count || 0), attention = Number(item.attention_count || 0);
        if (!success && !pending && !attention) {
            cell.append(U.node('span', item.status ? 'ยังไม่มีผลส่ง' : 'ยังไม่ได้รวบรวมผู้รับ', 'muted'));
            return;
        }
        const counts = U.node('div', undefined, 'recipient-counts');
        counts.append(U.node('span', `สำเร็จ ${number(success)}`, 'count-success'), U.node('span', `รอ ${number(pending)}`, 'count-pending'), U.node('span', `ตรวจสอบ ${number(attention)}`, 'count-attention'));
        const progress = U.node('div', undefined, 'delivery-progress'), fill = U.node('span');
        progress.setAttribute('aria-hidden', 'true');
        fill.style.width = (success / (success + pending + attention) * 100) + '%';
        progress.append(fill); cell.append(counts, progress);
    }

    async function load(background = false) {
        const requestId = ++listRequest;
        loading = true; updateControls();
        if (!background) {
            U.message('message', '');
            el('list-summary').textContent = 'กำลังโหลดรายการ…';
            placeholder('rows', 4, 'กำลังโหลดคำสั่ง…', 'ระบบกำลังตรวจสอบข้อมูลล่าสุด');
        }
        try {
            const q = new URLSearchParams({page, ...filters});
            const result = await U.request('order_jobs.php?' + q);
            if (requestId !== listRequest) return;
            total = Number(result.total);
            // If a last-page item disappeared while refreshing, return to a valid page.
            if (page > Math.max(1, Math.ceil(total / 20))) {
                page = Math.max(1, Math.ceil(total / 20));
                await load(background); return;
            }
            if (el('year').options.length === 1) result.years.forEach(year => el('year').add(new Option('พ.ศ. ' + year, year)));
            el('settings-link').hidden = !result.is_admin;
            const worker = result.worker;
            el('worker-status').textContent = worker.enabled ? 'เปิดส่งอัตโนมัติ' : worker.activated_at ? 'หยุดส่งชั่วคราว' : 'ยังไม่เปิดใช้งาน';
            el('worker-dot').className = 'status-dot ' + (worker.enabled ? 'enabled' : 'paused');
            el('worker-last-run').textContent = dateTime(worker.last_run, 'ยังไม่พบรอบทำงาน');
            el('worker-activated').textContent = dateTime(worker.activated_at, 'ยังไม่เปิดใช้งาน');
            el('rows').replaceChildren();
            for (const item of result.data) {
                const tr = U.node('tr'), doc = U.node('td'), status = U.node('td'), counts = U.node('td'), actions = U.node('td');
                doc.append(U.node('strong', `${item.doc_number} / ${item.doc_year}`, 'doc-number'), U.node('p', item.doc_name, 'doc-name'));
                status.append(U.badge(item.status));
                if (item.error_code) status.append(U.node('p', U.error(item.error_code), 'status-error'));
                renderCounts(counts, item);
                const button = U.button(item.status ? 'ดูรายละเอียด' : 'นำเข้าคิว', () => {
                    if (item.status) openDetail(item);
                    else if (confirm(`นำคำสั่ง ${item.doc_number} / ${item.doc_year} เข้าคิวส่งอีเมล?\n${item.doc_name}\nระบบจะวิเคราะห์ PDF และส่งถึงผู้รับในรอบถัดไป`)) action(item.doc_id, 'enqueue');
                });
                button.className = 'row-action' + (item.status ? ' button-secondary' : '');
                button.setAttribute('aria-label', `${item.status ? 'ดูรายละเอียด' : 'นำเข้าคิว'} คำสั่ง ${item.doc_number} / ${item.doc_year}`);
                actions.append(button); tr.append(doc, status, counts, actions); el('rows').append(tr);
            }
            if (!result.data.length) placeholder('rows', 4, 'ไม่พบคำสั่งตามเงื่อนไข', 'ลองเปลี่ยนคำค้น ปี หรือสถานะ หรือกดล้างตัวกรองเพื่อดูทั้งหมด');
            el('result-count').textContent = number(total) + ' รายการ';
            const start = total ? (page - 1) * 20 + 1 : 0, end = Math.min(page * 20, total);
            el('list-summary').textContent = total ? `แสดง ${number(start)}–${number(end)} จาก ${number(total)} รายการ${filters.search || filters.state || filters.year !== 'all' ? ' ตามตัวกรอง' : ''}` : 'ไม่มีรายการที่ตรงกับตัวกรอง';
            el('page-info').textContent = `หน้า ${number(page)} จาก ${number(Math.max(1, Math.ceil(total / 20)))}`;
            el('last-updated').textContent = 'อัปเดต ' + new Date().toLocaleTimeString('th-TH', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
            if (el('message').classList.contains('error')) U.message('message', '');
        } catch (error) {
            if (requestId !== listRequest) return;
            U.message('message', error.message, true);
            el('list-summary').textContent = background ? 'อัปเดตไม่สำเร็จ · กำลังแสดงข้อมูลจากรอบก่อน' : 'โหลดรายการไม่สำเร็จ';
            if (!background) {
                total = 0;
                el('result-count').textContent = '—'; el('page-info').textContent = '—';
                placeholder('rows', 4, 'ไม่สามารถโหลดคำสั่งได้', 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง', () => load());
            }
        } finally {
            if (requestId === listRequest) { loading = false; updateControls(); }
        }
    }

    async function action(docId, name, extra = {}) {
        if (busy) return;
        busy = true; updateControls();
        const feedbackId = el('detail').open ? 'detail-message' : 'action-message';
        U.message(feedbackId, 'กำลังบันทึกงาน…');
        try {
            const result = await U.request('order_jobs.php', {doc_id: docId, action: name, ...extra});
            await load(true);
            U.message(feedbackId, result.message);
            if (activeDoc?.doc_id === docId && el('detail').open) {
                U.message('detail-message', result.message);
                if (name === 'add_recipient') el('recipient-email').value = '';
                await detail();
            }
        } catch (error) {
            U.message(feedbackId, error.message, true);
        } finally { busy = false; updateControls(); }
    }

    async function openDetail(item) {
        if (busy) return;
        activeDoc = item; detailReady = false;
        el('detail-title').textContent = item.doc_name;
        el('detail-number').textContent = `คำสั่ง ${item.doc_number} / ${item.doc_year}`;
        el('recipient-email').value = '';
        U.message('detail-message', '');
        el('detail').showModal();
        await detail();
    }

    async function detail() {
        if (!activeDoc || !el('detail').open) return;
        const requestId = ++detailRequest, docId = activeDoc.doc_id;
        detailReady = false; detailLoading = true; updateControls();
        el('detail-status').textContent = 'กำลังโหลดรายละเอียด…';
        el('file-count').textContent = '—'; el('recipient-count').textContent = '—';
        placeholder('file-rows', 3, 'กำลังโหลดเอกสาร…');
        placeholder('recipient-rows', 4, 'กำลังโหลดผู้รับ…');
        try {
            const result = await U.request('order_jobs.php?doc_id=' + docId);
            if (requestId !== detailRequest || activeDoc?.doc_id !== docId || !el('detail').open) return;
            if (el('detail-message').classList.contains('error')) U.message('detail-message', '');
            activeDoc.status = result.job?.status;
            el('detail-status').replaceChildren(U.badge(result.job?.status));
            if (result.job?.error_code) el('detail-status').append(U.node('span', ' · ' + U.error(result.job.error_code)));
            el('file-count').textContent = number(result.files.length) + ' ไฟล์';
            el('recipient-count').textContent = number(result.recipients.length) + ' คน';
            el('file-rows').replaceChildren();
            for (const file of result.files) {
                const tr = U.node('tr'), status = U.node('td'), info = U.node('td');
                status.dataset.label = 'สถานะ'; info.dataset.label = 'การประมวลผล';
                status.append(U.badge(file.status));
                info.append(U.node('div', `ประมวลผล ${number(file.attempts)} ครั้ง`));
                if (file.error_code) info.append(U.node('p', U.error(file.error_code), 'status-error'));
                if (file.retry_at) info.append(U.node('p', 'ลองใหม่ ' + dateTime(file.retry_at), 'muted'));
                tr.append(U.node('td', file.caption || file.file_name), status, info); el('file-rows').append(tr);
            }
            if (!result.files.length) placeholder('file-rows', 3, 'ยังไม่มีผลวิเคราะห์ PDF', 'ระบบจะตรวจสอบเอกสารในรอบทำงานถัดไป');
            el('recipient-rows').replaceChildren();
            for (const recipient of result.recipients) {
                const tr = U.node('tr'), name = U.node('td'), status = U.node('td'), info = U.node('td'), actions = U.node('td'), buttons = U.node('div', undefined, 'detail-row-actions');
                status.dataset.label = 'ผลส่ง'; info.dataset.label = 'เวลา / การส่ง';
                name.append(U.node('strong', recipient.recipient_name), U.node('div', recipient.recipient_email, 'muted recipient-email'));
                status.append(U.badge(recipient.status));
                info.append(U.node('div', dateTime(recipient.sent_at || recipient.attempted_at, 'ยังไม่ได้ส่ง')), U.node('p', `${number(recipient.attempts)} ครั้ง`, 'muted'));
                if (recipient.error_code) info.append(U.node('p', U.error(recipient.error_code), 'status-error'));
                if (recipient.status === 'pending') buttons.append(U.button('ยกเลิก', () => {
                    if (confirm(`ยกเลิกการส่งถึง ${recipient.recipient_email}?`)) action(docId, 'cancel_recipient', {recipient_id: recipient.id});
                }, true));
                if (['failed', 'uncertain', 'sending', 'cancelled'].includes(recipient.status)) buttons.append(U.button('ส่งใหม่', () => {
                    if (confirm(`ส่งใหม่ถึง ${recipient.recipient_email}?\nตรวจสอบผลส่งก่อนยืนยัน หากเซิร์ฟเวอร์รับอีเมลไปแล้ว ผู้รับอาจได้รับซ้ำ`)) action(docId, 'retry_recipient', {recipient_id: recipient.id, confirmed: true});
                }));
                if (!buttons.childElementCount) buttons.append(U.node('span', '—', 'muted'));
                actions.append(buttons); tr.append(name, status, info, actions); el('recipient-rows').append(tr);
            }
            if (!result.recipients.length) placeholder('recipient-rows', 4, 'ยังไม่มีรายชื่อผู้รับ', 'รอผลวิเคราะห์ PDF หรือเพิ่มผู้รับด้วยอีเมลที่ลงทะเบียนในระบบ');
            detailReady = Boolean(result.job);
        } catch (error) {
            if (requestId !== detailRequest || !el('detail').open) return;
            el('detail-status').textContent = 'โหลดรายละเอียดไม่สำเร็จ';
            U.message('detail-message', error.message, true);
            placeholder('file-rows', 3, 'ไม่สามารถโหลดรายละเอียดได้', '', () => detail());
            placeholder('recipient-rows', 4, 'ยังไม่สามารถแสดงผู้รับได้');
        } finally { if (requestId === detailRequest) { detailLoading = false; updateControls(); } }
    }

    function applyFilters() {
        filters = {year: el('year').value, search: el('search').value.trim(), state: el('state').value};
        page = 1; syncQuickFilters(); load();
    }
    el('filters').addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
    el('year').addEventListener('change', applyFilters);
    el('state').addEventListener('change', applyFilters);
    quickFilters.forEach(button => button.addEventListener('click', () => { el('state').value = button.dataset.state; applyFilters(); }));
    el('reset-filters').onclick = () => { el('filters').reset(); applyFilters(); };
    el('refresh-list').onclick = () => load(true);
    el('prev').onclick = () => { if (!loading && !busy && page > 1) { page--; load(); } };
    el('next').onclick = () => { if (!loading && !busy && page * 20 < total) { page++; load(); } };
    el('close-detail').onclick = () => el('detail').close();
    el('detail').addEventListener('close', () => { detailRequest++; activeDoc = null; detailReady = false; detailLoading = false; });
    el('refresh-detail').onclick = () => { U.message('detail-message', ''); detail(); };
    el('reanalyze').onclick = () => {
        if (activeDoc && detailReady && confirm('อ่าน PDF ทุกไฟล์ใหม่ โดยไม่ส่งซ้ำให้ผู้ที่สำเร็จแล้ว และคงรายการผลส่งไม่แน่ชัดไว้ให้ตรวจสอบ')) action(activeDoc.doc_id, 'reanalyze', {confirmed: true});
    };
    el('cancel-job').onclick = () => {
        if (activeDoc && detailReady && confirm('หยุดงานที่ยังไม่ส่ง? อีเมลที่ส่งแล้วเรียกคืนไม่ได้')) action(activeDoc.doc_id, 'cancel_job');
    };
    el('add-recipient').onsubmit = event => {
        event.preventDefault();
        if (activeDoc && detailReady) action(activeDoc.doc_id, 'add_recipient', {email: el('recipient-email').value.trim()});
    };
    load();
    // Do not replace a focused/hovered action while an operator is using it.
    setInterval(() => {
        if (!document.hidden && !busy && !loading && !el('detail').open && !document.querySelector('#rows:hover') && !document.activeElement?.closest('form,table')) load(true);
    }, 15000);
})();
