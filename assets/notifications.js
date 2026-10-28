(() => {
    if (window.EOFFICE_MOCK_SERVICES || ['localhost','127.0.0.1','[::1]'].includes(location.hostname)) return;
    const appId = window.EOFFICE_PUSH_APP_ID;
    if (!appId) { console.warn('Push notifications require ONESIGNAL_APP_ID'); return; }
    const endpoint = new URL('../api/create_user_notification.php', document.currentScript.src);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async OneSignal => {
        try {
            await OneSignal.init({appId, notifyButton:{enable:true}});
            const subscription = OneSignal.User.PushSubscription;
            let saved = null, pending = false, queued = false, retry = null, failures = 0, previousId = null;
            const sync = async () => {
                if (pending) { queued = true; return; }
                const state = window.eofficeSessionState;
                const owner = state?.status === 'authenticated' ? state.user?.id : null;
                if (!owner) { saved = null; return; }
                const id = subscription.id || previousId;
                if (!id) { saved = null; return; }
                previousId = id;
                const active = Boolean(subscription.id && subscription.optedIn);
                const key = `${owner}:${id}:${active}`;
                if (saved === key) return;
                pending = true;
                if (retry !== null) { clearTimeout(retry); retry = null; }
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(),15000);
                try {
                    const response = await fetch(endpoint, {
                        method:'POST', credentials:'same-origin',
                        signal:controller.signal,
                        headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({target_Id:id, active, _expected_owner:owner})
                    });
                    const data = await response.json();
                    if (!response.ok || data.status !== 'success') throw new Error('Subscription registration failed');
                    if (window.eofficeSessionState?.status === 'authenticated' && window.eofficeSessionState.user?.id === owner) saved = key;
                    failures = 0;
                } catch (error) {
                    console.warn('Unable to register push notifications', error);
                    if (++failures <= 5) retry = setTimeout(() => { retry = null; sync(); }, Math.min(60000,1000 * 2 ** failures));
                } finally {
                    clearTimeout(timeout);
                    pending = false;
                    if (queued) { queued = false; await sync(); }
                }
            };
            subscription.addEventListener('change', sync);
            window.addEventListener('eoffice:session-updated', sync);
            window.addEventListener('online', sync);
            await sync();
        } catch (error) {
            console.warn('Unable to initialize push notifications', error);
        }
    });
})();
