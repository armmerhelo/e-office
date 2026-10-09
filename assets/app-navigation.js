(() => {
    const scriptUrl = document.currentScript?.src;
    if (!scriptUrl || document.querySelector('.eoffice-app-navigation')) return;

    const appRoot = new URL('../', scriptUrl);
    const route = path => new URL(path, appRoot).href;
    const modules = [
        {label: 'จัดการสมาชิก', path: 'management/user_manage.html', permission: 'members'},
        {label: 'จัดการกลุ่มงาน', path: 'management/department_manage.html', permission: 'departments'},
        {label: 'จองห้องประชุม', path: 'room_booking/index.html', login: true},
        {label: 'ขอใช้สถานที่', path: 'room_booking/new_room.html', login: true},
        {label: 'รายการจองห้องของฉัน', path: 'room_booking/edit_room_booking.html', login: true},
        {label: 'จองเลขคำสั่ง', path: 'external_number_booking/external_number_booking.html', login: true},
        {label: 'ส่งอีเมลคำสั่ง', path: 'email_send/doc_send_email.html', permission: 'email'},
        {label: 'คำสั่งของฉัน', path: 'email_send/my_dashboard.html', login: true},
        {label: 'ตั้งค่า AI และอีเมล', path: 'email_send/ai_settings.html', admin: true},
        {label: 'แจ้งซ่อม', path: 'maintenance_requests/index.html', login: true},
        {label: 'แจ้งซ่อม (ฝ่ายงาน)', path: 'maintenance_requests/admin.html', permission: 'maintenance'}
    ];

    const currentPath = new URL(location.href).pathname;
    const nav = document.createElement('nav');
    nav.className = 'eoffice-app-navigation';
    nav.setAttribute('aria-label', 'เมนูระบบ E-Office');

    const brand = document.createElement('a');
    brand.className = 'eoffice-app-navigation__brand';
    brand.href = route('index.php?view=received');
    brand.textContent = 'E-Office';

    const title = document.createElement('span');
    title.className = 'eoffice-app-navigation__title';
    title.textContent = document.title.replace(/\s*[·|—-]\s*E-Office\s*$/i, '') || 'ระบบสำนักงาน';

    const home = document.createElement('a');
    home.className = 'eoffice-app-navigation__home';
    home.href = route('index.php?view=received');
    home.textContent = 'กลับหน้าหลัก';

    const logout = document.createElement('button');
    logout.className = 'eoffice-app-navigation__logout';
    logout.type = 'button';
    logout.textContent = 'ออกจากระบบ';
    logout.hidden = true;

    const menu = document.createElement('details');
    menu.className = 'eoffice-app-navigation__menu';
    const summary = document.createElement('summary');
    summary.textContent = 'ไปยังเมนูอื่น';
    const list = document.createElement('div');
    list.className = 'eoffice-app-navigation__links';

    for (const item of modules) {
        const link = document.createElement('a');
        link.href = route(item.path);
        link.textContent = item.label;
        link.dataset.path = item.path;
        if (item.permission) link.dataset.permission = item.permission;
        if (item.login) link.dataset.requiresLogin = 'true';
        if (item.admin) link.dataset.requiresAdmin = 'true';
        if (new URL(link.href).pathname === currentPath) {
            link.setAttribute('aria-current', 'page');
            link.classList.add('is-current');
        }
        link.addEventListener('click', () => { menu.open = false; });
        list.append(link);
    }

    menu.append(summary, list);
    nav.append(brand, title, home, menu, logout);
    document.body.insertBefore(nav, document.body.firstChild);

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('app-navigation.css?v=20261009-top-level', scriptUrl).href;
    document.head.append(stylesheet);

    const applyAccess = user => {
        for (const link of list.querySelectorAll('a')) {
            const permission = link.dataset.permission;
            link.hidden = Boolean(
                (link.dataset.requiresLogin && !user) ||
                (permission && !user?.permissions?.includes(permission)) ||
                (link.dataset.requiresAdmin && user?.status !== 'Admin')
            );
        }
        logout.hidden = !user;
        menu.hidden = ![...list.querySelectorAll('a')].some(link => !link.hidden);
    };

    applyAccess(null);
    const getUser = window.sessionReady
        ? Promise.resolve(window.sessionReady)
        : fetch(route('api/me.php'), {credentials: 'same-origin'})
            .then(response => response.ok ? response.json() : null)
            .then(data => data?.user ?? null)
            .catch(() => null);
    getUser.then(user => {
        window.eofficeUser = user;
        applyAccess(user);
    });

    const refreshAccess = () => fetch(route('api/me.php'), {credentials: 'same-origin'})
        .then(response => response.ok ? response.json() : null)
        .then(data => {
            window.eofficeUser = data?.user ?? null;
            applyAccess(window.eofficeUser);
        })
        .catch(() => applyAccess(null));
    window.addEventListener('eoffice:permissions-changed', refreshAccess);
    window.addEventListener('focus', refreshAccess);
    window.addEventListener('pageshow', event => { if (event.persisted) refreshAccess(); });

    logout.addEventListener('click', async () => {
        logout.disabled = true;
        try {
            const response = await fetch(route('api/logout.php'), {method: 'POST', credentials: 'same-origin'});
            const result = await response.json();
            if (!response.ok || result.status !== 'success') throw new Error(result.message || 'ออกจากระบบไม่สำเร็จ');
            localStorage.clear();
            sessionStorage.clear();
            location.assign(home.href);
        } catch (error) {
            logout.disabled = false;
            window.alert(error.message || 'ไม่สามารถออกจากระบบได้');
        }
    });
})();
