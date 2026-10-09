
function eofficeCan(permission) {
    return !!window.eofficeUser?.permissions?.includes(permission);
}

function applyPermissionMenus() {
    for (const [permission, ids] of Object.entries({
        members: ['menu-members', 'group_menu_members'],
        departments: ['menu-groups', 'group_menu_groups'],
        email: ['send_email', 'group_send_email'],
        maintenance: ['menu-maintenance-admin', 'group_maintenance_admin']
    })) {
        for (const id of ids) {
            const node = document.getElementById(id);
            if (node) node.style.display = eofficeCan(permission) ? (node.tagName === 'A' ? 'flex' : 'block') : 'none';
        }
    }
    display_style('system_management', eofficeCan('members') || eofficeCan('departments') ? 'block' : 'none');
}

async function refreshPermissionMenus() {
    try {
        const response = await fetch('api/me.php');
        if (!response.ok) return;
        window.eofficeUser = (await response.json()).user;
        applyPermissionMenus();
        const current = localStorage.getItem('currentPage');
        if (restrictedViewPermission(current) && !eofficeCan(restrictedViewPermission(current))) showView(window.eofficeUser ? 'received' : 'public', 'load');
    } catch (error) { console.error(error); }
}

function restrictedViewPermission(view) {
    return {members:'members', groups:'departments', send_email:'email', maintenance_admin:'maintenance'}[view];
}

const MODULE_ROUTES = Object.freeze({
    members: 'management/user_manage.html',
    groups: 'management/department_manage.html',
    room_booking: 'room_booking/index.html',
    room_booking2: 'room_booking/new_room.html',
    edit_room_booking: 'room_booking/edit_room_booking.html',
    book: 'external_number_booking/external_number_booking.html',
    send_email: 'email_send/doc_send_email.html',
    my_public: 'email_send/my_dashboard.html',
    maintenance: 'maintenance_requests/index.html',
    maintenance_admin: 'maintenance_requests/admin.html'
});

window.addEventListener('eoffice:permissions-changed', () => {
    refreshPermissionMenus();
});
window.addEventListener('focus', () => { if (window.eofficeUser) refreshPermissionMenus(); });

var Page_number = 1;
var data_save = [];
var data_report_arr = [];
var data_save_send = [];
var data_save_public = [];

function updateDataSave(newData) {
    data_save = newData;
}
function updateDataSaveSend(newData) {
    data_save_send = newData;
}
function updateDataSavePublic(newData) {
    data_save_public = newData;
}
const COLLECTION_PATH = "documents"; // Dummy path
const current_view_title = document.getElementById("current-view-title");
const sub_head = document.getElementById("sub_head");
const menu_members = document.getElementById("menu-members");
const menu_edit_room_booking = document.getElementById("menu-edit-room-booking");
const menu_public = document.getElementById("menu-public");
const content_room_booking = document.getElementById("content_room_booking");
const menu_bookingroom  =  document.getElementById("menu-bookingroom");
const menu_groups = document.getElementById("menu-groups");
const menu_send = document.getElementById("menu-send");
const menu_send_table = document.getElementById("menu-send-table");
const menu_received = document.getElementById("menu-received");
const menu_maintenance = document.getElementById("menu-maintenance");
const menu_maintenance_admin = document.getElementById("menu-maintenance-admin");
const menu_bookdocnumber = document.getElementById("menu-bookdocnumber");
const send_email = document.getElementById("send_email");
const my_public = document.getElementById("my_menu_public");
const className_default =
    "menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150";
const className_click =
    "menu-item flex items-center p-3 rounded-lg bg-indigo-700 text-white transition duration-150";
const content_received = document.getElementById("content_received");
const add_doc_btn = document.getElementById("add-doc-btn");
const load_data = document.getElementById("load_data");
const components_pagination = document.getElementById("pagination_html");
const search_menu = document.getElementById("search_menu");
const modal = document.getElementById("modalOverlay");
const openModal = document.getElementById("openModal");
const closeIcon = document.getElementById("closeIcon");
const cancelBtn = document.getElementById("cancelBtn");
const closeDocDetail = document.getElementById("closeDocDetail");
const doc_detail = document.getElementById("doc_detail");
const content_edit_room_booking = document.getElementById("content_edit_room_booking");
// --- Main Initialization (MOCK) ---

// menu-members
// menu-groups
// menu-received
// menu-send
window.addEventListener('pageshow', function (event) {
    // event.persisted จะเป็น true ถ้าหน้าเว็บโหลดมาจาก Cache (กดย้อนกลับมา)
    if (event.persisted || window.performance && window.performance.navigation.type === 2) {
        // คำสั่งซ่อน Loader ของคุณ
        //document.getElementById('loading-icon').style.display = 'none';
        closeModal();
        console.log("ย้อนกลับ");
    }
});



