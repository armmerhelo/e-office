(() => {
    const U = OrderUI, C=OrderSettingsControls, K=OrderKeyring, el = id => document.getElementById(id);
    const buttonLabels = {save: 'บันทึกการตั้งค่า', models: 'โหลดรายชื่อโมเดล', test: 'ทดสอบ AI'};
    const buttonIds = {save: 'save', models: 'load-models', test: 'test-ai'};
    let saved = null, busy = false, ready = false, saveError = '', enabledBeforeClear = false;

    function dateTime(value, fallback) {
        if (!value) return fallback;
        const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
        if (!parts) return value;
        const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
        if(/(?:Z|[+-]\d{2}:\d{2})$/.test(String(value))){const instant=new Date(value);return instant.toLocaleString('th-TH',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+' น.';}
        return date.toLocaleDateString('th-TH', {day: 'numeric', month: 'short', year: 'numeric'}) + ` · ${parts[4]}:${parts[5]} น.`;
    }
    function dirty() {
        return Boolean(saved && (K.dirty() || settingsDirty()));
    }
    function settingsDirty(){return Boolean(saved&&(C.dirty(saved)||el('api-key').value||el('clear-key').checked||el('model').value.trim()!==saved.model||el('enabled').checked!==saved.enabled));}
    function templateDirty(){return Boolean(saved&&['subject','intro','signature'].some(id=>el(id).value.trim()!==saved.options[id]));}
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
        const hasKey = Boolean(el('api-key').value.trim() || saved?.key_configured);
        el('settings-fields').disabled = busy || !ready;
        el('settings-form').setAttribute('aria-busy', String(busy || !ready));
        el('save').disabled = busy || !ready || !settingsDirty();
        el('save-top').disabled = el('save').disabled;
        el('save-template').disabled=busy||!ready||!templateDirty();
        el('discard').disabled = busy || !ready || !settingsDirty();
        el('save-state').classList.toggle('unsaved', ready && settingsDirty());
        el('retry-load').disabled = busy;
        el('refresh-settings').disabled=busy;
        K.controls();
        el('smtp-admin').hidden=el('smtp_source').value!=='admin';
        el('delivery-mode').value=!el('enabled').checked?'stopped':el('analysis_only').checked?'analysis':el('require_approval').checked?'approval':'automatic';
        el('delivery-mode').disabled=clear;
        el('keyring-fields').disabled=busy||!ready;
        el('keyring-discard').disabled=busy||!ready||!K.dirty();
        el('keyring-title').textContent=K.dirty()?'คลัง API Key · มีแบบร่างที่ยังไม่บันทึก':'คลัง API Key · จัดการแยกจากการตั้งค่าหลัก';
        el('pdf-test').disabled=clear||!hasKey;
        el('api-key').disabled = clear;
        el('enabled').disabled = clear;
        el('show-key').disabled = clear || !el('api-key').value;
        el('load-models').disabled = clear || !hasKey;
        el('test-ai').disabled = clear || !hasKey;
        el('connection-help').hidden = hasKey && !clear;
        el('connection-help').textContent = clear ? 'ยกเลิกการล้าง key ก่อนโหลดโมเดลหรือทดสอบ AI' : 'กรอก API key ด้านบนก่อนโหลดโมเดลหรือทดสอบ AI';
        el('clear-key').disabled = !saved?.encryption_ready;
        const deliveryChanged = saved && el('enabled').checked !== saved.enabled;
        el('delivery-preview').textContent = clear ? 'กำลังเตรียมล้าง key และหยุดระบบเมื่อบันทึก' : deliveryChanged ? (el('enabled').checked ? 'จะเปิดระบบเมื่อบันทึก' : 'จะหยุดระบบเมื่อบันทึก') : el('enabled').checked ? 'เปิดใช้งานอยู่ · ทำงานตามรอบ Cron' : 'ปิดอยู่ · ยังไม่ส่งอีเมลอัตโนมัติ';
        if(!clear&&el('enabled').checked&&el('analysis_only').checked)el('delivery-preview').textContent='วิเคราะห์ตามรอบ Cron · เก็บรายชื่อไว้ ยังไม่ส่งเมล'+(dirty()?' (มีค่าที่ยังไม่บันทึก)':'');
        else if(!clear&&el('enabled').checked&&el('require_approval').checked)el('delivery-preview').textContent='วิเคราะห์แล้วรอเจ้าหน้าที่ตรวจผู้รับก่อนส่ง'+(dirty()?' (มีค่าที่ยังไม่บันทึก)':'');
        if (!busy) {
            el('save-state').textContent = saveError ? 'บันทึกไม่สำเร็จ · ' + saveError : !ready ? 'ยังไม่พร้อมแก้ไขการตั้งค่า' : settingsDirty() ? 'มีการตั้งค่าที่ยังไม่บันทึก' : 'การตั้งค่าเป็นปัจจุบัน';
            el('save-state').classList.toggle('error', Boolean(saveError));
            el('save-help').textContent = clear ? 'บันทึกเพื่อล้าง key และหยุดการส่งอัตโนมัติ' : 'การทดสอบ AI ไม่ได้บันทึกค่าลงระบบ';
        }
        const remaining=C.cooldownRemaining();
        for(const [id,label] of [['smtp-check','ตรวจการเชื่อมต่อ SMTP'],['smtp-test','ส่งอีเมลทดสอบ']]){el(id).disabled=busy||!ready||remaining>0;el(id).textContent=remaining?`${label} · รอ ${remaining} วินาที`:label;}
        if(saved)C.readiness(saved,dateTime,{enabled:!clear&&el('enabled').checked,model:el('model').value.trim(),api_key:el('api-key').value.trim(),options:C.values(),smtp_password:C.password()});
    }
    function render(settings,preserveSettings=false,preserveKeyring=false) {
        saved = settings; ready = true; saveError = '';
        if(!preserveSettings)enabledBeforeClear = settings.enabled;
        C.render(settings,dateTime,preserveSettings);
        K.render(settings,dateTime,keyAction,preserveKeyring);
        if(!preserveSettings){
            el('enabled').checked = settings.enabled;
            el('model').value = settings.model;
            el('api-key').value = ''; el('clear-key').checked = false; hideKey();
        }
        renderSummary(settings);
        syncModelOption();
    }
    function renderSummary(settings) {
        status('saved-delivery', settings.enabled ? (settings.options.analysis_only?'วิเคราะห์อย่างเดียว':settings.options.require_approval?'เปิดระบบ · รอตรวจผู้รับ':'เปิดส่งอัตโนมัติ') : settings.activated_at ? 'หยุดส่งชั่วคราว' : 'ยังไม่เปิดใช้งาน', settings.enabled);
        el('saved-delivery-note').textContent = settings.enabled ? (settings.options.analysis_only?'ยังไม่ส่งเมลถึงผู้รับ':'ระบบจะทำงานตามรอบ Cron') : 'เปิดระบบ เลือกโหมด และบันทึกเพื่อเริ่มทำงาน';
        status('saved-key', settings.key_configured ? (settings.key_usable?'ตั้งค่าแล้ว':'มีข้อมูล แต่ถอดรหัสไม่ได้') : 'ยังไม่มี API key', settings.key_usable);
        el('saved-key-source').textContent = settings.key_configured ? 'ใช้ key จาก' + (settings.key_source === 'admin' ? 'หน้า Admin' : 'เซิร์ฟเวอร์') + ' · ปิดบังค่า' : 'กำหนด key ใหม่ หรือให้ผู้ดูแลตั้งบนเซิร์ฟเวอร์';
        const activeKey=settings.keyring.keys.find(key=>key.active);
        if(activeKey)el('saved-key-source').textContent=activeKey.label+' · '+activeKey.reference+' · ปิดบังค่า';
        status('saved-encryption', settings.encryption_ready ? 'พร้อมบันทึก key' : 'ยังไม่พร้อม', settings.encryption_ready);
        el('saved-encryption-note').textContent = settings.encryption_ready ? 'เข้ารหัสก่อนจัดเก็บในระบบ' : 'ต้องตั้ง EOFFICE_SETTINGS_KEY';
        el('encryption-notice').hidden = settings.encryption_ready;
        status('saved-worker', dateTime(settings.worker_at, 'ยังไม่พบการทำงาน'), settings.diagnostics.cron.state==='healthy');
        el('activation-date').textContent = dateTime(settings.activated_at, 'ยังไม่เคยเปิดใช้งาน');
        el('summary').setAttribute('aria-busy', 'false');
        const needsSetup = !settings.key_configured || !settings.encryption_ready;
        el('readiness-title').textContent = !settings.key_usable ? 'API key ยังไม่พร้อมใช้งาน' : !settings.diagnostics.smtp.configured&&!settings.options.analysis_only?'SMTP ยังไม่พร้อมส่งอีเมล':settings.diagnostics.cron.state!=='healthy'?'Cron ยังไม่พร้อมหรือทำงานล่าช้า':settings.enabled ? (settings.options.analysis_only?'เปิดวิเคราะห์อย่างเดียว · ยังไม่ส่งอีเมล':'เปิดระบบแล้ว · ตรวจสอบงานได้ที่หน้าติดตาม') : 'ตั้งค่าระบบแล้ว · การทำงานอัตโนมัติปิดอยู่';
        el('readiness-description').textContent = !settings.encryption_ready ? 'ตั้ง EOFFICE_SETTINGS_KEY บนเซิร์ฟเวอร์เพื่อบันทึก key ผ่านหน้านี้ จากนั้นกำหนด key และทดสอบ AI' : !settings.key_configured ? 'เพิ่ม Gemini API key เลือกโมเดล แล้วทดสอบการอ่าน PDF ก่อนเปิดระบบและบันทึก' : !settings.worker_at ? 'ให้ผู้ดูแลตรวจ Cron ที่เรียก php scripts/order-emails.php ทุก 5 นาที การมี key ยังไม่ได้ยืนยันว่าทดสอบ AI ผ่าน' : 'สถานะนี้เป็นค่าที่บันทึกไว้ ตรวจความพร้อมของค่าที่กำลังแก้ไขด้านล่าง แล้วบันทึกเพื่อให้มีผล';
        if(settings.key_configured&&!settings.key_usable)el('readiness-description').textContent='มีข้อมูล API key แต่ถอดรหัสไม่ได้ ตรวจ EOFFICE_SETTINGS_KEY หรือบันทึก key ใหม่ คุณยังหยุดระบบได้';
        else if(settings.key_usable&&!settings.diagnostics.smtp.configured&&!settings.options.analysis_only)el('readiness-description').textContent='กำหนด SMTP และผู้ส่งให้ครบ แล้วส่งอีเมลทดสอบก่อนเปิดการส่งจริง';
        else if(settings.key_usable&&settings.diagnostics.cron.state!=='healthy')el('readiness-description').textContent='ตรวจเวลาทำงานล่าสุดและ log บนเซิร์ฟเวอร์ การเคยมี heartbeat ไม่ได้ยืนยันว่า Cron ยังทำงานอยู่';
        el('readiness-action').hidden = false;
        el('readiness-action').href = needsSetup||!settings.key_usable ? '#connection-title' : !settings.diagnostics.smtp.configured&&!settings.options.analysis_only?'#smtp-title':settings.diagnostics.cron.state!=='healthy' ? '#server-guide' : '#delivery-title';
        el('readiness-action').textContent = needsSetup||!settings.key_usable ? 'ตั้งค่าการเชื่อมต่อ ↓' : !settings.diagnostics.smtp.configured&&!settings.options.analysis_only?'ตั้งค่า SMTP ↓':settings.diagnostics.cron.state!=='healthy' ? 'ดูคู่มือตั้ง Cron ↓' : 'ดูการส่งอัตโนมัติ ↓';
    }
    function invalidateTest() {
        el('test-result').textContent = 'ยังไม่ได้ทดสอบค่าชุดนี้';
        el('test-result').classList.remove('ok', 'error');
    }
    async function keyAction(action,extra){
        if(busy||!ready)return;
        if(!K.confirmDrafts(action,extra))return;
        busy=true;hideKey();updateControls();U.message('keyring-message','กำลังดำเนินการ…');
        try{
            const result=await U.request('ai_settings.php',{action,revision:saved.revision,model:saved.model,...extra});
            render(result.settings,true);if(['key_activate','key_server'].includes(action)&&!el('api-key').value)invalidateTest();U.message('keyring-message',result.message+' · แบบร่างการตั้งค่าหลักยังคงอยู่');
            el('keyring-form').dispatchEvent(new Event('eoffice:form-saved',{bubbles:true}));
        }catch(error){U.message('keyring-message',error.message+' · หากมีการทดสอบแล้ว ให้โหลดค่าล่าสุดก่อนทำรายการต่อ',true);}
        finally{busy=false;updateControls();}
    }

    async function saveTemplate(){
        if(busy||!ready||!templateDirty()||!C.validate('save_template'))return;
        const data={action:'save_template',revision:saved.revision,options:C.optionsFor('save_template')};
        busy=true;hideKey();updateControls();U.message('template-result','กำลังบันทึกข้อความอีเมล…');
        try{
            const result=await U.request('ai_settings.php',data);
            render(result.settings,true,true);
            for(const id of ['subject','intro','signature'])el(id).value=saved.options[id];
            if(!settingsDirty())el('settings-form').dispatchEvent(new Event('eoffice:form-saved',{bubbles:true}));
            U.message('template-result',result.message+(settingsDirty()?' · การตั้งค่าส่วนอื่นยังเป็นแบบร่าง':''));
        }catch(error){U.message('template-result',error.message,true);}
        finally{busy=false;updateControls();}
    }

    async function load() {
        if (busy) return;
        busy = true; ready = false; updateControls();
        U.message('message', 'กำลังโหลดการตั้งค่า…');
        el('load-error').hidden = true;
        try {
            const result = await U.request('ai_settings.php');
            render(result.settings); U.message('message', '');
            for(const id of ['settings-form','keyring-form'])el(id).dispatchEvent(new Event('eoffice:form-saved',{bubbles:true}));
        } catch (error) {
            U.message('message', error.message, true);
            el('readiness-title').textContent = 'ยังตรวจสอบความพร้อมไม่ได้';
            el('readiness-description').textContent = 'ลองโหลดอีกครั้งด้านล่าง เพื่อดูสถานะและแก้ไขการตั้งค่า';
            el('readiness-action').hidden = true;
            el('load-error').hidden = false;
            el('saved-delivery').textContent = 'โหลดไม่สำเร็จ';
            el('summary').setAttribute('aria-busy', 'false');
        } finally { busy = false; updateControls(); }
    }

    async function run(action) {
        if (busy || !ready) return;
        if (action !== 'models' && !el('model').reportValidity()) return;
        if (action === 'save' && (!settingsDirty()||!C.validate('save'))) return;
        const clear = el('clear-key').checked;
        if ((action === 'models' || action === 'test') && (clear || !(el('api-key').value.trim() || saved.key_configured))) return;
        // Candidate credentials stay in page memory and the protected request only.
        const data = {action, api_key: clear ? '' : el('api-key').value.trim(), model: el('model').value.trim()};
        data.options=C.optionsFor(action);data.smtp_password=C.password();
        if (action === 'save') {
            data.enabled = clear ? false : el('enabled').checked;
            data.clear_key = clear;
            data.revision = saved.revision;
            const releasesHold=!data.options.analysis_only&&!data.options.require_approval&&(saved.options.analysis_only||saved.options.require_approval);
            const enablesDelivery=data.enabled&&!data.options.analysis_only&&(!saved.enabled||saved.options.analysis_only||releasesHold);
            if(enablesDelivery){
                const d=saved.diagnostics;
                if(!confirm(`ยืนยันเปลี่ยนโหมดเป็น “${data.options.require_approval?'วิเคราะห์และรอตรวจผู้รับ':'วิเคราะห์และส่งอัตโนมัติ'}”?\nสถานะคิวล่าสุดที่โหลด: งานรอคิว ${d.counts.queued||0} งาน · งานรอตรวจ/พัก ${d.counts.awaiting_approval||0} งาน · ผู้รับรอส่งรวม ${d.pending_recipients} คน\n${data.options.require_approval?'งานใหม่ต้องรอเจ้าหน้าที่ตรวจผู้รับ ส่วนงานที่อนุมัติแล้วอาจส่งในรอบ Cron ถัดไป':'งานที่พักตามนโยบายจะกลับเข้าคิว งานที่พร้อมอาจเริ่มส่งในรอบ Cron ถัดไป'}\nจำนวนข้างต้นเป็นภาพรวม ไม่ใช่จำนวนที่จะส่งทันที`))return;
            }
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
                C.noteTest(action,data,result,saved);
                U.message('test-result', `ทดสอบ ${data.model} สำเร็จ · เชื่อมต่อและอ่าน PDF ตัวอย่างได้`);
                await refreshDiagnostics();
            } else {
                render(result.settings,false,true); invalidateTest();
                U.message('message', result.message);
                el('settings-form').dispatchEvent(new Event('eoffice:form-saved', {bubbles:true}));
            }
        } catch (error) {
            if (action === 'save') saveError = error.message;
            U.message(action === 'models' ? 'models-message' : action === 'test' ? 'test-result' : 'message', error.message, true);
        } finally { busy = false; button.textContent = buttonLabels[action]; updateControls(); }
    }
    async function refreshDiagnostics(){
        try{
            const result=await U.request('ai_settings.php');
            // Do not silently adopt another administrator's revision while a draft is open.
            if(result.settings.revision===saved.revision){
                saved={...saved,worker_at:result.settings.worker_at,diagnostics:result.settings.diagnostics};
                C.render(saved,dateTime,true);
                renderSummary(saved);
            }
            else U.message('message','การตั้งค่าถูกแก้ไขจากที่อื่น แบบร่างยังอยู่ กรุณาโหลดค่าล่าสุดก่อนบันทึก',true);
        }catch{U.message('message','ทดสอบเสร็จแล้ว แต่โหลดสถานะล่าสุดไม่ได้ แบบร่างยังอยู่ กรุณาลองรีเฟรชภายหลัง',true);}
    }

    el('settings-form').onsubmit = event => { event.preventDefault(); run('save'); };
    el('save-top').onclick=()=>run('save');
    el('save-template').onclick=saveTemplate;
    el('keyring-form').onsubmit=event=>event.preventDefault();
    el('keyring-discard').onclick=()=>{if(busy||!ready)return;K.render(saved,dateTime,keyAction);updateControls();el('keyring-form').dispatchEvent(new Event('eoffice:form-saved',{bubbles:true}));U.message('keyring-message','ยกเลิกแบบร่างในคลัง Key แล้ว');};
    el('load-models').onclick = () => run('models');
    el('test-ai').onclick = () => run('test');
    el('retry-load').onclick = load;
    el('refresh-settings').onclick=()=>{if(!dirty()||confirm('โหลดค่าล่าสุดและยกเลิกการแก้ไขที่ยังไม่บันทึก?'))load();};
    el('settings-form').addEventListener('input',()=>{saveError='';updateControls();});
    el('settings-form').addEventListener('change',()=>{saveError='';updateControls();});
    for(const [id,action,target] of [['smtp-check','smtp_check','smtp-result'],['smtp-test','smtp_test','smtp-result'],['preview-mail','preview','message'],['pdf-test','pdf_test','pdf-result']]){
        el(id).onclick=async()=>{
            if(busy||!ready)return;
            if((action==='smtp_test'||action==='smtp_check')&&C.cooldownRemaining())return;
            if(!C.validate(action))return;
            const data={action,options:C.optionsFor(action),smtp_password:C.password(),model:el('model').value.trim(),api_key:el('api-key').value.trim()};
            busy=true;hideKey();updateControls();U.message(target,'กำลังดำเนินการ…');
            try{const result=await C.run(action,data);C.noteTest(action,data,result,saved);if(action==='preview')U.message(target,'แสดงตัวอย่างจากค่าที่กรอกแล้ว');else await refreshDiagnostics();}
            catch(error){if(error.retryAfter)C.cooldown(error.retryAfter);U.message(target,error.message,true);}
            finally{busy=false;updateControls();}
        };
    }
    el('readiness-action').onclick = event => {
        if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const target = el(el('readiness-action').getAttribute('href').slice(1));
        if (!target) return;
        // Fragment navigation cannot resolve IDs inside the module's shadow root.
        event.preventDefault();
        if (target.id === 'server-guide') target.open = true;
        target.setAttribute('tabindex', '-1');
        target.focus({preventScroll: true});
        target.scrollIntoView({block: 'start'});
    };
    el('discard').onclick = () => {
        if (busy || !ready || !settingsDirty()) return;
        render(saved,false,true); invalidateTest(); updateControls();
        U.message('message', 'ยกเลิกการแก้ไขแล้ว ใช้ค่าที่บันทึกไว้ล่าสุด');
        leavingConfirmed = false;
        el('settings-form').dispatchEvent(new Event('eoffice:form-saved', {bubbles:true}));
    };
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
    const selectMode=()=>{
        const mode=el('delivery-mode').value;
        el('enabled').checked=mode!=='stopped';
        if(mode!=='stopped'){el('analysis_only').checked=mode==='analysis';el('require_approval').checked=mode==='approval';}
        saveError='';updateControls();
    };
    el('delivery-mode').addEventListener('input',selectMode);
    el('delivery-mode').addEventListener('change',selectMode);
    el('clear-key').addEventListener('change', () => {
        saveError = '';
        if (el('clear-key').checked) { enabledBeforeClear = el('enabled').checked; el('enabled').checked = false; }
        else el('enabled').checked = enabledBeforeClear;
        hideKey(); invalidateTest(); updateControls();
    });
    let leavingConfirmed = false;
    window.addEventListener('eoffice:leaving-confirmed', () => { leavingConfirmed = true; });
    window.addEventListener('eoffice:leaving-cancelled', () => { leavingConfirmed = false; });
    const revokeLeaving = () => {leavingConfirmed=false;};
    el('settings-form').addEventListener('input',revokeLeaving);
    el('settings-form').addEventListener('change',revokeLeaving);
    el('settings-form').addEventListener('eoffice:form-dirty',revokeLeaving);
    for(const type of ['input','change'])el('keyring-form').addEventListener(type,()=>{revokeLeaving();updateControls();});
    // The shell observes edits after the form listener. Clear its generic dirty
    // marker after bubbling when only test inputs changed or edits were reverted.
    for(const [id,changed] of [['settings-form',settingsDirty],['keyring-form',K.dirty]])for(const type of ['input','change'])el(id).addEventListener(type,()=>{
        Promise.resolve().then(()=>{if(ready&&!changed())el(id).dispatchEvent(new Event('eoffice:form-saved',{bubbles:true}));});
    });
    let lastCooldown=0,lastExpiryCheck=Date.now();
    setInterval(()=>{
        const remaining=C.cooldownRemaining();
        if(ready&&!busy&&(remaining!==lastCooldown||Date.now()-lastExpiryCheck>=60000)){updateControls();lastCooldown=remaining;lastExpiryCheck=Date.now();}
    },1000);
    window.addEventListener('pageshow', () => { leavingConfirmed = false; });
    window.addEventListener('beforeunload', event => { if (!leavingConfirmed && dirty()) { event.preventDefault(); event.returnValue = ''; } });
    if(window.eofficeRegisterModuleRefresh)window.eofficeRegisterModuleRefresh(()=>{if(!busy&&!dirty())return load();});
    else load();
})();
