const fs = require('node:fs');
const assert = require('node:assert/strict');

const routes = {
    members: ['menu-members', 'management/user_manage.html'],
    groups: ['menu-groups', 'management/department_manage.html'],
    book: ['menu-bookdocnumber', 'external_number_booking/external_number_booking.html'],
    my_public: ['my_menu_public', 'email_send/my_dashboard.html'],
    send_email: ['send_email', 'email_send/doc_send_email.html'],
    room_booking: ['menu-bookingroom', 'room_booking/index.html'],
    edit_room_booking: ['menu-edit-room-booking', 'room_booking/edit_room_booking.html'],
    maintenance: ['menu-maintenance', 'maintenance_requests/index.html'],
    maintenance_admin: ['menu-maintenance-admin', 'maintenance_requests/admin.html']
};

const main = fs.readFileSync('assets/main.js', 'utf8');
const index = fs.readFileSync('index.php', 'utf8');
const routeSource = main.match(/const MODULE_ROUTES = Object\.freeze\(\{([\s\S]*?)\}\);/);
assert.ok(routeSource, 'main navigation should define standalone module routes');

for (const [view, [menuId, path]] of Object.entries(routes)) {
    assert.ok(routeSource[1].includes(`${view}: '${path}'`), `${view} should map to ${path}`);
    const anchor = index.match(new RegExp(`<a\\b[^>]*\\bid="${menuId}"[^>]*>`));
    assert.ok(anchor, `main menu should include ${menuId}`);
    assert.ok(anchor[0].includes(`href="${path}"`), `${menuId} should link to ${path}`);
    assert.ok(anchor[0].includes(`showView('${view}'`), `${menuId} should retain its view handler`);
}

const pages = [
    ...Object.values(routes).map(([, path]) => path),
    'room_booking/new_room.html',
    'email_send/ai_settings.html'
];
for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    assert.match(html, /assets\/app-navigation\.js/, `${page} should include the shared navigation`);
    assert.doesNotMatch(html, /<iframe\b/i, `${page} must render as a top-level page`);
}

assert.doesNotMatch(index, /<iframe\b/i, 'the main page must not embed module frames');
assert.doesNotMatch(main, /<iframe\b/i, 'the main router must not generate module frames');
assert.match(main, /window\.location\.assign\(moduleRoute\)/, 'module selections should open the standalone page');
assert.match(main, /urlParams\.get\('view'\)/, 'the main inbox should accept direct view links');
assert.match(fs.readFileSync('assets/app-navigation.js', 'utf8'), /eoffice:permissions-changed/);
assert.doesNotMatch(fs.readFileSync('assets/member-management.js', 'utf8'), /window\.parent\.postMessage/);

console.log(`PASS ${Object.keys(routes).length} module routes and ${pages.length} top-level pages use shared navigation`);
