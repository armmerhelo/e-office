window.escapeHTML = window.escapeHtml = function (value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
};
window.escapeRecord = function (record) {
    return Object.fromEntries(Object.entries(record).map(([key,value]) => [key, typeof value === 'string' ? escapeHTML(value) : value]));
};
window.sessionReady = fetch(new URL('../api/me.php', document.currentScript.src), {credentials:'same-origin'})
    .then(r => r.json()).then(data => { window.eofficeUser = data.user; return data.user; })
    .catch(() => { window.eofficeUser = null; return null; });
const originalFetch = window.fetch.bind(window);
window.fetch = function (input, options) {
    const request = originalFetch(input, options);
    if (String(input).includes('create_document.php')) return request.finally(() => {
        const button = document.getElementById('submit_add_doc');
        const loader = document.getElementById('loading_save');
        if (button) button.style.display = 'block';
        if (loader) loader.style.display = 'none';
    });
    return request;
};
