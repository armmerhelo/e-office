const pagination_element = document.getElementById('Pagination');

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[character]);
}

function safeHttpUrl(value) {
    if (!value) return '#';
    try {
        const url = new URL(String(value), window.location.href);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
    } catch (error) {
        return '#';
    }
}

let receivedRequestSequence = 0;
let sendTableRequestSequence = 0;
let sendRequestSequence = 0;
let publicRequestSequence = 0;


async function logOut() {
    try {
        // 1. เรียก API ปลายทาง (ยิงไปที่ api/logout.php)
        const response = await fetch('api/logout.php', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.status === 'success') {
            // 2. ล้างค่าในหน่วยความจำของ Browser ทั้งหมด (LocalStorage และ SessionStorage)
            localStorage.clear(); // ล้างข้อมูลทั้งหมดใน LocalStorage (รวมถึง User_Token และข้อมูลอื่นๆ)
            sessionStorage.clear(); // ล้าง SessionStorage

            // 3. สั่งลบ Cookie ฝั่ง JavaScript ย้ำอีกรอบเพื่อความชัวร์ 100%
            document.cookie = "User_Token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
            document.cookie = "User_DisplayName=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

            // 4. แจ้งเตือนและย้ายหน้าไปยังหน้า Login หรือหน้าหลัก (ไม่แนะนำให้ใช้ reload เฉยๆ)
            alert("ออกจากระบบเรียบร้อยแล้ว");

            // เปลี่ยน 'login.php' เป็นชื่อไฟล์หน้าแรก หรือหน้า Login จริงในระบบของคุณนะครับ
            window.location.href = 'index.php';
        } else {
            alert("ไม่สามารถออกจากระบบได้: " + data.message);
        }
    } catch (error) {
        console.error('Logout failed:', error);
        // หาก API พัง อย่างน้อยก็ควรล้างค่าฝั่ง Client แล้วส่งกลับหน้า Login
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = 'index.php';
    }
}
async function loginUser(username, password) {

    const apiUrl = 'api/auth_login.php'; // เปลี่ยนเป็น URL ของคุณ
    console.log('start authentication login');
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        });

        // แปลงข้อมูลที่ตอบกลับมาจาก PHP (JSON) ให้เป็น Object
        const result = await response.json();

        if (response.ok) {
            // กรณี Login สำเร็จ (Status 200)
            console.log("เข้าสู่ระบบสำเร็จ:", result);


            document.getElementById('success_modal').style.display = 'block';
            document.getElementById('modal_body').style.display = 'none';

            setTimeout(() => {
                console.log("ผ่านไป 2 วินาทีแล้ว!");
                const modal = document.getElementById('modalOverlay');
                const login_html = document.getElementById('login_html');
                //modal.classList.add('hidden');
                modal.style.display = 'none';
                document.body.style.overflow = 'auto';
                document.getElementById('openModal').style.display = 'none';
                document.getElementById('menu-logout').style.display = 'flex';
                login_html.style.display = 'none';

                window.location.reload();
            }, 2000);
        } else {
            // กรณี Login ไม่สำเร็จ (Status 401, 404, 500)
            console.error("Login ล้มเหลว:", result.message);
            document.getElementById('login_status').textContent = 'Login ล้มเหลว:' + result.message;
            //  alert("Error: " + result.message);
        }

    } catch (error) {
        // กรณีเกิด Error ที่ระบบ Network หรือ Server ล่ม
        console.error("เกิดข้อผิดพลาดในการเชื่อมต่อ:", error);
        alert("ไม่สามารถติดต่อ Server ได้");
    }
}