window.onload = async () => {
    await window.sessionReady;
    if (!window.EOFFICE_MOCK_SERVICES && window.eofficeUser?.permissions?.includes('email')) {
        const processNotifications = () => {
            if (document.visibilityState === 'visible') fetch('api/process_notifications.php', {
                method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'
            }).catch(console.error);
        };
        setTimeout(processNotifications, 5000);
        setInterval(processNotifications, 60000);
    }
    if ((window.EOFFICE_MOCK_SERVICES || location.hostname === 'localhost') && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(console.error);
    document.getElementById('menu-logout').style.display = window.eofficeUser ? 'flex' : 'none';
    document.getElementById('openModal').style.display = window.eofficeUser ? 'none' : 'flex';
    document.getElementById('login_html').style.display = window.eofficeUser ? 'none' : 'block';
    if (window.eofficeUser) {
        setCookie('User_Status', window.eofficeUser.status, 30);
        setCookie('User_Id', window.eofficeUser.id, 30);
        setCookie('User_DisplayName', encodeURIComponent(window.eofficeUser.name), 30);
    } else {
        for (const name of ['User_Status','User_Id','User_DisplayName']) document.cookie = name + '=; Max-Age=0; path=/';
    }
    const isLocalhost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "[::1]"; // รองรับ IPv6

    if (isLocalhost) {
        console.log("กำลังทำงานบน: Localhost (เครื่องตัวเอง)");
        setCookie("RunOn", "Localhost", 30);
        // เช่น: ใช้ API URL ชุดพัฒนา
    } else {
        setCookie("RunOn", "Server", 30);
        console.log("กำลังทำงานบน: Real Server (เซิร์ฟเวอร์จริง)");
        // เช่น: ใช้ API URL ชุดจริง
    }

    let User_Status = getCookie("User_Status");
    let User_DisplayName = getCookie("User_DisplayName");
    document.getElementById('user_nameDisplay').textContent = User_DisplayName ? decodeURI(User_DisplayName) : '';
    if (!window.eofficeUser) {
      menu_members.style.display = 'none';
      menu_groups.style.display = 'none';
      document.getElementById('system_management').style.display = 'none';
      display_style('group_menu_members','none');
      display_style('group_menu_groups','none');
      display_style('group_send_email','none');
      display_style('group_send_email_div','none');
      display_style('send_email','none');
      display_style('my_public_div','none');
      display_style('group_send_email','none');
    }

    // เมนูฝ่ายงานตรวจจากสิทธิ์ที่เซิร์ฟเวอร์ส่งกลับ
    // (หลัง login สำเร็จจะมี cookie User_Id; ผู้ใช้เก่าที่ยังไม่มี cookie จะถูกซ่อนจนกว่าจะ login ใหม่)
    if (!window.eofficeUser?.permissions?.includes('maintenance')) {
      display_style('group_maintenance_admin','none');
      display_style('menu-maintenance-admin','none');
    }

    localStorage.setItem("read_status_change", '');
    if (window.eofficeUser?.permissions?.includes('email')) {
        display_style('send_email','flex');
        display_style('group_send_email','block');
    }
    if (!localStorage.getItem("page_number")) {
       localStorage.setItem("page_number", 1);

    }
    var page_number = parseInt(localStorage.getItem("page_number")) || 1;
    if( !localStorage.getItem("doc_type")){
      localStorage.setItem("doc_type", "ALL");
      }


    var currentPage = localStorage.getItem("currentPage");
    applyPermissionMenus();
    if (id && getCookie("User_Token")) {
        showView('received', "load", '1');
    } else if (urlParams.get('view')) {
        showView(urlParams.get('view'), "load");
    } else if (MODULE_ROUTES[currentPage]) {
        // An old saved module used to reopen inside the main page. Start at the document inbox instead.
        showView(window.eofficeUser ? 'received' : 'public', "load");
    } else if (currentPage) {
        // สั่งให้ UI แสดงผล Tab นั้นๆ
        showView(currentPage, "load");
    }else if (!User_Status) {
      showView('public');
    }  else {

      showView('received');

    }


    if (getCookie("User_Token") === null) {
        menu_members.style.display = "none";
        menu_groups.style.display = "none";
        menu_send.style.display = "none";
        menu_send_table.style.display = "none";
        menu_received.style.display = "none";

        display_style('group_send_email','none');
        display_style('group_send_email_div','none');
        display_style('send_email','none');
        display_style('system_management','none');
        display_style('my_public_div','none');
        display_style('my_menu_public','none');
        display_style('group_menu_bookdocnumber','none');
        display_style('menu-bookdocnumber','none');
        display_style('group_menu_members','none');
        display_style('li_menu_received','none');
        display_style('other_menu_group','none');
        display_style('group_menu_send_table_1','none');
        display_style('group_menu_send_table_2','none');
        display_style('group_menu_bookingroom','none');
        display_style('group_menu_edit_room_booking','none');
        display_style('group_menu_logout','none');



        menu_bookingroom.style.display = "none";
        menu_edit_room_booking.style.display = "none";
        //components_pagination.style.display = "none";
        content_received.innerHTML = `<div id="loop_receive">กรุณาเข้าสู่ระบบ หรือ ไม่พบข้อมูล<br></div>`;
        //search_menu.style.display = "none";
        modal.classList.add("active"); // ค่อยๆ แสดง (Fade In)

        showView('public');
    }


    //document.getElementById("user-info").textContent = ;

    // Set up event listeners for UI elements

    document
        .getElementById("close-modal-btn")
        .addEventListener("click", () => toggleModal(false));

    // Attach the listener for the mobile menu toggle
    document
        .getElementById("menu-toggle")
        .addEventListener("click", toggleSidebar);

    // Set default Thai year for the modal input field immediately
    const currentThaiYear = new Date().getFullYear() + 543;
    const docYearInput = document.getElementById("doc_year");
    if (docYearInput) {
        docYearInput.value = currentThaiYear;
    }

    const yearSelect = document.getElementById("yearSelect");
    let savedYear = getCookie("yearSelect");
    if (savedYear) {
        yearSelect.value = savedYear;
        console.log("คืนค่าจาก Cookie: " + savedYear);
    } else {
        yearSelect.value = currentThaiYear;
        console.log("ใช้ปีปัจจุบันเป็นค่าเริ่มต้น: " + currentThaiYear);
    }

    // --- 2. ส่วนการบันทึกข้อมูล (SAVE) ---
    // โค้ดที่คุณเขียน: ดักจับการเปลี่ยนค่าแล้วบันทึกลง Cookie
    yearSelect.addEventListener("change", function () {
        const yearValue = this.value;
        setCookie("yearSelect", yearValue, 30); // บันทึกไว้ 30 วัน
        console.log("บันทึกค่าใหม่แล้ว: " + getCookie("yearSelect"));
        currentPage = localStorage.getItem("currentPage");
        showView(currentPage,'load');
    });

};

/** Toggles the visibility of the sidebar on mobile. */
const toggleSidebar = () => {
    setSidebarOpen(document.getElementById('sidebar').dataset.sidebarOpen !== 'true');
};

/** Toggles the visibility of the Add Document modal. */
const sidebarDesktop = window.matchMedia('(min-width: 64rem)');
let sidebarBodyOverflow = null;

function setSidebarOpen(open) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    const button = document.getElementById('menu-toggle');
    const wasOpen = sidebar.dataset.sidebarOpen === 'true';
    const isOpen = !sidebarDesktop.matches && open;
    sidebar.dataset.sidebarOpen = String(isOpen);
    sidebar.inert = !sidebarDesktop.matches && !isOpen;
    overlay.classList.toggle('hidden', !isOpen);
    document.getElementById('main_div').inert = isOpen;
    button.setAttribute('aria-expanded', String(isOpen));
    button.setAttribute('aria-label', isOpen ? 'ปิดเมนู' : 'เปิดเมนู');
    if (isOpen) {
        if (sidebarBodyOverflow === null) sidebarBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        sidebar.querySelector('a')?.focus();
    } else {
        if (sidebarBodyOverflow !== null) {
            document.body.style.overflow = sidebarBodyOverflow;
            sidebarBodyOverflow = null;
        }
        if (!sidebarDesktop.matches && wasOpen) button.focus();
    }
}

sidebarDesktop.addEventListener('change', () => setSidebarOpen(false));
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('sidebar').dataset.sidebarOpen === 'true') setSidebarOpen(false);
});
setSidebarOpen(false);

const toggleModal = (show) => {
    const modal = document.getElementById("document-modal");
    modal.classList.toggle("hidden", !show);
    if (show) {
        const form = document.getElementById("document-form");
        form.reset();
        document.getElementById("doc-form-title").textContent = "เพิ่มเอกสารใหม่";

        // Set default Thai year when opening the modal
        const currentThaiYear = new Date().getFullYear() + 543;
        //document.getElementById('doc_year').value = currentThaiYear;
    }
};

  function toggleExportModal() {
    display_style('download_report_btn','none');
    display_style('report_detail','block');
    display_style('create_report_btn','block');

    const modal = document.getElementById('exportModal');
    modal.classList.toggle('hidden');
    modal.classList.toggle('flex');
  }




/** All data rendering and fetching functions removed */

