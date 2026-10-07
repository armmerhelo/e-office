<?php
require_once __DIR__ . '/../config/google-auth.php';
app_method('GET');
if (!app_google_enabled()) app_google_redirect('not_configured');
app_google_session();
session_regenerate_id(true);
$documentId = $_GET['id'] ?? null;
$flow = app_google_flow(is_string($documentId) ? $documentId : null);
$_SESSION['google_login'] = $flow;
session_write_close();
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header('Location: ' . app_google_authorization_url($flow, app_google_config()), true, 302);
exit;
