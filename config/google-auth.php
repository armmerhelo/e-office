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
        'response_type' => 'code', 'scope' => 'openid email profile', 'prompt' => 'select_account',
        'state' => $flow['state'], 'nonce' => $flow['nonce'],
        'code_challenge' => $challenge, 'code_challenge_method' => 'S256',
    ], '', '&', PHP_QUERY_RFC3986);
}

function app_google_consume_flow(array &$session, mixed $state): array {
    $flow = $session['google_login'] ?? null;
    if (!is_array($flow) || !is_string($state) || !hash_equals($flow['state'], $state)
        || $flow['created_at'] < time() - 600 || $flow['created_at'] > time()) {
        throw new DomainException('invalid_state');
    }
    unset($session['google_login']); // Consume only the matching state, never a newer flow.
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
        || !in_array($claims['email_verified'] ?? false, [true, 'true'], true)) {
        throw new DomainException('unverified_email');
    }
    $email = strtolower($email);
    $domain = substr(strrchr($email, '@'), 1);
    $hd = is_string($claims['hd'] ?? null) ? $claims['hd'] : '';
    if ($domain === 'siya.ac.th' && $hd !== 'siya.ac.th') throw new DomainException('invalid_domain');
    return [
        'sub' => $claims['sub'], 'email' => $email, 'hd' => $hd,
        'name' => is_string($claims['name'] ?? null) ? mb_substr(trim($claims['name']), 0, 255) : '',
    ];
}

function app_google_school_identity(array $identity): bool {
    return substr(strrchr($identity['email'], '@'), 1) === 'siya.ac.th' && ($identity['hd'] ?? '') === 'siya.ac.th';
}

function app_google_user(PDO $pdo, array $identity, ?string $signupName = null, ?string $linkPassword = null): array {
    $ownsTransaction = !$pdo->inTransaction();
    if ($ownsTransaction) $pdo->beginTransaction();
    try {
        $user = app_google_resolve_user($pdo, $identity, $signupName, $linkPassword);
        if ($ownsTransaction) $pdo->commit();
        return $user;
    } catch (Throwable $e) {
        if ($ownsTransaction && $pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function app_google_resolve_user(PDO $pdo, array $identity, ?string $signupName, ?string $linkPassword): array {
    // Keep email validation, binding and session creation under the same user lock.
    $lock = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
    $q = $pdo->prepare('SELECT u.* FROM eoffice_google_accounts g JOIN t_user u ON u.User_Id=g.User_Id WHERE g.google_sub=?');
    $q->execute([$identity['sub']]);
    if ($binding = $q->fetch(PDO::FETCH_ASSOC)) {
        $q = $pdo->prepare('SELECT * FROM t_user WHERE User_Id=?' . $lock);
        $q->execute([$binding['User_Id']]);
        $user = $q->fetch(PDO::FETCH_ASSOC);
        if (!$user) throw new DomainException('account_conflict');
        if (strtolower($user['User_Email']) !== $identity['email']) throw new DomainException('account_conflict');
        return $user;
    }
    // Verified emails of any domain may link only to an existing E-Office account.
    $q = $pdo->prepare('SELECT * FROM t_user WHERE LOWER(User_Email)=? LIMIT 2' . $lock);
    $q->execute([$identity['email']]);
    $users = $q->fetchAll(PDO::FETCH_ASSOC);
    if (!$users) {
        if (!app_google_school_identity($identity)) throw new DomainException('not_registered');
        if ($signupName === null) throw new DomainException('signup_required');
        $signupName = trim($signupName);
        if ($signupName === '' || mb_strlen($signupName) > 255) throw new DomainException('invalid_name');
        // A new Google account starts with ordinary User privileges and no known password.
        $pdo->prepare("INSERT INTO t_user (User_Name,User_Email,User_Password,User_Token,User_Status) VALUES (?,?,?,?,'User')")->execute([
            $signupName, $identity['email'], password_hash(bin2hex(random_bytes(32)), PASSWORD_DEFAULT), bin2hex(random_bytes(32)),
        ]);
        $q = $pdo->prepare('SELECT * FROM t_user WHERE User_Id=?');
        $q->execute([$pdo->lastInsertId()]);
        $users = [$q->fetch(PDO::FETCH_ASSOC)];
    }
    if (count($users) !== 1) throw new DomainException('account_conflict');
    $user = $users[0];
    $q = $pdo->prepare('SELECT google_sub FROM eoffice_google_accounts WHERE User_Id=?' . $lock);
    $q->execute([$user['User_Id']]);
    $linkedSub = $q->fetchColumn();
    if ($linkedSub !== false) {
        if ($linkedSub !== $identity['sub']) throw new DomainException('account_conflict');
        return $user;
    }
    $domain = substr(strrchr($identity['email'], '@'), 1);
    $authoritative = $domain === 'gmail.com' || ($identity['hd'] ?? '') === $domain;
    if (!$authoritative) {
        // email_verified alone does not prove current ownership of a third-party email.
        if ($linkPassword === null) throw new DomainException('link_required');
        $stored = $user['User_Password'] ?? '';
        $hashed = password_get_info($stored)['algoName'] !== 'unknown';
        if ($stored === '' || !($hashed ? password_verify($linkPassword, $stored) : hash_equals($stored, $linkPassword))) {
            throw new DomainException('invalid_password');
        }
        if (!$hashed || password_needs_rehash($stored, PASSWORD_DEFAULT)) {
            $pdo->prepare('UPDATE t_user SET User_Password=? WHERE User_Id=?')->execute([password_hash($linkPassword, PASSWORD_DEFAULT), $user['User_Id']]);
        }
    }
    try {
        $pdo->prepare('INSERT INTO eoffice_google_accounts (google_sub,User_Id) VALUES (?,?)')->execute([$identity['sub'], $user['User_Id']]);
    } catch (PDOException $e) {
        if ((string)$e->getCode() !== '23000') throw $e;
        // Allow concurrent sign-ins only when they linked exactly the same identity.
        $q = $pdo->prepare('SELECT User_Id FROM eoffice_google_accounts WHERE google_sub=?' . $lock);
        $q->execute([$identity['sub']]);
        if ((int)$q->fetchColumn() !== (int)$user['User_Id']) throw new DomainException('account_conflict');
    }
    return $user;
}

function app_google_signup_pending(array &$session): array {
    $pending = $session['google_signup'] ?? null;
    if (!is_array($pending) || ($pending['expires_at'] ?? 0) <= time()
        || !in_array($pending['mode'] ?? '', ['signup', 'link'], true)
        || (($pending['mode'] ?? '') === 'signup' && !app_google_school_identity($pending['identity']))) {
        unset($session['google_signup']);
        throw new DomainException('signup_expired');
    }
    return $pending;
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
