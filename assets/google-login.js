(() => {
    const part = document.getElementById('google_login_part');
    const button = document.getElementById('google_login_btn');
    const status = document.getElementById('login_status');
    const url = new URL(window.location.href);
    const documentId = url.searchParams.get('id');
    if (part && button && window.EOFFICE_GOOGLE_LOGIN_ENABLED) {
        part.hidden = false;
        if (/^[1-9][0-9]{0,9}$/.test(documentId || '')) {
            button.href += '?id=' + encodeURIComponent(documentId);
        }
    }
    const error = url.searchParams.get('google_login');
    if (!error) return;
    const messages = {
        not_configured: 'ยังไม่ได้ตั้งค่าการเข้าสู่ระบบด้วย Google กรุณาติดต่อผู้ดูแลระบบ',
        cancelled: 'ยกเลิกการเข้าสู่ระบบด้วย Google แล้ว',
        invalid_state: 'คำขอเข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง กรุณากดเข้าสู่ระบบด้วย Google อีกครั้ง',
        invalid_domain: 'กรุณาใช้บัญชี Google ของโรงเรียน @siya.ac.th',
        not_registered: 'อีเมลนี้ยังไม่มีบัญชีในระบบ กรุณาสมัครสมาชิกก่อน หรือติดต่อผู้ดูแลระบบ',
        account_conflict: 'บัญชี Google ไม่ตรงกับข้อมูลในระบบ กรุณาติดต่อผู้ดูแลระบบ',
        failed: 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้ กรุณาลองอีกครั้ง',
    };
    if (status) status.textContent = Object.prototype.hasOwnProperty.call(messages, error) ? messages[error] : messages.failed;
    url.searchParams.delete('google_login');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
})();