async function get_data_api_received(Page_number,search_txt,doc_id, Year, user_token) {

    var read_status = localStorage.getItem("read_status_change");
    if (!read_status) { read_status = ''; }
    Page_number = Math.max(1, parseInt(Page_number, 10) || 1);
    if (Year === undefined) Year = getCookie('yearSelect');
    const requestSequence = ++receivedRequestSequence;
    console.log("Year : " + Year);
    console.log("Page : " + Page_number);
    localStorage.setItem("page_number", Page_number);
    console.log('Page_number is:'+Page_number);

    // ใช้ getElementById เพื่อความชัวร์ (แทนการเรียก ID ตรงๆ)
    const load_data = document.getElementById('load_data');
    const loop_receive = document.getElementById('loop_receive');

    const content_received = document.getElementById('content_received');

    // **จุดสำคัญที่แก้ Error:** เช็คว่ามีกล่อง loop_receive อยู่ไหม ถ้าไม่มีให้หยุดทันที
    if (!loop_receive) {
        console.error("หา element 'loop_receive' ไม่เจอ");
        return;
    }

    // แสดงตัวโหลด และ เคลียร์ข้อมูลเก่า
    if (load_data) load_data.style.display = "block";
    loop_receive.innerHTML = '';

    // --- 2. ยิง API ด้วย Fetch (แทน XMLHttpRequest) ---
    const url = 'api/get_data_received.php';
    const payload = {
        title: 'ตัวอย่างโพสต์ใหม่',
        body: 'เนื้อหาจาก Fetch',
        Page_number: Page_number,
        Year: Year,
        search_txt: search_txt,
        Read_Status_find : read_status,
        Doc_Id : doc_id
    };

    try {

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${user_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            credentials: 'include' // ส่ง Cookie ไปด้วย
        });

        if (!response.ok) throw new Error(`HTTP Status: ${response.status}`);

        const data = await response.json(); // ตัวแปร data ชื่อเดิม
        if (requestSequence !== receivedRequestSequence) return;
        console.log('ข้อมูลที่ได้รับ:', data);
        //data_save = data;
        updateDataSave(data);

        // ตัวแปร Pagination (ประกาศข้างนอกกัน Error)
        let Pagination = 0;

        // --- 3. ตรวจสอบว่ามีข้อมูลไหม ---
        if (Array.isArray(data) && data.length > 0 && data[0]['doc_id']) {

            // ดึงค่าจำนวนหน้าจากตัวแรก
            Pagination = parseInt(data[0]['Pagination']) || 0;

            let html_buffer = ""; // ตัวพักข้อมูล html
            const width  = window.innerWidth;
            const height = window.innerHeight;
            console.log(`Viewport: ${width}x${height}`);
            // วนลูปสร้าง HTML (ใช้ชื่อตัวแปรเดิม text_add)
            for (let i = 0; i < data.length; i++) {
                const docId = Number.parseInt(data[i]['doc_id'], 10);
                if (!Number.isInteger(docId) || docId <= 0) continue;

                // Logic เดิมของคุณ
                var doc_status = '';







let date_stamp = '';
if (width >= 1300) {

  if (data[i]['status_urgent'] == 'Urgent') {
      header_color_urgent = 'bg-red-100';
  }else {
      header_color_urgent = '';
  }

  if (data[i]['status'] == 'NotRead') {
      header_color = 'bg-gray-200';
  }else if (data[i]['status'] == 'Readed') {
      header_color = '';
  }


  var text_add = `
<tr id="tb_status_read_${docId}" onclick="view_doc_detail(${docId},'received')" class="hover:bg-gray-200 transition-colors ${header_color}">

<td class="border border-gray-300 p-2 text-[11px] leading-tight text-nowrap font-medium">
${escapeHtml(docId)}
</td>
<td class="border border-gray-300 p-2 leading-tight text-nowrap font-medium   ">
${escapeHtml(data[i]['doc_date'])}
</td>
<td class="border border-gray-300 p-2 font-medium text-[12px]">${escapeHtml(data[i]['doc_number_receive'])} </td>
<td class="border border-gray-300 p-2">${escapeHtml(data[i]['doc_number'])}</td>
<td class="border border-gray-300 p-2 text-nowrap"> ${escapeHtml(data[i]['doc_date_receive'])}</td>
<td class="border border-gray-300 p-2  "> ${escapeHtml(data[i]['send_from'])}  </td>
<td class="border border-gray-300 p-2 text-left ${header_color_urgent}" >${escapeHtml(data[i]['doc_receive_from'])} - ${escapeHtml(data[i]['doc_name'])}</td>


</tr>
  `;


}else {
  if (data[i]['status_urgent'] == "Urgent") {
      header_color = 'bg-red-100';
  }else {
      header_color = 'bg-gray-200';
  }

  if (data[i]['status'] == 'NotRead') {
       doc_status = `<span id="doc_status_${docId}" class="flex items-center w-full"><span class="w-4 h-4 bg-red-500 rounded-full ml-auto"></span></span>`;
  }else if (data[i]['status'] == 'Readed') {
    doc_status = ``;
  } else {
     doc_status = `<span id="doc_status_${docId}" class="flex items-center w-full"><span class="w-4 h-4 bg-red-500 rounded-full ml-auto"></span></span>`;
  }

  var text_add = `
  <a onclick="view_doc_detail(${docId},'received')" >
  <div class="max-w-2xl mx-auto my-8 bg-white rounded-xl shadow-lg overflow-hidden border-b-1 hover:shadow-xl transition">
      <div class="${header_color}  text-gray-500 p-3 border-b-1 border-black-800 text-left">
          <table width="100%">
              <tr>
                  <td>
                      <p class="text-xs font-medium truncate">


                       <span class="font-medium text-gray-600"> <span  class="text-green-600"><b>ที่ ${escapeHtml(data[i]['doc_number_receive'])} </b> |  </span > ${escapeHtml(data[i]["doc_receive_from"])} | </span>  <span class=" max-sm:block font-medium text-gray-600"> ส่งโดย ${escapeHtml(data[i]['send_from'])} </span>


                      </p>
                  </td>
                  <td align="right">
                      ${doc_status}
                      </div>
                  </td>
              </tr>
          </table>
      </div>

      <div class="p-3 space-y-2 text-gray-700 text-left ">
           <p class="text-s font-semibold ">${escapeHtml(data[i]['doc_name'])}</p>
      </div>

      <div class="bg-gray-50 p-3 text-xs text-gray-500 text-right">
          <p>
           <span class="font-medium text-gray-600">  วันที่: ${escapeHtml(data[i]['doc_date_receive'])} | </span>


               <span id="date_update_show" class="font-medium text-gray-600">แก้ไขล่าสุด: ${escapeHtml(data[i]['doc_date'])} | </span>
               <span class="font-medium text-gray-600">ID: ${escapeHtml(docId)}</span>
          </p>
      </div>
  </div>
  </a>
  `;
}


                html_buffer += text_add; // เก็บใส่ buffer ก่อน
            }

if (width >= 1300) {


                          html_buffer = `    <div class="w-full overflow-x-auto border border-gray-300 rounded-sm shadow-sm">
                                <table class="w-full border-collapse bg-white text-sm text-center">
                                  <thead class="bg-[#fcfcfc] text-gray-700">
                                    <tr>
                                      <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap" style="width:50px !important;">ID</th>
                                      <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap " style="width:140px !important;" >วันที่</th>
                                      <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap text-nowrap" style="width:80px !important;" >เลขทะเบียนรับ</th>
                                      <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap" style="width:140px !important;" >ที่</th>
                                      <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap text-nowrap" style="width:140px !important;" >ลงวันที่</th>
                                      <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap" style="width:120px !important;" >จาก</th>
                                      <th class="border border-gray-300 p-2 font-semibold min-w-[300px] text-left">ชื่อเรื่อง</th>
                                    </tr>
                                  </thead>
                                          <tbody class="text-gray-600">
                                          `
                                  +html_buffer+
                                  `  </tbody>
                                        </table>
                                      </div>`;

}



            // แสดงผลทีเดียว (เร็วกว่า)
            if (!doc_id) {
              loop_receive.innerHTML = html_buffer;
            }else {
              view_doc_detail(doc_id,'received');

            }

            console.log('Page_number is 2:'+Page_number);
            pagination_create(Pagination, 'received',  Page_number);


            // อัปเดตตัวเลขหน้า (เช็คก่อนว่ามี element ไหม กัน Error)
            if (document.getElementById('All_Doc')) document.getElementById('All_Doc').textContent = data[0].Total_Records ?? Pagination * 20;
            if (document.getElementById('All_Doc_1')) document.getElementById('All_Doc_1').textContent = (Page_number - 1) * 20 + 1;
            if (document.getElementById('All_Doc_2')) document.getElementById('All_Doc_2').textContent = (Page_number - 1) * 20 + data.length;
            //view_doc_detail(1179,'received');
        } else {
            // กรณีไม่มีข้อมูล หรือไม่ได้ Login
            currentPage = localStorage.getItem("currentPage");
            if (currentPage == 'received') {
              if (content_received) content_received.innerHTML = `<div id="loop_receive">ไม่มีหนังสือใหม่<br></div>`;

            }else {
              if (content_received) content_received.innerHTML = `<div id="loop_receive">ไม่พบข้อมูล<br></div>`;

            }
            if (data.error) console.log("status api:" + data['error']);
            load_data.style.display = 'none';

            pagination_create(1, 'received', Page_number);

        }



    } catch (error) {
        if (requestSequence === receivedRequestSequence) {
            console.error('⚠️ ข้อผิดพลาดเครือข่าย หรือ โค้ด:', error);
        }
    } finally {
        if (requestSequence === receivedRequestSequence && load_data) load_data.style.display = "none";
    }
    if (requestSequence === receivedRequestSequence) {
        window.history.replaceState(null, null, window.location.pathname);
    }

}

