var pagination_html = `<nav class="flex items-center justify-center border-t border-gray-200 bg-white px-4 py-3 sm:px-6 shadow-md rounded-lg">


        <div class="p-4">
            <div class="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                <a id="Pagination_PREV" data-page="" href="#" class="relative inline-flex items-center rounded-l-md px-3 py-2 text-sm font-medium text-gray-500 ring-1 ring-inset ring-gray-300 hover:bg-sky-50 transition">
                    <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L9.56 10l3.21 3.71a.75.75 0 11-1.04 1.08l-3.5-4a.75.75 0 010-1.08l3.5-4a.75.75 0 011.06-.02z" clip-rule="evenodd" />
                    </svg>
                    <span class="ml-1">PREV</span>
                </a>

                <div id= "Pagination">

                </div>
                <a  id="Pagination_NEXT" data-page="" href="#" class="relative inline-flex items-center rounded-r-md px-3 py-2 text-sm font-medium text-gray-500 ring-1 ring-inset ring-gray-300 hover:bg-sky-50 transition">
                    <span class="mr-1 ">NEXT</span>
                    <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L10.44 10 7.21 6.29a.75.75 0 111.04-1.08l3.5 4a.75.75 0 010 1.08l-3.5 4a.75.75 0 01-1.06.02z" clip-rule="evenodd" />
                    </svg>
                </a>
            </div>
        </div>
    </div>
</nav>
`;
document.getElementById("pagination_html").innerHTML = pagination_html;
var doc_detail_html = `


  <div id="doc_detail" class="p-2 fixed inset-0 bg-black/50 z-50 flex items-center justify-center modal-fade">



      <div class="max-w-3xl w-full mx-auto my-8 bg-white rounded-xl shadow-lg overflow-hidden border-b-1">
          <div class="bg-gray-200 text-gray-500 p-4 border-b-1 border-black-800 text-left">
            <table width="100%">
              <tr>
                <td>
                  <p class="text-xs font-medium truncate">
                      <span id="doc_row_1" class="font-medium text-gray-600"></span>  </p>
                </td>
                <td align="right">
              <div id="doc_status" class="text-right" style="display:none">
              <span class="flex items-center w-full">
                <span class="w-4 h-4 bg-red-500 rounded-full ml-auto"></span>
              </span>
                </div>
                </td>
                <td align="right"><button id="closeDocDetail" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button></td>
              </tr>
            </table>
          </div>

          <div class="p-4 space-y-2 text-gray-700 text-left ">
            <p id="doc_row_2" class="text-s font-semibold ">
            </p>
          </div>

          <div class=" p-3 text-xs text-gray-500 text-right border-b-1">
              <p>
                  <span id="doc_row_3" class="font-medium text-gray-600"></span>
              </p>

          </div>

          <div class="bg-gray-50 p-4 text-s text-gray-500 " align="center">
          <table >
            <tr align="center" id="Sign_File_API">
              <!-- <td ><a href="#"  target="_blank"><img src="img/e-sign.png"  width="30px" alt=""></a> เซ็นเอกสาร</td> -->
            </tr>
          </table>

<table >
  <tr align="center" id="Read_File_API" >
    <!-- <td > <a  href="#" target="_blank"><img src="img/file.png" width="30px" alt=""></a>  อ่านเอกสาร</td> -->
  </tr>
</table>

<table  >
  <tr align="center" id="url_link">
    <!-- <td ><a href="#"  target="_blank"><img src="img/e-sign.png"  width="30px" alt=""></a> เซ็นเอกสาร</td> -->
  </tr>
</table>
          </div>

    </div>
`;
document.getElementById("doc_detail_html").innerHTML = doc_detail_html;

