(() => {
    const U = OrderUI, el = id => document.getElementById(id);
    const buttonLabels = {save: 'บันทึกการตั้งค่า', models: 'โหลดรายชื่อโมเดล', test: 'ทดสอบ AI'};
    const buttonIds = {save: 'save', models: 'load-models', test: 'test-ai'};
    let saved = null, busy = false, ready = false, saveError = '', enabledBeforeClear = false;

    function dateTime(value, fallback) {
        if (!value) return fallback;
        const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
        if (!parts) return value;
        const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
        return date.toLocaleDateString('th-TH', {day: 'numeric', month: 'short', year: 'numeric'}) + ` · ${parts[4]}:${parts[5]} น.`;
    }
    function dirty() {
        return Boolean(saved && (el('api-key').value || el('clear-key').checked || el('model').value.trim() !== saved.model || el('enabled').checked !== saved.enabled));
    }
    function status(id, text, good) {
        el(id).textContent = text;
        el(id).className = good ? 'status-good' : 'status-warning';
    }
    function hideKey() {
        el('api-key').type = 'password';
        el('show-key').textContent = 'แสดง';
        el('show-key').setAttribute('aria-pressed', 'false');
    }
    function syncModelOption() {
        const model = el('model').value.trim();
        el('model-options').value = [...el('model-options').options].some(option => option.value === model) ? model : '';
    }
    function updateControls() {
        const clear = el('clear-key').checked;
        el('settings-fields').disabled = busy || !ready;
        el('settings-form').setAttribute('aria-busy', String(busy || !ready));
        el('save').disabled = busy || !ready || !dirty();
        el('retry-load').disabled = busy;
        el('api-key').disabled = clear;
        el('enabled').disabled = clear;
        el('show-key').disabled = clear || !el('api-key').value;
        el('load-models').disabled = clear;
        el('test-ai').disabled = clear;
        el('clear-key').disabled = !saved?.encryption_ready;
        el('delivery-preview').textContent = clear ? 'กำลังเตรียมล้าง key และหยุดส่งเมื่อบันทึก' : el('enabled').checked ? 'จะเปิดส่งอัตโนมัติเมื่อบันทึก' : 'จะหยุดส่งอัตโนมัติเมื่อบันทึก';
        if (!busy) {
            el('save-state').textContent = saveError ? 'บันทึกไม่สำเร็จ · ' + saveError : !ready ? 'ยังไม่พร้อมแก้ไขการตั้งค่า' : dirty() ? 'มีการเปลี่ยนแปลงที่ยังไม่บันทึก' : 'การตั้งค่าเป็นปัจจุบัน';
            el('save-state').classList.toggle('error', Boolean(saveError));
            el('save-help').textContent = clear ? 'บันทึกเพื่อล้าง key และหยุดการส่งอัตโนมัติ' : 'การทดสอบ AI ไม่ได้บันทึกค่าลงระบบ';
        }
    }
    function render(settings) {
        saved = settings; ready = true; saveError = ''; enabledBeforeClear = settings.enabled;
        el('enabled').checked = settings.enabled;
        el('model').value = settings.model;
        el('api-key').value = ''; el('clear-key').checked = false; hideKey();
        status('saved-delivery', settings.enabled ? 'เปิดส่งอัตโนมัติ' : settings.activated_at ? 'หยุดส่งชั่วคราว' : 'ยังไม่เปิดใช้งาน', settings.enabled);
        el('saved-delivery-note').textContent = settings.enabled ? 'ระบบจะทำงานตามรอบ Cron' : 'เปิดสวิตช์และบันทึกเพื่อเริ่มส่ง';
        status('saved-key', settings.key_configured ? 'ตั้งค่าแล้ว' : 'ยังไม่มี API key', settings.key_configured);
        el('saved-key-source').textContent = settings.key_configured ? 'ใช้ key จาก' + (settings.key_source === 'admin' ? 'หน้า Admin' : 'เซิร์ฟเวอร์') + ' · ปิดบังค่า' : 'กำหนด key ใหม่ หรือให้ผู้ดูแลตั้งบนเซิร์ฟเวอร์';
        status('saved-encryption', settings.encryption_ready ? 'พร้อมบันทึก key' : 'ยังไม่พร้อม', settings.encryption_ready);
        el('saved-encryption-note').textContent = settings.encryption_ready ? 'เข้ารหัสก่อนจัดเก็บในระบบ' : 'ต้องตั้ง EOFFICE_SETTINGS_KEY';
        el('encryption-notice').hidden = settings.encryption_ready;
        status('saved-worker', dateTime(settings.worker_at, 'ยังไม่พบการทำงาน'), Boolean(settings.worker_at));
        el('activation-date').textContent = dateTime(settings.activated_at, 'ยังไม่เคยเปิดใช้งาน');
        el('summary').setAttribute('aria-busy', 'false');
        syncModelOption();
    }
    function invalidateTest() {
        el('test-result').textContent = 'ยังไม่ได้ทดสอบค่าชุดนี้';
        el('test-result').classList.remove('ok', 'error');
    }

    async function load() {
        if (busy) return;
        busy = true; ready = false; updateControls();
        U.message('message', 'กำลังโหลดการตั้งค่า…');
        el('load-error').hidden = true;
        try {
            const result = await U.request('ai_settings.php');
            render(result.settings); U.message('message', '');
        } catch (error) {
            U.message('message', error.message, true);
            el('load-error').hidden = false;
            el('saved-delivery').textContent = 'โหลดไม่สำเร็จ';
            el('summary').setAttribute('aria-busy', 'false');
        } finally { busy = false; updateControls(); }
    }

    async function run(action) {
        if (busy || !ready) return;
        if (action !== 'models' && !el('model').reportValidity()) return;
        if (action === 'save' && !dirty()) return;
        const clear = el('clear-key').checked;
        // Candidate key is only kept in this form and sent to the protected API.
        const data = {action, api_key: clear ? '' : el('api-key').value.trim(), model: el('model').value.trim()};
        if (action === 'save') {
            data.enabled = clear ? false : el('enabled').checked;
            data.clear_key = clear;
            data.revision = saved.revision;
            if (data.api_key && !saved.encryption_ready) {
                saveError = 'ยังบันทึก API key ใหม่ไม่ได้ กรุณาตั้ง EOFFICE_SETTINGS_KEY บนเซิร์ฟเวอร์ก่อน';
                U.message('message', saveError, true); updateControls();
                el('api-key').focus(); return;
            }
        }
        busy = true; hideKey(); updateControls();
        const button = el(buttonIds[action]);
        button.textContent = action === 'save' ? 'กำลังบันทึก…' : action === 'models' ? 'กำลังโหลด…' : 'กำลังทดสอบ…';
        if (action === 'save') {
            saveError = ''; el('save-state').classList.remove('error');
            el('save-state').textContent = 'กำลังตรวจสอบและบันทึกการตั้งค่า…';
            U.message('message', 'กำลังบันทึก หากเปลี่ยน key หรือเปิดส่ง ระบบจะตรวจสอบ AI ก่อนบันทึก');
        } else if (action === 'test') {
            el('test-result').classList.remove('ok', 'error');
            el('test-result').textContent = 'กำลังทดสอบ key และโมเดลด้วย PDF ตัวอย่าง…';
        } else {
            U.message('models-message', 'กำลังขอรายชื่อโมเดลจาก Gemini…');
        }
        try {
            const result = await U.request('ai_settings.php', data);
            if (action === 'models') {
                el('models').replaceChildren();
                el('model-options').replaceChildren(new Option('เลือกโมเดล…', ''));
                for (const model of result.models) {
                    const option = new Option(model.label + ' · ' + model.id, model.id);
                    el('model-options').add(option);
                    const suggestion = new Option(model.label, model.id);
                    el('models').append(suggestion);
                }
                el('model-picker').hidden = !result.models.length;
                syncModelOption();
                U.message('models-message', result.models.length ? `โหลด ${result.models.length.toLocaleString('th-TH')} โมเดลแล้ว เลือกจากรายการหรือพิมพ์ชื่อเองได้` : 'ไม่พบโมเดลที่รองรับจาก key นี้');
            } else if (action === 'test') {
                U.message('test-result', `ทดสอบ ${data.model} สำเร็จ · เชื่อมต่อและอ่าน PDF ตัวอย่างได้`);
            } else {
                render(result.settings); invalidateTest();
                U.message('message', result.message);
            }
        } catch (error) {
            if (action === 'save') saveError = error.message;
            U.message(action === 'models' ? 'models-message' : action === 'test' ? 'test-result' : 'message', error.message, true);
        } finally { busy = false; button.textContent = buttonLabels[action]; updateControls(); }
    }

    el('settings-form').onsubmit = event => { event.preventDefault(); run('save'); };
    el('load-models').onclick = () => run('models');
    el('test-ai').onclick = () => run('test');
    el('retry-load').onclick = load;
    el('show-key').onclick = () => {
        const reveal = el('api-key').type === 'password';
        el('api-key').type = reveal ? 'text' : 'password';
        el('show-key').textContent = reveal ? 'ซ่อน' : 'แสดง';
        el('show-key').setAttribute('aria-pressed', String(reveal));
    };
    el('api-key').addEventListener('input', () => { saveError = ''; if (!el('api-key').value) hideKey(); invalidateTest(); updateControls(); });
    el('model').addEventListener('input', () => { saveError = ''; syncModelOption(); invalidateTest(); updateControls(); });
    el('model-options').addEventListener('change', () => {
        if (el('model-options').value) { saveError = ''; el('model').value = el('model-options').value; invalidateTest(); updateControls(); }
    });
    el('enabled').addEventListener('change', () => { saveError = ''; updateControls(); });
    el('clear-key').addEventListener('change', () => {
        saveError = '';
        if (el('clear-key').checked) { enabledBeforeClear = el('enabled').checked; el('enabled').checked = false; }
        else el('enabled').checked = enabledBeforeClear;
        hideKey(); invalidateTest(); updateControls();
    });
    window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
    load();
})();