/** Formats a date object or a string to a readable date string (Retained for future use/consistency). */
const formatDate = (dateInput) => {
    if (!dateInput) return "-";

    let date;

    // Check if it's a mock Timestamp object
    if (dateInput && typeof dateInput.toDate === "function") {
        date = dateInput.toDate();
    } else if (typeof dateInput === "string") {
        const monthMap = {
            "ม.ค.": "Jan",
            "ก.พ.": "Feb",
            "มี.ค.": "Mar",
            "เม.ย.": "Apr",
            "พ.ค.": "May",
            "มิ.ย.": "Jun",
            "ก.ค.": "Jul",
            "ส.ค.": "Aug",
            "ก.ย.": "Sep",
            "ต.ค.": "Oct",
            "พ.ย.": "Nov",
            "ธ.ค.": "Dec",
            "ส.ค.25": "Aug 25",
        };

        let standardDateStr = dateInput.trim();
        let yearMatch;

        for (const [thai, eng] of Object.entries(monthMap)) {
            standardDateStr = standardDateStr.replace(thai, eng).replace(".", "");
        }

        yearMatch = standardDateStr.match(/(\d{4})/);
        if (yearMatch) {
            let thaiYear = parseInt(yearMatch[1]);
            if (thaiYear > 2400) {
                let gregorianYear = thaiYear - 543;
                standardDateStr = standardDateStr.replace(
                    thaiYear.toString(),
                    gregorianYear.toString(),
                );
            }
        }

        date = new Date(standardDateStr);

        if (isNaN(date.getTime())) {
            return dateInput;
        }
    } else if (dateInput instanceof Date) {
        date = dateInput;
    } else {
        return "-";
    }

    try {
        return date.toLocaleDateString("th-TH", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch (e) {
        return dateInput;
    }
};

// ===== iframe auto-fit: ปรับความสูง iframe ให้เต็มพื้นที่จอที่เหลือ =====
// (เหตุผล: ให้ scrollbar มีอยู่ที่เดียว - ใน iframe การ์ด ไม่ซ้อนกับ scrollbar หน้าแม่)
function fit_iframe_height(iframe) {
    try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        if (!doc || !doc.documentElement) return;
        // หลักการ: ให้ iframe เติมพื้นที่จอที่เหลือพอดี -> scrollbar มีอยู่ที่เดียว (ใน iframe)
        // 1) เดินขึ้นจาก card ไปหา main_div สะสม "พื้นที่ใต้การ์ด" ที่ถูก element อื่นใช้จริง
        //    (padding ของ container, footer ฯลฯ) ไม่นับช่องว่างที่เหลือจาก flex stretch
        // 2) พื้นที่ว่าง = ความสูงจอ - ตำแหน่งบนของ iframe - พื้นที่ใต้ iframe
        const mainDiv = document.getElementById('main_div');
        if (!mainDiv) return;
        let el = iframe.parentElement; // การ์ดที่ครอบ iframe
        let reserve = 0;
        while (el && el !== mainDiv && el.parentElement && el.parentElement !== mainDiv) {
            const rect = el.getBoundingClientRect();
            const prect = el.parentElement.getBoundingClientRect();
            reserve += prect.bottom - rect.bottom;
            el = el.parentElement;
        }
        reserve += parseFloat(getComputedStyle(mainDiv).paddingBottom) || 0;
        const top = iframe.getBoundingClientRect().top;
        const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const avail = viewportHeight - top - reserve - 2; // -2 เผื่อ subpixel กัน scrollbar เกิน
        iframe.style.height = Math.max(avail, 300) + 'px';
    } catch (e) { /* cross-origin (ไม่ควรเกิด เนื่องจากเป็น same-origin ทั้งหมด): ข้ามไป */ }
}
function on_iframe_loaded(iframe) {
    fit_iframe_height(iframe);
    inject_thin_scrollbar(iframe);
}
// ฉีดสไตล์ scrollbar เล็กเข้า iframe (แต่ละหน้าเป็น document แยก ไม่ได้โหลด style_main.css)
// เรียกทุกครั้งที่ iframe โหลดเสร็จ (รวมเมื่อ navigates ภายใน iframe เช่น หน้า new_room.html)
function inject_thin_scrollbar(iframe) {
    try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.head) return;
        if (doc.getElementById('thin-scrollbar-style')) return;
        const style = doc.createElement('style');
        style.id = 'thin-scrollbar-style';
        style.textContent = '*{scrollbar-width:thin;scrollbar-color:#cbd5e1 transparent}*::-webkit-scrollbar{width:6px;height:6px}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:9999px}*::-webkit-scrollbar-thumb:hover{background:#94a3b8}';
        doc.head.appendChild(style);
    } catch (e) { /* cross-origin (ไม่ควรเกิด เนื่องจากเป็น same-origin ทั้งหมด): ข้ามไป */ }
}
window.fit_iframe_height = fit_iframe_height;
window.on_iframe_loaded = on_iframe_loaded;
// Expose functions to the window scope for use in inline HTML event handlers (onclick)
window.toggleSidebar = toggleSidebar;
window.toggleModal = toggleModal;
window.formatDate = formatDate;
const urlParams = new URLSearchParams(window.location.search);
var id = urlParams.get('id'); // ได้ค่า "123"
// วางโค้ดนี้ลงใน main.js เพื่อคอยสลัดปรับขนาด iframe เมื่อหน้าแจ้งซ่อมส่งสัญญาณมา
window.addEventListener('message', function(event) {
    if (false) {
        const iframe = document.getElementById('iframe_maintenance_requests');
        if (iframe) {
            // ปรับ iframe ให้สูงพอดีกับหน้าฟอร์มจริง (ความสูงแบบพิกเซลจะมาแทนที่ h-[70vh] ทันที)
            iframe.style.height = event.data.height + 'px'; 
        }
    }
});


