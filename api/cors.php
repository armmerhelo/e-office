<?php
// Files are served only through the document-authorized endpoint.
require_once __DIR__ . '/../config/bootstrap.php';
app_fail('โปรดเปิดไฟล์ผ่านเอกสารในระบบ', 410);
