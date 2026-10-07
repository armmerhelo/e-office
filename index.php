<?php
require_once __DIR__.'/config/google-auth.php';
$web_settings = app_settings();
header('Cache-Control: no-store');
?>
<!DOCTYPE html>
<html lang="th">

<head>
  <script>window.EOFFICE_MOCK_SERVICES = <?= json_encode($web_settings['mock']) ?>;</script>
  <script>window.EOFFICE_GOOGLE_LOGIN_ENABLED = <?= json_encode(app_google_enabled()) ?>;</script>
  <?php if (!$web_settings['mock']): ?>
  <!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-1G9FYB9951"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-1G9FYB9951');
</script>
  <?php endif; ?>


            <link rel="stylesheet" href="assets/tailwind.css?v=<?php echo filemtime(__DIR__.'/assets/tailwind.css'); ?>">
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600&display=swap" rel="stylesheet">

  <link id="manifest" rel="manifest" href="/manifest.json">

  <?php if (!$web_settings['mock']): ?>
  <script src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js" defer></script>
  <?php endif; ?>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script>
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async function(OneSignal) {
      if (window.EOFFICE_MOCK_SERVICES || ['localhost','127.0.0.1','[::1]'].includes(location.hostname)) return;
      await OneSignal.init({
        appId: "66d3f5ec-449a-4228-a313-05d87a614076",
        safari_web_id: "web.onesignal.auto.3a07767d-f8c5-4ebf-965b-cb322da40f9f",
        notifyButton: {
          enable: true,
        },
        allowLocalhostAsSecureOrigin: true,
      });
      // รอให้ OneSignal พร้อมทำงานก่อน
          OneSignal.User.PushSubscription.addEventListener("change", function(event) {
              if (event.current.id) {
                  console.log("Subscription ID:", event.current.id);
                  sendIdToBackend(event.current.id);
                  // ส่งค่านี้ไปเก็บที่ Server ของคุณ
              }
          });

          // หรือดึงค่าตรงๆ (ถ้า User กด Subscribe แล้ว)
          const subId = OneSignal.User.PushSubscription.id;
          console.log("Subscription ID:", subId);
          sendIdToBackend(subId);
    });


    const sendIdToBackend = (subscriptionId) => {
      let User_Token = getCookie("User_Token");
      if (!subscriptionId || !User_Token) return;

      console.log("กำลังส่ง ID ไปยังเซิร์ฟเวอร์:", subscriptionId);

      fetch('../api/create_user_notification.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_token: User_Token,
            target_Id: subscriptionId
          })
        })
        .then(res => res.json())
        .then(data => console.log('✅ บันทึกสำเร็จ:', data))
        .catch(err => console.error('❌ ผิดพลาด:', err));
    };


  </script>
  <!--
<script>
  // ตรวจสอบว่า Browser รองรับ Service Worker ไหม
if ('serviceWorker' in navigator) {
window.addEventListener('load', function() {
  navigator.serviceWorker.register('/sw.js?v=2.3') // อย่าลืมใส่เลข version
    .then(function(registration) {
      // ✅ ถ้าสำเร็จ ให้แสดงข้อความ
      console.log('SW Register สำเร็จ! Scope คือ: ', registration.scope);
    //  alert('Service Worker ติดตั้งแล้ว! (v1.8)'); // 👈 ใส่บรรทัดนี้เพื่อเช็คบน iPad ง่ายๆ
    }, function(err) {
      // ❌ ถ้าล้มเหลว
      console.log('SW Register พัง: ', err);
      //alert('ติดตั้งไม่สำเร็จ: ' + err);
    });
});
}
</script> -->



