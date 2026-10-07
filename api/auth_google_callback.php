<?php
require_once __DIR__ . '/../config/google-auth.php';
app_method('GET');
if (!app_google_enabled()) app_google_redirect('not_configured');
$documentId = '';
try {
    app_google_session();
    try {
        $flow = app_google_consume_flow($_SESSION, $_GET['state'] ?? null);
    } finally {
        session_write_close();
    }
    $documentId = $flow['document_id'];
    if (isset($_GET['error'])) app_google_redirect($_GET['error'] === 'access_denied' ? 'cancelled' : 'failed', $documentId);
    $code = $_GET['code'] ?? '';
    if (!is_string($code) || $code === '' || strlen($code) > 4096) app_google_redirect('failed', $documentId);
    $identity = app_google_identity($code, $flow, app_google_config());
    $user = app_google_user(app_pdo(), $identity);
    app_login_session($user);
    app_google_redirect('', $documentId);
} catch (DomainException $e) {
    app_google_redirect($e->getMessage(), $documentId);
} catch (Throwable $e) {
    // Do not log authorization codes, client secrets, or Google tokens.
    error_log('Google login failed (' . get_class($e) . ')');
    app_google_redirect('failed', $documentId);
}