function showView(showViews, page , page_number) {
    const permission = restrictedViewPermission(showViews);
    if (permission && !eofficeCan(permission)) showViews = window.eofficeUser ? 'received' : 'public';

    const moduleRoute = MODULE_ROUTES[showViews];
    if (moduleRoute) {
        if (!window.eofficeUser || getCookie('User_Token') === null) {
            showViews = 'public';
        } else {
            localStorage.setItem('currentPage', showViews);
            setSidebarOpen(false);
            window.location.assign(moduleRoute);
            return false;
        }
    }

document.body.style.overflow = "auto"; // คืนค่าให้เลื่อนหน้าเว็บได้ปกติ
components_pagination.style.display = 'block';
search_menu.style.display = 'block';
document.getElementById("content_room_booking").innerHTML = "";
document.getElementById("content_edit_room_booking").innerHTML = "";
content_edit_room_booking.style.display = 'none';
display_style('content_room_booking','none');
display_style('my_public_div','none');
display_style('content_edit_room_booking','none');
display_style('management_user','none');
display_style('management_department','none');
display_style('external_number_booking','none');
display_style('group_send_email_div','none');
display_style('maintenance_div','none');
display_style('maintenance_admin_div','none');

// หน้า iframe: ซ่อนการ์ดขาว (doc-list) ให้เต็มพื้นที่เนื้อหา ไม่ดูเป็นกล่องซ้อนกล่อง
// (หน้าเอกสาร: received/send/public/send_table ยังแสดงการ์ดขาวตามเดิม)
const IFRAME_VIEWS = ['members','groups','room_booking','room_booking2','edit_room_booking','book','send_email','my_public','maintenance','maintenance_admin'];
const docListCard = document.getElementById('doc-list');
if (docListCard) docListCard.style.display = IFRAME_VIEWS.includes(showViews) ? 'none' : 'block';

if (! page_number) {
   page_number = parseInt(localStorage.getItem("page_number"))||1;
}

  console.log('page number:'+page_number);
    localStorage.setItem("currentPage", showViews);


    if (page != "load") {
        setSidebarOpen(false);
    }

    display_style('btn_report','none');
    send_email.className = className_default;
    menu_maintenance.className = className_default;
    menu_maintenance_admin.className = className_default;
    my_public.className = className_default;
    menu_members.className = className_default;
    menu_groups.className = className_default;
    menu_send.className = className_default;
    menu_send_table.className = className_default;
    menu_received.className = className_default;
    menu_bookdocnumber.className = className_default;
    menu_public.className = className_default;
    menu_bookingroom.className = className_default;
    menu_edit_room_booking.className = className_default;
    display_style('sub_head','block');
    display_style('page_header','block'); // แสดงหัว title (หน้า iframe จะซ่อนเอง)
    console.log("Page_name : " + showViews);
    if (showViews != "received") {
      document.getElementById('read_icon_show').style.display = 'none';
    }else {
      document.getElementById('read_icon_show').style.display = 'flex';

    }

    display_style('doc_type_div','none');
    if (showViews == "members") {
                document.body.style.overflow = "auto"; // ให้หน้าแม่เลื่อนได้ (iframe จะยืดตามเนื้อหา)

        display_style('page_header','none'); // หน้า iframe มีหัวของตัวเอง -> ซ่อนหัว title หลัก
        current_view_title.innerHTML = "จัดการสมาชิก";
        display_style('sub_head','none');
        menu_members.className = className_click;
        content_received.style.display = "none";
        add_doc_btn.style.display = "none";

        display_style('management_user','block');
        components_pagination.style.display = 'none';
        search_menu.style.display = 'none';
        const management_user = document.getElementById("management_user");
        if (!management_user.querySelector('iframe')) {
            management_user.innerHTML = `

            `;
        }
        load_data.style.display = "none";

    } else if (showViews == "groups") {
        document.body.style.overflow = "auto"; // ให้หน้าแม่เลื่อนได้ (iframe จะยืดตามเนื้อหา)
        display_style('page_header','none'); // หน้า iframe มีหัวของตัวเอง -> ซ่อนหัว title หลัก
        current_view_title.innerHTML = "จัดการกลุ่มงาน";
        display_style('sub_head','none');
        menu_groups.className = className_click;
        content_received.style.display = "none";
        add_doc_btn.style.display = "none";
        load_data.style.display = "block";

        display_style('management_department','block');
        components_pagination.style.display = 'none';
        search_menu.style.display = 'none';
        const management_department = document.getElementById("management_department");
        if (!management_department.querySelector('iframe')) {
            management_department.innerHTML = `

            `;
        }
        load_data.style.display = "none";


    } else if (showViews == "received"  || id) {
        document.getElementById('search_txt').value = '';
        if (getCookie("User_Token")){

          if(id){
            var open_doc_id = Number.parseInt(id, 10);
            id = null;
            if (Number.isInteger(open_doc_id) && open_doc_id > 0) {
              get_data_api_received(1,'',open_doc_id, undefined, getCookie("User_Token"));
            } else {
              get_data_api_received(page_number);
            }
          } else {
            get_data_api_received(page_number);
          }

        }
        current_view_title.innerHTML = "หนังสือส่งถึง";
        sub_head.innerHTML = "ทั้งหมด";
        menu_received.className = className_click;
        content_received.style.display = "block";
        add_doc_btn.style.display = "none";
        load_data.style.display = "block";

    } else if (showViews == "send") {
        display_style('doc_type_div','flex');
        display_style('btn_report','block');
        document.getElementById('search_txt').value = '';
        if (getCookie("User_Token")) get_data_api_send(page_number);
        current_view_title.innerHTML = "ทะเบียนหนังสือรับ";
        menu_send.className = className_click;
        sub_head.innerHTML = "";
        add_doc_btn.style.display = "flex";
        load_data.style.display = "block";
        content_received.style.display = "block";
    }else if (showViews == "public") {
      display_style('sub_head','none');
      display_style('btn_report','block');
      get_data_api_public();
      current_view_title.innerHTML = "คำสั่ง";
      sub_head.innerHTML = "คำสั่ง";
      menu_public.className = className_click;
      content_received.style.display = "block";
      add_doc_btn.style.display = "none";
      load_data.style.display = "block";
    }else if (showViews == "send_table") {
        menu_send_table.className = className_click;
        display_style('doc_type_div','flex');
        display_style('btn_report','block');
        document.getElementById('search_txt').value = '';
        if (getCookie("User_Token")) get_data_api_send_table(page_number);
        current_view_title.innerHTML = "ทะเบียนหนังสือรับ";
        sub_head.innerHTML = "";
        add_doc_btn.style.display = "flex";
        load_data.style.display = "block";
        content_received.style.display = "block";
    } else if (showViews == "room_booking" ) {
        document.body.style.overflow = "auto"; // หน้าปฏิทินเต็มจอ ไม่ต้องล็อค scroll หน้าแม่
      display_style('page_header','none'); // หน้า iframe มีหัวของตัวเอง -> ซ่อนหัว title หลัก
      current_view_title.innerHTML = "จองห้องประชุม";
      display_style('sub_head','none');

    menu_bookingroom.className = className_click; // ไฮไลท์เมนู

    // จัดการการแสดงผลของ Container
    content_received.style.display = "none";
    content_room_booking.style.display = "block"; // แสดง Container นี้
    if(typeof content_edit_room_booking !== 'undefined') content_edit_room_booking.style.display = "none";

    add_doc_btn.style.display = "none";
    load_data.style.display = "none";
    components_pagination.style.display = 'none';
    search_menu.style.display = 'none';

    // ตรวจสอบและโหลด iframe สำหรับ room_booking (ไฟล์ index.html)
    // หน้า index เป็นแบบ full-screen -> ใช้ความสูงเต็มพื้นที่จอที่เหลือ
    // (หน้า new_room.html ที่เปิดต่อจากใน iframe จะมี scroll ภายในของตัวเอง)
    const containerBooking1 = document.getElementById("content_room_booking");
    if (!containerBooking1.querySelector('iframe')) {
        containerBooking1.innerHTML = `

        `;
    }

} else if (showViews == "room_booking2") {

    menu_bookingroom.className = className_click; // ไฮไลท์เมนู

    // จัดการการแสดงผลของ Container
    content_received.style.display = "none";
    content_room_booking.style.display = "none";
    if(typeof content_edit_room_booking !== 'undefined') content_edit_room_booking.style.display = "none";

    add_doc_btn.style.display = "none";
    load_data.style.display = "none";
    components_pagination.style.display = 'none';
    search_menu.style.display = 'none';

    // ตรวจสอบและโหลด iframe สำหรับ room_booking2 (ไฟล์ new_room.html)


} else if (showViews == "edit_room_booking") {
    document.body.style.overflow = "auto"; // ให้หน้าแม่เลื่อนได้ (iframe จะยืดตามเนื้อหา)
    display_style('page_header','none'); // หน้า iframe มีหัวของตัวเอง -> ซ่อนหัว title หลัก
    current_view_title.innerHTML = "แก้ไขการจองห้องประชุม";
    display_style('sub_head','none');
    if(typeof menu_edit_room_booking !== 'undefined') menu_edit_room_booking.className = className_click;

    // จัดการการแสดงผลของ Container
    content_received.style.display = "none";
    content_room_booking.style.display = "none";
    if(typeof content_edit_room_booking !== 'undefined') content_edit_room_booking.style.display = "block"; // แสดง Container นี้

    add_doc_btn.style.display = "none";
    load_data.style.display = "none";
    components_pagination.style.display = 'none';
    search_menu.style.display = 'none';

    // ตรวจสอบและโหลด iframe สำหรับ edit_room_booking (ไฟล์ edit_room_booking.html)
    const containerEdit = document.getElementById("content_edit_room_booking");
    if (containerEdit && !containerEdit.querySelector('iframe')) {
        containerEdit.innerHTML = `

        `;
    }
}else if (showViews == "book") {

  display_style('page_header','none'); // หน้า iframe มีหัวของตัวเอง -> ซ่อนหัว title หลัก
  current_view_title.innerHTML = "จองเลขคำสั่ง";
  display_style('sub_head','none');
  menu_bookdocnumber.className = className_click;
  add_doc_btn.style.display = "none";
  load_data.style.display = "none";
  components_pagination.style.display = 'none';
  search_menu.style.display = 'none';
  content_received.style.display = "none";
  content_room_booking.style.display = "none";
  display_style('external_number_booking','block');
  const external_number_booking = document.getElementById("external_number_booking");
  if (external_number_booking && !external_number_booking.querySelector('iframe')) {
      external_number_booking.innerHTML = `

      `;
  }

}else if (showViews == "send_email") {
        document.body.style.overflow = "auto"; // ให้หน้าแม่เลื่อนได้ (iframe จะยืดตามเนื้อหา)

  display_style('page_header','none'); // หน้า iframe มีหัวของตัวเอง -> ซ่อนหัว title หลัก
  current_view_title.innerHTML = "ส่งอีเมลคำสั่ง";
  display_style('sub_head','none');
  send_email.className = className_click;
  add_doc_btn.style.display = "none";
  load_data.style.display = "none";
  components_pagination.style.display = 'none';
  search_menu.style.display = 'none';
  content_received.style.display = "none";
  content_room_booking.style.display = "none";
  display_style('group_send_email_div','block');
  display_style('external_number_booking','none');
  const group_send_email_div = document.getElementById("group_send_email_div");
  if (group_send_email_div && !group_send_email_div.querySelector('iframe')) {
      group_send_email_div.innerHTML = `

      `;
  }

}

else if (showViews == "my_public") {
  display_style('page_header','none'); // หน้า iframe มีหัวของตัวเอง -> ซ่อนหัว title หลัก
  current_view_title.innerHTML = "คำสั่งของฉัน";
  display_style('sub_head','none');

  my_public.className = className_click;
  add_doc_btn.style.display = "none";
  load_data.style.display = "none";
  components_pagination.style.display = 'none';
  search_menu.style.display = 'none';
  content_received.style.display = "none";
  content_room_booking.style.display = "none";
  display_style('my_public_div','block');
  display_style('external_number_booking','none');
  const my_public_div = document.getElementById("my_public_div");
  // 🛡️ แก้บั๊ก: เดิมเช็คผิด container (group_send_email_div) ทำให้ iframe ถูกสร้างซ้ำทุกครั้ง
  if (my_public_div && !my_public_div.querySelector('iframe')) {
      my_public_div.innerHTML = `

      `;
  }

}else if (showViews == "maintenance") {
  display_style('page_header','none'); // หน้า iframe มีหัวของตัวเอง -> ซ่อนหัว title หลัก
  current_view_title.innerHTML = "แจ้งซ่อม";
  display_style('sub_head','none');
document.body.style.overflow = "auto"; // ให้หน้าแม่เลื่อนได้ (iframe จะยืดตามเนื้อหา)
  menu_maintenance.className = className_click;
  add_doc_btn.style.display = "none";
  load_data.style.display = "none";
  components_pagination.style.display = 'none';
  search_menu.style.display = 'none';
  content_received.style.display = "none";
  content_room_booking.style.display = "none";
  display_style('maintenance_div','block');

  const maintenance_div = document.getElementById("maintenance_div");
  // 🛡️ เพิ่ม guard (เหมือน branch อื่น) กันสร้าง iframe ใหม่ทุกครั้ง -> ฟอร์มไม่หายเมื่อกลับมาหน้าเดิม
  if (maintenance_div && !maintenance_div.querySelector('iframe')) {
      maintenance_div.innerHTML = `



      `;
  }

} else if (showViews == "maintenance_admin") {
  display_style('page_header','none'); // หน้า iframe มีหัวของตัวเอง -> ซ่อนหัว title หลัก
  current_view_title.innerHTML = "แจ้งซ่อม (ฝ่ายงาน)";
  display_style('sub_head','none');
  document.body.style.overflow = "auto"; // ให้หน้าแม่เลื่อนได้ (iframe จะยืดตามเนื้อหา)
  menu_maintenance_admin.className = className_click;
  add_doc_btn.style.display = "none";
  load_data.style.display = "none";
  components_pagination.style.display = 'none';
  search_menu.style.display = 'none';
  content_received.style.display = "none";
  content_room_booking.style.display = "none";
  display_style('maintenance_admin_div','block');

  const maintenance_admin_div = document.getElementById("maintenance_admin_div");
  if (maintenance_admin_div && !maintenance_admin_div.querySelector('iframe')) {
      maintenance_admin_div.innerHTML = `


      `;
  }

}

    // ปรับความสูง iframe ที่กำลังแสดงให้เต็มพื้นที่จอ (กัน scrollbar ซ้อน/พื้นที่ว่างด้านล่าง)
    document.querySelectorAll('iframe[data-fit]').forEach(function (f) {
        if (f.offsetParent !== null) fit_iframe_height(f);
    });

    if (getCookie("User_Token") === null) load_data.style.display = "none";

}
function view_doc_public(doc_id) {
    const doc = data_save_public.find((item) => String(item.doc_id) === String(doc_id));
    const doc_detail = document.getElementById("doc_detail");
    const doc_row_1 = document.getElementById("doc_row_1");
    const doc_row_2 = document.getElementById("doc_row_2");
    const doc_row_3 = document.getElementById("doc_row_3");
    const url_link = document.getElementById("url_link");
    var url_link_Add = '';
    url_link.innerHTML = '';
    if (doc) {
        doc_detail.classList.add("active"); // ค่อยๆ แสดง (Fade In)
        document.body.style.overflow = "hidden";
        if (doc.send_from !== undefined) {
            var send_from = "| ส่งโดย" + doc.send_from;
        } else {
            var send_from = "";
        }
        doc_detail.classList.remove("hidden"); // ลบคลาสซ่อนออก
        document.body.style.overflow = "hidden"; // ล็อคไม่ให้เลื่อนหน้าเว็บด้านหลัง
        console.log("ชื่อเอกสาร:", doc.doc_name);
        doc_row_1.innerHTML = `ที่ ${escapeHtml(doc.doc_number)} ${escapeHtml(send_from)} | ${escapeHtml(doc.doc_date)}`;
        doc_row_2.innerHTML = escapeHtml(doc.doc_name);
        doc_row_3.innerHTML = ` ID: ${escapeHtml(doc.doc_id)}  `;

            Read_File_API.innerHTML = "";
            Sign_File_API.innerHTML = "";
            const uploadPaths = Array.isArray(doc.doc_upload_path) ? doc.doc_upload_path : [];
            for (let i = 0; i < uploadPaths.length; i++) {
              const filePath = String(uploadPaths[i].path ?? '');
              const id_path = `public-file-${doc_id}-${i}`;
                console.log(
                    `Index ${i}. ${uploadPaths[i].detail}:${filePath}`,
                );
                const Read_File_Path = `${window.location.origin}/api/view_file.php?Doc_Id=${encodeURIComponent(doc.doc_id)}&File_Path=${encodeURIComponent(filePath)}&Year=${encodeURIComponent(doc.doc_year)}`;
                const Sign_File_Path = `e-sign/e-sign.php?Doc_Id=${encodeURIComponent(doc.doc_id)}&File_Path=${encodeURIComponent(filePath)}&Year=${encodeURIComponent(doc.doc_year)}`;

                var Read_file_Add = `

                <td class="p-2"> <a  onclick="this.style.display='none';document.getElementById('read_load_${id_path}').style.display='block';" href="${escapeHtml(Read_File_Path)}" ><img src="img/file.png" width="30px" alt=""></a>  ${escapeHtml(uploadPaths[i].detail)}
                <div style="display:none;" id="read_load_${id_path}" class="h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-t-transparent "> </div>
                </td>`;


                Read_File_API.innerHTML = Read_File_API.innerHTML + Read_file_Add;
            }

            if (isJson(doc.doc_url)) {
            var doc_url = JSON.parse(doc.doc_url);
            var i = 0;
            if (Array.isArray(doc_url)) doc_url.forEach(function(item) {

                    var key = Object.keys(item)[0]; // ดึงชื่อ Key ออกมา (เช่น "1" หรือ "2")
                    var url = safeHttpUrl(item[key]);            // ดึงค่า URL ออกมาตาม Key นั้น

                    // --- ตัวอย่างการนำไปใช้ ---
                    console.log("ID: " + key);
                    console.log("Link: " + url);

                    // ถ้าจะเอาไปสร้าง HTML ต่อ (สมมติ)
                    // document.getElementById('...').innerHTML += `<a href="${url}">Link ${key}</a><br>`;

                    url_link_Add = `
                    <td class="p-2" ><a   onclick="this.style.display='none';document.getElementById('url_load_${i}').style.display='block';" href="${escapeHtml(url)}"  ><img src="img/url_icon.png"  width="30px" alt=""></a> ${escapeHtml(key)}
                    <div style="display:none;" id="url_load_${i}" class="h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-t-transparent "></div>
                    </td>`;
                    i++;
                    url_link.innerHTML = url_link.innerHTML + url_link_Add;
                });

              console.log('url : true');

            }else {
              var doc_url = [doc.doc_url];
              var doc_url_name = [doc.doc_url_name];
              console.log(doc_url);
              var i = 0;
              for (let i = 0; i < doc_url.length; i++) {
                console.log(doc_url_name[i]+ ':' + doc_url[i]);
                url = safeHttpUrl(doc_url[i]);
                if (doc_url_name[i]) {
                  key = doc_url_name[i];
                }else {
                  key = '';
                }

                url_link_Add = `
                <td class="p-2" ><a   onclick="this.style.display='none';document.getElementById('url_load_${i}').style.display='block';" href="${escapeHtml(url)}"  ><img src="img/url_icon.png"  width="30px" alt=""></a> ${escapeHtml(key)}
                <div style="display:none;" id="url_load_${i}" class="h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-t-transparent "></div>
                </td>`;
                i++;
                url_link.innerHTML = url_link.innerHTML + url_link_Add;
              }
                console.log('url : true');
            }


    } else {
        console.error("หาไม่เจอ! ลองเช็คว่า doc_id ที่ส่งมาคือ:", doc_id);
    }
}
function view_doc_detail(doc_id, type) {
    var user_token = getCookie("User_Token");
    update_read_status(doc_id, user_token, type);

    const doc = data_save.find((item) => String(item.doc_id) === String(doc_id));
    const doc_detail = document.getElementById("doc_detail");
    const doc_row_1 = document.getElementById("doc_row_1");
    const doc_row_2 = document.getElementById("doc_row_2");
    const doc_row_3 = document.getElementById("doc_row_3");
    const Read_File_API = document.getElementById("Read_File_API");
    const Sign_File_API = document.getElementById("Sign_File_API");
    const url_link = document.getElementById("url_link");

    if (doc) {
        doc_detail.classList.add("active"); // ค่อยๆ แสดง (Fade In)
        document.body.style.overflow = "hidden";
        if (doc.send_from !== undefined) {
            var send_from = "| ส่งโดย" + doc.send_from;
        } else {
            var send_from = "";
        }
        doc_detail.classList.remove("hidden"); // ลบคลาสซ่อนออก
        document.body.style.overflow = "hidden"; // ล็อคไม่ให้เลื่อนหน้าเว็บด้านหลัง
        console.log("ชื่อเอกสาร:", doc.doc_name);
        doc_row_1.innerHTML = `<span class="text-green-600"><b>ที่ ${escapeHtml(doc.doc_number)} </b></span>| ${escapeHtml(doc.doc_receive_from)}   ${escapeHtml(send_from)} `;
        doc_row_2.innerHTML = escapeHtml(doc.doc_name);
        doc_row_3.innerHTML = `วันที่: ${escapeHtml(doc.doc_date_receive)} | แก้ไขล่าสุด: ${escapeHtml(doc.doc_date)} | ID:${escapeHtml(doc.doc_id)}  `;

            Read_File_API.innerHTML = "";
            Sign_File_API.innerHTML = "";
            const uploadPaths = Array.isArray(doc.doc_upload_path) ? doc.doc_upload_path : [];
            for (let i = 0; i < uploadPaths.length; i++) {
              const filePath = String(uploadPaths[i].path ?? '');
              const id_path = `document-file-${doc_id}-${i}`;
                console.log(
                    `Index ${i}. ${uploadPaths[i].detail}:${filePath}`,
                );
                const Read_File_Path = `${window.location.origin}/api/view_file.php?Doc_Id=${encodeURIComponent(doc.doc_id)}&File_Path=${encodeURIComponent(filePath)}&Year=${encodeURIComponent(doc.doc_year)}`;
                const Sign_File_Path = `e-sign/e-sign.php?Doc_Id=${encodeURIComponent(doc.doc_id)}&File_Path=${encodeURIComponent(filePath)}&Year=${encodeURIComponent(doc.doc_year)}`;

                var Read_file_Add = `

                <td class="p-2"> <a  onclick="this.style.display='none';document.getElementById('read_load_${id_path}').style.display='block';" href="${escapeHtml(Read_File_Path)}" ><img src="img/file.png" width="30px" alt=""></a>  ${escapeHtml(uploadPaths[i].detail)}
                <div style="display:none;" id="read_load_${id_path}" class="h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-t-transparent "> </div>
                </td>`;

                var Sign_file_Add = `
                <td class="p-2"><a  onclick="this.style.display='none';document.getElementById('sign_load_${id_path}').style.display='block';" href="${escapeHtml(Sign_File_Path)}"  ><img src="img/e-sign.png"  width="30px" alt=""></a> ${escapeHtml(uploadPaths[i].detail)}
                <div style="display:none;" id="sign_load_${id_path}" class="h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-t-transparent "></div>
                </td>`;
                Read_File_API.innerHTML = Read_File_API.innerHTML + Read_file_Add;
                Sign_File_API.innerHTML = Sign_File_API.innerHTML + Sign_file_Add;
            }
            var url_link_Add = '';
            url_link.innerHTML = '';
            if (isJson(doc.doc_url)) {
            var doc_url = JSON.parse(doc.doc_url);
            var i = 0;
            if (Array.isArray(doc_url)) doc_url.forEach(function(item) {

                    var key = Object.keys(item)[0]; // ดึงชื่อ Key ออกมา (เช่น "1" หรือ "2")
                    var url = safeHttpUrl(item[key]);            // ดึงค่า URL ออกมาตาม Key นั้น

                    // --- ตัวอย่างการนำไปใช้ ---
                    console.log("ID: " + key);
                    console.log("Link: " + url);

                    // ถ้าจะเอาไปสร้าง HTML ต่อ (สมมติ)
                    // document.getElementById('...').innerHTML += `<a href="${url}">Link ${key}</a><br>`;

                    url_link_Add = `
                    <td class="p-2" ><a   onclick="this.style.display='none';document.getElementById('url_load_${i}').style.display='block';" href="${escapeHtml(url)}"  ><img src="img/url_icon.png"  width="30px" alt=""></a> ${escapeHtml(key)}
                    <div style="display:none;" id="url_load_${i}" class="h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-t-transparent "></div>
                    </td>`;
                    i++;
                    url_link.innerHTML = url_link.innerHTML + url_link_Add;
                });

              console.log('url : true');

            }


    } else {
        console.error("หาไม่เจอ! ลองเช็คว่า doc_id ที่ส่งมาคือ:", doc_id);
    }
}

