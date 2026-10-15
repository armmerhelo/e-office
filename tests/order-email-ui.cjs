// Regression checks for the order-email pages without a live database or provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
    constructor(tag = 'div', id = '') {
        this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.events = {};
        this.attributes = {}; this.dataset = {}; this.style = {}; this.value = ''; this.checked = false;
        this.disabled = false; this.hidden = false; this.open = false; this.type = 'text';
        this._text = ''; this._className = '';
        this.classList = {
            contains: name => this._className.split(/\s+/).includes(name),
            toggle: (name, force) => {
                const classes = new Set(this._className.split(/\s+/).filter(Boolean));
                if (force === undefined ? classes.has(name) : !force) classes.delete(name); else classes.add(name);
                this._className = [...classes].join(' ');
            },
            add: name => this.classList.toggle(name, true),
            remove: name => this.classList.toggle(name, false),
        };
    }
    get className() { return this._className; }
    set className(value) { this._className = String(value || ''); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value ?? ''); this.children = []; }
    get options() { return this.children; }
    get childElementCount() { return this.children.length; }
    append(...nodes) { this.children.push(...nodes); }
    add(node) { this.children.push(node); }
    replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
    addEventListener(name, callback) { (this.events[name] ??= []).push(callback); }
    dispatch(name, event = {}) { for (const callback of this.events[name] || []) callback({target: this, preventDefault() {}, ...event}); }
    dispatchEvent(event) { this.dispatch(event.type,event);return true; }
    click() { if (typeof this.onclick === 'function') this.onclick({target: this, preventDefault() {}}); this.dispatch('click'); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    focus() {}
    reportValidity() { return !this.required || Boolean(this.value.trim()); }
    reset() {}
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatch('close'); }
}

const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }
function makeDocument() {
    const elements = new Map();
    const getElementById = id => {
        if (!elements.has(id)) elements.set(id, new Element(id === 'settings-form' || id === 'filters' || id === 'add-recipient' ? 'form' : 'div', id));
        return elements.get(id);
    };
    const descendants = element => [element, ...element.children.flatMap(descendants)];
    return {
        elements, getElementById, createElement: tag => new Element(tag), hidden: false,
        activeElement: {closest: () => null},
        querySelectorAll(selector) {
            if (selector === '[data-option]') return [...fs.readFileSync('email_send/ai_settings.html','utf8').matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"[^>]*\bdata-option[^>]*>/g)].map(match=>{
                const field=getElementById(match[1]);field.type=match[0].match(/type="([^"]+)"/)?.[1]||'text';return field;
            });
            if (selector === '[data-state]') return [];
            if (selector === '#rows button, #recipient-rows button') return ['rows', 'recipient-rows'].flatMap(id => descendants(getElementById(id))).filter(node => node.tagName === 'BUTTON');
            return [];
        },
        querySelector: () => null,
        addEventListener() {},
    };
}
function uiFor(document, request) {
    return {
        node(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; },
        badge(status) { return this.node('span', status || 'ยังไม่เข้าคิว', 'badge ' + (status || '')); },
        button(text, callback, danger = false) { const button = this.node('button', text, danger ? 'danger' : ''); button.type = 'button'; button.addEventListener('click', callback); return button; },
        request,
        message(id, text, error = false) { const element = document.getElementById(id); element.textContent = text; element.classList.toggle('error', error); element.classList.toggle('ok', !error); },
        error: code => code || '—',
    };
}

async function testOrderActionFeedback() {
    const document = makeDocument(), item = {doc_id: 17, doc_number: '17', doc_year: '2569', doc_name: 'คำสั่งทดสอบ', status: null, success_count: 0, pending_count: 0, attention_count: 0};
    const calls = []; let rejectEnqueue = true, poll;
    const request = async (url, data) => {
        calls.push({url, data});
        if (data && rejectEnqueue) throw new Error('เพิ่มเข้าคิวไม่สำเร็จ');
        if (data) return {message: 'บันทึกงานแล้ว'};
        return {total: 1, years: [], is_admin: false, worker: {enabled: false}, data: [item]};
    };
    vm.runInNewContext(fs.readFileSync('email_send/order-dashboard.js', 'utf8'), {
        OrderUI: uiFor(document, request), document, window:{}, URLSearchParams, Event,
        Option: class { constructor(text, value) { this.text = text; this.value = value; } },
        confirm: () => true, setInterval: callback => { poll = callback; },
    }, {filename: 'email_send/order-dashboard.js'});
    await settle();
    const enqueue = document.querySelectorAll('#rows button, #recipient-rows button')[0];
    assert.ok(enqueue, 'the unqueued order action renders');
    enqueue.click(); await settle();
    assert.equal(document.getElementById('action-message').textContent, 'เพิ่มเข้าคิวไม่สำเร็จ');
    assert.equal(document.getElementById('action-message').classList.contains('error'), true);

    poll(); await settle();
    assert.equal(document.getElementById('message').textContent, '');
    assert.equal(document.getElementById('action-message').textContent, 'เพิ่มเข้าคิวไม่สำเร็จ', 'successful list refresh must not clear a failed POST');

    rejectEnqueue = false;
    enqueue.click(); await settle();
    assert.equal(document.getElementById('action-message').textContent, 'บันทึกงานแล้ว');
    assert.equal(document.getElementById('action-message').classList.contains('error'), false);
    assert.equal(calls.filter(call => call.data?.action === 'enqueue').length, 2);
}