<!--
  <script>

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async function(OneSignal) {
      await OneSignal.init({
        appId: "66d3f5ec-449a-4228-a313-05d87a614076",
        safari_web_id: "web.onesignal.auto.3a07767d-f8c5-4ebf-965b-cb322da40f9f",
        notifyButton: {
          enable: true
        },
      });

      // สร้างฟังก์ชันกลางเพื่อส่งข้อมูลไปหา PHP
      const sendIdToBackend = (subscriptionId) => {
        let User_Token = getCookie("User_Token");
        if (!subscriptionId || !User_Token) return;

        console.log("กำลังส่ง ID ไปยังเซิร์ฟเวอร์:", subscriptionId);

        fetch('../api/create_user_notification.php', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              user_token: User_Token,
              target_Id: subscriptionId
            })
          })
          .then(res => res.json())
          .then(data => console.log('✅ บันทึกสำเร็จ:', data))
          .catch(err => console.error('❌ ผิดพลาด:', err));
      };

      // กรณีที่ 1: มี ID อยู่แล้ว (เคยเข้าเว็บแล้ว)
      const currentId = OneSignal.User.PushSubscription.id;
      if (currentId) {
        sendIdToBackend(currentId);
      }

      // กรณีที่ 2: เพิ่งกด Allow ครั้งแรก (รอรับ Event)
      OneSignal.User.PushSubscription.addEventListener("change", (event) => {
        if (event.current.id) {
          sendIdToBackend(event.current.id);
        }
      });
    });
  </script>
 -->




  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>E-Office ศรียานุสรณ์</title>
  <link rel="icon" type="image/x-icon" href="img/eoffice_icon.ico">
  <!-- <link rel="stylesheet" href="assets/style.css?v=<?php echo time(); ?>"> -->

  <link rel="stylesheet" href="assets/style_main.css?v=<?php echo filemtime(__DIR__.'/assets/style_main.css'); ?>">


  <style>
    /* Custom styles for smoother UI and focus */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+Thai:wght@400;600;700&display=swap');

    :root {
      font-family: 'Noto Sans Thai', 'Inter', sans-serif;
    }

    .modal-content {
      max-height: 90vh;
      overflow-y: auto;
    }
  </style>
  <style>
    /* บังคับให้ sidebar มี transition เสมอ */
    #sidebar {
      transition: transform 0.25s ease-in-out;
    }

    /* สำหรับ Overlay ให้ค่อยๆ จาง (Fade) */
    #overlay {
      transition: opacity 0.25s ease-in-out;
    }

    #overlay.hidden {
      display: none;
      opacity: 0;
    }

    /* เพิ่มต่อท้ายในแท็ก <style> เดิมของคุณ */
    #sidebar {
      /* บังคับ Transition ให้ทำงานกับทุก Property ที่เปลี่ยน */
      transition: transform 0.25s ease-in-out;
      /* ป้องกันการกระพริบในบางเบราว์เซอร์ */
      backface-visibility: hidden;
    }
  </style>
</head>