var add_new_doc_html = `<div id="document-modal" class="fixed inset-0 bg-gray-900 bg-opacity-75 z-[60] flex items-center justify-center hidden p-4 sm:p-0">
    <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-6 modal-content">
    <div class="flex justify-between items-center border-b pb-3 mb-4 border-gray-400">
        <h3 id="doc-form-title" class="text-2xl font-bold text-indigo-700">เพิ่มเอกสารใหม่</h3>

        <div class="flex items-center gap-4">
            <button id="delete_doc_btn" onclick="delete_doc();" type="button" class="text-red-500 hover:text-red-700 text-sm font-medium transition cursor-pointer">
                <u>ลบเอกสารนี้</u>
            </button>

            <button id="close-modal-btn" class="text-gray-400 hover:text-gray-600 transition">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            </button>
        </div>
    </div>
<h4 id="read_head" class="font-semibold text-lg text-indigo-600  pb-1 " onclick="read_show();">รายการรับเอกสาร ⓘ </h4>
<div id="read_show" align="center" class=" pb-2 " style="display:block;">
  <table  class="border-collapse border border-gray-400 "  width="650px">
    <thead>
      <tr class="h-12">
        <th class="border border-gray-300 w-15">ลำดับ</th>
        <th class="border border-gray-300 ">ชื่อ</th>
        <th class="border border-gray-300 w-45">เวลา อ่าน</th>
        <th class="border border-gray-300 w-15">เซ็น</th>
      </tr>
    </thead>
    <tbody id="user_status">
    </tbody>
  </table>
  <p class="border-b border-gray-400 pt-2"></p>
</div>
  <form id="document-form"  class="space-y-4 pt-4">
<div class=" pt-4 pb-4" id="DocDetail_0">
<h4 class="font-semibold text-lg text-indigo-600 pb-1 ">เลขทะเบียนรับ(ฝ่าย)</h4>
<div id="" class="grid grid-cols-1 md:grid-cols-3 gap-4 ">
    <div class="grid grid-cols-1">
        <label  class="block text-sm font-medium text-gray-700">เลขรับ(ฝ่าย)</label>
        <input type="text" id="doc_number_receive_stamp" name="doc_number_receive_stamp" class=" w-full mt-1 block  rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border">
    </div>
    <div class="grid grid-cols-1">
        <label  class="block text-sm font-medium text-gray-700">ลงวันที่(ฝ่าย)</label>
        <input type="text" id="stamp_date_recieve" name="stamp_date_recieve" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border">
    </div>
</div>
</div>

        <input type="hidden" id="formtype" name="formtype" value="create_document">
        <input type="hidden" id="doc_id" name="doc_id" value="">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4" id="data_send_div">
                <div class="md:col-span-1 space-y-4">

                    <h4 class="font-semibold text-lg text-indigo-600 border-b pb-1 ">ข้อมูลเอกสาร</h4>
                    <div>
                        <label for="doc_type" class="block text-sm font-medium text-gray-700">ประเภทเอกสาร</label>
                        <select id="doc_type" name="doc_type" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border bg-white">
                          <option value="หนังสือ">หนังสือ</option>
                          <option value="คำสั่ง">คำสั่ง</option>

                        </select>
                    </div>
                    <div id="DocDetail_1">
                        <label for="doc_number_receive" class="block text-sm font-medium text-gray-700">เลขทะเบียนรับ</label>
                        <input type="text" id="doc_number_receive" name="doc_number_receive" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" required>
                    </div>
                    <div >
                        <label for="doc_number" class="block text-sm font-medium text-gray-700">ที่</label>
                        <input type="text" id="doc_number" name="doc_number" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" required>
                    </div>



                </div>

                <div class="md:col-span-1 space-y-4">
                    <h4 class="font-semibold text-lg text-indigo-600 border-b pb-1">ข้อมูลการรับและสถานะ</h4>
                    <div>
                        <label for="doc_date" class="block text-sm font-medium text-gray-700">ลงวันที่</label>
                        <input type="text" id="doc_date" name="doc_date_receive" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" required>
                    </div>
                    <div id="DocDetail_2">
                        <label for="doc_receive_from" class="block text-sm font-medium text-gray-700">จาก</label>
                        <input type="text" id="doc_receive_from" name="doc_receive_from" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" required>
                    </div>
                    <div id="DocDetail_3">
                        <label for="status" class="block text-sm font-medium text-gray-700">สถานะปัจจุบัน</label>
                        <select id="status" name="status" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border bg-white">

                            <option value="ปกติ">ปกติ</option>
                            <option value="ด่วน">ด่วน</option>

                        </select>
                    </div>
                </div>

                <div class="md:col-span-1 space-y-4">
                    <h4 class="font-semibold text-lg text-indigo-600 border-b pb-1">เนื้อหาและลิงก์</h4>
                    <div class="md:col-span-3">
                        <label for="doc_name" class="block text-sm font-medium text-gray-700">ชื่อเอกสาร (หัวเรื่อง) <span class="text-red-500">*</span></label>
                        <textarea type="text" id="doc_name" name="doc_name" rows="3" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" required></textarea>
                    </div>
                    <div>
                        <label for="doc_action" class="block text-sm font-medium text-gray-700">การปฏิบัติ</label>
                        <input id="doc_action" name="doc_action"  class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border">
                    </div>
                    <div>
                        <label for="doc_other" class="block text-sm font-medium text-gray-700">หมายเหตุ</label>
                        <input id="doc_other" name="doc_other"  class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border">
                    </div>
                    <div>


                    </div>





                </div>
            </div>
            <div class="border-t border-gray-400" align="center" id="file_and_link">
              <div style="padding:15px" > <h4 class="block text-m font-medium text-gray-700"> ไฟล์ ลิงก์</h4>  </div>

              <div class="  grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class=" border-r border-gray-200 p-2  items-center ">
                <label for="doc_file_link" class="block text-sm font-medium text-gray-700">ลิงก์ (URL)</label>
                <div id="doc_file_link_main" >

                </div>

                <div align="center" class="p-1">
                <button id="addNewLink_btn" type="button" onclick="addNewLink()" class="">
                    <img src="img/add_user.png" class="w-8 h-8">
                </button>
                </div>
                </div>

                <div class=" p-2 border-l border-gray-200 items-center justify-center">
                <div class="w-full" >
                    <label class="items-center  text-sm font-medium text-gray-700 mb-1 text-left">ไฟล์แนบ</label>


                  <div id="file_send"></div>

                    <div class="flex flex-col gap-1 p-1">
                      <div align="center">
                      <button id="addNewInputFile_btn" type="button" onclick="addNewInputFile()" class="">
                          <img src="img/add_user.png" class="w-8 h-8">
                      </button>
                      </div>
                    </div>


                </div>
                </div>
              </div>

            </div>
            <div class="border-t border-gray-400" align="center" id="send_to">
            <div style="padding:15px" > <h4 class="block text-m font-medium text-gray-700"> ส่งถึง</h4>  </div>

            <div class="grid grid-cols-2 gap-4">
    <div class=" p-4">
    <input type="text" id="name_search" onkeyup="get_userName()" class=" mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" placeholder="ค้นหาบุคลากร">

        <div id = "findName">


        </div>

    </div>

    <div id="user_send" class="bg-blue-50 p-4 border-t border-gray-400">

    </div>
</div>



            </div>

            <div class="border-t border-gray-400" align="center" id="send_to_group">
            <div style="padding:15px" > <h4 class="block text-m font-medium text-gray-700"> ส่งถึงกลุ่มงาน</h4>  </div>

            <div class="grid grid-cols-2 gap-4">
            <div class=" p-4">
            <input type="text" id="group_search" onkeyup="get_groupName()" class=" mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" placeholder="ค้นหากลุ่มงาน">

            <div id = "findGroup">


            </div>

            </div>

            <div id="group_send" class="bg-blue-50 p-4 border-t border-gray-400">

            </div>
            </div>



            </div>

            <div class="pt-4 border-t flex justify-end">
                <button  id="submit_add_doc" onclick=""  class="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-6 rounded-lg shadow-lg transition duration-200">
                    บันทึกเอกสาร
                </button>
                <div style="display:none;" id="loading_save" class="h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-t-transparent "></div>
            </div>


        </form>
    </div>
</div>
`;
document.getElementById("add_new_doc_html").innerHTML = add_new_doc_html;

