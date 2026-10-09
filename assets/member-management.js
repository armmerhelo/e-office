(() => {
    const el = id => document.getElementById(id);
    const state = {page:1, limit:20, total:0, users:[], catalog:{}, canManage:false, departments:[], editId:null, permissionId:null, permissionVersion:'', request:0, departmentRequest:0, dialogRequest:0, memberVersion:'', departmentsReady:false, statusUser:null, busy:false};
    let returnFocus;

    function message(id, text, error = false) {
        const node = el(id);
        node.textContent = text;
        node.classList.toggle('error', error);
        node.hidden = !text;
    }
    async function api(url, options) {
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok || data.status === 'error') throw new Error(data.message || 'ไม่สามารถทำรายการได้');
        return data;
    }
    function showDialog(id) {
        returnFocus = document.activeElement;
        el(id).hidden = false;
        el(id).querySelector('input:not([type=hidden]), button')?.focus();
    }
    function closeDialog(id) {
        if (state.busy) return;
        if (id === 'modal_user_manage' || id === 'modal_status' || id === 'modal_permissions') {
            state.dialogRequest++; state.departmentRequest++; state.departmentsReady = false;
        }
        el(id).hidden = true;
        returnFocus?.focus();
    }
    function notifySessionChange() {
        window.dispatchEvent(new Event('eoffice:permissions-changed'));
    }
    function button(text, handler, className = 'btn small') {
        const node = document.createElement('button');
        node.type = 'button'; node.textContent = text; node.className = className;
        node.addEventListener('click', handler);
        return node;
    }
    function renderFilter() {
        const filter = el('permission-filter'), value = filter.value;
        filter.replaceChildren(new Option('สิทธิ์ทั้งหมด', ''), new Option('Admin สูงสุด', 'Admin'));
        for (const [key, item] of Object.entries(state.catalog)) filter.add(new Option(item.label, key));
        filter.value = value;
    }
    function renderTable() {
        const tbody = el('userTableBody'); tbody.replaceChildren();
        if (!state.users.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="muted">ไม่พบสมาชิกตามเงื่อนไขที่เลือก</td></tr>';
        }
        state.users.forEach((user, index) => {
            const row = document.createElement('tr');
            const status = user.User_Status === 'Admin' ? 'Admin สูงสุด' : user.User_Status === 'Editor' ? 'ผู้แก้ไข (เดิม)' : 'บุคลากรทั่วไป';
            const permissionBadges = user.User_Status === 'Admin' ? '<span class="badge badge-admin">ทุกสิทธิ์</span>' : user.permissions.map(key => `<span class="badge">${escapeHTML(state.catalog[key]?.label || key)}</span>`).join('');
            const roleBadges = (user.sign_roles || []).map(role => `<span class="badge">${escapeHTML(role)}</span>`).join('');
            const badges = permissionBadges + roleBadges || '<span class="muted">สิทธิ์พื้นฐาน</span>';
            row.innerHTML = `<td>${(state.page - 1) * state.limit + index + 1}</td><td><div class="name">${escapeHTML(user.User_Name)}</div><div class="muted">${escapeHTML(user.User_Email)}</div></td><td><span class="badge ${user.User_Status === 'Admin' ? 'badge-admin' : ''}">${status}</span></td><td><div class="badges">${badges}</div></td><td><div class="actions"></div></td>`;
            const actions = row.querySelector('.actions');
            if (user.can_edit) actions.append(button('แก้ไข', () => editMember(user)));
            else { const note = document.createElement('span'); note.className = 'muted'; note.textContent = 'เฉพาะ Admin สูงสุด'; actions.append(note); }
            if (state.canManage && user.User_Status !== 'Admin') actions.append(button('สิทธิ์', () => editPermissions(user), 'btn small primary'));
            if (state.canManage) actions.append(button('ระดับ', () => editStatus(user)));
            tbody.append(row);
        });
        el('member-count').textContent = `สมาชิกทั้งหมด ${state.total.toLocaleString('th-TH')} คน`;
        const pagination = el('usersPagination'); pagination.replaceChildren();
        const pages = Math.max(1, Math.ceil(state.total / state.limit));
        const info = document.createElement('span'); info.className = 'muted'; info.textContent = `หน้า ${state.page} / ${pages}`;
        const controls = document.createElement('div'); controls.className = 'actions';
        const prev = button('‹ ก่อนหน้า', () => { state.page--; loadUsers(); }); prev.disabled = state.page <= 1;
        const next = button('ถัดไป ›', () => { state.page++; loadUsers(); }); next.disabled = state.page >= pages;
        controls.append(prev, next); pagination.append(info, controls);
    }
    async function loadUsers() {
        const request = ++state.request;
        const params = new URLSearchParams({search:el('search_txt').value, permission:el('permission-filter').value, page:state.page, limit:state.limit});
        try {
            const data = await api(`get_users_api.php?${params}`);
            if (request !== state.request) return;
            state.users = data.data; state.total = data.total; state.page = data.page;
            state.catalog = data.permission_catalog; state.canManage = data.can_manage_permissions;
            el('add-member').disabled = false;
            renderFilter(); renderTable();
        } catch (error) {
            if (request !== state.request) return;
            message('page-message', error.message, true);
            el('add-member').disabled = true;
            el('userTableBody').replaceChildren(); el('usersPagination').replaceChildren();
            el('member-count').textContent = '';
        }
    }
    function renderDepartments() {
        const container = el('selected-departments'); container.replaceChildren();
        for (const dept of state.departments) {
            const chip = document.createElement('span'); chip.className = 'department-chip';
            const label = document.createElement('span'); label.textContent = dept.Department_Name;
            const remove = button('×', () => { if(state.busy || !state.departmentsReady)return; state.departments = state.departments.filter(item => item.Department_Id !== dept.Department_Id); renderDepartments(); }, '');
            remove.disabled = !state.departmentsReady || state.busy;
            remove.setAttribute('aria-label', `ถอนกลุ่มงาน ${dept.Department_Name}`);
            chip.append(label, remove); container.append(chip);
        }
        if (!state.departments.length) container.textContent = 'ยังไม่มีกลุ่มงานที่ได้รับมอบหมาย';
    }
    async function editMember(user = null) {
        if (state.busy) return;
        if (user && !user.can_edit) return;
        state.editId = user ? Number(user.User_Id) : null;
        const dialogRequest = ++state.dialogRequest;
        state.memberVersion = ''; state.departmentsReady = !user;
        state.departmentRequest++; state.departments = [];
        el('form_user_data').reset();
        el('edit_id').value = state.editId || '';
        el('edit_name').value = user?.User_Name || '';
        el('edit_email').value = user?.User_Email || '';
        el('edit_name').disabled = el('edit_email').disabled = !!user;
        el('User_Status').querySelector('option[value=Editor]')?.remove();
        if (user?.User_Status === 'Editor') el('User_Status').add(new Option('ผู้แก้ไข (เดิม)', 'Editor'));
        el('User_Status').value = user?.User_Status || 'User';
        el('User_Status_Group').hidden = !!user || !state.canManage;
        el('User_Status').disabled = !!user;
        el('modal_title').textContent = user ? 'แก้ไขข้อมูลสมาชิก' : 'เพิ่มสมาชิกใหม่';
        el('password_1').required = el('password_2').required = !user;
        el('btn_delete_user').hidden = !user || Number(user.User_Id) === window.eofficeUser?.id;
        el('department_section').hidden = !user;
        el('department-search').disabled = !!user;
        el('department-loading').hidden = !user;
        el('txtHint_department').hidden = true;
        message('member-error', ''); renderDepartments();
        el('save-member').disabled = !!user;
        showDialog('modal_user_manage'); el('edit_name').focus();
        if (user) {
            const editId = state.editId;
            try {
                const data = await api(`get_user_departments_api.php?User_Id=${editId}`);
                if (dialogRequest !== state.dialogRequest || state.editId !== editId || el('modal_user_manage').hidden) return;
                // Keep fields and version from one consistent server snapshot.
                el('edit_name').value = data.user.User_Name; el('edit_email').value = data.user.User_Email;
                el('edit_name').disabled = el('edit_email').disabled = false;
                state.memberVersion = data.member_version;
                state.departments = data.data; state.departmentsReady = true;
                el('department-search').disabled = false; el('department-loading').hidden = true;
                renderDepartments(); el('save-member').disabled = false;
            } catch (error) {
                if (dialogRequest === state.dialogRequest) { el('department-loading').hidden = true; message('member-error', error.message, true); }
            }
        }
    }
    async function searchDepartments() {
        if (!state.departmentsReady || state.busy || el('modal_user_manage').hidden) return;
        const search = el('department-search').value.trim();
        const request = ++state.departmentRequest, editId = state.editId;
        const list = el('txtHint_department'); list.replaceChildren(); list.hidden = !search;
        if (!search) return;
        try {
            const data = await api(`search_departments_api.php?search=${encodeURIComponent(search)}`);
            if (request !== state.departmentRequest || editId !== state.editId) return;
            for (const dept of data.data) {
                const li = document.createElement('li');
                li.append(button(dept.Department_Name, () => {
                    if (!state.departmentsReady || state.busy || request !== state.departmentRequest) return;
                    if (!state.departments.some(item => Number(item.Department_Id) === Number(dept.Department_Id))) state.departments.push(dept);
                    renderDepartments(); list.hidden = true; el('department-search').value = ''; state.departmentRequest++;
                }, ''));
                list.append(li);
            }
            if (!data.data.length) { const li = document.createElement('li'); li.textContent = 'ไม่พบกลุ่มงาน'; list.append(li); }
        } catch (error) { if (request === state.departmentRequest) message('member-error', error.message, true); }
    }
    async function saveMember(event) {
        event.preventDefault(); if (state.busy || !state.departmentsReady) return;
        message('member-error', '');
        if (el('password_1').value !== el('password_2').value) { message('member-error', 'รหัสผ่านไม่ตรงกัน', true); return; }
        const form = new FormData(el('form_user_data'));
        if (state.editId) { form.delete('User_Status'); form.set('member_version', state.memberVersion); }
        if (state.editId) for (const dept of state.departments) form.append('Department_Id_Acc[]', dept.Department_Id);
        const wasNew = !state.editId;
        if (wasNew && form.get('User_Status') === 'Admin' && !confirm('บัญชีนี้จะเป็น Admin สูงสุดและเข้าถึงระบบทั้งหมด ต้องการดำเนินการหรือไม่?')) return;
        state.busy = true; el('save-member').disabled = true;
        try {
            const data = await api(wasNew ? 'new_user_api.php' : 'update_user_api.php', {method:'POST', body:form});
            state.busy = false; closeDialog('modal_user_manage');
            message('page-message', data.message); notifySessionChange();
            if (wasNew) { state.page = 1; el('search_txt').value = ''; el('permission-filter').value = ''; }
            await loadUsers();
            if (wasNew && state.canManage && form.get('User_Status') === 'User') editPermissions({User_Id:data.user_id, User_Name:form.get('User_name'), User_Email:form.get('User_Email'), permissions:[]});
        } catch (error) { message('member-error', error.message, true); }
        finally { state.busy = false; el('save-member').disabled = false; }
    }
    async function editStatus(user) {
        if (!state.canManage || state.busy) return;
        const dialogRequest = ++state.dialogRequest;
        state.statusUser = null;
        message('status-error', ''); el('status-member').textContent = user.User_Name;
        el('save-status').disabled = true; el('status-select').disabled = true;
        el('status-select').querySelector('option[value=Editor]')?.remove();
        showDialog('modal_status');
        try {
            const data = await api(`get_user_departments_api.php?User_Id=${user.User_Id}`);
            if (dialogRequest !== state.dialogRequest || el('modal_status').hidden) return;
            state.statusUser = {...data.user, member_version:data.member_version};
            if (data.user.User_Status === 'Editor') el('status-select').add(new Option('ผู้แก้ไข (เดิม)', 'Editor'));
            el('status-select').value = data.user.User_Status;
            el('status-select').disabled = false; el('save-status').disabled = false;
        } catch (error) { if (dialogRequest === state.dialogRequest) message('status-error', error.message, true); }
    }
    async function saveStatus(event) {
        event.preventDefault(); if (state.busy || !state.statusUser) return;
        const status = el('status-select').value;
        if (status === state.statusUser.User_Status) { closeDialog('modal_status'); return; }
        if (!confirm(status === 'Admin' ? 'ให้บัญชีนี้เป็น Admin สูงสุดและเข้าถึงระบบทั้งหมดหรือไม่?' : 'เปลี่ยนระดับผู้ใช้นี้หรือไม่? หากถอน Admin สูงสุด สิทธิ์เดิมจะถูกล้างและเหลือสิทธิ์พื้นฐาน')) return;
        state.busy = true; el('save-status').disabled = true;
        try {
            const data = await api('save_user_status_api.php', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user_id:state.statusUser.User_Id,status,member_version:state.statusUser.member_version})});
            state.busy = false; closeDialog('modal_status');
            message('page-message', data.message); notifySessionChange(); await loadUsers();
        } catch (error) { message('status-error', error.message, true); }
        finally { state.busy = false; el('save-status').disabled = false; }
    }
    async function editPermissions(user) {
        if (!state.canManage || state.busy) return;
        const dialogRequest = ++state.dialogRequest;
        state.permissionId = Number(user.User_Id);
        state.permissionVersion = '';
        el('permissions-member').textContent = `${user.User_Name} — ${user.User_Email}`;
        message('permissions-error', '');
        const options = el('permission-options'); options.replaceChildren();
        el('save-permissions').disabled = true;
        message('permissions-loading', 'กำลังโหลดสิทธิ์ปัจจุบัน...');
        showDialog('modal_permissions');
        try {
            const data = await api(`get_user_departments_api.php?User_Id=${user.User_Id}`);
            if (dialogRequest !== state.dialogRequest || el('modal_permissions').hidden) return;
            if (data.user.User_Status === 'Admin') throw new Error('บัญชีนี้เปลี่ยนเป็น Admin สูงสุดแล้ว กรุณาเปิดข้อมูลใหม่');
            state.permissionVersion = data.permission_version;
            el('permissions-member').textContent = `${data.user.User_Name} — ${data.user.User_Email}`;
            for (const [key, item] of Object.entries(state.catalog)) {
                const label = document.createElement('label'); label.className = 'permission-option';
                const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'permissions'; input.value = key; input.checked = data.permissions.includes(key);
                const description = document.createElement('span');
                description.innerHTML = `<strong>${escapeHTML(item.label)}</strong><span class="muted">${escapeHTML(item.description)}</span>`;
                label.append(input, description); options.append(label);
            }
            message('permissions-loading', ''); el('save-permissions').disabled = false;
        } catch (error) {
            if (dialogRequest === state.dialogRequest) { state.permissionVersion = ''; message('permissions-loading', ''); message('permissions-error', error.message, true); }
        }
    }
    async function savePermissions(event) {
        event.preventDefault(); if (state.busy || !state.permissionVersion) return;
        const permissions = new FormData(el('form_permissions')).getAll('permissions');
        state.busy = true; el('save-permissions').disabled = true;
        try {
            const data = await api('save_user_permissions_api.php', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user_id:state.permissionId, permissions,permission_version:state.permissionVersion})});
            state.busy = false; closeDialog('modal_permissions');
            message('page-message', data.message); notifySessionChange(); await loadUsers();
        } catch (error) { message('permissions-error', error.message, true); }
        finally { state.busy = false; el('save-permissions').disabled = false; }
    }
    async function deleteMember() {
        if (state.busy || !state.editId || !confirm('ต้องการลบสมาชิกนี้อย่างถาวรหรือไม่?')) return;
        state.busy = true; el('btn_delete_user').disabled = true;
        try {
            const form = new FormData(); form.append('User_Id', state.editId);
            const data = await api('delete_user_api.php', {method:'POST', body:form});
            state.busy = false; closeDialog('modal_user_manage'); message('page-message', data.message); await loadUsers();
        } catch (error) { message('member-error', error.message, true); }
        finally { state.busy = false; el('btn_delete_user').disabled = false; }
    }
    function debounce(fn) { let timer; return () => { clearTimeout(timer); timer = setTimeout(fn, 250); }; }
    el('search_txt').addEventListener('input', debounce(() => { state.page = 1; loadUsers(); }));
    el('permission-filter').addEventListener('change', () => { state.page = 1; loadUsers(); });
    el('department-search').addEventListener('input', debounce(searchDepartments));
    el('add-member').addEventListener('click', () => editMember());
    el('form_user_data').addEventListener('submit', saveMember);
    el('form_permissions').addEventListener('submit', savePermissions);
    el('form_status').addEventListener('submit', saveStatus);
    el('btn_delete_user').addEventListener('click', deleteMember);
    document.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => closeDialog(node.dataset.close)));
    document.addEventListener('keydown', event => {
        const overlay = [...document.querySelectorAll('.overlay')].find(node => !node.hidden);
        if (!overlay) return;
        if (event.key === 'Escape') closeDialog(overlay.id);
        if (event.key === 'Tab') {
            const nodes = [...overlay.querySelectorAll('button, input, select')].filter(node => !node.disabled && node.getClientRects().length);
            const first = nodes[0], last = nodes[nodes.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    window.sessionReady.then(loadUsers);
    window.addEventListener('eoffice-sign-routes-changed', loadUsers);
})();