async function get_data_api_public(Page_number,search_txt, Year) {

    // --- 1. ตรวจสอบค่าเริ่มต้น และ Element ในหน้าเว็บ ---
    Page_number = Math.max(1, parseInt(Page_number, 10) || 1);
    if (Year === undefined) Year = getCookie('yearSelect');
    const requestSequence = ++publicRequestSequence;
    localStorage.setItem("page_number", Page_number);
    console.log("Page : " + Page_number);

    // ใช้ getElementById เพื่อความชัวร์ (แทนการเรียก ID ตรงๆ)
    const load_data = document.getElementById('load_data');
    const loop_receive = document.getElementById('loop_receive');
    const content_received = document.getElementById('content_received');

    // **จุดสำคัญที่แก้ Error:** เช็คว่ามีกล่อง loop_receive อยู่ไหม ถ้าไม่มีให้หยุดทันที
    if (!loop_receive) {
        console.error("หา element 'loop_receive' ไม่เจอ");
        return;
    }

    // แสดงตัวโหลด และ เคลียร์ข้อมูลเก่า
    if (load_data) load_data.style.display = "block";
    loop_receive.innerHTML = '';

    // --- 2. ยิง API ด้วย Fetch (แทน XMLHttpRequest) ---
    const url = 'api/get_data_public.php';
    const payload = {
        title: 'ตัวอย่างโพสต์ใหม่',
        body: 'เนื้อหาจาก Fetch',
        Page_number: Page_number,
        Year: Year,
        search_txt: search_txt
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            credentials: 'include' // ส่ง Cookie ไปด้วย
        });

        if (!response.ok) throw new Error(`HTTP Status: ${response.status}`);

        const data = await response.json(); // ตัวแปร data ชื่อเดิม
        if (requestSequence !== publicRequestSequence) return;
        console.log('ข้อมูลที่ได้รับ:', data);
        //data_save_public = data;
        updateDataSavePublic(data);
        // ตัวแปร Pagination (ประกาศข้างนอกกัน Error)
        let Pagination = 0;

        // --- 3. ตรวจสอบว่ามีข้อมูลไหม ---
        if (Array.isArray(data) && data.length > 0 && data[0]['doc_id']) {

            // ดึงค่าจำนวนหน้าจากตัวแรก
            Pagination = parseInt(data[0]['Pagination']) || 0;

            let html_buffer = ""; // ตัวพักข้อมูล html

            // วนลูปสร้าง HTML (ใช้ชื่อตัวแปรเดิม text_add)
            for (let i = 0; i < data.length; i++) {
                const docId = Number.parseInt(data[i]['doc_id'], 10);
                if (!Number.isInteger(docId) || docId <= 0) continue;
                //
                // var text_add = `
                // <a onclick="view_doc_public(${data[i]['doc_id']});" >
                // <div class="max-w-2xl mx-auto my-8 bg-white rounded-xl shadow-lg overflow-hidden border-b-1 hover:shadow-xl transition">
                //     <div class=" bg-gray-200 text-gray-500 p-3 border-b-1 border-black-800 text-left">
                //         <table width="100%">
                //             <tr>
                //                 <td class="flex justify-between items-center">
                //                     <p class="text-xs font-medium truncate">
                //                     <span class="font-medium text-green-600"><b> เลขคำสั่ง ${data[i]['doc_number']} </b></span>   <span class="font-medium text-gray-600"> | วันที่: ${data[i]['doc_date']}</span>
                //
                //                     </p>
                //                 </td>
                //                 <td align="right">
                //
                //
                //                     </div>
                //                 </td>
                //             </tr>
                //         </table>
                //     </div>
                //
                //     <div class="p-3 space-y-2 text-gray-700 text-left ">
                //         <p class="text-s font-semibold ">${data[i]['doc_name']}</p>
                //     </div>
                //
                //     <div class="bg-gray-50 p-3 text-xs text-gray-500 text-right">
                //         <p>
                //             <span class="font-medium text-gray-600">ID: ${data[i]['doc_id']}</span>
                //         </p>
                //     </div>
                // </div>
                // </a>
                // `;
                var text_add = `
              <tr  onclick="view_doc_public(${docId});" class="hover:bg-gray-200 transition-colors ">

              <td class="border border-gray-300 p-2 text-[11px] leading-tight text-nowrap font-medium">
              ${escapeHtml(docId)}
              </td>
              <td class="border border-gray-300 p-2 leading-tight text-nowrap font-medium   ">
              ${escapeHtml(data[i]['doc_date'])}
              </td>
              <td class="border border-gray-300 p-2 font-medium text-[12px]">${escapeHtml(data[i]['doc_number'])} </td>
              <td class="border border-gray-300 p-2 text-left">${escapeHtml(data[i]['doc_name'])}</td>


              </tr>
                `;
                html_buffer += text_add; // เก็บใส่ buffer ก่อน
            }


            // แสดงผลทีเดียว (เร็วกว่า)

          //  loop_receive.innerHTML = html_buffer;

                      loop_receive.innerHTML = `                <div class="w-full overflow-x-auto border border-gray-300 rounded-sm shadow-sm">
                            <table class="w-full border-collapse bg-white text-sm text-center">
                              <thead class="bg-[#fcfcfc] text-gray-700">
                                <tr>

                                  <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap" style="width:50px !important;">ID</th>
                                  <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap " style="width:140px !important;" >วันที่</th>
                                  <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap text-nowrap" style="width:80px !important;" >เลขคำสั่ง</th>
                                  <th class="border border-gray-300 p-2 font-semibold min-w-[300px] text-left">ชื่อเรื่อง</th>
                                </tr>
                              </thead>
                                      <tbody class="text-gray-600">
                                      `
                              +html_buffer+
                              `  </tbody>
                                    </table>
                                  </div>`;
            pagination_create(Pagination, 'public', Page_number);

        } else {
            // กรณีไม่มีข้อมูล หรือไม่ได้ Login
            if (content_received) content_received.innerHTML = `<div id="loop_receive">ไม่พบข้อมูล<br></div>`;
            if (data.error) console.log("status api:" + data['error']);
            load_data.style.display = 'none';
          //  pagination_create(1, 'send', Page_number);

        }
    } catch (error) {
        if (requestSequence === publicRequestSequence) {
            console.error('⚠️ ข้อผิดพลาดเครือข่าย หรือ โค้ด:', error);
        }
    } finally {
        if (requestSequence === publicRequestSequence && load_data) load_data.style.display = "none";
    }
}
async function get_data_api_report(user_token) {
  var doc_type = localStorage.getItem("doc_type");
  // --- 1. ตรวจสอบค่าเริ่มต้น และ Element ในหน้าเว็บ ---
  if (!doc_type) doc_type = 'Internal';
  display_style('report_detail','none');
  display_style('create_report_btn','none');
  display_style('loading_report','flex');
    // 1. รับค่าจากหน้าจอ
    const Year = document.getElementById('yearSelect_report')?.value || ''; // ใส่ ? กัน error กรณีหา element ไม่เจอ
    const Page_start = document.getElementById('page_report_start')?.value || 0;
    const Page_end = document.getElementById('page_report_end')?.value || 0;
    var currentPage = localStorage.getItem("currentPage");
    console.log("currentPage : " + currentPage);
    if (currentPage == "public") {
      var url = 'api/get_data_public.php';
    }else {
      var url = 'api/get_data_send.php';
    }

    const payload = {
        title: 'ตัวอย่างโพสต์ใหม่',
        body: 'เนื้อหาจาก Fetch',
        Page_start: Page_start,
        Page_end: Page_end,
        Year: Year,
        doc_type: doc_type
    };

    try {
        // (Optional) สั่งแสดง Loading ตรงนี้ได้

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${user_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            credentials: 'include'
        });

        // 2. เช็คสถานะ HTTP ก่อน (สำคัญ!)
        if (!response.ok) {
            throw new Error(`HTTP Error! Status: ${response.status}`);
        }

        // 3. แปลงเป็น JSON
        const data_report = await response.json();

        // สมมติ data_report_arr เป็น Global variable
        data_report_arr = data_report;
        console.log("Data Received:", data_report_arr);

        // 4. เช็คข้อมูลใน Array
        if (Array.isArray(data_report) && data_report.length > 0 && data_report[0]['doc_id']) {
          display_style('loading_report','none');
          display_style('download_report_btn','flex');

            // --- ทำงานเมื่อมีข้อมูลถูกต้อง ---
            console.log("Found documents.");
            // renderTable(data_report); // ตัวอย่างฟังก์ชันแสดงผล
        } else {
            // --- กรณีไม่มีข้อมูล หรือ API ส่ง Error กลับมาแบบ JSON ---
            if (data_report.error) {
                console.warn("API Error Message:", data_report.error);
                alert("เกิดข้อผิดพลาดจากระบบ: " + data_report.error);
            } else {
                console.log("No data found.");
            }
        }

    } catch (e) {
        // 5. แสดง Error ถ้ามีปัญหา (Network หลุด หรือ Code พัง)
        console.error("Fetch Error:", e);
        alert("ไม่สามารถดึงข้อมูลได้ กรุณาลองใหม่");
    } finally {
        // (Optional) ปิด Loading ตรงนี้เสมอ ไม่ว่าจะสำเร็จหรือล้มเหลว
        // hideLoading();
    }
}
async function get_data_api_send_table(Page_number,search_txt, Year, user_token) {
    var doc_type = localStorage.getItem("doc_type");
    // --- 1. ตรวจสอบค่าเริ่มต้น และ Element ในหน้าเว็บ ---
    if (!doc_type) doc_type = 'Internal';
    Page_number = Math.max(1, parseInt(Page_number, 10) || 1);
    if (Year === undefined) Year = getCookie('yearSelect');
    const requestSequence = ++sendTableRequestSequence;
    console.log("Page : " + Page_number);
    localStorage.setItem("page_number", Page_number);
    // ใช้ getElementById เพื่อความชัวร์ (แทนการเรียก ID ตรงๆ)
    const load_data = document.getElementById('load_data');
    const loop_receive = document.getElementById('loop_receive');

    const content_received = document.getElementById('content_received');


    // **จุดสำคัญที่แก้ Error:** เช็คว่ามีกล่อง loop_receive อยู่ไหม ถ้าไม่มีให้หยุดทันที
    if (!loop_receive) {
        console.error("หา element 'loop_receive' ไม่เจอ");
        return;
    }

    // แสดงตัวโหลด และ เคลียร์ข้อมูลเก่า
    if (load_data) load_data.style.display = "block";
    loop_receive.innerHTML = '';

    // --- 2. ยิง API ด้วย Fetch (แทน XMLHttpRequest) ---
    const url = 'api/get_data_send.php';
    const payload = {
        title: 'ตัวอย่างโพสต์ใหม่',
        body: 'เนื้อหาจาก Fetch',
        Page_number: Page_number,
        Year: Year,
        search_txt: search_txt,
        doc_type: doc_type
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${user_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            credentials: 'include' // ส่ง Cookie ไปด้วย
        });

        if (!response.ok) throw new Error(`HTTP Status: ${response.status}`);

        const data = await response.json(); // ตัวแปร data ชื่อเดิม
        if (requestSequence !== sendTableRequestSequence) return;
        console.log('ข้อมูลที่ได้รับ:', data);
        // data_save_send = data;
        updateDataSaveSend(data);
        // ตัวแปร Pagination (ประกาศข้างนอกกัน Error)
        let Pagination = 0;

        // --- 3. ตรวจสอบว่ามีข้อมูลไหม ---
        if (Array.isArray(data) && data.length > 0 && data[0]['doc_id']) {

            // ดึงค่าจำนวนหน้าจากตัวแรก
            Pagination = parseInt(data[0]['Pagination']) || 0;

            let html_buffer = ""; // ตัวพักข้อมูล html
            // วนลูปสร้าง HTML (ใช้ชื่อตัวแปรเดิม text_add)
            for (let i = 0; i < data.length; i++) {
              const docId = Number.parseInt(data[i]['doc_id'], 10);
              if (!Number.isInteger(docId) || docId <= 0) continue;
              let doc_type_show = '';
              if(data[i]['doc_type'] == 'External'){
                document.getElementById('doc_type').value = 'คำสั่ง';
                doc_type_show = '<span class=" text-green-600"><b>| เลขคำสั่ง '+escapeHtml(data[i]['doc_number']) + '</b></span>';
                var doc_number_receive = '';

              }else{

                var doc_number_receive = `${data[i]['doc_number_receive']}`;
                document.getElementById('doc_type').value = 'หนังสือ';

              }
                // Logic เดิมของคุณ
                var doc_status = '';

                if (data[i]['status'] == 'NotRead') {
                    doc_status = '<div id="doc_status" class="text-right" style="display:block">';
                } else {
                    doc_status = '<div id="doc_status" class="text-right" style="display:none">';
                }
                if (data[i]['send_from'] !== undefined) {
                    var send_from = '| ส่งโดย' + data[i]['send_from'];
                } else {
                    var send_from = '';
                }
                var header_color = '';
                if (data[i]['status'] == 'Urgent') {
                    header_color = 'bg-red-100';
                } else {
                    header_color = 'bg-white-200';
                }
                let doc_type_send = localStorage.getItem("doc_type");

                if (doc_type_send == 'Stamp') {
                var doc_number_receive =   data[i]['doc_number_receive_stamp'];
                var date_stamp =  data[i]['doc_date_receive_stamp']
                var doc_number_stamp = data[i]['doc_number_receive']
              }else {
                var doc_number_stamp = data[i]['doc_number']
                var date_stamp = data[i]['doc_date_receive'];
                  var doc_number_receive =   data[i]['doc_number_receive'];
              }

                var text_add = `
          <tr  onclick="edit_doc(${docId});" class="hover:bg-gray-200 transition-colors ${header_color}">

            <td class="border border-gray-300 p-2 text-[11px] leading-tight text-nowrap font-medium">
              ${escapeHtml(docId)}
            </td>
            <td class="border border-gray-300 p-2 leading-tight text-nowrap font-medium   ">
              ${escapeHtml(data[i]['doc_date'])}
            </td>

            <td class="border border-gray-300 p-2 font-medium text-[12px]">${escapeHtml(doc_number_receive)} </td>
            <td class="border border-gray-300 p-2">${escapeHtml(doc_number_stamp)}</td>
            <td class="border border-gray-300 p-2 text-nowrap"> ${escapeHtml(date_stamp)}</td>
            <td class="border border-gray-300 p-2  "> ${escapeHtml(data[i]['doc_receive_from'])}</td>
            <td class="border border-gray-300 p-2 text-left">${escapeHtml(data[i]['doc_name'])}</td>
            <td class="border border-gray-300 p-2">
              <button class="text-gray-400"><a   onclick="edit_doc(${docId});" > 📄 </a></button>
            </td>
            <td class="border border-gray-300 p-2 italic">${escapeHtml(data[i]['doc_action'])}</td>
            <td class="border border-gray-300 p-2 "> <p class="text-green-600">${escapeHtml(data[i]['doc_other'])}</p></td>

            <td class="border border-gray-300 p-2">
              <div class="flex items-center justify-center flex-block"><a   onclick="edit_doc(${docId});" > <img  src="img/more.png" style="width:25px; height:auto;"> <p class="flex items-center justify-center" id="count_user_read_table_${docId}"></p> </a>

              </div>
            </td>

          </tr>
                `;

                html_buffer += text_add; // เก็บใส่ buffer ก่อน
            }


            // แสดงผลทีเดียว (เร็วกว่า)

            loop_receive.innerHTML = `                <div class="w-full overflow-x-auto border border-gray-300 rounded-sm shadow-sm">
                  <table class="w-full border-collapse bg-white text-sm text-center">
                    <thead class="bg-[#fcfcfc] text-gray-700">
                      <tr>

                        <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap" style="width:50px !important;">ID</th>
                        <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap " style="width:140px !important;" >วันที่</th>
                        <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap text-nowrap" style="width:80px !important;" >เลขทะเบียนรับ</th>
                        <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap" style="width:140px !important;" >ที่</th>
                        <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap text-nowrap" style="width:140px !important;" >ลงวันที่</th>
                        <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap" style="width:120px !important;" >จาก</th>
                        <th class="border border-gray-300 p-2 font-semibold min-w-[300px] text-left">ชื่อเรื่อง</th>
                        <th class="border border-gray-300 p-2 font-semibold w-12">แก้ไข</th>
                        <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap w-20">การปฏิบัติ</th>
                        <th class="border border-gray-300 p-2 font-semibold whitespace-nowrap w-20">หมายเหตุ</th>

                        <th class="border border-gray-300 p-2 font-semibold w-16 text-nowrap">ผู้รับ</th>
                      </tr>
                    </thead>
                            <tbody class="text-gray-600">
                            `
                    +html_buffer+
                    `  </tbody>
                          </table>
                        </div>`;
            pagination_create(Pagination, 'send_table', Page_number);
            let user_status_text = '';
             for (let i = 0; i < data.length; i++) {
            data_status =   data[i];
            if (data_status.user_send_to && data_status.user_send_to.length > 0) {
                   let doc_id = Number.parseInt(data_status.doc_id, 10);
                   if (!Number.isInteger(doc_id) || doc_id <= 0) continue;

                // ลูปชั้นแรก: เข้าถึง Array ของกลุ่มผู้ใช้
                for (let i = 0; i < data_status.user_send_to.length; i++) {
                    let group = data_status.user_send_to[i];
                    // ลูปชั้นที่สอง: เข้าถึง Object ของผู้ใช้แต่ละคนในกลุ่มนั้น
                    let read_number = 0;
                    for (let j = 0; j < group.length; j++) {

                        let userObj = group[j];
                        // เนื่องจาก Key เป็นตัวเลข (User_Id) เราจะใช้ Object.entries เพื่อดึง ID และ Name
                        let [user,detail] = Object.entries(userObj)[0];
                        if (detail.date && detail.date != '') {
                          read_number++;
                        }
                        //console.log('User : '+detail);
                        //console.log("User ID:", detail.user_id, "| Name:", detail.user_name , "| Status:", detail.user_status);
                        add_user_send(detail.user_id, detail.user_name);
                        user_status_text = user_status_text + `
                        <tr class="h-9">
                                <td align="center" class="border border-gray-300 "><p class="pt-2"></p>${j+1}</td>
                                <td class="border border-gray-300 pt-2"><p class="pl-2">${escapeHtml(detail.user_name)}</p></td>
                                <td align="center"  class="border border-gray-300 pt-2"><p class="pl-2">${escapeHtml(detail.date)}</p></td>
                              </tr>`;
                        if (read_number == j+1) {
                          document.getElementById('count_user_read_table_'+doc_id).innerHTML = `<img src="img/readed.png" width="15px" alt="">`;

                        }else {
                          document.getElementById('count_user_read_table_'+doc_id).innerHTML = `(${read_number}/${j+1})`;

                        }

                    }

                }
            }
            }



        } else {
            // กรณีไม่มีข้อมูล หรือไม่ได้ Login
            if (content_received) content_received.innerHTML = `<div id="loop_receive">ไม่พบข้อมูล<br></div>`;
            if (data.error) console.log("status api:" + data['error']);
            load_data.style.display = 'none';
            pagination_create(1, 'send', Page_number);

        }





    } catch (error) {
        if (requestSequence === sendTableRequestSequence) {
            console.error('⚠️ ข้อผิดพลาดเครือข่าย หรือ โค้ด:', error);
        }
    } finally {
        if (requestSequence === sendTableRequestSequence && load_data) load_data.style.display = "none";
    }
}
async function get_data_api_send(Page_number,search_txt, Year, user_token) {
    var doc_type = localStorage.getItem("doc_type");
    // --- 1. ตรวจสอบค่าเริ่มต้น และ Element ในหน้าเว็บ ---
    if (!doc_type) doc_type = 'Internal';
    Page_number = Math.max(1, parseInt(Page_number, 10) || 1);
    if (Year === undefined) Year = getCookie('yearSelect');
    const requestSequence = ++sendRequestSequence;
    console.log("Page : " + Page_number);
    localStorage.setItem("page_number", Page_number);
    // ใช้ getElementById เพื่อความชัวร์ (แทนการเรียก ID ตรงๆ)
    const load_data = document.getElementById('load_data');
    const loop_receive = document.getElementById('loop_receive');

    const content_received = document.getElementById('content_received');


    // **จุดสำคัญที่แก้ Error:** เช็คว่ามีกล่อง loop_receive อยู่ไหม ถ้าไม่มีให้หยุดทันที
    if (!loop_receive) {
        console.error("หา element 'loop_receive' ไม่เจอ");
        return;
    }

    // แสดงตัวโหลด และ เคลียร์ข้อมูลเก่า
    if (load_data) load_data.style.display = "block";
    loop_receive.innerHTML = '';

    // --- 2. ยิง API ด้วย Fetch (แทน XMLHttpRequest) ---
    const url = 'api/get_data_send.php';
    const payload = {
        title: 'ตัวอย่างโพสต์ใหม่',
        body: 'เนื้อหาจาก Fetch',
        Page_number: Page_number,
        Year: Year,
        search_txt: search_txt,
        doc_type: doc_type
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${user_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            credentials: 'include' // ส่ง Cookie ไปด้วย
        });

        if (!response.ok) throw new Error(`HTTP Status: ${response.status}`);

        const data = await response.json(); // ตัวแปร data ชื่อเดิม
        if (requestSequence !== sendRequestSequence) return;
        console.log('ข้อมูลที่ได้รับ:', data);
        //data_save_send = data;
        updateDataSaveSend(data);
        // ตัวแปร Pagination (ประกาศข้างนอกกัน Error)
        let Pagination = 0;

        // --- 3. ตรวจสอบว่ามีข้อมูลไหม ---
        if (Array.isArray(data) && data.length > 0 && data[0]['doc_id']) {

            // ดึงค่าจำนวนหน้าจากตัวแรก
            Pagination = parseInt(data[0]['Pagination']) || 0;

            let html_buffer = ""; // ตัวพักข้อมูล html
            // วนลูปสร้าง HTML (ใช้ชื่อตัวแปรเดิม text_add)
            for (let i = 0; i < data.length; i++) {
              const docId = Number.parseInt(data[i]['doc_id'], 10);
              if (!Number.isInteger(docId) || docId <= 0) continue;
              let doc_type_show = '';
              if(data[i]['doc_type'] == 'External'){
                document.getElementById('doc_type').value = 'คำสั่ง';
                doc_type_show = '<span class=" text-green-600"><b>| เลขคำสั่ง '+escapeHtml(data[i]['doc_number']) + '</b></span>';
                var doc_number_receive = '';

              }else{

                var doc_number_receive = ` ที่ ${data[i]['doc_number_receive']} | `;
                document.getElementById('doc_type').value = 'หนังสือ';

              }
                // Logic เดิมของคุณ
                var doc_status = '';

                if (data[i]['status'] == 'NotRead') {
                    doc_status = '<div id="doc_status" class="text-right" style="display:block">';
                } else {
                    doc_status = '<div id="doc_status" class="text-right" style="display:none">';
                }
                if (data[i]['send_from'] !== undefined) {
                    var send_from = '| ส่งโดย' + data[i]['send_from'];
                } else {
                    var send_from = '';
                }
                var header_color = '';
                if (data[i]['status'] == 'Urgent') {
                    header_color = 'bg-red-200';
                } else {
                    header_color = 'bg-gray-200';
                }
                var text_add = `
                <a   onclick="edit_doc(${docId});" >
                <div class="max-w-2xl mx-auto my-8 bg-white rounded-xl shadow-lg overflow-hidden border-b-1 hover:shadow-xl transition">
                    <div class="${header_color}  text-gray-500 p-3 pl-4 border-b-1 border-black-800 text-left">
                        <table width="100%">
                            <tr>
                                <td class="flex justify-between items-center">

                                    <p class="text-xs font-medium truncate">
                                      <span class=" text-green-600"><b> ${escapeHtml(doc_number_receive)} </b> </span>
                                      <span class="max-[450px]:block font-medium text-gray-600">  ${escapeHtml(send_from)} ${escapeHtml(data[i]["doc_receive_from"])}  ${doc_type_show}</span>


                                    </p>
                                    <p class=" text-xs font-medium text-right flex ">
                                    <span class=" text-green-600">
                                    <b>${escapeHtml(data[i]['doc_other'])}</b>
                                     </span>
                                    <span class=" text-gray-600"> | </span>

                                    <span id="count_user_read_${docId}"  class=" text-gray-600">-</span></p>
                                </td>
                                <td align="right">
                                    ${doc_status}
                                    <span class="flex items-center w-full">
                                        <span class="w-4 h-4 bg-red-500 rounded-full ml-auto"></span>
                                    </span>
                                    </div>
                                </td>
                            </tr>
                        </table>
                    </div>

                    <div class="p-2 pl-4 space-y-2 text-gray-700 text-left ">
                         <p class="text-s font-semibold ">${escapeHtml(data[i]['doc_name'])}</p>
                    </div>

                    <div class="bg-gray-50 p-2 pl-4 text-xs text-gray-500 text-right flex justify-between">
                    <p>
                        <span id="date_update_show" class="font-medium text-gray-600">วันที่: ${escapeHtml(data[i]['doc_date_receive'])} </span>
                    </p>
                        <p>
                            <span class="font-medium text-gray-600">แก้ไขล่าสุด: ${escapeHtml(data[i]['doc_date'])} | </span>
                            <span class="font-medium text-gray-600">ID: ${escapeHtml(docId)}</span>
                        </p>
                    </div>
                </div>
                </a>
                `;

                html_buffer += text_add; // เก็บใส่ buffer ก่อน
            }


            // แสดงผลทีเดียว (เร็วกว่า)

            loop_receive.innerHTML = html_buffer;
            pagination_create(Pagination, 'send', Page_number);
            let user_status_text = '';
             for (let i = 0; i < data.length; i++) {
            data_status =   data[i];
            if (data_status.user_send_to && data_status.user_send_to.length > 0) {
                   let doc_id = Number.parseInt(data_status.doc_id, 10);
                   if (!Number.isInteger(doc_id) || doc_id <= 0) continue;

                // ลูปชั้นแรก: เข้าถึง Array ของกลุ่มผู้ใช้
                for (let i = 0; i < data_status.user_send_to.length; i++) {
                    let group = data_status.user_send_to[i];
                    // ลูปชั้นที่สอง: เข้าถึง Object ของผู้ใช้แต่ละคนในกลุ่มนั้น
                    let read_number = 0;
                    for (let j = 0; j < group.length; j++) {

                        let userObj = group[j];
                        // เนื่องจาก Key เป็นตัวเลข (User_Id) เราจะใช้ Object.entries เพื่อดึง ID และ Name
                        let [user,detail] = Object.entries(userObj)[0];
                        if (detail.date && detail.date != '') {
                          read_number++;
                        }
                        //console.log('User : '+detail);
                        //console.log("User ID:", detail.user_id, "| Name:", detail.user_name , "| Status:", detail.user_status);

                        add_user_send(detail.user_id, detail.user_name,doc_type);
                        user_status_text = user_status_text + `
                        <tr class="h-9">
                                <td align="center" class="border border-gray-300 "><p class="pt-2"></p>${j+1}</td>
                                <td class="border border-gray-300 pt-2"><p class="pl-2">${escapeHtml(detail.user_name)}</p></td>
                                <td align="center"  class="border border-gray-300 pt-2"><p class="pl-2">${escapeHtml(detail.date)}</p></td>
                              </tr>`;
                        if (read_number == j+1) {
                          document.getElementById('count_user_read_'+doc_id).innerHTML = `<img src="img/readed.png" width="15px" alt="">`;

                        }else {
                          document.getElementById('count_user_read_'+doc_id).innerHTML = `(${read_number}/${j+1})`;

                        }

                    }

                }
            }
            }



        } else {
            // กรณีไม่มีข้อมูล หรือไม่ได้ Login
            if (content_received) content_received.innerHTML = `<div id="loop_receive">ไม่พบข้อมูล<br></div>`;
            if (data.error) console.log("status api:" + data['error']);
            load_data.style.display = 'none';
            pagination_create(1, 'send', Page_number);

        }





    } catch (error) {
        if (requestSequence === sendRequestSequence) {
            console.error('⚠️ ข้อผิดพลาดเครือข่าย หรือ โค้ด:', error);
        }
    } finally {
        if (requestSequence === sendRequestSequence && load_data) load_data.style.display = "none";
    }
}

