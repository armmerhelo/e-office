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
            const changeAccount = document.getElementById('google_signup_change_account');
            if (changeAccount) changeAccount.href = button.href;
        }
    }
    const error = url.searchParams.get('google_login');
    if (!error) return;
    if (error === 'signup') {
        window.addEventListener('load', () => setTimeout(loadSignup, 0));
        return;
    }
    const messages = {
        not_configured: 'ยังไม่ได้ตั้งค่าการเข้าสู่ระบบด้วย Google กรุณาติดต่อผู้ดูแลระบบ',
        cancelled: 'ยกเลิกการเข้าสู่ระบบด้วย Google แล้ว',
        invalid_state: 'คำขอเข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง กรุณากดเข้าสู่ระบบด้วย Google อีกครั้ง',
        invalid_domain: 'กรุณาใช้บัญชี Google ของโรงเรียน @siya.ac.th',
        unverified_email: 'Google ยังไม่ได้ยืนยันอีเมลของบัญชีนี้ กรุณายืนยันอีเมลก่อน',
        not_registered: 'อีเมลนี้ยังไม่มีบัญชีในระบบ อีเมลนอกโรงเรียนต้องให้ผู้ดูแลสร้างบัญชีก่อน',
        account_conflict: 'บัญชี Google ไม่ตรงกับข้อมูลในระบบ กรุณาติดต่อผู้ดูแลระบบ',
        failed: 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้ กรุณาลองอีกครั้ง',
    };
    if (status) status.textContent = Object.prototype.hasOwnProperty.call(messages, error) ? messages[error] : messages.failed;
    url.searchParams.delete('google_login');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);

    async function loadSignup() {
        const form = document.getElementById('google_signup_form');
        const signup = document.getElementById('google_signup_part');
        if (!form || !signup) return;
        try {
            const response = await fetch('api/auth_google_signup.php', {credentials:'same-origin', cache:'no-store'});
            const profile = await response.json();
            if (!response.ok) throw new Error(profile.message || 'ไม่สามารถโหลดข้อมูล Google ได้');
            await window.sessionReady;
            document.getElementById('login_html').style.display = 'block';
            const overlay = document.getElementById('modalOverlay');
            overlay.classList.add('active');
            overlay.firstElementChild.style.maxHeight = 'calc(100vh - 32px)';
            overlay.firstElementChild.style.overflowY = 'auto';
            document.getElementById('login_part').style.display = 'none';
            document.getElementById('register_part').style.display = 'none';
            document.getElementById('register_btn').style.display = 'none';
            const linking = profile.mode === 'link';
            document.getElementById('head_login').textContent = linking ? 'ผูกบัญชี Google' : 'ลงทะเบียนด้วย Google';
            document.getElementById('google_signup_intro').textContent = linking
                ? 'ยืนยันรหัสผ่าน E-Office ครั้งแรกเพื่อผูกบัญชี Google นี้' : 'ยืนยันข้อมูลเพื่อสร้างบัญชี E-Office';
            document.getElementById('google_signup_email').textContent = profile.email;
            document.getElementById('google_signup_name').value = profile.name;
            document.getElementById('google_signup_name_part').hidden = linking;
            document.getElementById('google_signup_name').required = !linking;
            document.getElementById('google_signup_consent_part').style.display = linking ? 'none' : 'flex';
            document.getElementById('google_signup_consent').required = !linking;
            document.getElementById('google_link_password_part').hidden = !linking;
            document.getElementById('google_link_password').required = linking;
            const agreement = document.getElementById('google_signup_agreement');
            if (!linking) {
                const terms = document.getElementById('detail_agreement').cloneNode(true);
                terms.removeAttribute('id');
                terms.style.cssText = 'padding:10px;text-align:left';
                agreement.appendChild(terms);
            }
            signup.hidden = false;
            document.getElementById('openModal')?.addEventListener('click', () => {
                document.getElementById('login_part').style.display = 'none';
                document.getElementById('register_part').style.display = 'none';
                document.getElementById('register_btn').style.display = 'none';
                document.getElementById('head_login').textContent = linking ? 'ผูกบัญชี Google' : 'ลงทะเบียนด้วย Google';
            });
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const button = document.getElementById('google_signup_submit');
                const message = document.getElementById('google_signup_status');
                button.disabled = true;
                message.textContent = '';
                try {
                    const r = await fetch('api/auth_google_signup.php', {
                        method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({name:document.getElementById('google_signup_name').value, consent:document.getElementById('google_signup_consent').checked, password:linking ? document.getElementById('google_link_password').value : undefined, csrf:profile.csrf}),
                    });
                    const result = await r.json();
                    if (!r.ok) throw new Error(result.message || 'ไม่สามารถลงทะเบียนได้');
                    const target = new URL(result.redirect_url, window.location.href);
                    if (target.origin !== window.location.origin) throw new Error('URL ปลายทางไม่ถูกต้อง');
                    window.location.assign(target.href);
                } catch (e) {
                    message.textContent = e.message;
                    button.disabled = false;
                }
            });
        } catch (e) {
            if (status) status.textContent = e.message;
        }
    }
})();
