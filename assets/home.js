/* Public landing and personal overview for index.php?view=main. */
(() => {
    const root = document.getElementById('home-view');
    if (!root || window.eofficeHome) return;
    const el = id => document.getElementById(id);
    const guest = el('home-guest');
    const member = el('home-member');
    const title = el('home-title');
    const subtitle = el('home-subtitle');
    const feedback = el('home-feedback');
    const refreshButton = el('home-refresh');
    const loginButton = el('home-login');
    const receiveButton = el('home-receive');
    const receiveCard = el('home-receive-card');
    const yearSelect = el('home-year-select');
    const publicFeedback = el('home-public-feedback');
    const publicList = el('home-public-list');
    const presenceFeedback = el('home-presence-feedback');
    const presenceList = el('home-presence-list');
    const presenceSummary = el('home-presence-summary');
    const pendingFeedback = el('home-pending-feedback');
    const pendingList = el('home-pending-list');
    const summaryFeedback = el('home-summary-feedback');
    const statIds = {
        total: el('home-stat-total'),
        pending: el('home-stat-pending'),
        urgent: el('home-stat-urgent'),
        completed: el('home-stat-completed'),
    };
    const number = new Intl.NumberFormat('th-TH');
    const roles = {director: 'ผู้อำนวยการ', deputy_director: 'รองผู้อำนวยการ'};
    let sequence = 0;
    let controller = null;
    let active = false;
    let loading = false;
    let account = null;
    let initialized = false;
    let lastYear = '';

    function currentUser() {
        const state = window.eofficeSessionState;
        if (state?.status === 'authenticated') return state.user || null;
        return state?.status === 'guest' ? null : (window.eofficeUser || null);
    }

    function isAuthenticated() {
        return Boolean(currentUser()?.id && window.eofficeSessionState?.status !== 'guest');
    }

    function node(tag, text = '', className = '') {
        const item = document.createElement(tag);
        if (text !== '') item.textContent = text;
        if (className) item.className = className;
        return item;
    }

    function initials(name) {
        return Array.from(String(name || '?').trim()).slice(0, 2).join('').toLocaleUpperCase('th');
    }

    function displayCount(value) {
        return Number.isFinite(Number(value)) ? number.format(Number(value)) : '—';
    }

    function setFeedback(target, text, error = false) {
        if (!target) return;
        target.replaceChildren();
        target.textContent = text;
        target.dataset.error = String(Boolean(error));
    }

    function panelError(target, text, retry) {
        if (!target) return;
        target.replaceChildren(document.createTextNode(text + ' '));
        const button = node('button', 'ลองใหม่', 'eo-btn eo-btn--secondary eo-btn--sm');
        button.type = 'button';
        button.addEventListener('click', retry);
        target.append(button);
        target.dataset.error = 'true';
    }

    function emptyState(text, tag = 'p') {
        return node(tag, text, 'home-empty');
    }

    function resetStats() {
        for (const target of Object.values(statIds)) target.textContent = '—';
    }

    function renderAccountState() {
        const user = currentUser();
        const authenticated = isAuthenticated();
        guest.hidden = authenticated;
        member.hidden = !authenticated;
        loginButton.hidden = authenticated;
        receiveButton.hidden = !authenticated;
        el('home-shortcut-login').hidden = authenticated;
        if (authenticated) {
            title.textContent = `ภาพรวมงานเอกสารของ ${user.name || 'สมาชิก'}`;
            subtitle.textContent = 'ติดตามหนังสือที่รออ่านหรือรอลงนาม และลงทะเบียนรับเอกสารใหม่ได้จากหน้านี้';
        } else {
            title.textContent = 'ยินดีต้อนรับสู่ E-Office ศรียานุสรณ์';
            subtitle.textContent = 'ระบบหนังสือราชการและงานสารบรรณของโรงเรียน เปิดอ่านคำสั่งและตรวจกำหนดการผู้บริหารได้โดยไม่ต้องเข้าสู่ระบบ';
        }
        if (!authenticated) {
            resetStats();
            setFeedback(summaryFeedback, '');
        }
        account = authenticated ? String(user.id) : 'guest';
    }

    function syncYears() {
        const current = new Date().getFullYear() + 543;
        const saved = Number(window.getCookie?.('yearSelect'));
        const selected = Number.isFinite(saved) && saved >= 2566 && saved <= current ? String(saved) : String(current);
        if (!yearSelect.options.length) {
            for (let year = current; year >= 2566; year--) {
                const option = document.createElement('option');
                option.value = String(year);
                option.textContent = String(year);
                yearSelect.append(option);
            }
        }
        if (![...yearSelect.options].some(option => option.value === selected)) {
            const option = document.createElement('option');
            option.value = selected;
            option.textContent = selected;
            yearSelect.append(option);
        }
        yearSelect.value = selected;
        return selected;
    }

    function currentMonth() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    async function request(url, options, signal) {
        const response = await fetch(url, {...options, credentials: 'same-origin', cache: 'no-store', signal});
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.message || `โหลดข้อมูลไม่สำเร็จ (${response.status})`);
        return data;
    }

    function renderLoading(target, message) {
        target.setAttribute('aria-busy', 'true');
        target.replaceChildren(emptyState(message));
    }

    function renderGuestDocuments(rows, year) {
        publicList.replaceChildren();
        if (!rows.length) {
            publicList.append(emptyState(`ยังไม่มีคำสั่งสาธารณะในปี พ.ศ. ${year}`));
            setFeedback(publicFeedback, '');
            return;
        }
        for (const row of rows) {
            const id = Number(row.doc_id);
            if (!Number.isInteger(id) || id <= 0) continue;
            const button = node('button', '', 'home-doc-card');
            button.type = 'button';
            const top = node('span', '', 'home-doc-card__top');
            top.append(
                node('span', row.external_number ? `เลขที่ ${row.external_number}` : `คำสั่ง #${id}`, 'home-doc-card__number'),
                node('span', row.doc_date || '', 'home-doc-card__date'),
            );
            button.append(
                top,
                node('strong', row.doc_name || 'ไม่ระบุชื่อคำสั่ง', 'home-doc-card__title'),
                node('span', 'เอกสารสาธารณะ · เปิดอ่านรายละเอียด', 'home-doc-card__meta'),
            );
            button.addEventListener('click', () => window.view_doc_public?.(id));
            publicList.append(button);
        }
        if (!publicList.children.length) publicList.append(emptyState(`ยังไม่มีคำสั่งสาธารณะในปี พ.ศ. ${year}`));
        setFeedback(publicFeedback, '');
    }

    function renderPresence(data) {
        const executives = Array.isArray(data?.executives) ? data.executives : [];
        const todayEntries = Array.isArray(data?.today_entries) ? data.today_entries : [];
        const awayIds = new Set(todayEntries
            .filter(row => row.status === 'scheduled')
            .map(row => Number(row.executive_id)));
        if (!executives.length) {
            presenceSummary.textContent = '';
            presenceList.replaceChildren(emptyState('ยังไม่มีข้อมูลตำแหน่งผู้อำนวยการหรือรองผู้อำนวยการ', 'li'));
            setFeedback(presenceFeedback, '');
            return;
        }
        const people = executives.map(person => ({...person, away: awayIds.has(Number(person.id))}));
        people.sort((a, b) => Number(a.away) - Number(b.away));
        const present = people.filter(person => !person.away).length;
        const away = people.length - present;
        presenceSummary.textContent = `อยู่ ${number.format(present)} · ไม่อยู่ ${number.format(away)}`;
        presenceList.replaceChildren(...people.map(person => {
            const item = node('li', '', 'home-presence-person');
            item.dataset.presence = person.away ? 'away' : 'present';
            item.title = `${person.name} — ${person.away ? 'ไม่อยู่: มีกำหนดการไปราชการ' : 'อยู่: ไม่มีกำหนดการไปราชการ'}`;
            const avatar = node('span', initials(person.name), 'home-presence-avatar');
            if (person.photo_url) {
                const image = document.createElement('img');
                image.src = new URL(person.photo_url, document.baseURI).href;
                image.alt = '';
                image.loading = 'lazy';
                image.decoding = 'async';
                image.addEventListener('error', () => image.remove(), {once: true});
                avatar.append(image);
            }
            const copy = node('span', '', 'home-presence-copy');
            copy.append(
                node('strong', person.name || 'ไม่ระบุชื่อ', 'home-presence-name'),
                node('span', roles[person.position] || 'ผู้บริหาร', 'home-presence-role'),
            );
            item.append(avatar, copy, node('span', person.away ? 'ไปราชการ' : 'อยู่', 'home-presence-mark'));
            return item;
        }));
        setFeedback(presenceFeedback, '');
    }

    async function loadGuest(ticket, signal, year) {
        renderLoading(publicList, 'กำลังโหลดคำสั่ง…');
        setFeedback(publicFeedback, 'กำลังโหลดคำสั่ง…');
        setFeedback(presenceFeedback, 'กำลังตรวจสอบกำหนดการ…');
        presenceList.replaceChildren();
        presenceSummary.textContent = '';
        const publicTask = (async () => {
            const rows = await request('api/get_data_public.php', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({Page_number: 1, Year: year, search_txt: '', limit: 5}),
            }, signal);
            if (ticket !== sequence) return;
            if (!Array.isArray(rows)) throw new Error('รูปแบบข้อมูลคำสั่งไม่ถูกต้อง');
            const rowsWithId = rows.filter(row => Number.isInteger(Number(row.doc_id)) && Number(row.doc_id) > 0);
            window.updateDataSavePublic?.(rowsWithId);
            if (publicList.isConnected) renderGuestDocuments(rowsWithId.slice(0, 5), year);
        })().catch(error => {
            if (ticket !== sequence || error?.name === 'AbortError') return;
            publicList.replaceChildren();
            panelError(publicFeedback, 'โหลดคำสั่งไม่สำเร็จ', () => refresh());
        });
        const presenceTask = (async () => {
            const data = await request(`api/official-travel.php?month=${encodeURIComponent(currentMonth())}`, {method: 'GET'}, signal);
            if (ticket !== sequence) return;
            if (data?.status !== 'success') throw new Error(data?.message || 'รูปแบบข้อมูลกำหนดการไม่ถูกต้อง');
            renderPresence(data);
        })().catch(error => {
            if (ticket !== sequence || error?.name === 'AbortError') return;
            presenceSummary.textContent = '';
            presenceList.replaceChildren();
            panelError(presenceFeedback, 'โหลดสถานะผู้บริหารไม่สำเร็จ', () => refresh());
        });
        await Promise.allSettled([publicTask, presenceTask]);
    }

    function renderStats(counts) {
        statIds.total.textContent = displayCount(counts.total);
        statIds.pending.textContent = displayCount(counts.pending);
        statIds.urgent.textContent = displayCount(counts.urgent);
        statIds.completed.textContent = displayCount(counts.completed);
    }

    function renderPendingDocuments(rows) {
        pendingList.replaceChildren();
        if (!rows.length) {
            pendingList.append(emptyState('ไม่มีหนังสือรอดำเนินการในปีที่เลือก'));
            setFeedback(pendingFeedback, '');
            return;
        }
        for (const row of rows) {
            const id = Number(row.doc_id);
            if (!Number.isInteger(id) || id <= 0) continue;
            const button = node('button', '', 'home-doc-card');
            button.type = 'button';
            const top = node('span', '', 'home-doc-card__top');
            top.append(
                node('span', `เลขรับ ${row.doc_number_receive || '—'}`, 'home-doc-card__number'),
                node('span', row.doc_date_receive || row.doc_date || '', 'home-doc-card__date'),
            );
            const meta = node('span', '', 'home-doc-card__meta');
            meta.append(
                node('span', row.doc_receive_from ? `จาก ${row.doc_receive_from}` : 'ไม่ระบุผู้ส่ง'),
                node('span', row.send_from ? `ส่งโดย ${row.send_from}` : ''),
            );
            const badges = node('span', '', 'home-doc-card__badges');
            if (row.status_urgent === 'Urgent') badges.append(node('span', 'ด่วน', 'home-badge home-badge--urgent'));
            if (row.requires_signature) badges.append(node('span', 'รอลงนาม', 'home-badge home-badge--sign'));
            else badges.append(node('span', 'รออ่าน', 'home-badge'));
            button.append(
                top,
                node('strong', row.doc_name || 'ไม่ระบุชื่อเรื่อง', 'home-doc-card__title'),
                meta,
                badges,
            );
            button.addEventListener('click', () => window.view_doc_detail?.(id, 'received'));
            pendingList.append(button);
        }
        if (!pendingList.children.length) pendingList.append(emptyState('ไม่มีหนังสือรอดำเนินการในปีที่เลือก'));
        setFeedback(pendingFeedback, '');
    }

    async function loadMember(ticket, signal, year) {
        resetStats();
        setFeedback(summaryFeedback, '');
        renderLoading(pendingList, 'กำลังโหลดรายการ…');
        setFeedback(pendingFeedback, 'กำลังโหลดรายการ…');
        const summaryTask = (async () => {
            const data = await request('api/inbox_summary.php', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({Year: year}),
            }, signal);
            if (ticket !== sequence) return;
            if (data?.status !== 'success' || !data.counts) throw new Error('รูปแบบข้อมูลสรุปไม่ถูกต้อง');
            renderStats(data.counts);
        })().catch(error => {
            if (ticket !== sequence || error?.name === 'AbortError') return;
            resetStats();
            panelError(summaryFeedback, 'โหลดตัวเลขสรุปไม่สำเร็จ', () => refresh());
        });
        const pendingTask = (async () => {
            const rows = await request('api/get_data_received.php', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({Page_number: 1, Year: year, search_txt: '', Read_Status_find: 'NotRead', limit: 5}),
            }, signal);
            if (ticket !== sequence) return;
            if (!Array.isArray(rows)) throw new Error('รูปแบบข้อมูลหนังสือไม่ถูกต้อง');
            const rowsWithId = rows.filter(row => Number.isInteger(Number(row.doc_id)) && Number(row.doc_id) > 0);
            window.updateDataSave?.(rowsWithId);
            if (pendingList.isConnected) renderPendingDocuments(rowsWithId.slice(0, 5));
        })().catch(error => {
            if (ticket !== sequence || error?.name === 'AbortError') return;
            pendingList.replaceChildren();
            panelError(pendingFeedback, 'โหลดรายการหนังสือไม่สำเร็จ', () => refresh());
        });
        await Promise.allSettled([summaryTask, pendingTask]);
    }

    async function load() {
        if (!active) return;
        const ticket = ++sequence;
        controller?.abort();
        controller = new AbortController();
        renderAccountState();
        const year = syncYears();
        lastYear = year;
        loading = true;
        refreshButton.disabled = true;
        setFeedback(feedback, 'กำลังอัปเดตข้อมูล…');
        try {
            if (isAuthenticated()) await loadMember(ticket, controller.signal, year);
            else await loadGuest(ticket, controller.signal, year);
            if (ticket === sequence) {
                setFeedback(feedback, '');
                refreshButton.title = `อัปเดตล่าสุด ${new Date().toLocaleTimeString('th-TH', {hour: '2-digit', minute: '2-digit'})} น.`;
            }
        } finally {
            if (ticket === sequence) {
                loading = false;
                refreshButton.disabled = false;
                publicList.setAttribute('aria-busy', 'false');
                pendingList.setAttribute('aria-busy', 'false');
            }
        }
    }

    function refresh() {
        if (!active) return;
        load();
    }

    function show() {
        active = true;
        renderAccountState();
        if (!initialized) {
            initialized = true;
            refreshButton.addEventListener('click', refresh);
            loginButton.addEventListener('click', () => window.eofficeOpenLoginModal?.());
            el('home-shortcut-login').addEventListener('click', () => window.eofficeOpenLoginModal?.());
            receiveButton.addEventListener('click', requestReceive);
            receiveCard.addEventListener('click', requestReceive);
            el('home-pending-all').addEventListener('click', () => openReceived('NotRead'));
            yearSelect.addEventListener('change', () => {
                const year = yearSelect.value;
                window.setCookie?.('yearSelect', year, 30);
                const documentYear = el('yearSelect');
                if (documentYear) documentYear.value = year;
                refresh();
            });
            document.querySelectorAll('[data-home-received]').forEach(button => {
                button.addEventListener('click', () => openReceived(button.dataset.homeReceived || ''));
            });
        }
        load();
    }

    function leave() {
        active = false;
        sequence++;
        controller?.abort();
        controller = null;
        loading = false;
        refreshButton.disabled = false;
    }

    function accountChanged(user) {
        const next = user?.id ? String(user.id) : 'guest';
        if (next === account) return;
        account = next;
        if (!active) return;
        renderAccountState();
        load();
    }

    window.addEventListener('eoffice:session-updated', event => {
        if (!active) return;
        const status = event.detail?.status;
        if (status === 'authenticated' || status === 'guest' || status === 'unavailable') {
            accountChanged(event.detail.user || null);
        }
    });

    function openReceived(filter) {
        localStorage.setItem('read_status_change', filter);
        if (typeof window.syncReceivedFilter === 'function') window.syncReceivedFilter(filter);
        window.showView?.('received', 'load');
    }

    function requestReceive() {
        if (isAuthenticated()) {
            window.open_create_doc?.();
            return;
        }
        window.eofficeOpenLoginModal?.('receive_document');
    }

    window.eofficeHome = Object.freeze({
        show,
        leave,
        refresh,
        accountChanged,
        get active() { return active; },
        get loading() { return loading; },
        get year() { return lastYear; },
    });
})();
