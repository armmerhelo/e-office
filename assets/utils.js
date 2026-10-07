const setCookie = (name, value, days) => {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`;
};

function deleteAllCookies() {
  const cookies = document.cookie.split(";");

  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i];
    const name = cookie.split("=")[0].trim();
    document.cookie = name + "=; Max-Age=-99999999; path=/;";
  }
}

function getCookie(name) {
  if (name === 'User_Token') return window.eofficeUser ? 'session' : null;
  // 1. สร้างรูปแบบที่ต้องการค้นหา เช่น "user_id="
  let nameEQ = name + "=";
  // 2. แยก cookie ทั้งหมดออกเป็น Array
  let ca = document.cookie.split(";");

  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    // ตัดช่องว่างด้านหน้าออก (ถ้ามี)
    while (c.charAt(0) == " ") c = c.substring(1, c.length);
    // ถ้าเจอชื่อที่ตรงกัน ให้ส่งค่ากลับไป
    if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
  }
  // ถ้าไม่เจอเลย ให้ส่งค่าว่าง (null) กลับไป
  return null;
}

// สร้างตัวแปรไว้นอกฟังก์ชันเพื่อเก็บลำดับของแถว
let fileIndex = 0;
function addNewInputFile(name, file_id,doc_id,path,year) {
  let doc_type_send = localStorage.getItem("doc_type");
  fileIndex++; // เพิ่มลำดับทุกครั้งที่กดปุ่มบวก
  const safeName = escapeHtml(name);
  const safeFileId = escapeHtml(file_id);
  const safeDocId = escapeHtml(doc_id);
  const safeFilePath = encodeURIComponent(String(path ?? ''));
  const safeYear = encodeURIComponent(String(year ?? ''));
  var loop_file = "";
  if (name || file_id) {
    loop_file = `
        <input type="hidden" name="file_id[]" value="${safeFileId}">`;
  }else{
    loop_file = `
        <input type="hidden" name="file_id[]" value="">`;
    name = ``;
  }
  if (doc_id && doc_id != '') {
    var view_file = `<label
           class="cursor-pointer flex items-center justify-center w-13 h-10 border-2 border-dashed border-indigo-300 rounded-lg bg-indigo-20 hover:bg-indigo-100 flex-shrink-0 transition">
            <a href="e-sign/e-sign.php?Doc_Id=${safeDocId}&File_Path=${safeFilePath}&Year=${safeYear}">
                <img src="img/e-sign.png" class="w-13 h-10 opacity-50">
            </a>
    </label>`;
  }else {
    var view_file = '';
  }


  // ใช้ ID ที่ไม่ซ้ำกัน เช่น file-upload-1, file-upload-2


    if (doc_type_send == 'Stamp') {

      var text_add = `
        <div id="file_row_${fileIndex}" class="flex flex-col gap-1 p-1">
            <div class="flex items-center gap-2">
                ${loop_file}
                <input type="text" name="doc_file_name[]" value="${safeName}"
                       class="flex-1 rounded-lg border-gray-300 bg-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border text-sm"
                       placeholder="ชื่อเอกสาร" readonly>


                  ${view_file}

            </div>

            <p id="display-${fileIndex}" class="text-[10px] text-gray-500 italic pl-1"></p>
        </div>
        `;
    }else {

      var text_add = `
        <div id="file_row_${fileIndex}" class="flex flex-col gap-1 p-1">
            <div class="flex items-center gap-2">
                ${loop_file}
                <input type="text" name="doc_file_name[]" value="${safeName}"
                       class="flex-1 rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border text-sm"
                       placeholder="ชื่อเอกสาร" required>

                <label for="file-upload-${fileIndex}"
                       class="cursor-pointer flex items-center justify-center w-10 h-10 border-2 border-dashed border-indigo-300 rounded-lg bg-indigo-50 hover:bg-indigo-100 flex-shrink-0 transition">
                    <img src="https://cdn-icons-png.flaticon.com/512/126/126477.png" class="w-5 h-5 opacity-70">
                    <input id="file-upload-${fileIndex}" type="file" name="doc_upload[]"
                           class="hidden" onchange="updateFileName(this, ${fileIndex})">
                </label>

                  ${view_file}
                <button type="button" onclick="this.closest('#file_row_${fileIndex}').remove()"
                        class="flex items-center justify-center w-10 h-10 border-2 border-red-200 rounded-lg bg-red-50 hover:bg-red-100 flex-shrink-0 transition">
                    <img src="img/remove.png" class="w-5 h-5">
                </button>
            </div>

            <p id="display-${fileIndex}" class="text-[10px] text-gray-500 italic pl-1"></p>
        </div>
        `;
    }

  var file_send = document.getElementById("file_send");
  file_send.insertAdjacentHTML("beforeend", text_add);
}

let LinkIndex = 0;
function addNewLink(name, url) {
  if (!name || !url) {
    name = "";
    url = "";
  }
  console.log("addNewLink");
  LinkIndex++; // เพิ่มลำดับทุกครั้งที่กดปุ่มบวก
  const safeLinkName = escapeHtml(name);
  const safeLinkValue = escapeHtml(url);
  const safeLinkHref = escapeHtml(safeHttpUrl(url));
  // ใช้ ID ที่ไม่ซ้ำกัน เช่น file-upload-1, file-upload-2
  let doc_type_send = localStorage.getItem("doc_type");

  if (doc_type_send == 'Stamp') {

    var text_add = `
      <div id="link_row_${LinkIndex}" class="flex flex-col gap-1 p-1">
          <div class="flex items-center gap-2">
          <input value="${safeLinkName}" type="text"  id="doc_link_name_${LinkIndex}" name="doc_url_name[]" class="bg-gray-200 mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" placeholder="ชื่อลิงก์" readonly>
          <input value="${safeLinkValue}" type="url" id="doc_link_url_${LinkIndex}" name="doc_url[]" class="bg-gray-200 mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" placeholder="เช่น https://drive.google.com/..." readonly>
          <a href="${safeLinkHref}"  target="_blank"
                  class="flex items-center justify-center w-10 h-10 border-2 border-green-200 rounded-lg  hover:bg-green-100 flex-shrink-0 transition">
              <img src="img/web_open.png" class="w-5 h-5">
          </a>
          </div>
      </div>
      `;
  }else {

    var text_add = `
      <div id="link_row_${LinkIndex}" class="flex flex-col gap-1 p-1">
          <div class="flex items-center gap-2">
          <input value="${safeLinkName}" type="text"  id="doc_link_name_${LinkIndex}" name="doc_url_name[]" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" placeholder="ชื่อลิงก์" required>
          <input value="${safeLinkValue}" type="url" id="doc_link_url_${LinkIndex}" name="doc_url[]" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" placeholder="เช่น https://drive.google.com/..." required>
          <a href="${safeLinkHref}"  target="_blank"
                  class="flex items-center justify-center w-10 h-10 border-2 border-green-200 rounded-lg  hover:bg-green-100 flex-shrink-0 transition">
              <img src="img/web_open.png" class="w-5 h-5">
          </a>
              <button type="button" onclick="this.closest('#link_row_${LinkIndex}').remove()"
                      class="flex items-center justify-center w-10 h-10 border-2 border-red-200 rounded-lg bg-red-50 hover:bg-red-100 flex-shrink-0 transition">
                  <img src="img/remove.png" class="w-5 h-5">
              </button>
          </div>
      </div>
      `;
  }


  var doc_file_link_main = document.getElementById("doc_file_link_main");
  doc_file_link_main.insertAdjacentHTML("beforeend", text_add);
}



function updateFileName(input, index) {
  const display = document.getElementById(`display-${index}`);
  if (input.files && input.files.length > 0) {
    display.innerText =
      input.files.length > 1
        ? `📎 เลือกแล้ว ${input.files.length} ไฟล์`
        : `📎 ${input.files[0].name}`;
  } else {
    display.innerText = "";
  }
}

doc_type.addEventListener("change", add_doc_detail_change);
function add_doc_detail_change() {
  // 'this' ในที่นี้คือตัว doc_type ที่ถูกเปลี่ยนค่า
  var selectedValue = this.value;

  console.log("ค่าที่เลือกคือ: " + selectedValue);
  if (selectedValue == "คำสั่ง") {
    document.getElementById('doc_number_receive').value = '';
    document.getElementById('doc_receive_from').value = '';
    document.getElementById('doc_receive_from').value = '';
    document.getElementById('doc_number_receive').removeAttribute('required');
    document.getElementById('doc_receive_from').removeAttribute('required');
    document.getElementById("DocDetail_1").style.display = "none";
    document.getElementById("DocDetail_2").style.display = "none";
    document.getElementById("DocDetail_3").style.display = "none";
    document.getElementById("send_to").style.display = "none";
  } else {
    document.getElementById('doc_number_receive').setAttribute('required', '');
    document.getElementById('doc_receive_from').setAttribute('required', '');
    document.getElementById("DocDetail_1").style.display = "block";
    document.getElementById("DocDetail_2").style.display = "block";
    document.getElementById("DocDetail_3").style.display = "block";
    document.getElementById("send_to").style.display = "block";
  }

  // คุณสามารถเขียนเงื่อนไขต่อจากตรงนี้ได้เลย
}
function add_group_send(group_id, group_name,doc_type) {
  if (!document.getElementById('group_send_'+group_id)) {
    console.log(group_id + " || " + group_name);
    group_send = document.getElementById("group_send");
    const safeGroupId = escapeHtml(group_id);
    const safeGroupName = escapeHtml(group_name);

if (doc_type == 'Stamp') {
  var text_add = `

  <div id="group_send_${group_id}" class="flex justify-between border-b  p-4 border-gray-400">
    <input type="hidden" name="send_to_group[]" value="${safeGroupId}">
    <p >${safeGroupName}</p>
  </div>`;
}else {
  var text_add = `

  <div id="group_send_${safeGroupId}" class="flex justify-between border-b  p-4 border-gray-400">
    <input type="hidden" name="send_to_group[]" value="${safeGroupId}">
    <p >${safeGroupName}</p>
    <img onclick="document.querySelector('#group_send_${safeGroupId}').remove(); " style="width:25px;height:auto;" src="img/remove.png">
  </div>`;
}



    //user_send.innerHTML = user_send.innerHTML + text_add;
    group_send.insertAdjacentHTML("afterbegin", text_add);
  } else {
    console.log("มี user_send อยู่ในรายการแล้ว");
  }
}
function add_user_send(user_id, user_name,doc_type) {


  if (!document.getElementById('user_send_'+user_id)) {
    console.log(user_id + " || " + user_name);
    user_send = document.getElementById("user_send");
    console.log('doc_type add_user_send '+doc_type);
    const safeUserId = escapeHtml(user_id);
    const safeUserName = escapeHtml(user_name);
    if (doc_type == 'Stamp') {
      var text_add = `
      <div id="user_send_${user_id}" class="flex justify-between border-b  p-4 border-gray-400">
        <input type="hidden" name="send_to[]" value="${safeUserId}">
        <p >${safeUserName}</p>
      </div>`;
    }else {
      var text_add = `
      <div id="user_send_${safeUserId}" class="flex justify-between border-b  p-4 border-gray-400">
        <input type="hidden" name="send_to[]" value="${safeUserId}">
        <p >${safeUserName}</p>
        <img onclick="document.querySelector('#user_send_${safeUserId}').remove(); " style="width:25px;height:auto;" src="img/remove.png">
      </div>`;
    }


    //user_send.innerHTML = user_send.innerHTML + text_add;
    user_send.insertAdjacentHTML("afterbegin", text_add);
  } else {
    console.log("มี user_send อยู่ในรายการแล้ว");
  }
}

function loop_show_file(doc_id) {
    const data_edit = data_save_send.find(
    (item) => String(item.doc_id) === String(doc_id),
  );
  var file_list = data_edit.doc_upload_path;
//   file_list.forEach((itemObj, index) => {
//     Object.entries(itemObj).forEach(([file_id,path, detail]) => {
//       console.log(`file_id: ${file_id}`);
//       console.log(`detail: ${detail}`);
//       //
//     });
//   });


    // 2. เช็คว่า doc_upload_path มีข้อมูลไหม (เพื่อความปลอดภัยและไม่ error)
    document.getElementById("file_send").innerHTML = '';
    if (file_list && file_list.length > 0) {
        // 3. วนลูป items ข้างใน doc_upload_path
            file_list.forEach((file) => {
            console.log(`file_id: ${file.file_id}`);
            console.log(`detail: ${file.detail}`);
            console.log('-------------'); // ขีดคั่นเพื่อให้ดูง่าย
            addNewInputFile(file.detail, file.file_id,doc_id,file.path,data_edit.doc_year);
        });

    }


}

function isJson(str) {
  if (typeof str !== 'string') return false;
  try {
    const parsed = JSON.parse(str);
    return parsed !== null && typeof parsed === 'object'; // แปลงสำเร็จ, เป็น JSON object/array
    } catch (e) {
        return false; // แปลงไม่สำเร็จ, ไม่ใช่ JSON
    }
}

function delete_doc(id) {
    const isConfirmed = confirm("คุณยืนยันหรือไม่ที่จะลบเอกสารนี้? ");
    var user_token = getCookie("User_Token");
    if (isConfirmed) {
        fetch('api/api_soft_delete_doc.php', {
            method: 'POST',
            // แก้ไขจุดนี้: แยก Key และ Value ออกจากกัน
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                Doc_Id: id,          // ใช้ตัวแปร id ที่รับมา
                User_Token: user_token // ใช้ตัวแปร user_token ที่รับมา
            }),
            credentials: 'include'
        })
        .then(res => {
            if (!res.ok) throw new Error('Network response was not ok');
            return res.json();
        })
        .then(result => {
            if (result.status === 'success') {
                alert(result.message);
                location.reload(); // ลบสำเร็จแล้ว refresh หน้าจอ
            } else {
                alert('เกิดข้อผิดพลาด: ' + result.message);
            }
        })
        .catch(error => {
    // แก้จาก alert เดิม เป็นอันนี้เพื่อดูสาเหตุจริง
    console.error('Detailed Error:', error);
            alert('เกิดปัญหา: ' + error.message);
        });

        console.log('delete doc:' + id);
    }
}


function edit_doc(doc_id) {
  // เลือกปุ่มด้วย ID
const deleteBtn = document.querySelector('#delete_doc_btn');
deleteBtn.setAttribute('onclick', `delete_doc(${doc_id})`);
var doc_type_send = localStorage.getItem("doc_type");
if (doc_type_send == 'Stamp') {
display_style('addNewInputFile_btn','none');
display_style('addNewLink_btn','none');
display_style('DocDetail_0','grid');

document.getElementById('doc_number_receive').setAttribute('readonly', '');
document.getElementById('doc_receive_from').setAttribute('readonly', '');
document.getElementById('doc_number').setAttribute('readonly', '');
document.getElementById('doc_name').setAttribute('readonly', '');
document.getElementById('doc_action').setAttribute('readonly', '');
document.getElementById('doc_other').setAttribute('readonly', '');
document.getElementById('doc_date').setAttribute('readonly', '');
display_style('doc_type','none');
display_style('status','none');

//display_style('data_send_div','none');
//display_style('file_and_link','none');

// document.getElementById('doc_type').setAttribute('disabled', '');
// document.getElementById('doc_number').setAttribute('disabled', '');
// document.getElementById('doc_number_receive').setAttribute('disabled', '');
// document.getElementById('doc_date_receive').setAttribute('disabled', '');
// document.getElementById('doc_receive_from').setAttribute('disabled', '');
// document.getElementById('doc_action').setAttribute('disabled', '');
// document.getElementById('doc_other').setAttribute('disabled', '');
// }else {

}else {
  document.getElementById('doc_number_receive').removeAttribute('readonly', '');
  document.getElementById('doc_receive_from').removeAttribute('readonly', '');
  document.getElementById('doc_number').removeAttribute('readonly', '');
  document.getElementById('doc_name').removeAttribute('readonly', '');
  document.getElementById('doc_action').removeAttribute('readonly', '');
  document.getElementById('doc_other').removeAttribute('readonly', '');
  document.getElementById('doc_date').removeAttribute('readonly', '');
  display_style('doc_type','block');
  display_style('status','block');

  display_style('addNewInputFile_btn','block');
  display_style('addNewLink_btn','block');
display_style('DocDetail_0','none');
//display_style('data_send_div','grid');
display_style('file_and_link','block');
}
  display_style('delete_doc_btn','block');
  document.getElementById("read_show").style.display = 'block';
  document.getElementById("read_head").style.display = 'block';
 document.getElementById('submit_add_doc').style.display = 'block';
 document.getElementById('loading_save').style.display = 'none';
  document.getElementById("doc_id").value = doc_id;
console.log('doc_id : '+doc_id);
  window.toggleModal(true);
  const data_edit = data_save_send.find(
    (item) => String(item.doc_id) === String(doc_id),
  );

  if (data_edit.doc_type == 'External') {
    document.getElementById('doc_type').value = 'คำสั่ง';
    document.getElementById('doc_number').removeAttribute('required');
    document.getElementById('doc_receive_from').removeAttribute('required');
    document.getElementById('doc_receive_from').removeAttribute('required');
    document.getElementById("DocDetail_1").style.display = "none";
    document.getElementById("DocDetail_2").style.display = "none";
    document.getElementById("DocDetail_3").style.display = "none";
    document.getElementById("send_to").style.display = "none";


  }else if (data_edit.doc_type == 'Internal') {
    document.getElementById('doc_type').value = 'หนังสือ';
    document.getElementById('doc_number').setAttribute('required', '');
    document.getElementById('doc_receive_from').setAttribute('required', '');
    document.getElementById('doc_receive_from').setAttribute('required', '');
    document.getElementById("DocDetail_1").style.display = "block";
    document.getElementById("DocDetail_2").style.display = "block";
    document.getElementById("DocDetail_3").style.display = "block";
    document.getElementById("send_to").style.display = "block";
  }
  document.getElementById("formtype").value = "edit_document";
  document.getElementById("doc-form-title").innerHTML = `แก้ไขเอกสาร `;
  document.getElementById("doc_number").value = data_edit.doc_number;
  document.getElementById("doc_number_receive").value =
    data_edit.doc_number_receive;
  document.getElementById("doc_number_receive_stamp").value =  data_edit.doc_number_receive_stamp;
  document.getElementById("stamp_date_recieve").value =  data_edit.doc_date_receive_stamp;

  document.getElementById("doc_date").value = data_edit.doc_date_receive;
  document.getElementById("doc_receive_from").value =
    data_edit.doc_receive_from;
  if (data_edit.status == "Nomal") {
    document.getElementById("status").value = "ปกติ";
  } else {
    document.getElementById("status").value = "ด่วน";
  }
  document.getElementById("doc_file_link_main").innerHTML = "";
  document.getElementById("user_send").innerHTML = "";
  document.getElementById("group_send").innerHTML = "";
    document.getElementById("findName").innerHTML = "";
    document.getElementById("findGroup").innerHTML = "";
  document.getElementById("name_search").value = "";




  if (data_edit.doc_url) {

    if (!isJson(data_edit.doc_url)) {
          var result = '';
          const nameStr = data_edit.doc_url_name;
          //console.log(nameStr);
          const urlStr = data_edit.doc_url;
        //  console.log(urlStr);

          const names = (data_edit.doc_url_name || "").split(',');
          const urls = (data_edit.doc_url || "").split(',');

           result = [
            names.reduce((acc, name, index) => {
              if (name) acc[name.trim()] = urls[index]?.trim() || null;
              return acc;
            }, {})
          ];

          console.log(result);
    var link_url = result;
    }else {
    var link_url = JSON.parse(data_edit.doc_url);
    }
    link_url.forEach((itemObj, index) => {
      Object.entries(itemObj).forEach(([name_url, url]) => {
        //console.log(`Key: ${name_url}`);
      //  console.log(`URL: ${url}`);
        addNewLink(name_url, url);
      });
    });

  }
  // สมมติว่า data_edit คือ Object หนึ่งตัวจาก JSON ที่คุณส่งมา
  var user_status_text = '';
  if (data_edit.user_send_to && data_edit.user_send_to.length > 0) {

      // ลูปชั้นแรก: เข้าถึง Array ของกลุ่มผู้ใช้
      for (let i = 0; i < data_edit.user_send_to.length; i++) {
          let group = data_edit.user_send_to[i];
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
              add_user_send(detail.user_id, detail.user_name,doc_type_send);
              if (detail.Is_Signed == 'true') {
                var is_sign = `<img src="img/readed.png" width="15px" alt="">`;
              }else {
                var is_sign = ``;
              }
              user_status_text = user_status_text + `
              <tr class="h-9">
                      <td align="center" class="border border-gray-300 "><p class="pt-2"></p>${j+1}</td>
                      <td class="border border-gray-300 pt-2"><p class="pl-2">${escapeHtml(detail.user_name)}</p></td>
                      <td align="center"  class="border border-gray-300 pt-2"><p class="pl-2">${escapeHtml(detail.date)}</p></td>
                      <td align="center"  class="border border-gray-300 pt-2"><p class="pl-2">${is_sign}</p></td>
                    </tr>`;

          }

      }


  }
  var department_arr = data_edit.department_id;

  if (department_arr && Object.keys(department_arr).length > 0) {
      console.log('department_arr:', department_arr);

      Object.entries(department_arr).forEach(([group_id, name]) => {
          console.log(`GROUP ID: ${group_id}, Name: ${name}`);

           add_group_send(group_id, name);
      });
  } else {
      console.log('ไม่มีข้อมูลใน department_arr');
  }

  document.getElementById('user_status').innerHTML = user_status_text;
  document.getElementById("doc_name").value = data_edit.doc_name;
  document.getElementById("doc_action").value = data_edit.doc_action;
  document.getElementById("doc_other").value = data_edit.doc_other;
  loop_show_file(doc_id);
}
