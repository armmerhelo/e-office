(() => {
    const el = id => document.getElementById(id);
    const number = value => Number(value).toLocaleString('th-TH');
    const itemsPerPage = 10;
    let currentPage = 1, totalItems = 0, documentsRequest = 0, loading = false, hasResult = false;
    let filters = {year: 'all', search: ''};
    let displayedFilters = null;
    const paths = {
        document: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8M8 17h5',
        external: 'M14 4h6v6M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
        chevron: 'm6 9 6 6 6-6'
    };
    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (className) element.className = className;
        return element;
    }
    function icon(name, className) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        for (const [key, value] of Object.entries({viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'})) svg.setAttribute(key, value);
        if (className) svg.setAttribute('class', className);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', paths[name]); svg.append(path);
        return svg;
    }
    function button(text, callback, className = 'button-secondary') {
        const element = node('button', text, className);
        element.type = 'button'; element.addEventListener('click', callback);
        return element;
    }
    const filtered = () => filters.year !== 'all' || Boolean(filters.search);
    const sameFilters = () => displayedFilters && displayedFilters.year === filters.year && displayedFilters.search === filters.search;

    function updateControls() {
        // Refresh remains available: a newer request always supersedes an older one.
        el('refreshOrders').querySelector('span').textContent = loading ? 'กำลังอัปเดต…' : 'อัปเดต';
        el('listContent').setAttribute('aria-busy', String(loading));
        el('resetFilters').hidden = !filtered() && !el('orderSearch').value && el('yearSelect').value === 'all';
        el('paginationBtns').querySelectorAll('button').forEach(control => {
            control.disabled = loading || control.dataset.unavailable === 'true';
        });
    }
    function state(title, description, action, actionText) {
        el('ordersTableHead').hidden = true;
        const row = node('tr', undefined, 'state-row'), cell = node('td'), content = node('div', undefined, 'empty-state');
        cell.colSpan = 3;
        content.append(icon('document', 'empty-icon'), node('strong', title), node('p', description));
        if (action) content.append(button(actionText, action));
        cell.append(content); row.append(cell); el('myDocTableBody').replaceChildren(row);
        el('ordersPagination').hidden = true;
    }
    function skeleton() {
        el('ordersTableHead').hidden = false;
        const rows = [];
        for (let i = 0; i < 4; i++) {
            const row = node('tr', undefined, 'skeleton-row'); row.setAttribute('aria-hidden', 'true');
            for (let j = 0; j < 3; j++) {
                const cell = node('td'); cell.append(node('span', '', 'skeleton-line'));
                if (j === 1) cell.append(node('span', '', 'skeleton-line short'));
                row.append(cell);
            }
            rows.push(row);
        }
        el('myDocTableBody').replaceChildren(...rows);
        el('ordersPagination').hidden = true;
    }
    function fileLink(item, file, text, orderNumber) {
        const query = new URLSearchParams({Doc_Id: item.doc_id, File_Path: file, Year: item.doc_year});
        const link = node('a', undefined, 'file-link');
        // Module routes execute under index.php; resolve against the module base URI.
        link.href = new URL('../api/view_file.php?' + query, document.baseURI).href;
        link.target = '_blank'; link.rel = 'noopener';
        link.setAttribute('aria-label', `${text} · คำสั่ง ${orderNumber} (เปิดแท็บใหม่)`);
        link.append(node('span', text), icon('external'));
        return link;
    }
    function renderDocuments(data) {
        const rows = [];
        for (const item of data) {
            const id = Number(item.doc_id);
            if (!Number.isInteger(id) || id <= 0) continue;
            const orderNumber = `${item.external_number ?? '—'}/${item.doc_year || '—'}`;
            const files = [...new Set((Array.isArray(item.files) ? item.files : [item.file_name]).filter(name => typeof name === 'string' && name.trim()))];
            const row = node('tr', undefined, 'document-row');
            const identifier = node('td'), subject = node('td'), actions = node('td', undefined, 'file-cell');
            identifier.append(node('strong', orderNumber, 'doc-number'));
            subject.append(node('p', item.doc_name || 'ไม่ระบุชื่อคำสั่ง', 'doc-name'), node('p', files.length ? `เอกสาร ${number(files.length)} ไฟล์` : 'ไม่มีไฟล์พร้อมเปิด', 'doc-meta'));
            if (files.length === 1) actions.append(fileLink(item, files[0], 'เปิด PDF', orderNumber));
            else if (files.length > 1) {
                const details = node('details', undefined, 'file-list'), summary = node('summary'), list = node('ul');
                summary.append(node('span', `ดูเอกสาร ${number(files.length)} ไฟล์`), icon('chevron'));
                summary.setAttribute('aria-label', `ดูเอกสาร ${number(files.length)} ไฟล์ · คำสั่ง ${orderNumber}`);
                files.forEach((file, index) => {
                    const entry = node('li');
                    const name = file.split(/[\\/]/).pop() || `เอกสาร ${index + 1}.pdf`;
                    entry.append(fileLink(item, file, name, orderNumber)); list.append(entry);
                });
                details.append(summary, list); actions.append(details);
            } else actions.append(node('span', 'ไฟล์เดิมไม่พร้อมใช้งาน', 'file-unavailable'));
            row.append(identifier, subject, actions); rows.push(row);
        }
        el('ordersTableHead').hidden = false;
        el('myDocTableBody').replaceChildren(...rows);
    }
    function renderPagination(totalPages) {
        el('ordersPagination').hidden = totalItems === 0;
        el('paginationBtns').replaceChildren();
        if (!totalItems) return;
        const start = (currentPage - 1) * itemsPerPage + 1, end = Math.min(currentPage * itemsPerPage, totalItems);
        el('pageInfo').textContent = `แสดง ${number(start)}–${number(end)} จาก ${number(totalItems)} รายการ`;
        if (totalPages <= 1) return;
        const add = (text, page, unavailable, label) => {
            const control = button(text, async () => {
                if (loading) return;
                await load(page);
                el('paginationBtns').querySelector('[aria-current="page"]')?.focus({preventScroll: true});
            }, 'btn-page');
            control.dataset.unavailable = String(unavailable);
            control.setAttribute('aria-label', label);
            if (page === currentPage && !unavailable) control.setAttribute('aria-current', 'page');
            el('paginationBtns').append(control);
        };
        add('ก่อนหน้า', currentPage - 1, currentPage <= 1, 'หน้าก่อนหน้า');
        const startPage = Math.max(1, Math.min(currentPage - 1, totalPages - 2));
        for (let page = startPage; page <= Math.min(totalPages, startPage + 2); page++) add(number(page), page, false, `หน้า ${number(page)} จาก ${number(totalPages)}`);
        add('ถัดไป', currentPage + 1, currentPage >= totalPages, 'หน้าถัดไป');
    }
    function syncYears(years) {
        const selected = el('yearSelect').value;
        const choices = new Set((Array.isArray(years) ? years : []).map(String));
        if (selected !== 'all') choices.add(selected);
        el('yearSelect').replaceChildren();
        const all = node('option', 'ทุกปี'); all.value = 'all'; el('yearSelect').append(all);
        [...choices].sort((a, b) => Number(b) - Number(a)).forEach(year => {
            const option = node('option', 'พ.ศ. ' + year); option.value = year; el('yearSelect').append(option);
        });
        el('yearSelect').value = selected;
    }
    async function load(page = currentPage, background = false) {
        const request = ++documentsRequest, submitted = {...filters};
        const retain = background && hasResult && sameFilters() && page === currentPage;
        loading = true; updateControls();
        el('listFeedback').hidden = true;
        el('listStatus').textContent = retain ? 'กำลังอัปเดตรายการ…' : 'กำลังโหลดคำสั่ง…';
        if (!retain) { hasResult = false; skeleton(); el('resultCount').textContent = '—'; el('lastUpdated').textContent = ''; }
        try {
            const query = new URLSearchParams({page, limit: itemsPerPage, ...submitted});
            const response = await fetch('api_get_my_docs.php?' + query, {credentials: 'same-origin'});
            const result = await response.json();
            if (request !== documentsRequest) return;
            if (!response.ok || result.status !== 'success') throw Object.assign(new Error(result.message || 'โหลดรายการไม่สำเร็จ'), {status: response.status});
            if (!Array.isArray(result.data)) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง');
            const total = Number(result.pagination?.total_items ?? result.data.length);
            if (!Number.isFinite(total) || total < 0) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง');
            const pages = Math.max(1, Math.ceil(total / itemsPerPage));
            if (page > pages) return load(pages);
            currentPage = page; totalItems = total;
            displayedFilters = submitted; hasResult = true;
            el('userInfo').textContent = result.user_email ? `อีเมลผู้รับ: ${result.user_email}` : result.user_name || '';
            syncYears(result.years);
            el('resultCount').textContent = `${number(totalItems)} รายการ${filtered() ? ' · ตามตัวกรอง' : ''}`;
            if (result.data.length) { renderDocuments(result.data); renderPagination(pages); }
            else if (filtered()) state('ไม่พบคำสั่งตามเงื่อนไข', 'ลองใช้คำค้นอื่น หรือดูคำสั่งทั้งหมดของคุณ', resetFilters, 'ล้างตัวกรอง');
            else state('ยังไม่มีคำสั่งของคุณ', 'เมื่อมีคำสั่งที่ระบบส่งถึงอีเมลของคุณ รายการจะแสดงที่นี่', () => load(1, true), 'อัปเดตรายการ');
            el('lastUpdated').textContent = 'อัปเดต ' + new Date().toLocaleTimeString('th-TH', {hour: '2-digit', minute: '2-digit'}) + ' น.';
            el('listStatus').textContent = `โหลดแล้ว ${number(totalItems)} รายการ${filtered() ? 'ตามตัวกรอง' : ''}`;
        } catch (error) {
            if (request !== documentsRequest) return;
            const sessionExpired = error.status === 401, denied = error.status === 403;
            if (sessionExpired || denied) {
                hasResult = false; el('resultCount').textContent = '—'; el('lastUpdated').textContent = '';
                if (sessionExpired) el('userInfo').textContent = 'กรุณาเข้าสู่ระบบอีกครั้ง';
                state(sessionExpired ? 'กรุณาเข้าสู่ระบบอีกครั้ง' : 'ไม่สามารถเข้าถึงรายการได้', sessionExpired ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบเพื่อดูคำสั่งของคุณ' : 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงรายการ กรุณาตรวจสอบบัญชีที่ใช้งาน', () => window.location.reload(), 'โหลดหน้าใหม่');
            } else if (retain) {
                const feedback = el('listFeedback');
                feedback.replaceChildren(node('span', 'อัปเดตไม่สำเร็จ กำลังแสดงข้อมูลจากครั้งก่อน'), button('ลองอีกครั้ง', () => load(currentPage, true), 'button-text'));
                feedback.hidden = false;
            } else {
                hasResult = false; el('resultCount').textContent = '—';
                state('โหลดรายการไม่สำเร็จ', 'ตรวจสอบการเชื่อมต่อ แล้วลองโหลดรายการอีกครั้ง', () => load(page), 'ลองอีกครั้ง');
            }
            el('listStatus').textContent = sessionExpired ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : denied ? 'ไม่สามารถเข้าถึงรายการได้' : retain ? 'อัปเดตไม่สำเร็จ กำลังแสดงข้อมูลจากครั้งก่อน' : 'โหลดรายการไม่สำเร็จ';
        } finally {
            if (request === documentsRequest) { loading = false; updateControls(); }
        }
    }
    function applyFilters() {
        filters = {year: el('yearSelect').value, search: el('orderSearch').value.trim()};
        load(1);
    }
    function resetFilters() {
        el('filters').reset(); filters = {year: 'all', search: ''};
        el('orderSearch').focus(); load(1);
    }
    el('filters').addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
    el('yearSelect').addEventListener('change', applyFilters);
    el('orderSearch').addEventListener('input', updateControls);
    el('resetFilters').addEventListener('click', resetFilters);
    el('refreshOrders').addEventListener('click', () => load(currentPage, true));
    if (window.eofficeRegisterModuleRefresh) window.eofficeRegisterModuleRefresh(() => load(currentPage, true));
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => load());
    else load();
})();