var login_html = `
  <div id="modalOverlay" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center modal-fade">

    <div  class="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden transform transition-all text-center">

      <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
        <h3 id="head_login" class=" flex-1 text-xl font-semibold text-gray-800 text-center">เข้าสู่ระบบ</h3>
        <button id="closeIcon" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
      </div>
      <div id="modal_body">

<div id="login_part" >
<form id="loginForm" >

  <div class="p-6 text-gray-600">
    <input placeholder="ชื่อผู้ใช้งาน" type="text" id="Username" name="username" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" required>
<br>
  <input placeholder="รหัสผ่าน" type="password" id="user_password" name="password" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" required>


  </div>
<p id="login_status" class="text-red-500" role="alert" aria-live="polite"></p>
  <div class="px-6 py-2  flex justify-center gap-1 text-center">
    <button type="submit" class="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-md transition">เข้าสู่ระบบ</button>
  </div>

</form>
<div id="google_login_part" class="px-6 py-4" hidden>
  <p class="text-gray-500 pb-3">หรือ</p>
  <a id="google_login_btn" href="api/auth_google.php" class="flex items-center justify-center gap-2 px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-100 transition">
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.03 46.98 31.85 46.98 24.55z"/>
      <path fill="#FBBC05" d="M10.53 28.59A14.41 14.41 0 019.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.87 23.87 0 000 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
    เข้าสู่ระบบด้วย Google
  </a>
  <p class="text-gray-500 pt-3">บัญชีโรงเรียนสมัครผ่าน Google ได้ · อีเมลอื่นใช้ได้เมื่อมีบัญชีในระบบแล้ว</p>
</div>
</div>

<div id="google_signup_part" class="px-6 py-4 text-gray-600" hidden>
  <p id="google_signup_intro" class="pb-3">ยืนยันข้อมูลเพื่อสร้างบัญชี E-Office</p>
  <p id="google_signup_email" class="pb-3" style="overflow-wrap:anywhere"></p>
  <form id="google_signup_form">
    <div id="google_signup_name_part">
      <label for="google_signup_name">ชื่อ นามสกุล</label>
      <input id="google_signup_name" name="name" type="text" maxlength="255" autocomplete="name" class="mt-1 block w-full rounded-lg p-2 border" required>
    </div>
    <div id="google_link_password_part" hidden>
      <label for="google_link_password">รหัสผ่านบัญชี E-Office</label>
      <input id="google_link_password" type="password" autocomplete="current-password" class="mt-1 block w-full rounded-lg p-2 border">
    </div>
    <div id="google_signup_agreement" class="mt-3" style="max-height:160px;overflow:auto;text-align:left"></div>
    <label id="google_signup_consent_part" class="flex items-center justify-center gap-2 pt-3">
      <input id="google_signup_consent" type="checkbox" required> ยอมรับข้อตกลงการสมัครสมาชิก
    </label>
    <p id="google_signup_status" class="text-red-500 pt-3" role="alert" aria-live="polite"></p>
    <button id="google_signup_submit" type="submit" class="px-4 py-2 mt-3 bg-blue-600 text-white rounded-md">ยืนยันและเข้าสู่ระบบ</button>
    <a id="google_signup_change_account" href="api/auth_google.php" class="block pt-3">เปลี่ยนบัญชี Google</a>
  </form>
</div>

<div id="register_part" class="pl-6 pr-6 pt-6 text-gray-600" style="display:none">
<div id="register_part_text"> </div>
<form id="registerForm">
<div class="flex">
<input placeholder="อีเมล" type="text" id="register_email" name="register_email" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" required>
<p class="pt-3"> @siya.ac.th</p>
</div>
<br>
<input placeholder="ชื่อ นามสกุล" type="text" id="register_name" name="register_name" class=" mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2  border" required>
<br>
<div id="detail_agreement" style="width: 100%; height:200px ;  padding: 10px;  overflow: auto;" class="pt-2 bg-gray-200" align="left" >
<p>
<h5><b>ข้อตกลงการคุ้มครองข้อมูลส่วนบุคคล (Privacy Consent)</b></h5>
"ข้าพเจ้าได้อ่านและทำความเข้าใจ นโยบายความเป็นส่วนตัว (Privacy Policy) และข้อตกลงการสมัครสมาชิกฉบับนี้เรียบร้อยแล้ว และยินยอมให้ โรงเรียนศรียานุสรณ์ เก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของข้าพเจ้า โดยมีรายละเอียดดังนี้:"
<br>1. ข้อมูลที่เก็บรวบรวม
ข้อมูลส่วนบุคคลพื้นฐาน: ชื่อ-นามสกุล, อีเมล,  พฤติกรรมการใช้งานบนเว็บไซต์
ข้อมูลทางเทคนิค: IP Address, Cookies, การใช้งานเว็บไซต์
<br>2. วัตถุประสงค์การใช้งาน
เพื่อใช้ในการบริหารจัดการสมาชิก และให้บริการตามข้อกำหนด
เพื่อติดต่อสื่อสาร ประชาสัมพันธ์ข้อมูลข่าวสาร เพื่อวิเคราะห์ข้อมูลและพัฒนาปรับปรุงบริการ เพื่อยืนยันตัวตนในการเข้าใช้งานระบบ เพื่อติดต่อสื่อสารหรือตอบข้อซักถาม
<br>3. การรักษาความปลอดภัยและการเปิดเผยข้อมูล
โรงเรียนจะเก็บรักษาข้อมูลของท่านไว้อย่างปลอดภัยตามมาตรฐานความปลอดภัย และจะไม่เปิดเผยข้อมูลให้บุคคลที่สามโดยมิได้รับความยินยอม ยกเว้นเป็นการปฏิบัติตามกฎหมาย
<br>4. สิทธิ์ของเจ้าของข้อมูล
ท่านมีสิทธิ์ในการเข้าถึง ขอสำเนา แก้ไข ลบ หรือระงับการใช้ข้อมูลส่วนบุคคลของท่าน
ท่านสามารถถอนความยินยอมนี้ได้ตลอดเวลา
</p>
</div>
<div id="check_agreement" class="flex  justify-center pt-3">
<input id="checkbox_agreement"  style="" type="checkbox" class=" form-checkbox h-5 w-5 text-blue-600 rounded " required>

<label class="pl-2 text-gray-700" onclick=" "> ยอมรับข้อตกลง</label>
</div>


<div class="px-6 py-4  flex justify-center gap-1 text-center">
<button id="btn_submit_register" type="submit" class="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-md transition">ยืนยัน</button>
</form>



</div>


</div>


<div class="pb-3  flex justify-center">
  <button id="register_btn" type="button" onclick="register();" class=" flex-1 text-gray-700 hover:bg-gray-200   text-center">สมัครสมาชิก</button>

</div>
  </div>

<div id="success_modal" style="display:none" class="flex items-center p-4 mb-4 text-green-800 border-t-4 border-green-300 bg-green-50" role="alert">
    <!-- Icon -->
    <svg class="size-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
    </svg>
    <!-- Text -->

    <div class="ms-3 text-sm font-medium">
      กำลังดำเนินการ
    </div>
    <div class="w-full max-w-md mx-auto p-4">
      <div class="relative w-full h-1 bg-gray-200 overflow-hidden rounded-full">
        <div class="absolute top-0 h-full bg-indigo-600 animate-progress"></div>
      </div>
    </div>
</div>



    </div>

  </div>
`;
document.getElementById("login_html").innerHTML = login_html;