function pagination_create(Pagination, type, Page_number) {
    // --- 4. สร้าง Pagination (ใช้ Logic เดิมของคุณ) ---
    // --- 4. สร้าง Pagination ---
    Page_number = Math.max(1, parseInt(Page_number, 10) || 1);
    window.Page_number = Page_number;
    // อัปเดตตัวเลขหน้า (เช็คก่อนว่ามี element ไหม กัน Error)
    if (document.getElementById('All_Doc')) document.getElementById('All_Doc').innerHTML = Pagination * 5;
    if (document.getElementById('All_Doc_1')) document.getElementById('All_Doc_1').innerHTML = (Page_number * 5) - 4;
    if (document.getElementById('All_Doc_2')) document.getElementById('All_Doc_2').innerHTML = Page_number * 5;
    if (pagination_element) {
        pagination_element.innerHTML = '';
        let Pagination_html = ''; // ใช้ let และรวม string ก่อนแสดงผลจะเร็วกว่า
        const Pagination_PREV = document.getElementById('Pagination_PREV');
        const Pagination_NEXT = document.getElementById('Pagination_NEXT');
        for (let i = 1; i <= Pagination; i++) {
          // console.log('Pagi'+i);
          // console.log('Page_number'+Page_number);
            if (Page_number - 1 <= i && Page_number + 2 >= i) {

                // ใช้ data-page แทน onclick
                const activeClass = (i == Page_number)
                    ? "bg-sky-100 text-sky-700 border-t-2 border-sky-400 z-10"
                    : "text-gray-700 hover:bg-sky-50 hover:text-sky-700";

                Pagination_html += `<a href="#" data-page="${i}" data-send="${type}" class="relative inline-flex items-center px-4 py-2 text-sm font-semibold ring-1 ring-inset ring-gray-300 transition ${activeClass}">${i}</a>`;
            }
        }

        if (Pagination - Page_number > 2) {
          console.log('Pagi   .... ');
            Pagination_html += `
                    <span class="relative inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300">...</span>
                    <a href="#" data-page="${Pagination}" data-send="${type}" class="relative inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-sky-50 hover:text-sky-700 transition">${Pagination}</a>`;
        }

        pagination_element.innerHTML = Pagination_html;
        Pagination_PREV.dataset.page = Page_number - 1;
        Pagination_NEXT.dataset.page = Page_number + 1;
        Pagination_PREV.dataset.send = type;
        Pagination_NEXT.dataset.send = type;

        // ใส่โค้ดนี้ไว้ท้ายฟังก์ชันที่ใช้ render pagination
        const prevElement = document.getElementById('Pagination_PREV');
        const nextElement = document.getElementById('Pagination_NEXT');

        // จัดการปุ่ม PREV
        if (Page_number <= 1) {
            prevElement.classList.add('opacity-30', 'pointer-events-none');
        } else {
            prevElement.classList.remove('opacity-30', 'pointer-events-none');
        }

        // จัดการปุ่ม NEXT
        if (Page_number >= Pagination) {
            nextElement.classList.add('opacity-30', 'pointer-events-none');
        } else {
            nextElement.classList.remove('opacity-30', 'pointer-events-none');
        }

    }

}

