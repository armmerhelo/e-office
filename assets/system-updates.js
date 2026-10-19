/* Shared release feed and browser-local, account-specific read state. */
(() => {
    const feedUrl = new URL('../data/system-updates.json', document.currentScript.src);
    const cacheLifetime = 60_000;
    let feed, pending, loadedAt = 0;
    const memory = new Set();
    const keyFor = (id, releaseId) => `eoffice:system-updates:read:${id}:${JSON.stringify(releaseId)}`;
    const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    function seen(id, releaseId) {
        if (memory.has(keyFor(id, releaseId))) return true;
        try {
            return localStorage.getItem(keyFor(id, releaseId)) === '1' ||
                localStorage.getItem(`eoffice:system-updates:seen:${id}`) === releaseId;
        } catch { return false; }
    }
    function refreshBadge() {
        const user = window.eofficeSessionState?.status === 'authenticated' ? window.eofficeUser : null;
        const group = document.getElementById('group_menu_updates');
        if (group) group.style.display = user ? 'block' : 'none';
        const badge = document.getElementById('system-updates-badge');
        if (badge) badge.hidden = !user || !feed?.length || seen(user.id, feed[0].id);
    }
    async function load({force = false} = {}) {
        if (pending) return pending;
        if (!force && feed && Date.now() - loadedAt < cacheLifetime) return feed;
        pending = fetch(feedUrl, {cache:'no-cache', credentials:'same-origin', signal:AbortSignal.timeout(20_000)})
            .then(response => {
                if (!response.ok) throw Error('ไม่สามารถโหลดประวัติอัปเดตได้');
                return response.json();
            }).then(items => {
                const ids = new Set();
                if (!Array.isArray(items) || items.some(item => {
                    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) return true;
                    ids.add(item.id);
                    return !validDate(item.date) ||
                        typeof item.title !== 'string' || typeof item.summary !== 'string' ||
                        (item.version !== undefined && typeof item.version !== 'string') ||
                        ['added','improved','fixed'].some(key => !Array.isArray(item[key]) || item[key].some(text => typeof text !== 'string'));
                })) throw Error('รูปแบบข้อมูลอัปเดตไม่ถูกต้อง');
                feed = items.filter(item => item.date <= new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Bangkok'}))
                    .sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
                loadedAt = Date.now();
                refreshBadge();
                return feed;
            }).finally(() => { pending = null; });
        return pending;
    }
    window.eofficeSystemUpdates = Object.freeze({
        load,
        clearSessionStorage() {
            // Preserve only non-sensitive release-read markers across logout.
            const sessionKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const marker = /^eoffice:system-updates:seen:[0-9]+$/.test(key) ||
                    (/^eoffice:system-updates:read:[0-9]+:/.test(key) && localStorage.getItem(key) === '1');
                if (!marker) sessionKeys.push(key);
            }
            // Remove session data individually so a concurrent tab's new marker is never cleared.
            for (const key of sessionKeys) localStorage.removeItem(key);
        },
        markRead(latestId, ownerId) {
            if (!ownerId || String(window.eofficeUser?.id) !== String(ownerId) ||
                window.eofficeSessionState?.status !== 'authenticated' || latestId !== feed?.[0]?.id) return;
            try {
                localStorage.setItem(keyFor(ownerId, latestId), '1');
                memory.delete(keyFor(ownerId, latestId));
            } catch {
                // Keep only unsaved markers in memory; persisted state is shared across tabs.
                memory.add(keyFor(ownerId, latestId));
            }
            refreshBadge();
        }
    });
    window.addEventListener('eoffice:session-updated', refreshBadge);
    window.addEventListener('storage', event => {
        if (event.storageArea && event.storageArea !== localStorage) return;
        if (event.key === null) memory.clear();
        else memory.delete(event.key);
        refreshBadge();
    });
    const revalidate = () => {
        if (!document.hidden) load({force:true}).catch(() => { /* Keep the last known badge on network errors. */ });
    };
    window.addEventListener('focus', revalidate);
    window.addEventListener('pageshow', event => { if (event.persisted) revalidate(); });
    document.addEventListener('visibilitychange', revalidate);
    refreshBadge();
    load().catch(() => { /* The page provides an explicit retry when the feed is unavailable. */ });
})();