var logout_html = `
  <div id="modalOverlay_logout" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center hidden">

    <div  class="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden transform transition-all text-center">

      <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
        <h3 class=" flex-1 text-xl font-semibold text-gray-800 text-center">เข้าสู่ระบบ</h3>
        <button id="closeIcon" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
      </div>
      <div id="">


  <div class="p-6 text-gray-600">
    <input placeholder="ชื่อผู้ใช้งาน" type="text" id="Username" name="username" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" required>
<br>
  <input placeholder="รหัสผ่าน" type="password" id="user_password" name="password" class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border" required>


  </div>
<p id="login_status" class="text-red-500"></p>
  <div class="px-6 py-2  flex justify-center gap-1 text-center">
    <button type="submit" class="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-md transition">เข้าสู่ระบบ</button>
  </div>

</form>
<div class="py-2  ">
  <button id="cancelBtn" class=" flex-1 text-gray-700 hover:bg-gray-200   text-center">ยกเลิก</button>
  <br>
</div>
  </div>




    </div>

  </div>
`;

var x = 1;
const currentDates = new Date();
const currentYears = currentDates.getFullYear();
var years =  currentYears + 543;
var year_html ='';
for (let i = years; i >= 2566; i--) {
year_html = year_html +  `<option value="${i}">พ.ศ. ${i}</option>`;
}