async function update_read_status(doc_id, user_token, type) {
    if (type === 'send') {
        console.log("ไม่ต้องมีสถานะการอ่าน");
        return;

    }

    const url = 'api/update_read_status.php'; // ตรวจสอบ path ให้ถูกนะครับ

    // ✅ แก้ไข: เพิ่ม doc_id เข้าไปใน payload
    const payload = {
        user_token: user_token,
        doc_id: doc_id
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${user_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        // ถ้า HTTP Status ไม่ใช่ 200-299 ให้โยน Error
        if (!response.ok) {
            // พยายามอ่าน Error message จาก JSON ที่ PHP ส่งมา (ถ้ามี)
            const errorData = await response.json().catch(() => null);
            throw new Error(errorData ? errorData.message : `HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        console.log('ข้อมูลที่ได้รับ:', data);

        if (data.status === 'success') {
            const openedDoc = data_save.find((item) => String(item.doc_id) === String(doc_id));
            if (openedDoc) openedDoc.status = 'Readed';

            let doc_id_text = 'doc_status_' + doc_id;
            let tb_status_read = 'tb_status_read_' + doc_id;
            if (document.getElementById(doc_id_text)) {
                console.log("✅ บันทึกสถานะการอ่านสำเร็จ!");

                console.log('doc_id_text : ' + doc_id_text);
                document.getElementById(doc_id_text).style.display = 'none';

            }else if (document.getElementById(tb_status_read)) {
              document.getElementById(tb_status_read).classList.remove("bg-gray-200");
              console.log("✅ บันทึกสถานะการอ่านสำเร็จ!" + tb_status_read );
            }

            if (type === 'received' && localStorage.getItem('read_status_change') === 'NotRead') {
                const currentPage = parseInt(localStorage.getItem('page_number'), 10) || 1;
                const searchText = document.getElementById('search_txt')?.value || '';
                get_data_api_received(currentPage, searchText);
            }


        } else {
            console.warn("⚠️ API แจ้งเตือน:", data.message);
        }

    } catch (error) {
        console.error('❌ เกิดข้อผิดพลาด:', error.message);
    }
}

let userCache = null;
async function get_userName_request(nameSearch) {
    const url = 'api/get_userName.php';
    const container = document.getElementById('findName');

    try {
        let dataToDisplay = [];

        // 2. ตรวจสอบว่ามีข้อมูลใน Cache หรือยัง
        if (userCache !== null) {
            console.log("🔍 ค้นหาจาก Cache...");
            // ค้นหาชื่อที่ตรงกับ nameSearch ในตัวแปร userCache
            dataToDisplay = userCache.filter(user =>
                user.message.toLowerCase().includes(nameSearch.toLowerCase())
            );
        } else {
            console.log("🌐 เรียก API ครั้งแรก (Fetch All)...");
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer`,
                    'Content-Type': 'application/json'
                },
                // ส่งคำค้นหาว่างไป หรือจัดการฝั่ง PHP ให้ส่งข้อมูลทั้งหมดมาในครั้งแรก
                body: JSON.stringify({ name_serch: "" })
            });

            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

            const data = await response.json();

            // 3. บันทึกข้อมูลทั้งหมดลง Cache
            userCache = data;

            // กรองข้อมูลเฉพาะที่ผู้ใช้พิมพ์มาแสดงผล
            dataToDisplay = userCache.filter(user =>
                user.message.toLowerCase().includes(nameSearch.toLowerCase())
            );
        }

        // 4. แสดงผลลัพธ์
        if (dataToDisplay.length > 0) {
            let text_add = '';
            dataToDisplay.forEach(raw => {
                const item = {...raw, message: escapeHtml(raw.message)};
                text_add += `
                    <div class="flex justify-between border-b p-4 border-gray-400">
                        <p>${item.message}</p>
                        <img onclick="add_user_send('${item.User_Id}','${item.message}')"
                             style="width:25px;height:auto;cursor:pointer;"
                             src="img/add_user.png">
                    </div>`;
            });
            container.innerHTML = text_add;
            container.querySelectorAll('img').forEach((image, index) => {
                image.removeAttribute('onclick');
                image.addEventListener('click', () => add_user_send(dataToDisplay[index].User_Id, dataToDisplay[index].message));
            });
        } else {
            container.innerHTML = '<p class="p-4 text-gray-500">ไม่พบข้อมูล</p>';
            console.warn("⚠️ ไม่พบรายชื่อที่ตรงกัน");
        }

    } catch (error) {
        console.error('❌ เกิดข้อผิดพลาด:', error.message);
        container.innerHTML = '<p class="p-4 text-red-500">เกิดข้อผิดพลาดในการดึงข้อมูล</p>';
    }
}