async function testRecipientFormLifecycle() {
    const document = makeDocument(), form = document.getElementById('add-recipient'), input = document.getElementById('recipient-email');
    const item = {doc_id: 17, doc_number: '17', doc_year: '2569', doc_name: 'QA order', status: 'sending'};
    let dirty = false, cleanEvents = 0, rejectWrite = false, failRefresh = false, deferWrite = false, finishWrite;
    input.addEventListener('input', () => { dirty = true; });
    form.addEventListener('eoffice:form-saved', () => { dirty = false; cleanEvents++; });
    const request = async (url, data) => {
        if (data) {
            if (rejectWrite) throw Error('recipient rejected');
            assert.equal(data.action, 'add_recipient');
            if (deferWrite) return new Promise(resolve => {finishWrite=resolve;});
            return {message: 'recipient saved'};
        }
        if (failRefresh) throw Error('refresh failed after successful write');
        if (url.includes('doc_id=')) return {job: {status: 'sending'}, files: [], recipients: []};
        return {total: 1, years: [], is_admin: false, worker: {enabled: false}, data: [item]};
    };
    vm.runInNewContext(fs.readFileSync('email_send/order-dashboard.js', 'utf8'), {
        OrderUI: uiFor(document, request), document, window:{}, URLSearchParams, Event,
        Option: class { constructor(text, value) { this.text = text; this.value = value; } },
        confirm: () => true, setInterval() {},
    });
    await settle();
    const open = () => document.querySelectorAll('#rows button, #recipient-rows button')[0].click();
    const submit = () => form.onsubmit({preventDefault() {}});
    open(); await settle();
    input.value = 'new@example.test'; input.dispatch('input'); assert.equal(dirty, true);
    submit(); await settle();
    assert.equal(dirty, false); assert.equal(input.value, '');
    document.getElementById('detail').close();
    // A previous cancelled draft must not make a freshly initialized dialog dirty.
    dirty = true; input.value = 'abandoned@example.test'; open(); await settle();
    assert.equal(dirty, false); assert.equal(input.value, '');
    input.value = 'failed@example.test'; input.dispatch('input'); rejectWrite = true;
    const beforeFailure = cleanEvents; submit(); await settle();
    assert.equal(dirty, true); assert.equal(input.value, 'failed@example.test'); assert.equal(cleanEvents, beforeFailure);
    rejectWrite = false; failRefresh = true; submit(); await settle();
    assert.equal(dirty, false, 'an accepted write clears the form even when subsequent list/detail refresh fails');
    assert.equal(input.value, '');
    failRefresh = false; document.getElementById('detail').close(); open(); await settle();
    input.value = 'pending@example.test'; input.dispatch('input'); deferWrite = true; submit();
    document.getElementById('detail').close(); finishWrite({message: 'saved after dialog closed'}); await settle();
    assert.equal(dirty, false, 'an accepted write still clears cached dirty state if the dialog was closed while saving');
    assert.equal(input.value, '');
}