var report_modal = `<div id="exportModal" class="fixed inset-0 z-50 hidden items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">

  <div class="relative bg-white w-full max-w-md rounded-2xl shadow-2xl transform transition-all">

    <button
      onclick="toggleExportModal()"
      class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-2 rounded-full transition-all focus:outline-none"
      aria-label="Close"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>

    <div class="p-6 border-b border-gray-100">
      <h3 class="text-xl font-bold text-gray-900">ออกรายงาน</h3>
      <p class="text-sm text-gray-500">เลือกช่วงเวลาที่ต้องการดึงข้อมูล</p>
    </div>

    <div id="report_detail" class="p-6 space-y-5">

    <div>
      <label class="block text-xs font-semibold text-gray-500 uppercase mb-1">ปี พ.ศ. </label>


      <select id="yearSelect_report" class="block w-full h-12 md:w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-lg border  h-11">
      ${year_html}

    </select>
    </div>
    <label class="block text-xs font-semibold text-gray-500 uppercase mb-1">หน้า</label>

      <div class="flex items-center">
        <input id="page_report_start" type="text" class="w-full h-12 border-gray-200 rounded-lg p-2 border text-sm" value="1">
        <p class="p-5 text-s font-semibold text-gray-500 uppercase mb-1">ถึง</p>
        <input id="page_report_end" type="text" class="w-full h-12 border-gray-200 rounded-lg p-2 border text-sm" value="1">

      </div>

      <div class="flex gap-3 ">
        <button id="create_report_btn" type="button" onclick="get_data_api_report(); " class="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition">
          สร้างเอกสาร
        </button>
      </div>


    </div>
    <div align="center " style="display:none;" id="loading_report" class="pt-4 pb-4 flex justify-center">
    <div   class="h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-t-transparent "></div>
    </div>
    <div class="flex justify-center" id="download_report_btn" style="display:none;" >
    <div class="flex gap-3 p-4 w-100">
      <button type="button" onclick="openReportPage_path();" class="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition ">
        พิมพ์เอกสาร
      </button>
    </div>
    </div>


  </div>
</div>
`;

document.getElementById("report_html").innerHTML = report_modal;


//document.getElementById('logout_html').innerHTML = logout_html;