// ดักฟัง Event ที่ตัวพ่อใหญ่สุด
components_pagination.addEventListener("click", function (e) {
    // ป้องกัน Error กรณีคลิกโดนช่องว่าง
    const targetLink = e.target.closest("a");
    var search_txt = document.getElementById('search_txt').value;
    if (!targetLink) return;

    e.preventDefault();

    // 1. เช็กปุ่มตัวเลข (ผ่าน data-page)
    const page = parseInt(targetLink.getAttribute("data-page"));
    const type = targetLink.getAttribute("data-send");
    console.log(
        "คลิกที่หน้า:",
        page,
        "โหมด:",
        type,
        "หน้าปัจจุบันในระบบ:",
        Page_number,
    );
    if (!isNaN(page)) {
        if (type === "received") {
            get_data_api_received(page,search_txt);
        } else if (type === "send") {
            get_data_api_send(page,search_txt);
        }else if (type === "public") {
          get_data_api_public(page,search_txt);

        }else if (type === "send_table") {
          get_data_api_send_table(page,search_txt);

        }
    }

});

document.getElementById("loginForm").addEventListener("submit", function (e) {
    e.preventDefault(); // กันหน้าเว็บ Refresh
    console.log("Submit Login");
    const user = document.getElementById("Username").value;
    const pass = document.getElementById("user_password").value;

    // เรียกใช้ Function ที่เราเขียนไว้ด้านบน
    loginUser(user, pass);
});