<body class="bg-gray-100 min-h-screen">

  <header id="mobile-header" class="lg:hidden h-16 bg-white shadow-md p-4 flex justify-between items-center sticky top-0 z-40">
    <a href="index.php">
      <h1 class="text-xl font-bold text-indigo-700">E-Office SIYA</h1>
    </a>

    <button id="menu-toggle" type="button" aria-label="เปิดเมนู" aria-controls="sidebar" aria-expanded="false" class="text-gray-600 hover:text-indigo-600 focus:outline-none">
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7"></path>
      </svg>
    </button>
  </header>

  <div id="app-layout" class="flex min-h-[calc(100dvh-4rem)] lg:min-h-screen">

    <nav id="sidebar" data-sidebar-open="false" aria-label="เมนูหลัก" class="bg-indigo-800 text-white shadow-2xl overflow-y-auto">
      <div class="pt-4 pl-6 pr-6" align="center">
        <a href="index.php"><img src="img/icon_app_xl.png" width="60px" alt="E-Office"></a>
        <div align="center" class="mt-1">
          <p class="text-sm font-semibold text-white leading-tight">ระบบหนังสือราชการ E-Office</p>
          <p class="text-xs text-indigo-200 leading-tight">โรงเรียนศรียานุสรณ์</p>
        </div>
        <p id="user_nameDisplay" class="px-4 pt-2 pb-2 text-xs font-semibold  text-indigo-300  border-indigo-700 ">user name</p>
      </div>





        <li id="system_management" class="px-4 pt-4 pb-2 text-xs font-semibold uppercase text-indigo-300 border-t border-indigo-700">จัดการระบบ</li>
        <li id="group_menu_members">
          <a href="#" id="menu-members" onclick="showView('members','','1');" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
            <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19a4 4 0 10-8 0m4-8a4 4 0 100-8 4 4 0 000 8zm8-3v6m3-3h-6"></path>
            </svg>
            จัดการสมาชิก
          </a>
        </li>
        <li id="group_menu_groups">
          <a href="#" id="menu-groups" onclick="showView('groups','','1');" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
            <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"></path>
            </svg>
            จัดการกลุ่มงาน
          </a>
        </li>
        <li class="px-4 pt-6 pb-2 text-xs font-semibold uppercase text-indigo-300 border-t border-indigo-700">ทะเบียนเอกสาร</li>
        <li id="group_menu_bookdocnumber">
          <a href="#book_doc_number" id="menu-bookdocnumber" onclick="showView('book','','1');" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
            <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m4 16l4-16M9 9h10M5 15h10"></path>
            </svg>
            จองเลขคำสั่ง
          </a>
        </li>
        <li>
          <a href="#public" id="menu-public" onclick="showView('public','','1');" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
            <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.768-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"></path>
            </svg>
            คำสั่ง

          </a>
        </li>

        <li>
          <a href="#" id="my_menu_public" onclick="showView('my_public','','1');" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
            <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path>
            </svg>
            คำสั่งของฉัน

          </a>
        </li>
        <li id="group_send_email">
          <a href="#" id="send_email" onclick="showView('send_email','','1');" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
            <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
            </svg>

            ส่งอีเมลคำสั่ง
          </a>
        </li>
        <li id="li_menu_received">
          <a href="#received" id="menu-received" onclick="showView('received','','1');" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
            <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
            </svg>
            หนังสือส่งถึง

          </a>
        </li>
        <li id="group_menu_send_table_1" class="hidden max-sm:block">
          <a href="#send" id="menu-send"  onclick="showView('send','','1');" class=" menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
            <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
            </svg>
            ทะเบียนหนังสือรับ
          </a>
        </li>
        <li id="group_menu_send_table_2" class="max-sm:hidden">
          <a href="#sentable" id="menu-send-table" onclick="showView('send_table','','1');" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
            <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
            </svg>
            ทะเบียนหนังสือรับ
          </a>
        </li>


          <li id="other_menu_group" class="px-4 pt-4 pb-2 text-xs font-semibold uppercase text-indigo-300 border-t border-indigo-700">อื่นๆ</li>

          <li id="group_menu_bookingroom">
            <a href="#" id="menu-bookingroom" onclick="showView('room_booking','','1');" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
              <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h.01M7 21h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
              </svg>
              จองห้องประชุม
            </a>
          </li>
          <li id="group_menu_edit_room_booking" >
            <a href="#" id="menu-edit-room-booking" onclick="showView('edit_room_booking','','1');" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
              <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
              </svg>
              แก้ไขการจองห้อง
            </a>
          </li>
          <li id="group_maintenance" >
            <a href="#" id="menu-maintenance" onclick="showView('maintenance','','1');" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
              <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55.164 1.163.133 1.694-.066.22-.082.415-.208.583-.376l2.441-2.441a.5.5 0 00-.353-.854h-1.738a1 1 0 01-.707-.293l-.586-.586a1 1 0 00-.707-.293h-2.211a1 1 0 00-.707.293l-.586.586a1 1 0 01-.707.293h-1.738a.5.5 0 00-.353.854l2.44 2.441a2.25 2.25 0 01.583.376z"></path>
              </svg>
              แจ้งซ่อม
            </a>
          </li>
          <li id="group_maintenance_admin">
            <a href="#" id="menu-maintenance-admin" onclick="showView('maintenance_admin','','1');" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150">
              <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h10a2 2 0 012 2v14a2 2 0 01-2 2z"></path>
              </svg>
              แจ้งซ่อม (ฝ่ายงาน)
            </a>
          </li>
        <li class="px-4 pt-6 pb-2 text-xs font-semibold uppercase text-indigo-300 border-t border-indigo-700">ผู้ใช้งาน</li>
        <li id="group_menu_logout" >
          <a href="#" id="menu-logout" onclick="logOut();" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150 " style="display:none">
            <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
            </svg>
            ออกจากระบบ
          </a>
        </li>

        <li>

          <a id="openModal" class="menu-item flex items-center p-3 rounded-lg text-indigo-200 hover:bg-indigo-600 transition duration-150" style="display:none">
            <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
            </svg>
            เข้าสู่ระบบ
          </a>
        </li>




      <div class="absolute pb-7 left-0 w-full px-4 text-center text-xs text-indigo-400">
        <span id="user-info" class="block truncate">
          <p>พบปัญหาติดต่อ ครูภูธเนศ</p>

          <p>E-OFFICE ศรียานุสรณ์. All Rights Reserved</p>


      </span>
      </div>
    </nav>

    <div id="overlay" onclick="window.toggleSidebar()" class="fixed inset-0 bg-black opacity-50 z-40 hidden lg:hidden"></div>

    <div id="main_div" class="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto">
      <header id="page_header" class="bg-white shadow-lg rounded-xl p-3 sm:p-4 mb-4 flex">
        <h1 id="current-view-title" class="text-2xl font-bold text-gray-800 pr-4">
          ทะเบียนหนังสือรับ
        </h1>
        <br>

      </header>

      <main id="main-content-area" class="min-w-0">
        <div class="flex flex-col md:flex-row md:justify-between md:items-center mb-4 ">
          <div  class="menu-item flex ">

            <div id="read_icon_show" class="menu-item flex pl-3 pb-2">
              <div class="menu-item item-unread pt-1 pl-2 pr-2 "  onclick="toggleSelection(this); read_status_change('NotRead','load'); ">
                <div class="icon-wrapper">
                  <svg class="envelope-icon" viewBox="0 0 24 24">
                    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                  </svg>
                  <span class="notification-dot"></span>
                </div>
              </div>

              <div  class="menu-item item-read pt-1 pr-2 pl-2 " onclick="toggleSelection(this); read_status_change('Readed','load');" >
                <div class="icon-wrapper">
                  <svg class="envelope-icon" viewBox="0 0 24 24">
                    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                  </svg>
                  </div>
              </div>
              <div class="p-1">

              </div>
            </div>
            <div class="gap-2 flex  max-md:pb-4  pr-5 ">
              <h3 id="sub_head" class="text-xl font-bold  text-left pt-2 pl-2">รายการหนังสือรับเข้า</h3>
            <div id="doc_type_div" class="gap-2 flex" style="display:none;">

            <button id="internal_btn" onclick="setActiveButton('Internal');"
                class="md:w-auto px-3 py-2 bg-blue-600 text-white font-medium rounded-lg transition duration-150 opacity-40">
                หนังสือ
            </button>

            <button id="external_btn" onclick="setActiveButton('External');"
                class="md:w-auto  px-3 py-2 bg-blue-500 text-white font-medium rounded-lg transition duration-150 opacity-40">
                คำสั่ง
            </button>
            <button id="stamp_btn" onclick="setActiveButton('Stamp');"
                class="md:w-auto  px-3 py-2 bg-blue-500 text-white font-medium rounded-lg transition duration-150 opacity-40">
                ประทับตรา
            </button>
          </div>
            </div>



          </div>


          <div id="search_menu" width="100%" align="center" class="flex justify-center  items-center ">

            <div class="flex md:flex gap-2 items-right justify-right  ">
              <div class="relative w-full md:w-1/3">
                <div class="absolute inset-y-0 left-0 pl-1 flex items-center pointer-events-none">
                  <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=""></path>
                  </svg>
                </div>
                <input id="search_txt" type="text" class="h-11 block w-full pl-4 pr-3 py-2.5 border border-gray-300 rounded-lg leading-5  placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm" placeholder="ค้นชื่อเรื่อง เลขที่ เลขทะเบียนรับ หรือ วันที่">
              </div>


                <select id="yearSelect" class="block w-full md:w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-lg border  h-11">
                <?php

                  for ($i = (date("Y")+543); $i >= 2566 ; $i--) {
                  ?>
                  <option value="<?=  $i ?>">พ.ศ. <?=  $i ?></option>

                  <?php

                  }
                 ?>
                </select>

                <button id="btn_search" onclick="search_find();" class=" md:w-auto px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition duration-150 ease-in-out">
                  ค้นหา
                </button>
                <button style="display:none" id="add-doc-btn" onclick="open_create_doc();LinkIndex = 0;fileIndex = 0;" class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-5 rounded-lg shadow-md transition duration-200 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
                  </svg>
                </button>
                <button id="btn_report" onclick="toggleExportModal()" class="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium transition shadow-md">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>

                </button>




            </div>
          </div>


        </div>


        <div id="doc-list" class="mt-4">





          <div class="text-center p-1 text-gray-500 bg-white rounded-xl shadow-lg ">




            <div id="load_data" width="100%" align="center" style="display:block;padding-top:15px;">
              <!-- <div class="h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-t-transparent "></div> -->
              <br>
              <div id="data-container">
  <div class="animate-pulse space-y-4">
    <div class="h-24 bg-gray-200 rounded-xl w-full"></div>
    <div class="h-24 bg-gray-200 rounded-xl w-full"></div>
    <div class="h-24 bg-gray-200 rounded-xl w-full"></div>
    <div class="h-24 bg-gray-200 rounded-xl w-full"></div>



  </div>
