(() => {
    const get = id => document.getElementById('travel-' + id);
    const form = get('form'), editor = get('editor'), detail = get('detail');
    const field = name => form.elements.namedItem(name);
    const thaiDate = new Intl.DateTimeFormat('th-TH', {dateStyle:'medium', timeZone:'UTC'});
    const thaiMonth = new Intl.DateTimeFormat('th-TH', {year:'numeric', month:'long', timeZone:'UTC'});
    const thaiDay = new Intl.DateTimeFormat('th-TH', {weekday:'long', day:'numeric', month:'short', timeZone:'UTC'});
    const compactScreen = window.matchMedia('(max-width: 70rem)');
    const asDate = iso => new Date(iso + 'T00:00:00Z');
    const dateText = iso => thaiDate.format(asDate(iso));
    const minMonth = '1900-01', maxMonth = '2199-12';
    const endpoint = '../api/official-travel.php';
    const statuses = {scheduled:'มีกำหนดการ', postponed:'เลื่อน / รอวันใหม่', cancelled:'ยกเลิก'};
    let snapshot = null, owner = null, month = '', sequence = 0, loadedAt = 0, loading = false;
    let selectedDate = null, selectedEntry = null, editing = null, dirty = false, saving = false, suspended = false;
    let preferredView = 'grid';

    function element(tag, text = '', className = '') {
        const node = document.createElement(tag);
        node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    function initials(name) {
        return Array.from((name || '?').trim()).slice(0, 2).join('').toLocaleUpperCase('th');
    }
    function options(select, rows, preferred = select.value) {
        select.replaceChildren(...rows.map(([value, text]) => {
            const option = element('option', text);
            option.value = value;
            return option;
        }));
        if (rows.some(([value]) => String(value) === preferred)) select.value = preferred;
    }
    function message(node, text, error = false) {
        node.textContent = text;
        node.dataset.error = error;
    }
    async function request(url, init) {
        const response = await fetch(url, {cache:'no-store', ...init});
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.status !== 'success') {
            const error = new Error(data?.message || 'ไม่สามารถเชื่อมต่อปฏิทินได้ กรุณาลองใหม่');
            error.status = response.status;
            throw error;
        }
        return data;
    }
    function controls() {
        get('prev').disabled = loading || !snapshot || month <= minMonth;
        get('next').disabled = loading || !snapshot || month >= maxMonth;
        get('current').disabled = loading || !snapshot ||
            (month === snapshot.today.slice(0,7) && selectedDate === snapshot.today);
        get('new').disabled = loading || !snapshot?.executives.length;
        get('new').hidden = !snapshot?.can_manage || !snapshot.executives.length;
        get('setup').hidden = !snapshot?.can_manage || Boolean(snapshot.executives.length);
        get('department').disabled = !snapshot;
        get('person').disabled = !snapshot;
        renderView();
    }
    function renderView() {
        const list = !compactScreen.matches && preferredView === 'list';
        get('view-controls').hidden = !snapshot || compactScreen.matches;
        get('view-list').setAttribute('aria-pressed', String(list));
        get('view-grid').setAttribute('aria-pressed', String(!list));
        get('calendar-layout').hidden = !snapshot || list;
        get('agenda').hidden = !snapshot || !list;
        get('empty').hidden = !snapshot || !list || Number(get('result-count').dataset.count) > 0;
    }
    async function load(target = month, successMessage = '', requestedSelection = null) {
        const ticket = ++sequence;
        const previousSelection = selectedDate;
        const showLoading = !snapshot;
        loading = true;
        controls();
        get('retry').hidden = true;
        message(get('feedback'), showLoading ? 'กำลังโหลดปฏิทิน…' : '');
        try {
            const data = await request(endpoint + (target ? '?month=' + encodeURIComponent(target) : ''));
            if (ticket !== sequence) return;
            if ((owner && owner !== data.owner) || (window.eofficeUser && Number(window.eofficeUser.id) !== data.owner)) {
                throw new Error('บัญชีผู้ใช้เปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ก่อนใช้งาน');
            }
            owner = data.owner;
            snapshot = data;
            month = data.month;
            selectedDate = requestedSelection?.startsWith(month)
                ? requestedSelection
                : previousSelection?.startsWith(month)
                    ? previousSelection
                    : month === data.today.slice(0,7) ? data.today : month + '-01';
            loadedAt = Date.now();
            render();
            message(get('feedback'), successMessage);
        } catch (error) {
            if (ticket !== sequence) return;
            snapshot = null;
            for (const key of ['grid','agenda','selected-date','selected-count','selected-items','result-count','presence-list','presence-summary']) get(key).replaceChildren();
            get('presence').hidden = true;
            get('selected-date').removeAttribute('datetime');
            get('selected-empty').hidden = true;
            get('clear').hidden = true;
            get('empty').hidden = true;
            if (detail.open) detail.close();
            message(get('feedback'), error.message, true);
            get('retry').hidden = false;
            get('retry').onclick = () => load(target);
        } finally {
            if (ticket === sequence) {
                loading = false;
                controls();
            }
        }
    }
    function period(row) {
        if (row.start_date === row.end_date) {
            return dateText(row.start_date) + (row.start_time ? ` · ${row.start_time}–${row.end_time} น.` : ' · ทั้งวัน');
        }
        const start = dateText(row.start_date) + (row.start_time ? ` ${row.start_time} น.` : '');
        const end = dateText(row.end_date) + (row.end_time ? ` ${row.end_time} น.` : '');
        return `${start} – ${end}${row.start_time ? '' : ' · ทั้งวัน'}`;
    }
    function role(row) {
        const department = snapshot.departments[row.department];
        return row.department === 'director' ? department : `รอง ผอ. · ${department}`;
    }
    function entry(row, view) {
        const button = element('button', '', 'travel-entry');
        button.type = 'button';
        button.dataset.department = row.department;
        const inactive = row.status !== 'scheduled';
        button.dataset.inactive = inactive;
        button.append(element('strong', row.executive_name), element('span', row.subject, 'travel-entry-subject'));
        const meta = element('span', '', 'travel-entry-meta');
        meta.append(element('span', row.place), element('span', role(row)));
        button.append(meta, element('span', period(row)));
        if (view === 'selected' && row.start_date < selectedDate) button.append(element('span', 'เดินทางต่อเนื่องจากวันก่อน'));
        if (view === 'list' && row.start_date < month + '-01') button.append(element('span', 'ต่อเนื่องจากเดือนก่อน'));
        if (inactive) button.append(element('span', statuses[row.status], 'travel-entry-status'));
        button.addEventListener('click', () => showDetail(row));
        return button;
    }
    function render() {
        get('month').textContent = thaiMonth.format(asDate(month + '-01'));
        options(get('department'), [['','ทุกฝ่าย'], ...Object.entries(snapshot.departments)]);
        renderCalendar();
    }
    function renderAgenda(rows) {
        const days = new Map();
        const first = month + '-01';
        const ordered = [...rows].sort((a,b) => a.start_date.localeCompare(b.start_date) || (a.start_time || '').localeCompare(b.start_time || ''));
        for (const row of ordered) {
            const key = row.start_date < first ? first : row.start_date;
            if (!days.has(key)) days.set(key, []);
            days.get(key).push(row);
        }
        const upcoming = month === snapshot.today.slice(0,7)
            ? [...days].find(([date, entries]) => date > snapshot.today && entries.some(row => row.status === 'scheduled'))?.[0]
            : undefined;
        get('agenda').replaceChildren(...[...days].map(([date, entries]) => {
            const group = element('section', '', 'travel-agenda-day');
            const title = element('h3');
            const label = element('time', thaiDay.format(asDate(date)));
            label.dateTime = date;
            title.append(label);
            if (date === snapshot.today) {
                label.setAttribute('aria-current', 'date');
                title.append(element('span', 'วันนี้', 'travel-agenda-today'));
            } else if (date === upcoming) {
                title.append(element('span', 'กำหนดการถัดไป', 'travel-agenda-today'));
            }
            const items = element('div', '', 'travel-agenda-items');
            items.append(...entries.map(row => entry(row, 'list')));
            group.append(title, items);
            return group;
        }));
    }
    function renderCalendar() {
        if (!snapshot) return;
        const department = get('department').value;
        const byDepartment = snapshot.entries.filter(row => !department || row.department === department);
        const people = new Map(byDepartment.map(row => [String(row.executive_id), row.executive_name]));
        const names = [...people].sort((a,b) => a[1].localeCompare(b[1], 'th'));
        options(get('person'), [['','ทุกคน'], ...names]);
        const person = get('person').value;
        const rows = byDepartment.filter(row => !person || String(row.executive_id) === person);
        const filtered = Boolean(department || person);
        get('clear').hidden = !filtered;
        get('result-count').dataset.count = String(rows.length);
        get('result-count').textContent = `${rows.length} กำหนดการ`;
        get('empty').textContent = filtered ? 'ไม่พบกำหนดการตามตัวกรองในเดือนนี้' : 'เดือนนี้ยังไม่มีกำหนดการ';
        renderAgenda(rows);
        renderView();
        const selectedRows = rows.filter(row => row.start_date <= selectedDate && row.end_date >= selectedDate);
        const selectedDateLabel = get('selected-date');
        selectedDateLabel.textContent = thaiDay.format(asDate(selectedDate));
        selectedDateLabel.dateTime = selectedDate;
        get('selected-today').hidden = selectedDate !== snapshot.today;
        get('selected-count').textContent = `${selectedRows.length} กำหนดการ`;
        get('selected-items').replaceChildren(...selectedRows.map(row => entry(row, 'selected')));
        get('selected-body').scrollTop = 0;
        get('selected-empty').hidden = !!selectedRows.length;
        get('selected-empty').textContent = filtered
            ? 'ไม่พบกำหนดการตามตัวกรองในวันที่เลือก'
            : selectedDate === snapshot.today ? 'วันนี้ยังไม่มีกำหนดการไปราชการ' : 'วันที่เลือกยังไม่มีกำหนดการไปราชการ';
        renderPresence();
        const grid = get('grid'), first = asDate(month + '-01');
        const blanks = (first.getUTCDay() + 6) % 7;
        const dayCount = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
        const weekdays = ['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'];
        const items = weekdays.map(name => element('div', name, 'travel-weekday'));
        const cells = Math.ceil((blanks + dayCount) / 7) * 7;
        for (let i = 0; i < cells; i++) {
            const day = i - blanks + 1;
            if (day < 1 || day > dayCount) {
                items.push(element('div', '', 'travel-day--blank'));
                continue;
            }
            const iso = `${month}-${String(day).padStart(2, '0')}`;
            const daily = rows.filter(row => row.start_date <= iso && row.end_date >= iso);
            const cell = element('button', '', 'travel-day');
            cell.type = 'button';
            cell.dataset.date = iso;
            cell.dataset.count = String(daily.length);
            cell.setAttribute('aria-pressed', String(iso === selectedDate));
            const label = element('time', String(day));
            label.dateTime = iso;
            if (iso === snapshot.today) {
                cell.classList.add('travel-day--today');
                cell.setAttribute('aria-current', 'date');
            }
            if (iso === selectedDate) cell.classList.add('travel-day--selected');
            const count = element('span', String(daily.length), 'travel-day-count');
            count.dataset.count = String(daily.length);
            cell.setAttribute('aria-label', `${thaiDay.format(asDate(iso))} ${daily.length ? `${daily.length} กำหนดการ` : 'ไม่มีกำหนดการ'}`);
            cell.append(label, count);
            cell.addEventListener('click', () => {
                selectedDate = iso;
                renderCalendar();
                controls();
                get('grid').querySelector(`[data-date="${iso}"]`)?.focus();
            });
            items.push(cell);
        }
        grid.replaceChildren(...items);
    }
    function renderPresence() {
        const panel = get('presence');
        const executives = Array.isArray(snapshot?.executives) ? snapshot.executives : [];
        if (!executives.length) {
            panel.hidden = true;
            get('presence-list').replaceChildren();
            return;
        }
        const present = [], away = [];
        for (const executive of executives) {
            const isAway = snapshot.entries.some(row =>
                Number(row.executive_id) === Number(executive.id)
                && row.status === 'scheduled'
                && row.start_date <= selectedDate
                && row.end_date >= selectedDate);
            (isAway ? away : present).push({...executive, away: isAway});
        }
        get('presence-summary').textContent = `อยู่ ${present.length} · ไม่อยู่ ${away.length}`;
        get('presence-list').replaceChildren(...[...present, ...away].map(executive => {
            const item = element('li', '', 'travel-presence-person');
            item.dataset.presence = executive.away ? 'away' : 'present';
            item.title = `${executive.name} — ${executive.away ? 'ไม่อยู่: มีกำหนดการไปราชการ' : 'อยู่: ไม่มีกำหนดการไปราชการ'}`;
            item.setAttribute('aria-label', item.title);
            const avatarWrap = element('span', '', 'travel-presence-avatar-wrap');
            const avatar = element('span', '', 'travel-presence-avatar');
            avatar.append(element('span', initials(executive.name), 'travel-presence-fallback'));
            if (executive.photo_url) {
                const image = document.createElement('img');
                image.src = executive.photo_url;
                image.alt = '';
                image.loading = 'lazy';
                image.decoding = 'async';
                image.addEventListener('load', () => image.classList.add('is-loaded'));
                image.addEventListener('error', () => image.remove());
                avatar.append(image);
            }
            const mark = element('span', executive.away ? '–' : '✓', 'travel-presence-mark');
            mark.setAttribute('aria-hidden', 'true');
            avatarWrap.append(avatar, mark);
            item.append(avatarWrap, element('span', executive.name, 'travel-presence-name'));
            return item;
        }));
        panel.hidden = false;
    }
    function move(offset) {
        if (!snapshot || loading) return;
        const target = asDate(month + '-01');
        target.setUTCMonth(target.getUTCMonth() + offset);
        const value = target.toISOString().slice(0, 7);
        if (value >= minMonth && value <= maxMonth) load(value, '', value + '-01');
    }
    function showDetail(row) {
        selectedEntry = row;
        get('detail-title').textContent = row.subject;
        const pairs = [['ผู้ไปราชการ', `${row.executive_name} — ${role(row)}`], ['สถานที่', row.place],
            ['วันและเวลา', period(row)], ['สถานะ', statuses[row.status]]];
        if (row.reference_no) pairs.push(['เลขที่หนังสือ', row.reference_no]);
        if (row.private_note) pairs.push(['หมายเหตุภายใน', row.private_note]);
        get('detail-items').replaceChildren(...pairs.flatMap(([key,value]) => [element('dt',key), element('dd',value)]));
        get('edit').hidden = !snapshot.can_manage || !row.revision;
        detail.showModal();
    }
    function selectedExecutives() {
        if (editing) {
            const id = Number(field('executive_id').value);
            const person = snapshot?.executives.find(row => Number(row.id) === id);
            if (person) return [person];
            if (editing.executive_id === id) {
                return [{id, name:editing.executive_name, position:editing.department === 'director' ? 'director' : 'deputy_director'}];
            }
            return [];
        }
        return [...get('executive-checkboxes').querySelectorAll('input[type=checkbox]:checked')].map(input => {
            const id = Number(input.value);
            return snapshot?.executives.find(row => Number(row.id) === id) || {id, name:'', position:'deputy_director'};
        });
    }
    function updateDepartments(preferred = field('department').value) {
        const people = selectedExecutives();
        const hasDirector = people.some(person => person.position === 'director');
        const hasDeputy = people.some(person => person.position === 'deputy_director');
        const all = Object.entries(snapshot?.departments || {});
        let list;
        if (hasDeputy) list = all.filter(([key]) => key !== 'director');
        else if (hasDirector) list = all.filter(([key]) => key === 'director');
        else list = all;
        const needsChoice = hasDeputy || !people.length;
        options(field('department'), needsChoice ? [['','เลือกฝ่าย'], ...list] : list, preferred);
        const hint = get('department-hint');
        hint.hidden = !hasDeputy;
        hint.textContent = hasDirector
            ? 'ผอ. ใช้ฝ่ายผู้อำนวยการอัตโนมัติ · ฝ่ายที่เลือกใช้กับรอง ผอ.'
            : 'เลือกฝ่ายของรอง ผอ.';
    }
    function renderExecutiveChoices(row = null) {
        const container = get('executive-checkboxes');
        const select = field('executive_id');
        const people = [...(snapshot?.executives || [])];
        if (row && !people.some(person => Number(person.id) === Number(row.executive_id))) {
            people.unshift({
                id: row.executive_id,
                name: row.executive_name,
                position: row.department === 'director' ? 'director' : 'deputy_director',
            });
        }
        if (row) {
            container.replaceChildren();
            container.hidden = true;
            select.hidden = false;
            select.disabled = false;
            options(select, people.map(person => [person.id, person.name]), String(row.executive_id));
            get('executive-help').textContent = 'แก้ไขกำหนดการได้ครั้งละหนึ่งคน';
            return;
        }
        select.hidden = true;
        select.disabled = true;
        select.replaceChildren();
        container.hidden = false;
        container.replaceChildren(...people.map(person => {
            const label = element('label', '', 'travel-executive-option');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.name = 'executive_ids';
            input.value = String(person.id);
            const text = element('span', '', 'travel-executive-option-text');
            text.append(element('strong', person.name), element('span', person.position === 'director' ? 'ผอ.' : 'รอง ผอ.', 'travel-executive-role'));
            label.append(input, text);
            return label;
        }));
        get('executive-help').textContent = 'เลือกได้มากกว่าหนึ่งคนเมื่อไปราชการวันเดียวกัน';
    }
    function times() {
        for (const key of ['start','end']) {
            const allDay = field('all_day').checked;
            get(key + '-time').hidden = allDay;
            field(key + '_time').required = !allDay;
        }
    }
    function openEditor(row = null) {
        if (!snapshot?.can_manage || saving) return;
        if (suspended) {
            suspended = false;
            editor.showModal();
            return;
        }
        editing = row;
        dirty = false;
        form.reset();
        message(get('form-message'), '');
        get('editor-title').textContent = row ? 'แก้ไขกำหนดการ' : 'เพิ่มกำหนดการ';
        get('status').hidden = !row;
        renderExecutiveChoices(row);
        updateDepartments(row?.department || '');
        const today = snapshot.today.startsWith(month) ? snapshot.today : month + '-01';
        for (const key of ['start_date','end_date']) field(key).value = row?.[key] || today;
        for (const key of ['subject','place','start_time','end_time','reference_no','private_note']) field(key).value = row?.[key] || '';
        field('status').value = row?.status || 'scheduled';
        field('all_day').checked = !row?.start_time;
        times();
        editor.showModal();
    }
    function closeEditor(saved = false) {
        if (!saved && (saving || (dirty && !window.confirm('ทิ้งข้อมูลที่ยังไม่ได้บันทึกหรือไม่?')))) return;
        dirty = false;
        suspended = false;
        form.reset();
        editor.close();
    }
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('change', () => { dirty = true; });
    field('executive_id').addEventListener('change', () => updateDepartments(''));
    get('executive-checkboxes').addEventListener('change', () => updateDepartments(''));
    field('all_day').addEventListener('change', times);
    field('start_date').addEventListener('change', () => {
        if (field('end_date').value < field('start_date').value) field('end_date').value = field('start_date').value;
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (saving || !snapshot?.can_manage) return;
        const data = new FormData(form);
        const input = Object.fromEntries(data);
        input.all_day = field('all_day').checked;
        input.id = editing?.id || 0;
        input.revision = editing?.revision || 0;
        input._expected_owner = owner;
        if (editing) {
            input.executive_id = Number(field('executive_id').value);
            if (!input.executive_id) {
                message(get('form-message'), 'กรุณาเลือกผู้ไปราชการ', true);
                return;
            }
        } else {
            input.executive_ids = data.getAll('executive_ids').map(Number);
            delete input.executive_id;
            if (!input.executive_ids.length) {
                message(get('form-message'), 'กรุณาเลือกผู้ไปราชการอย่างน้อยหนึ่งคน', true);
                return;
            }
        }
        if (!input.department) {
            message(get('form-message'), 'กรุณาเลือกฝ่าย', true);
            return;
        }
        if (editing?.status !== 'cancelled' && input.status === 'cancelled' && !window.confirm('ยืนยันยกเลิกกำหนดการนี้หรือไม่?')) return;
        saving = true;
        for (const item of form.elements) item.disabled = true;
        message(get('form-message'), 'กำลังบันทึก…');
        try {
            await request(endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input)});
            closeEditor(true);
            const startMonth = input.start_date.slice(0,7), endMonth = input.end_date.slice(0,7);
            await load(month < startMonth || month > endMonth ? startMonth : month, 'บันทึกกำหนดการแล้ว', input.start_date);
        } catch (error) {
            message(get('form-message'), error.message, true);
            if (error.status === 409) await load();
        } finally {
            saving = false;
            for (const item of form.elements) item.disabled = false;
        }
    });
    get('prev').onclick = () => move(-1);
    get('next').onclick = () => move(1);
    get('current').onclick = () => load(snapshot?.today.slice(0,7), '', snapshot?.today);
    get('department').onchange = renderCalendar;
    get('person').onchange = renderCalendar;
    get('clear').onclick = () => {
        get('department').value = '';
        get('person').value = '';
        renderCalendar();
        get('department').focus();
    };
    get('view-grid').onclick = () => { preferredView = 'grid'; renderView(); };
    get('view-list').onclick = () => { preferredView = 'list'; renderView(); };
    compactScreen.addEventListener('change', renderView);
    get('new').onclick = () => openEditor();
    get('close-detail').onclick = () => detail.close();
    get('edit').onclick = () => { detail.close(); openEditor(selectedEntry); };
    get('close-editor').onclick = () => closeEditor();
    editor.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
    window.eofficeRegisterModuleSuspend?.(() => { suspended = editor.open && (dirty || saving); });
    window.eofficeRegisterModuleResume?.(() => { if (suspended && !editor.open) openEditor(editing); });
    window.eofficeRegisterModuleChanges?.(() => dirty);
    window.addEventListener('focus', () => {
        if (!document.hidden && snapshot && !loading && !saving && !suspended && !editor.open && !detail.open && Date.now() - loadedAt > 30000) load();
    });
    controls();
    if (window.eofficeRegisterModuleRefresh) window.eofficeRegisterModuleRefresh(() => load());
    else if (window.eofficeUser) load();
})();