// ฟังก์ชันเปิด
openModal.addEventListener("click", () => {
    //modal.classList.remove('hidden'); // ลบคลาสซ่อนออก
    modal.classList.add("active"); // ค่อยๆ แสดง (Fade In)
    document.body.style.overflow = "hidden"; // ล็อคไม่ให้เลื่อนหน้าเว็บด้านหลัง
    document.getElementById('register_part').style.display = 'none';
    document.getElementById('register_btn').style.display = 'block';
    document.getElementById('login_part').style.display = 'block';
    document.getElementById('head_login').innerHTML = 'เข้าสู่ระบบ';
    document.getElementById('register_email').value = '';
    document.getElementById('register_name').value = '';
    document.getElementById('checkbox_agreement').checked = false;
    display_style('btn_submit_register','block');
    display_style('detail_agreement','block');
    display_style('check_agreement','block');
    display_style('success_modal','none');
    display_style('registerForm','block');
    document.getElementById('register_part_text').innerHTML = '';
});

// ฟังก์ชันปิด
const closeModal = () => {
    modal.classList.remove("active"); // ค่อยๆ จางหาย
    document.body.style.overflow = "auto"; // คืนค่าให้เลื่อนหน้าเว็บได้ปกติ
    document.getElementById("doc_detail").classList.remove("active"); // ค่อยๆ จางหาย
};

closeIcon.addEventListener("click", closeModal);
//cancelBtn.addEventListener("click", closeModal);
closeDocDetail.addEventListener("click", closeModal);
// ปิดเมื่อคลิกพื้นที่ว่าง (Overlay) นอกกล่อง Modal
window.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
    if (e.target === doc_detail) closeModal();
});

function get_userName() {
    var nameSerch = document.getElementById("name_search").value;
    get_userName_request(nameSerch);
    console.log(nameSerch);
}

