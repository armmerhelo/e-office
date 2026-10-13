(() => {
    let ownerId = null, conflicted = false;
    const observe = () => {
        const state = window.eofficeSessionState;
        const pageOwner = state?.pageOwnerId ? String(state.pageOwnerId) : null;
        if (pageOwner) {
            if (ownerId && ownerId !== pageOwner) conflicted = true;
            else ownerId = pageOwner;
        }
        // Pending/unavailable snapshots retain an owner, not authorization.
        const user = state ? (state.status === 'authenticated' ? state.user : null) : window.eofficeUser;
        const current = user?.id ? String(user.id) : null;
        if (current) {
            if (ownerId && ownerId !== current) conflicted = true;
            else ownerId = current;
        }
        return current;
    };
    window.eofficeFormOwner = Object.freeze({
        capture() {
            const current = observe();
            if (conflicted) {
                window.alert?.('บัญชีผู้ใช้เปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ก่อนส่งข้อมูล');return null;
            }
            if (!current) {
                window.alert?.('กรุณารอการตรวจสอบบัญชีหรือเข้าสู่ระบบก่อนส่งข้อมูล');return null;
            }
            return ownerId;
        },
        matches(token) {return observe() === token && !conflicted && token !== null;},
        hasConflict() {observe();return conflicted;},
        async verified(token, {target, cancelled = () => false} = {}) {
            const decision = () => {
                const current = observe();
                if (cancelled() || conflicted || token === null || ownerId !== token) return false;
                // Guest/unavailable are not evidence of another owner. Keep the
                // committed receipt until the same owner is verified or discarded.
                return current === token ? true : null;
            };
            let notice;
            if (decision() === null) {
                if (target) {
                    target.dataset.eofficeSaveState = 'awaiting-session';
                    if (document.createElement && target.before) {
                        notice = document.createElement('p');notice.className = 'eoffice-draft-notice';notice.setAttribute('role','status');
                        notice.textContent = 'บันทึกข้อมูลที่ส่งไปสำเร็จแล้ว กำลังรอยืนยันบัญชีเดิมก่อนอัปเดตฟอร์ม กรุณาตรวจสอบการเชื่อมต่อและกลับมาที่แท็บนี้ ไม่ต้องส่งซ้ำ';
                        target.before(notice);
                    }
                }
                try {
                    await new Promise(resolve => {
                        const settled = () => {
                            if (decision() === null) return;
                            window.removeEventListener('eoffice:session-updated',settled);
                            target?.removeEventListener('reset',settled);
                            target?.removeEventListener('eoffice:form-discarded',settled);
                            resolve();
                        };
                        window.addEventListener('eoffice:session-updated',settled);
                        target?.addEventListener('reset',settled);
                        target?.addEventListener('eoffice:form-discarded',settled);
                        settled();
                    });
                } finally {
                    notice?.remove();
                    if (target) delete target.dataset.eofficeSaveState;
                }
            }
            return decision() === true;
        },
        async applyVerified(token, options, apply) {
            // A new check may start in the microtask between verification and
            // its caller resuming. Re-wait, then apply the receipt synchronously
            // in the same turn as the final owner/generation check.
            while (await this.verified(token,options)) {
                if (options.cancelled?.()) return false;
                if (!this.matches(token)) continue;
                apply();return true;
            }
            return false;
        }
    });
    // Remember every accepted transition, including a different account that
    // later returns to the first one. Reset/discard never resets this boundary.
    window.addEventListener?.('eoffice:session-updated',observe);
    observe();
    Promise.resolve(window.sessionReady).then(() => {observe();}).catch(() => {});
})();