let groupCache = null;


async function get_groupName_request(nameSearch) {
    const url = 'api/get_groupName.php';
    const container = document.getElementById('findGroup');

    try {
        // 1. ดึงข้อมูลครั้งแรกและเก็บเข้า Cache
        if (groupCache === null) {
            console.log("🌐 Fetching all departments...");
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name_serch: "" })
            });

            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

            // ข้อมูลที่ได้จะเป็น Array ของ { Department_Id, Department_Name }
            groupCache = await response.json();
        }

        // 2. กรองข้อมูลจาก Cache
        const searchTerm = nameSearch.toLowerCase().trim();
        const dataToDisplay = groupCache.filter(item => {
            // ป้องกัน Error ด้วยการเช็คว่ามีค่า Department_Name หรือไม่
            const name = item.Department_Name || "";
            return name.toLowerCase().includes(searchTerm);
        });

        // 3. แสดงผลลัพธ์
        if (dataToDisplay.length > 0) {
            let text_add = '';
            dataToDisplay.forEach(raw => {
                const item = {...raw, Department_Name: escapeHtml(raw.Department_Name)};
                text_add += `
                    <div class="flex justify-between items-center border-b p-4 border-gray-400 hover:bg-gray-50">
                        <p class="font-medium text-gray-800">${item.Department_Name}</p>
                        <img onclick="add_group_send('${item.Department_Id}','${item.Department_Name}')"
                             style="width:25px;height:auto;cursor:pointer;"
                             src="img/add_user.png"
                             alt="Add">
                    </div>`;
            });
            container.innerHTML = text_add;
            container.querySelectorAll('img').forEach((image, index) => {
                image.removeAttribute('onclick');
                image.addEventListener('click', () => add_group_send(dataToDisplay[index].Department_Id, dataToDisplay[index].Department_Name));
            });
        } else {
            container.innerHTML = '<p class="p-4 text-gray-500">ไม่พบข้อมูล</p>';
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        container.innerHTML = '<p class="p-4 text-red-500">เกิดข้อผิดพลาดในการโหลดข้อมูล</p>';
    }
}

// แยกส่วน UI ออกมาเพื่อให้ Code อ่านง่ายขึ้น
function renderResults(data, container) {
    if (data.length === 0) {
        container.innerHTML = '<p class="p-4 text-gray-500">ไม่พบข้อมูล</p>';
        return;
    }

    const html = data.map(item => `
        <div class="flex justify-between items-center border-b p-4 border-gray-400 hover:bg-gray-50">
            <p class="font-medium text-gray-800">${item.message}</p>
            <button onclick="add_user_send('${item.Department_Id}','${item.Department_Name}')"
                    class="focus:outline-none transition-transform active:scale-90">
                <img style="width:25px;height:auto;" src="img/add_user.png" alt="add">
            </button>
        </div>
    `).join('');

    container.innerHTML = html;
}