async function testSettingsDraftActions() {
    const document = makeDocument(), requests = [];
    let settings = {keyring:{keys:[],server:{configured:false}},enabled: true, model: 'gemini-test', key_configured: true, key_usable:true, key_source: 'admin', encryption_ready: true, activated_at: null, worker_at: null, revision:7,
        options:{analysis_only:false,require_approval:false,smtp_source:'server',smtp_host:'',smtp_port:587,smtp_security:'starttls',smtp_username:'',smtp_from:'',smtp_name:'E-Office',smtp_reply_to:'',subject:'คำสั่ง {doc_number}',intro:'เรียน {recipient_name}',signature:'E-Office',input_price:0,output_price:0},diagnostics:{smtp:{effective:{},configured:false},cron:{state:'missing'},counts:{},pending_recipients:0,usage:[],events:[],base_url:'http://localhost',mock:true}};
    const request = async (url, data) => {
        requests.push(data || {method: 'GET'});
        if (!data) return {settings};
        if (data.action === 'test') return {message: 'ทดสอบผ่าน'};
        if (data.action === 'save') {
            settings = {...settings, enabled: data.enabled, model: data.model, key_configured: data.clear_key ? false : settings.key_configured};
            return {message: 'บันทึกแล้ว', settings};
        }
        throw new Error('unexpected settings action');
    };
    const modelOptions = document.getElementById('model-options');
    modelOptions.append(new Element('option'));
    document.getElementById('model').required = true;
    const windowEvents={};const window = {addEventListener(type,callback) {(windowEvents[type] ||= []).push(callback);}};
    const context=vm.createContext({
        OrderUI: uiFor(document, request), document, window, Event,
        Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    });
    vm.runInContext(fs.readFileSync('email_send/settings-controls.js','utf8'),context);
    context.OrderSettingsControls=window.OrderSettingsControls;
    vm.runInContext(fs.readFileSync('email_send/keyring-controls.js','utf8'),context);
    context.OrderKeyring=window.OrderKeyring;
    vm.runInContext(fs.readFileSync('email_send/ai-settings.js', 'utf8'),context,{filename:'email_send/ai-settings.js'});
    await settle();

    const model = document.getElementById('model'), testButton = document.getElementById('test-ai');
    const action = document.getElementById('readiness-action');
    action.setAttribute('href', '#server-guide');
    const guide = document.getElementById('server-guide');
    let prevented = false, scrolled = false, focused = false;
    guide.scrollIntoView = () => {scrolled = true;};
    guide.focus = () => {focused = true;};
    action.onclick({button: 0, preventDefault() {prevented = true;}});
    assert.equal(prevented, true, 'local section links must bypass the shell router');
    assert.equal(guide.open, true, 'Cron guidance expands before scrolling');
    assert.equal(scrolled && focused, true, 'section links scroll and move keyboard focus within the module');
    model.value = 'gemini-candidate'; model.dispatch('input'); await settle();
    const warns=()=>{let warned=false;for(const callback of windowEvents.beforeunload)callback({preventDefault(){warned=true;}});return warned;};
    assert.equal(warns(),true);
    windowEvents['eoffice:leaving-confirmed'][0]();assert.equal(warns(),false);
    document.getElementById('settings-form').dispatch('input');assert.equal(warns(),true,'new settings edits must revoke confirmed departure');
    windowEvents['eoffice:leaving-confirmed'][0]();windowEvents['eoffice:leaving-cancelled'][0]();assert.equal(warns(),true,'a cancelled/failed departure must restore the AI guard');
    testButton.click(); await settle();
    assert.equal(requests.at(-1).action, 'test');
    assert.equal(requests.at(-1).model, 'gemini-candidate');
    assert.equal(document.getElementById('test-result').classList.contains('ok'), true);
    model.value = 'gemini-edited'; model.dispatch('input');
    assert.equal(document.getElementById('test-result').textContent, 'ยังไม่ได้ทดสอบค่าชุดนี้', 'editing a tested model invalidates its previous result');

    document.getElementById('clear-key').checked = true;
    document.getElementById('clear-key').dispatch('change');
    assert.equal(document.getElementById('enabled').checked, false);
    assert.equal(document.getElementById('enabled').disabled, true);
    document.getElementById('settings-form').onsubmit({preventDefault() {}});
    await settle();
    const save = [...requests].reverse().find(request => request.action === 'save');
    assert.ok(save, 'clearing the configured key saves settings');
    assert.equal(save.clear_key, true);
    assert.equal(save.enabled, false, 'clearing key must pause automatic delivery');
    assert.equal(save.api_key, '', 'clear-key request must not send any candidate credential');
    assert.equal(save.revision,7,'settings save binds the loaded revision');
    assert.equal(testButton.disabled, true, 'AI actions need a configured or candidate key');
    assert.equal(document.getElementById('load-models').disabled, true);
    const beforeDiscard = requests.length;
    const key = document.getElementById('api-key');
    key.value = 'draft-only-key'; key.dispatch('input');
    assert.equal(testButton.disabled, false, 'a candidate key can be tested before saving');
    model.value = 'abandoned-model'; model.dispatch('input');
    document.getElementById('enabled').checked = true;
    document.getElementById('enabled').dispatch('change');
    let cleanEvents = 0;
    document.getElementById('settings-form').addEventListener('eoffice:form-saved', () => cleanEvents++);
    document.getElementById('discard').click();
    assert.equal(requests.length, beforeDiscard, 'discard must not send a write or refresh request');
    assert.equal(key.value, '', 'discard removes the candidate credential');
    assert.equal(model.value, settings.model);
    assert.equal(document.getElementById('enabled').checked, settings.enabled);
    assert.equal(document.getElementById('save').disabled, true);
    assert.equal(warns(), false, 'discard clears the local departure guard');
    assert.equal(cleanEvents, 1, 'discard synchronizes the shell form guard');
    assert.equal(document.getElementById('delivery-preview').textContent, 'ปิดอยู่ · ยังไม่ส่งอีเมลอัตโนมัติ');
    document.getElementById('smtp_name').value='Changed sender';document.getElementById('settings-form').dispatch('input');
    assert.equal(document.getElementById('save').disabled,false,'SMTP/template changes participate in unsaved state');
    assert.equal(warns(),true);
    document.getElementById('discard').click();assert.equal(document.getElementById('smtp_name').value,'E-Office');assert.equal(warns(),false);
    document.getElementById('keyring-label').value='Draft backup';document.getElementById('settings-form').dispatch('input');assert.equal(warns(),true,'unfinished key additions participate in the leave guard');
    document.getElementById('discard').click();assert.equal(document.getElementById('keyring-label').value,'');assert.equal(warns(),false);
}

