<?php
require_once __DIR__ . '/auth.php';

function app_google_config(): array {
    return [
        'client_id' => trim((string)app_env('GOOGLE_CLIENT_ID')),
        'client_secret' => trim((string)app_env('GOOGLE_CLIENT_SECRET')),
        'redirect_uri' => app_settings()['base_url'] . '/api/auth_google_callback.php',
    ];
}

function app_google_enabled(): bool {
    $config = app_google_config();
    return $config['client_id'] !== '' && $config['client_secret'] !== '';
}

function app_google_session(): void {
    // A separate, short-lived session carries the OAuth state across Google's redirect.
    // Lax permits the top-level GET callback; application authentication stays Strict.
    session_name('EOFFICE_GOOGLE');
    session_start([
        'use_strict_mode' => 1, 'use_only_cookies' => 1, 'use_trans_sid' => 0,
        'cookie_lifetime' => 600, 'cookie_path' => '/', 'cookie_httponly' => true,
        'cookie_secure' => parse_url(app_settings()['base_url'], PHP_URL_SCHEME) === 'https',
        'cookie_samesite' => 'Lax',
    ]) || throw new RuntimeException('OAuth session unavailable');
}

function app_google_flow(?string $documentId = null): array {
    return [
        'state' => bin2hex(random_bytes(32)), 'nonce' => bin2hex(random_bytes(32)),
        'verifier' => bin2hex(random_bytes(32)), 'created_at' => time(),
        'document_id' => is_string($documentId) && preg_match('/^[1-9][0-9]{0,9}$/', $documentId) ? $documentId : '',
    ];
}

function app_google_authorization_url(array $flow, array $config): string {
    $challenge = rtrim(strtr(base64_encode(hash('sha256', $flow['verifier'], true)), '+/', '-_'), '=');
    return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
        'client_id' => $config['client_id'], 'redirect_uri' => $config['redirect_uri'],
        'response_type' => 'code', 'scope' => 'openid email', 'prompt' => 'select_account',
        'hd' => 'siya.ac.th', 'state' => $flow['state'], 'nonce' => $flow['nonce'],
        'code_challenge' => $challenge, 'code_challenge_method' => 'S256',
    ], '', '&', PHP_QUERY_RFC3986);
}

function app_google_consume_flow(array &$session, mixed $state): array {
    $flow = $session['google_login'] ?? null;
    unset($session['google_login']); // A callback can use this state only once.
    if (!is_array($flow) || !is_string($state) || !hash_equals($flow['state'], $state)
        || $flow['created_at'] < time() - 600 || $flow['created_at'] > time()) {
        throw new DomainException('invalid_state');
    }
    return $flow;
}

function app_google_token_request(array $fields): array {
    $ch = curl_init('https://oauth2.googleapis.com/token');
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 20,
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'],
        CURLOPT_POSTFIELDS => http_build_query($fields, '', '&', PHP_QUERY_RFC3986),
    ]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $status !== 200) throw new RuntimeException('Google token exchange failed');
    $data = json_decode($body, true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($data) || isset($data['error'])) throw new RuntimeException('Invalid Google token response');
    return $data;
}

function app_google_identity(string $code, array $flow, array $config, ?callable $request = null): array {
    $tokens = ($request ?? 'app_google_token_request')([
        'code' => $code, 'client_id' => $config['client_id'], 'client_secret' => $config['client_secret'],
        'redirect_uri' => $config['redirect_uri'], 'grant_type' => 'authorization_code',
        'code_verifier' => $flow['verifier'],
    ]);
    // This ID token comes ONLY from Google's token endpoint over verified TLS,
    // authenticated with our client secret. Never accept an ID token from a browser.
    // Google documents that signature verification is not required for this channel:
    // https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo
    $jwt = $tokens['id_token'] ?? null;
    if (!is_string($jwt) || strlen($jwt) > 16384) throw new RuntimeException('Missing Google ID token');
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) throw new RuntimeException('Invalid Google ID token');
    $payload = base64_decode(strtr($parts[1], '-_', '+/'), true);
    $claims = $payload === false ? null : json_decode($payload, true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($claims) || !in_array($claims['iss'] ?? '', ['https://accounts.google.com', 'accounts.google.com'], true)
        || ($claims['aud'] ?? null) !== $config['client_id']
        || (isset($claims['azp']) && $claims['azp'] !== $config['client_id'])
        || !is_int($claims['exp'] ?? null) || $claims['exp'] <= time()
        || !is_int($claims['iat'] ?? null) || $claims['iat'] > time() + 60
        || !is_string($claims['nonce'] ?? null) || !hash_equals($flow['nonce'], $claims['nonce'])
        || !is_string($claims['sub'] ?? null) || !preg_match('/^[a-zA-Z0-9_-]{1,255}$/', $claims['sub'])) {
        throw new RuntimeException('Invalid Google identity claims');
    }
    $email = $claims['email'] ?? null;
    if (!is_string($email) || strlen($email) > 255 || !filter_var($email, FILTER_VALIDATE_EMAIL)
        || !in_array($claims['email_verified'] ?? false, [true, 'true'], true)
        || ($claims['hd'] ?? '') !== 'siya.ac.th'
        || strtolower(substr(strrchr($email, '@'), 1)) !== 'siya.ac.th') {
        throw new DomainException('invalid_domain');
    }
    return ['sub' => $claims['sub'], 'email' => strtolower($email)];
}

function app_google_user(PDO $pdo, array $identity): array {
    $q = $pdo->prepare('SELECT u.* FROM eoffice_google_accounts g JOIN t_user u ON u.User_Id=g.User_Id WHERE g.google_sub=?');
    $q->execute([$identity['sub']]);
    if ($user = $q->fetch(PDO::FETCH_ASSOC)) {
        if (strtolower($user['User_Email']) !== $identity['email']) throw new DomainException('account_conflict');
        return $user;
    }
    // First sign-in links a Google-managed, verified school email to an existing account.
    $q = $pdo->prepare('SELECT * FROM t_user WHERE LOWER(User_Email)=? LIMIT 2');
    $q->execute([$identity['email']]);
    $users = $q->fetchAll(PDO::FETCH_ASSOC);
    if (!$users) throw new DomainException('not_registered');
    if (count($users) !== 1) throw new DomainException('account_conflict');
    $user = $users[0];
    try {
        $pdo->prepare('INSERT INTO eoffice_google_accounts (google_sub,User_Id) VALUES (?,?)')->execute([$identity['sub'], $user['User_Id']]);
    } catch (PDOException $e) {
        if ((string)$e->getCode() !== '23000') throw $e;
        // Allow concurrent sign-ins only when they linked exactly the same identity.
        $q = $pdo->prepare('SELECT User_Id FROM eoffice_google_accounts WHERE google_sub=?');
        $q->execute([$identity['sub']]);
        if ((int)$q->fetchColumn() !== (int)$user['User_Id']) throw new DomainException('account_conflict');
    }
    return $user;
}

function app_google_redirect(string $error = '', string $documentId = ''): never {
    $query = [];
    if ($documentId !== '' && preg_match('/^[1-9][0-9]{0,9}$/', $documentId)) $query['id'] = $documentId;
    if ($error !== '') $query['google_login'] = $error;
    header('Cache-Control: no-store');
    header('Referrer-Policy: no-referrer');
    header('Location: ' . app_settings()['base_url'] . '/' . ($query ? '?' . http_build_query($query) : ''), true, 303);
    exit;
}
