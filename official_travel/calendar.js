(() => {
    const get = id => document.getElementById('travel-' + id);
    const form = get('form'), editor = get('editor'), detail = get('detail');
    const field = name => form.elements.namedItem(name);
    const thaiDate = new Intl.DateTimeFormat('th-TH', {dateStyle:'medium', timeZone:'UTC'});
    const thaiMonth = new Intl.DateTimeFormat('th-TH', {year:'numeric', month:'long', timeZone:'UTC'});
    const asDate = iso => new Date(iso + 'T00:00:00Z');
    const dateText = iso => thaiDate.format(asDate(iso));
    const minMonth = '1900-01', maxMonth = '2199-12';
    const endpoint = '../api/official-travel.php';
    const statuses = {scheduled:'มีกำหนดการ', postponed:'เลื่อน / รอวันใหม่', cancelled:'ยกเลิก'};
    let snapshot = null, owner = null, month = '', sequence = 0, loadedAt = 0, loading = false;
    let selected = null, editing = null, dirty = false, saving = false, suspended = false;

    function element(tag, text = '', className = '') {
        const node = document.createElement(tag);
        node.textContent = text;
        if (className) node.className = className;
        return node;
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
        get('current').disabled = loading || !snapshot;
        get('new').disabled = loading || !snapshot?.executives.length;
        get('new').hidden = !snapshot?.can_manage;
        get('department').disabled = !snapshot;
        get('person').disabled = !snapshot;
    }
    async function load(target = month, successMessage = '') {
        const ticket = ++sequence;
        loading = true;
        controls();
        get('retry').hidden = true;
        message(get('feedback'), 'กำลังโหลดปฏิทิน…');
        try {
            const data = await request(endpoint + (target ? '?month=' + encodeURIComponent(target) : ''));
            if (ticket !== sequence) return;
            if ((owner && owner !== data.owner) || (window.eofficeUser && Number(window.eofficeUser.id) !== data.owner)) {
                throw new Error('บัญชีผู้ใช้เปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ก่อนใช้งาน');
            }
            owner = data.owner;
            snapshot = data;
            month = data.month;
            loadedAt = Date.now();
            render();
            const setup = data.can_manage && !data.executives.length
                ? 'ยังไม่มีรายชื่อผู้บริหาร ให้ Admin ระบุตำแหน่ง ผอ. หรือรอง ผอ. ในหน้าจัดการสมาชิก' : '';
            message(get('feedback'), successMessage || setup);
        } catch (error) {
            if (ticket !== sequence) return;
            snapshot = null;
            for (const key of ['grid','agenda','today-items','today-date']) get(key).replaceChildren();
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
    function entry(row, view, day = '') {
        const button = element('button', '', 'travel-entry');
        button.type = 'button';
        button.dataset.department = row.department;
        const inactive = row.status !== 'scheduled';
        button.dataset.inactive = inactive;
        const when = view === 'today'
            ? `กลับ ${dateText(row.end_date)}${row.end_time ? ` ${row.end_time} น.` : ' · ทั้งวัน'}`
            : period(row);
        button.setAttribute('aria-label', `${day ? dateText(day) + ' · ' : ''}${row.executive_name} · ${role(row)} · ${row.subject} · ${when}${inactive ? ' · ' + statuses[row.status] : ''}`);
        button.append(element('strong', row.executive_name), element('span', row.subject));
        button.append(element('span', role(row)));
        if (view !== 'grid') button.append(element('span', when));
        if (inactive) button.append(element('span', statuses[row.status]));
        button.addEventListener('click', () => showDetail(row));
        return button;
    }
    function render() {
        get('today-date').textContent = dateText(snapshot.today);
        get('today-items').replaceChildren(...(snapshot.today_entries.length
            ? snapshot.today_entries.map(row => entry(row, 'today'))
            : [element('p', 'ไม่มีกำหนดการไปราชการวันนี้', 'travel-muted')]));
        get('month').textContent = thaiMonth.format(asDate(month + '-01'));
        options(get('department'), [['','ทุกฝ่าย'], ...Object.entries(snapshot.departments)]);
        renderCalendar();
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
        get('empty').hidden = !!rows.length;
        get('agenda').replaceChildren(...rows.map(row => entry(row, 'list')));
        const grid = get('grid'), first = asDate(month + '-01');
        const blanks = (first.getUTCDay() + 6) % 7;
        const dayCount = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
        const weekdays = ['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'];
        const items = weekdays.map(name => element('div', name, 'travel-weekday'));
        const cells = Math.ceil((blanks + dayCount) / 7) * 7;
        for (let i = 0; i < cells; i++) {
            const day = i - blanks + 1;
            if (day < 1 || day > dayCount) {
                items.push(element('div', '', 'travel-day travel-day--blank'));
                continue;
            }
            const iso = `${month}-${String(day).padStart(2, '0')}`;
            const cell = element('div', '', 'travel-day');
            const label = element('time', String(day));
            label.dateTime = iso;
            if (iso === snapshot.today) {
                cell.classList.add('travel-day--today');
                label.setAttribute('aria-current','date');
            }
            cell.append(label);
            for (const row of rows) if (row.start_date <= iso && row.end_date >= iso) cell.append(entry(row, 'grid', iso));
            items.push(cell);
        }
        grid.replaceChildren(...items);
    }
    function move(offset) {
        if (!snapshot || loading) return;
        const target = asDate(month + '-01');
        target.setUTCMonth(target.getUTCMonth() + offset);
        const value = target.toISOString().slice(0, 7);
        if (value >= minMonth && value <= maxMonth) load(value);
    }
    function showDetail(row) {
        selected = row;
        get('detail-title').textContent = row.subject;
        const pairs = [['ผู้ไปราชการ', `${row.executive_name} — ${role(row)}`], ['สถานที่', row.place],
            ['วันและเวลา', period(row)], ['สถานะ', statuses[row.status]]];
        if (row.reference_no) pairs.push(['เลขที่หนังสือ', row.reference_no]);
        if (row.private_note) pairs.push(['หมายเหตุภายใน', row.private_note]);
        get('detail-items').replaceChildren(...pairs.flatMap(([key,value]) => [element('dt',key), element('dd',value)]));
        get('edit').hidden = !snapshot.can_manage || !row.revision;
        detail.showModal();
    }
    function updateDepartments(preferred = field('department').value) {
        const id = Number(field('executive_id').value);
        const position = editing?.executive_id === id
            ? (editing.department === 'director' ? 'director' : 'deputy_director')
            : snapshot?.executives.find(row => Number(row.id) === id)?.position;
        const list = Object.entries(snapshot?.departments || {}).filter(([key]) =>
            position && (key === 'director') === (position === 'director'));
        options(field('department'), position === 'director' ? list : [['','เลือกฝ่าย'], ...list], preferred);
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
        const people = snapshot.executives.map(person => [person.id, person.name]);
        if (row && !people.some(([id]) => Number(id) === row.executive_id)) people.unshift([row.executive_id, row.executive_name]);
        options(field('executive_id'), [['','เลือกผู้ไปราชการ'], ...people], row ? String(row.executive_id) : '');
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
    field('all_day').addEventListener('change', times);
    field('start_date').addEventListener('change', () => {
        if (field('end_date').value < field('start_date').value) field('end_date').value = field('start_date').value;
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (saving || !snapshot?.can_manage) return;
        const input = Object.fromEntries(new FormData(form));
        input.executive_id = Number(input.executive_id);
        input.all_day = field('all_day').checked;
        input.id = editing?.id || 0;
        input.revision = editing?.revision || 0;
        input._expected_owner = owner;
        if (editing?.status !== 'cancelled' && input.status === 'cancelled' && !window.confirm('ยืนยันยกเลิกกำหนดการนี้หรือไม่?')) return;
        saving = true;
        for (const item of form.elements) item.disabled = true;
        message(get('form-message'), 'กำลังบันทึก…');
        try {
            await request(endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input)});
            closeEditor(true);
            const startMonth = input.start_date.slice(0,7), endMonth = input.end_date.slice(0,7);
            await load(month < startMonth || month > endMonth ? startMonth : month, 'บันทึกกำหนดการแล้ว');
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
    get('current').onclick = () => load(snapshot?.today.slice(0,7));
    get('department').onchange = renderCalendar;
    get('person').onchange = renderCalendar;
    get('new').onclick = () => openEditor();
    get('close-detail').onclick = () => detail.close();
    get('edit').onclick = () => { detail.close(); openEditor(selected); };
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
