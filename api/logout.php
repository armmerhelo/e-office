<?php
require_once __DIR__ . '/../config/bootstrap.php';
app_method('POST');
$token = $_COOKIE['User_Token'] ?? '';
if (is_string($token)) app_pdo()->prepare('DELETE FROM eoffice_sessions WHERE token_hash=?')->execute([hash('sha256', $token)]);
foreach (['User_Token','User_Status','User_DisplayName','User_Id'] as $name) app_cookie($name, '', time()-3600, $name==='User_Token');
app_json(['status'=>'success', 'message'=>'Logged out successfully']);