function get_groupName() {
    var GroupSerch = document.getElementById("group_search").value;
    get_groupName_request(GroupSerch);
    console.log(GroupSerch);
}

// เพิ่ม => หลัง (e)
document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!document.getElementById('register_email').value.includes('@')) document.getElementById('register_email').value += '@siya.ac.th';
    console.log("Submit registerForm");

    display_style('btn_submit_register','none');
    display_style('detail_agreement','none');
    display_style('check_agreement','none');
    display_style('success_modal','block');
    display_style('registerForm','none');

    const Formdata = document.getElementById("registerForm");
    const registerForm = new FormData(Formdata);

    try {
        const response = await fetch("../api/register.php", {
            method: "POST",
            body: registerForm,
        });

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new TypeError("Server did not return JSON");
        }

        const result = await response.json();
        if (response.ok && result.status === "success") {
            alert("🎉 ลงทะเบียนสำเร็จ! ");
            display_style('success_modal','none');
            display_style('registerForm','none');
            display_style('register_part','block');
            document.getElementById('register_part_text').innerHTML = `
            <div class="flex items-center p-4 mb-4 text-green-800  border-green-300 bg-green-50"> สมัครสมาชิกสำเร็จ กรุณายืนยันอีเมลเพื่อเข้าใช้งาน </div>
            <div class="flex items-center p-2 mb-4 text-red-800  border-red-300 bg-red-50">  อีเมลสำหรับยืนยันอาจอยู่ในเมลขยะ</div>

            <br>
            `;

        } else {
            alert("❌ ล้มเหลว: " + (result.message || "Something went wrong"));
            // กรณีล้มเหลว อย่าลืมโชว์ปุ่มกลับมาเพื่อให้ผู้ใช้กดใหม่ได้นะครับ
            display_style('btn_submit_register','block');
            closeModal();
        }

    } catch (error) {
        console.error("Error:", error);
        alert("เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง");
        display_style('btn_submit_register','block');
         closeModal();
    }
});