</div>
            </div>


            <div id="content_received" class="p-4" style="display:none" align="center">
              <div id="loop_receive">

              </div>
            </div>

            <div id="pagination_html">



            </div>

          
<script>
window.addEventListener('message', function(event) {
    // 🔒 ตรวจสอบความปลอดภัย (แนะนำให้เปิดใช้เมื่อขึ้นระบบจริง)
    // if (event.origin !== 'https://child-domain.com') return;

    // ตรวจสอบประเภท Message
    if (event.data && event.data.type === 'RESIZE_IFRAME') {
        const iframe = document.getElementById('iframe_maintenance_requests');
        const maintenance_div = document.getElementById('maintenance_div'); // แก้เพิ่มตรงนี้!
        
        if (iframe) {
            // ปรับความสูงของ iframe ตามที่หน้าลูกส่งมา
            iframe.style.height = event.data.height + 'px';
        }
        
        if (maintenance_div) {
            // ปรับความสูงของตัวครอบด้วย (ถ้าจำเป็น) 
            // แต่จริง ๆ ถ้า iframe สูงขึ้น ตัว div นี้จะยืดตามเองครับ
            maintenance_div.style.height = event.data.height + 'px';
        }
    }
});
</script>




          </div>
        </div>
<div id="content_room_booking" class="iframe-view-container" style="display:none"></div>
<div id="external_number_booking" class="iframe-view-container" style="display:none"></div>
<div id="content_edit_room_booking" class="iframe-view-container" style="display:none"></div>
<div id="management_user" class="iframe-view-container" style="display:none"></div>
<div id="management_department" class="iframe-view-container" style="display:none"></div>
<div id="group_send_email_div" class="iframe-view-container" style="display:none"></div>
<div id="my_public_div" class="iframe-view-container" style="display:none"></div>
<div id="maintenance_div" class="iframe-view-container" style="display:none"></div>
<div id="maintenance_admin_div" class="iframe-view-container" style="display:none"></div>
      </main>


    </div>
  </div>



  <div id="login_html"></div>
  <div id="doc_detail_html"></div>
  <div id="add_new_doc_html"></div>
  <div id="report_html"></div>
  <script src="components/components.js?v=<?php echo filemtime(__DIR__.'/components/components.js'); ?>"></script>
  <script src="assets/google-login.js?v=<?php echo filemtime(__DIR__.'/assets/google-login.js'); ?>"></script>

  <script src="assets/security.js?v=<?php echo filemtime(__DIR__.'/assets/security.js'); ?>"></script>
  <script src="assets/api-service.js?v=<?php echo filemtime(__DIR__.'/assets/api-service.js'); ?>"></script>
  <script src="assets/utils.js?v=<?php echo filemtime(__DIR__.'/assets/utils.js'); ?>"></script>
  <script src="assets/main.js?v=<?php echo filemtime(__DIR__.'/assets/main.js'); ?>"></script>
  <script src="assets/modal.js?v=<?php echo filemtime(__DIR__.'/assets/modal.js'); ?>"></script>
  <!-- <script src="room_booking/main-room.js?v=<?php echo time(); ?>"></script> -->
  <doc-detail></doc-detail>

  <script type="text/javascript">
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '[::1]'; // รองรับ IPv6

    if (isLocalhost) {

      document.getElementById('manifest').href = '';
      console.log("กำลังทำงานบน: Localhost (เครื่องตัวเอง)");
      // เช่น: ใช้ API URL ชุดพัฒนา

    } else {
      console.log("กำลังทำงานบน: Real Server (เซิร์ฟเวอร์จริง)");
      // เช่น: ใช้ API URL ชุดจริง

    }


    if (getCookie("User_Token")) {
      console.log("มี User_Token ");
      let User_Token = getCookie("User_Token");
      document.addEventListener("DOMContentLoaded", function() {

        document.getElementById('menu-logout').style.display = 'flex';
        document.getElementById('openModal').style.display = 'none';
        document.getElementById('login_html').style.display = 'none';


      });



    } else {
      console.log("ไม่มี User_Token หรือ Cookie หมดอายุ");
      document.addEventListener("DOMContentLoaded", function() {
        document.getElementById('openModal').style.display = 'flex';
        document.getElementById('menu-logout').style.display = 'none';
      });
    }
  </script>







</body>






</html>
