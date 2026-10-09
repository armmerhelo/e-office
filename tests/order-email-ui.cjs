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
        OrderUI: uiFor(document, request), document, URLSearchParams,
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

async function testSettingsDraftActions() {
    const document = makeDocument(), requests = [];
    let settings = {enabled: true, model: 'gemini-test', key_configured: true, key_source: 'admin', encryption_ready: true, activated_at: null, worker_at: null, revision:7};
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
    const window = {addEventListener() {}};
    vm.runInNewContext(fs.readFileSync('email_send/ai-settings.js', 'utf8'), {
        OrderUI: uiFor(document, request), document, window,
        Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    }, {filename: 'email_send/ai-settings.js'});
    await settle();

    const model = document.getElementById('model'), testButton = document.getElementById('test-ai');
    model.value = 'gemini-candidate'; model.dispatch('input'); await settle();
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
}

function testSaveBarDoesNotOverlay() {
    const css = fs.readFileSync('email_send/ai-settings.css', 'utf8');
    const rule = css.match(/\.ai-settings-page \.save-bar\s*\{([^}]*)\}/);
    assert.ok(rule, 'save bar has a dedicated layout rule');
    assert.match(rule[1], /position:\s*static\s*;/);
    assert.doesNotMatch(rule[1], /position:\s*(?:sticky|fixed)\s*;/, 'save bar must stay in document flow rather than cover form controls');
}

(async () => {
    await testOrderActionFeedback();
    console.log('PASS an action failure remains visible after a successful automatic refresh');
    await testSettingsDraftActions();
    console.log('PASS AI test invalidation and clearing the key pauses delivery without sending a new key');
    testSaveBarDoesNotOverlay();
    console.log('PASS settings save bar stays in normal document flow');
})().catch(error => { console.error(error); process.exitCode = 1; });
