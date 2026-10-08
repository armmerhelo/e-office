(() => {
    const el = id => document.getElementById(id);
    const state = {users:[], departments:[], version:'', request:0, busy:false, dirty:false};
    function message(text, error = false) {
        const node = el('sign-routing-message');
        node.textContent = text; node.hidden = !text; node.classList.toggle('error', error);
    }
    async function api(url, options) {
        const response = await fetch(url, options), data = await response.json();
        if (!response.ok || data.status === 'error') throw new Error(data.message || 'ไม่สามารถทำรายการได้');
        return data;
    }
    function controls(ready) {
        el('save-sign-routes').disabled = el('add-sign-route').disabled = !ready;
        el('reload-sign-routes').disabled = state.busy;
        el('sign-route-rows').querySelectorAll('select, button').forEach(node => { node.disabled = !ready; });
    }
    function emptyHint() { el('sign-route-empty').hidden = !!el('sign-route-rows').children.length; }
    function addRow(route = {}) {
        const row = document.createElement('tr');
        for (const [key, label] of [['department','ฝ่าย / ตราประทับ'], ['secretary_id','เลขาฝ่าย'], ['deputy_id','รองฝ่าย']]) {
            const cell = document.createElement('td'), select = document.createElement('select');
            select.dataset.field = key; select.setAttribute('aria-label', label); select.required = key !== 'department';
            if (key === 'department') {
                select.add(new Option('-- เลือกฝ่าย --', '__choose__'));
                select.add(new Option('ทุกฝ่าย (คู่เดิม)', ''));
                state.departments.forEach(name => select.add(new Option(name, name)));
                select.value = route.department ?? '__choose__';
            } else {
                select.add(new Option(`-- เลือก${label} --`, ''));
                state.users.forEach(user => select.add(new Option(`${user.User_Name} (${user.User_Email})`, user.User_Id)));
                select.value = route[key] ?? '';
            }
            select.addEventListener('change', () => { state.dirty = true; });
            cell.append(select); row.append(cell);
        }
        const cell = document.createElement('td'), remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'btn small danger'; remove.textContent = 'ลบคู่';
        remove.addEventListener('click', () => { if (state.busy) return; row.remove(); state.dirty = true; emptyHint(); });
        cell.append(remove); row.append(cell); el('sign-route-rows').append(row); emptyHint();
    }
    async function load() {
        if (state.busy || (state.dirty && !confirm('โหลดข้อมูลใหม่จะยกเลิก Auto send ที่ยังไม่ได้บันทึก ต้องการดำเนินการหรือไม่?'))) return;
        const request = ++state.request;
        state.version = ''; controls(false); message('กำลังโหลดการกำหนดเลขาฝ่าย / รองฝ่าย...');
        try {
            const data = await api('get_sign_routes_api.php');
            if (request !== state.request) return;
            state.users = data.users; state.departments = data.departments; state.version = data.route_version;
            el('sign-route-rows').replaceChildren(); data.routes.forEach(addRow); emptyHint();
            state.dirty = false; controls(true); message('');
        } catch (error) { if (request === state.request) message(error.message, true); }
    }
    el('add-sign-route').addEventListener('click', () => { if (state.busy || !state.version) return; addRow(); state.dirty = true; });
    el('reload-sign-routes').addEventListener('click', load);
    el('form_sign_routes').addEventListener('submit', async event => {
        event.preventDefault(); if (state.busy || !state.version) return;
        const routes = [...el('sign-route-rows').children].map(row => {
            const values = Object.fromEntries([...row.querySelectorAll('select')].map(select => [select.dataset.field, select.value]));
            return {department:values.department, secretary_id:Number(values.secretary_id), deputy_id:Number(values.deputy_id)};
        });
        if (routes.some(route => route.department === '__choose__' || !route.secretary_id || !route.deputy_id)) { message('กรุณาเลือกฝ่าย เลขาฝ่าย และรองฝ่ายให้ครบ', true); return; }
        state.busy = true; controls(false); message('กำลังบันทึก Auto send...');
        try {
            const data = await api('save_sign_routes_api.php', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({routes, route_version:state.version})});
            state.version = data.route_version; state.dirty = false; message(data.message);
            window.dispatchEvent(new Event('eoffice-sign-routes-changed'));
        } catch (error) { message(error.message, true); }
        finally { state.busy = false; controls(true); }
    });
    window.sessionReady.then(user => {
        if (user?.status !== 'Admin') return;
        el('sign-routing-section').hidden = false; load();
    });
})();