const docForm = document.getElementById("document-form");
docForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    var user_token = getCookie("User_Token");
    const formData = new FormData(docForm);
    if (localStorage.getItem('doc_type') !== 'Stamp') {
        formData.set('replace_recipients', '1');
        formData.set('replace_files', '1');
    }

    try {
      document.getElementById('submit_add_doc').style.display='none';
      document.getElementById('loading_save').style.display = 'block';
        const response = await fetch("../api/create_document.php", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${user_token}`,
            },
            body: formData,
        });

        // แปลงผลลัพธ์ที่ได้จาก PHP ให้เป็น JSON object
        const result = await response.json();

        if (response.ok && result.status === "success") {
            // ตรวจสอบว่ามี Error ในส่วนของไฟล์แนบหรือไม่
            if (result.files && result.files.status === "error") {
                // กรณีบันทึกข้อความสำเร็จ แต่ "ไฟล์" ไม่ผ่าน
                alert(
                    "⚠️ บันทึกข้อมูลสำเร็จ แต่ไฟล์แนบมีปัญหา:\n" + result.files.message,
                );

                // แนะนำ: ไม่ต้อง reload เพื่อให้ผู้ใช้เห็นว่าไฟล์ไหนผิดและแก้ไขได้ทันที
            } else {
                // กรณีสำเร็จทั้งหมด
                alert("✅ สำเร็จ: " + result.message);
                document.getElementById("document-modal").classList.add("hidden");
                var page_name = localStorage.getItem("currentPage");

                showView(page_name, "load");
                //form.reset();
                //  location.reload();
            }

        } else {
            // กรณี Error ตั้งแต่ระดับการบันทึกข้อมูลหลัก หรือ Token หมดอายุ
            alert("❌ ล้มเหลว: " + (result.message || "เกิดข้อผิดพลาดไม่ทราบสาเหตุ"));
        }
    } catch (error) {
        console.error("Error:", error);
        alert("ไม่สามารถเชื่อมต่อกับ API ได้ หรือระบบส่งข้อมูลกลับมาไม่ใช่ JSON");
    }

});
function search_find(doc_type){
  if (doc_type) {
    localStorage.setItem("doc_type", doc_type);
  }
  var search_txt = document.getElementById('search_txt').value;
  var page_name = localStorage.getItem("currentPage");
  if (page_name == 'received') {
    get_data_api_received(1,search_txt);
  }else if (page_name == 'send') {
    get_data_api_send(1,search_txt);

  }else if (page_name == 'public') {
    get_data_api_public(1,search_txt);
  }else if (page_name == 'send_table') {
    get_data_api_send_table(1,search_txt);

  }

}
function open_create_doc(){
  display_style('delete_doc_btn','none');

  document.getElementById("read_show").style.display = 'none';
  document.getElementById("read_head").style.display = 'none';
  document.getElementById('submit_add_doc').style.display = 'block';
  document.getElementById('loading_save').style.display = 'none';
  document.getElementById("user_send").innerHTML = "";
  document.getElementById("findName").innerHTML = "";
  document.getElementById("name_search").value = "";
  document.getElementById("doc_file_link_main").innerHTML = '';
  document.getElementById("file_send").innerHTML = '';
  document.getElementById("group_send").innerHTML = '';
  document.getElementById("findGroup").innerHTML = '';

  window.toggleModal(true);

  document.getElementById('formtype').value = 'create_document';
}

function toggleSelection(element) {
    // 1. ตรวจสอบก่อนว่าตัวที่คลิก "มีคลาส is-active อยู่แล้ว" หรือไม่
    const isActive = element.classList.contains('is-active');

    // 2. ลบคลาส is-active ออกจากทุกเมนู (เพื่อให้เลือกได้ทีละอัน)
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('is-active');
    });

    // 3. ถ้าก่อนหน้านี้มันไม่ได้ active ให้เติม active เข้าไป
    // (แต่ถ้ามัน active อยู่แล้ว พอกดซ้ำมันจะกลายเป็นลบออกทั้งหมดแทน)
    if (!isActive) {
        element.classList.add('is-active');
    }
}

function read_status_change(status,api){
  var read_status = localStorage.getItem("read_status_change");
  if (read_status == status) {
    localStorage.setItem('read_status_change' ,'');
  }else {
    localStorage.setItem('read_status_change' ,status);
  }
  read_status = localStorage.getItem("read_status_change");

        if (read_status == 'NotRead') {
      document.getElementById('sub_head').innerHTML = 'ใหม่';
      }else if (read_status =='Readed') {
        document.getElementById('sub_head').innerHTML = 'อ่านแล้ว';
      }else {
        document.getElementById('sub_head').innerHTML = 'ทั้งหมด';
      }

  console.log('read_status_change:'+read_status);
  if (api == 'load') {
    get_data_api_received();

  }
}

function read_show() {
  var x = document.getElementById("read_show");
  if (x.style.display === "none") {
    x.style.display = "block";
  } else {
    x.style.display = "none";
  }
}

function register(){
document.getElementById('register_part').style.display = 'block';
document.getElementById('register_btn').style.display = 'none';
document.getElementById('login_part').style.display = 'none';
document.getElementById('head_login').innerHTML = 'สมัครสมาชิก';
}
function display_style(x,d){

    document.getElementById(x).style.display = d;



}

function openReportPage_path(){
  var currentPage = localStorage.getItem("currentPage");
  console.log("currentPage : " + currentPage);
  if (currentPage == "public") {
      exportJsonToExcel();
        }else {
      openReportPage();
  }
}
// Function to export JSON data to Excel
function exportJsonToExcel() {

  const now = new Date();

  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear() + 543; // บวก 543 เป็นปีไทย
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');

  // ต่อกัน
  const dateStringTH = `${day}_${month}_${year}_${hour}_${minute}`;

  console.log(dateStringTH);
  // ผลลัพธ์: 29_01_2569_23_30


  var jsonData = [];
  let data = data_report_arr; // สมมติว่ามีข้อมูลในนี้แล้ว

  // 1. กำหนดคู่มือการเปลี่ยนชื่อ { "ชื่อเดิม" : "ชื่อใหม่" }
  const renameMap = {
      "doc_id": "รหัสเอกสาร",
      "doc_name": "ชื่อเรื่อง",
      "doc_date_receive": "วันที่",
      "doc_number": "เลขทะเบียนรับ",
      "doc_number_receive": "ที่",
      "doc_other": "หมายเหตุ",
      "doc_receive_from": "จาก",
      "doc_action": "การปฏิบัติ",
      "doc_year": "ปี"
  };

  // 2. คีย์ที่จะลบทิ้ง
  const removeKeys = [
      "Pagination", "doc_url_name", "doc_date_update", "doc_url",
      "doc_type", "doc_date", "doc_file_link", "external_number",
      "status", "date", "doc_upload_path", "user_send_to"
  ];

  // 3. [แก้ตรงนี้] ลำดับการเรียงต้องใช้ "ชื่อใหม่" (ภาษาไทย) ครับ
  const desiredOrder = [
      "รหัสเอกสาร",      // มาจาก doc_id
      "วันที่",           // มาจาก doc_date_receive
      "เลขทะเบียนรับ",    // มาจาก doc_number
      "ที่",             // มาจาก doc_number_receive
      "จาก",             // มาจาก doc_receive_from
      "ชื่อเรื่อง",
      "การปฏิบัติ" ,       // มาจาก doc_name
      "หมายเหตุ"       // มาจาก doc_action
  ];

  // 4. เริ่มประมวลผล
  jsonData = data.map(obj => {
      // A. แปลงข้อมูลเบื้องต้น (เปลี่ยนชื่อ + ลบ)
      const processedObj = Object.keys(obj).reduce((acc, key) => {
          if (removeKeys.includes(key)) return acc; // ถ้าอยู่ในรายการลบ ให้ข้าม

          const newKey = renameMap[key] || key;     // เปลี่ยนชื่อถ้ามีในคู่มือ
          acc[newKey] = obj[key];
          return acc;
      }, {});

      // B. จัดเรียงลำดับใหม่ (Sort Keys)
      const sortedObj = {};

      // วนลูปตามลำดับภาษาไทยที่เราตั้งไว้
      desiredOrder.forEach(newKeyName => {
          // เช็คว่ามีคีย์ภาษาไทยนี้อยู่ไหม
          if (processedObj.hasOwnProperty(newKeyName)) {
              sortedObj[newKeyName] = processedObj[newKeyName];
              delete processedObj[newKeyName]; // ลบออกจากกองกลาง กันซ้ำ
          }
      });

      // เอาของที่เหลือ (เช่น "ปี" ที่ไม่ได้ระบุใน desiredOrder) มาต่อท้าย
      Object.assign(sortedObj, processedObj);

      return sortedObj;
  });

  console.log(jsonData);



    //jsonData = newData;
    const workbook = XLSX.utils.book_new();

    // Convert JSON data to a worksheet
    const worksheet = XLSX.utils.json_to_sheet(jsonData);

    // Append the worksheet to the workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    filename = `report_${dateStringTH}.xlsx`;
    // Export the workbook as an Excel file
    XLSX.writeFile(workbook, filename);
    toggleExportModal();
}



function setActiveButton(type) {
    const btns = {
        'Internal': document.getElementById('internal_btn'),
        'External': document.getElementById('external_btn'),
        'Stamp': document.getElementById('stamp_btn')
    };

    const targetBtn = btns[type];
    const isActive = targetBtn.classList.contains('opacity-100');

    if (isActive) {
        // --- กรณีที่ 1: กดปุ่มเดิมที่ชัดอยู่แล้ว -> ทำให้จางทั้งหมด ---
        Object.values(btns).forEach(btn => {
            btn.classList.replace('opacity-100', 'opacity-40');
        });
        search_find('ALL');
    } else {
        // --- กรณีที่ 2: กดปุ่มที่จางอยู่ -> ชัดเฉพาะปุ่มนั้น ปุ่มอื่นจาง ---
        Object.keys(btns).forEach(key => {
            if (key === type) {
                btns[key].classList.replace('opacity-40', 'opacity-100');
            } else {
                btns[key].classList.replace('opacity-100', 'opacity-40');
            }
        });
        search_find(type);
    }
}

async function openReportPage() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear() + 543;
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');

    const dateStringTH = `${day}_${month}_${year}_${hour}_${minute}`;
    console.log("วันที่รายงาน:", dateStringTH);

    let data = data_report_arr; // ตรวจสอบให้แน่ใจว่าตัวแปรนี้มีข้อมูล
    let doc_type_send = localStorage.getItem("doc_type");
if(doc_type_send == 'Stamp'){
  var renameMap = {
      "doc_name": "ชื่อเรื่อง",
      "doc_date_receive_stamp": "ลงวันที่",
      "doc_date": "วันที่",
      "doc_number": "ที่",
      "doc_number_receive_stamp": "เลขทะเบียนรับ",
      "doc_other": "หมายเหตุ",
      "doc_receive_from": "จาก",
      "doc_year": "ปี"
  };

  var removeKeys = [
      "Pagination", "doc_url_name", "doc_date_update", "doc_url",
      "doc_type", "doc_file_link", "external_number",
      "status", "date", "doc_upload_path", "user_send_to","doc_id", "doc_action"
  ];

  var desiredOrder = [
      "รหัสเอกสาร", "วันที่", "เลขทะเบียนรับ", "ที่","ลงวันที่", "จาก", "ชื่อเรื่อง", "หมายเหตุ"
  ];

}else {
  var renameMap = {
      "doc_name": "ชื่อเรื่อง",
      "doc_date_receive": "ลงวันที่",
      "doc_date": "วันที่",
      "doc_number_receive": "เลขทะเบียนรับ",
      "doc_number": "ที่",
      "doc_other": "หมายเหตุ",
      "doc_receive_from": "จาก",
      "doc_action": "การปฏิบัติ",
      "doc_year": "ปี"
  };

  var removeKeys = [
      "Pagination", "doc_url_name", "doc_date_update", "doc_url",
      "doc_type", "doc_file_link", "external_number",
      "status", "date", "doc_upload_path", "user_send_to","doc_id"
  ];
  var desiredOrder = [
      "รหัสเอกสาร", "วันที่", "ที่", "เลขทะเบียนรับ","ลงวันที่", "จาก", "ชื่อเรื่อง", "การปฏิบัติ", "หมายเหตุ"
  ];

}



    // --- ส่วนการประมวลผลข้อมูล ---
    const jsonData = data.map(obj => {
        // A. เปลี่ยนชื่อและลบคีย์
        const processedObj = Object.keys(obj).reduce((acc, key) => {
            if (removeKeys.includes(key)) return acc;
            const newKey = renameMap[key] || key;
            acc[newKey] = obj[key];
            return acc;
        }, {});

        // B. จัดเรียงลำดับคีย์ใหม่
        const sortedObj = {};
        desiredOrder.forEach(newKeyName => {
            if (processedObj.hasOwnProperty(newKeyName)) {
                sortedObj[newKeyName] = processedObj[newKeyName];
                delete processedObj[newKeyName];
            }
        });

        Object.assign(sortedObj, processedObj);
        return sortedObj; // *** ต้อง Return ค่าออกไปที่ jsonData ***
    });

    console.log("Data to send:", jsonData);



        // สร้าง Form ชั่วคราวขึ้นมา
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = 'report.php'; // หน้าที่จะเปิด
        form.target = '_blank';    // เปิดหน้าใหม่

        // สร้าง Input เพื่อใส่ข้อมูล JSON
        const hiddenField = document.createElement('input');
        hiddenField.type = 'hidden';
        hiddenField.name = 'data_json'; // ชื่อที่จะไปรับใน PHP
        hiddenField.value = JSON.stringify({
            title: 'ส่งข้อมูลไปพิมพ์รายงาน',
            reportData: jsonData
        });

        form.appendChild(hiddenField);
        document.body.appendChild(form);
        form.submit(); // ส่งค่าไปและเปลี่ยนหน้า
        document.body.removeChild(form); // ส่งเสร็จแล้วลบทิ้ง

}


// Event listener for the export button