function testSaveBarDoesNotOverlay() {
    const css = fs.readFileSync('email_send/ai-settings.css', 'utf8');
    const rule = css.match(/\.ai-settings-page \.save-bar\s*\{([^}]*)\}/);
    assert.ok(rule, 'save bar has a dedicated layout rule');
    assert.match(rule[1], /position:\s*static\s*;/);
    assert.doesNotMatch(rule[1], /position:\s*(?:sticky|fixed)\s*;/, 'save bar must stay in document flow rather than cover form controls');
}

function testKeyringControls(){
    const document=makeDocument(),window={},calls=[];
    vm.runInNewContext(fs.readFileSync('email_send/keyring-controls.js','utf8'),{window,document,OrderUI:uiFor(document,async()=>{}),confirm:()=>true});
    const base={enabled:true,usable:true,created_at:'2026-10-15',remind_days:90,rotation_due:false,tested_at:null,tested_model:null,test_code:null,last_success_at:null,last_error_at:null,last_error_code:null,usage:{requests:2,input_tokens:10,output_tokens:4,total_tokens:14}};
    const settings={keyring:{keys:[{...base,id:1,reference:'key_a',label:'Primary',active:true},{...base,id:2,reference:'key_b',label:'Reserve',active:false}],server:{configured:true,active:false}},encryption_ready:true};
    window.OrderKeyring.render(settings,()=> '—',(action,data)=>calls.push({action,data}));
    const cards=document.getElementById('keyring-list').children;
    const buttons=card=>card.children.at(-1).children;
    assert.ok(!buttons(cards[0]).some(b=>['พักใช้','ลบ Key'].includes(b.textContent)),'active key cannot be paused/deleted from its card');
    assert.ok(buttons(cards[1]).some(b=>b.textContent==='ทดสอบและเลือกเป็นตัวหลัก'));
    buttons(cards[1]).find(b=>b.textContent==='ทดสอบและเลือกเป็นตัวหลัก').click();assert.equal(calls.at(-1).action,'key_activate');assert.equal(calls.at(-1).data.confirmed,true);
    const input=cards[1].children.find(n=>n.tagName==='INPUT');input.value='Renamed reserve';assert.equal(window.OrderKeyring.dirty(),true);
    buttons(cards[1]).find(b=>b.textContent==='บันทึกชื่อ/รอบเตือน').click();assert.equal(calls.at(-1).data.label,'Renamed reserve');
    document.getElementById('keyring-server').click();assert.equal(calls.at(-1).action,'key_server');
    document.getElementById('keyring-label').value='New';document.getElementById('keyring-secret').value='synthetic-ui-only-secret';document.getElementById('keyring-add').click();assert.equal(calls.at(-1).action,'key_add');
    window.OrderKeyring.render(settings,()=> '—',()=>{});assert.equal(document.getElementById('keyring-secret').value,'');assert.equal(window.OrderKeyring.dirty(),false);
}

(async () => {
    await testOrderActionFeedback();
    console.log('PASS an action failure remains visible after a successful automatic refresh');
    await testRecipientFormLifecycle();
    console.log('PASS recipient form: successful save, reopen, rejected write and failed post-save refresh synchronize the shared guard');
    await testSettingsDraftActions();
    console.log('PASS AI test invalidation and clearing the key pauses delivery without sending a new key');
    testSaveBarDoesNotOverlay();
    console.log('PASS settings save bar stays in normal document flow');
    testKeyringControls();console.log('PASS key vault cards protect the primary key, bind confirmations and clear sensitive drafts');
})().catch(error => { console.error(error); process.exitCode = 1; });
