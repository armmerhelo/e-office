<?php
if (PHP_SAPI !== 'cli') exit;
require __DIR__ . '/../config/google-auth.php';
$passed = 0;
function check(bool $value, string $name): void {
    global $passed;
    if (!$value) throw new RuntimeException('FAIL ' . $name);
    $passed++;
    echo "PASS $name\n";
}
function rejected(callable $fn, string $name, string $error = ''): void {
    try { $fn(); } catch (Throwable $e) {
        check($error === '' || $e->getMessage() === $error, $name);
        return;
    }
    throw new RuntimeException('FAIL ' . $name . ': accepted');
}
function token(array $claims): array {
    $encode = static fn($value) => rtrim(strtr(base64_encode(json_encode($value)), '+/', '-_'), '=');
    // Only injected into the CLI-only transport, never accepted by an HTTP endpoint.
    return ['id_token' => $encode(['alg'=>'RS256']) . '.' . $encode($claims) . '.test-signature'];
}
$config = ['client_id'=>'test-client', 'client_secret'=>'test-secret', 'redirect_uri'=>'http://localhost/api/auth_google_callback.php'];
$flow = app_google_flow('123');
$session = ['google_login'=>$flow];
check(app_google_consume_flow($session, $flow['state']) === $flow, 'state matches original browser flow');
rejected(static fn() => app_google_consume_flow($session, $flow['state']), 'replayed state rejected', 'invalid_state');
foreach (['wrong', null, [], ''] as $state) {
    $session = ['google_login'=>$flow];
    rejected(static fn() => app_google_consume_flow($session, $state), 'invalid state rejected', 'invalid_state');
}
$expired = $flow; $expired['created_at'] = time() - 601;
$session = ['google_login'=>$expired];
rejected(static fn() => app_google_consume_flow($session, $flow['state']), 'expired state rejected', 'invalid_state');
parse_str(parse_url(app_google_authorization_url($flow, $config), PHP_URL_QUERY), $params);
check($params['code_challenge_method'] === 'S256' && $params['code_challenge'] === rtrim(strtr(base64_encode(hash('sha256', $flow['verifier'], true)), '+/', '-_'), '='), 'PKCE challenge matches verifier');
check($params['scope'] === 'openid email' && $params['nonce'] === $flow['nonce'] && $params['hd'] === 'siya.ac.th', 'minimal scopes, nonce and school hint');
check(app_google_flow('https://attacker.example')['document_id'] === '', 'arbitrary return URL rejected');
$claims = ['iss'=>'https://accounts.google.com','aud'=>'test-client','sub'=>'123456','exp'=>time()+300,'iat'=>time(),'nonce'=>$flow['nonce'],'email'=>'QA-OWNER@siya.ac.th','email_verified'=>true,'hd'=>'siya.ac.th'];
$identity = app_google_identity('test-code', $flow, $config, static function ($fields) use ($claims, $flow, $config) {
    check($fields['code'] === 'test-code' && $fields['code_verifier'] === $flow['verifier'] && $fields['client_secret'] === $config['client_secret'] && $fields['redirect_uri'] === $config['redirect_uri'], 'code exchange binds client, redirect and PKCE');
    return token($claims);
});
check($identity === ['sub'=>'123456','email'=>'qa-owner@siya.ac.th'], 'verified Workspace identity accepted and email normalized');
foreach ([['iss','https://attacker.example'],['aud','another-client'],['azp','another-client'],['exp',time()-1],['exp','9999999999'],['iat',time()+3600],['nonce','wrong'],['sub',''],['email_verified',false],['email_verified','false'],['hd','other.ac.th'],['hd',null],['email','qa@siya.ac.th.attacker.example'],['email',[]]] as [$key,$value]) {
    $bad = $claims; $bad[$key] = $value;
    rejected(static fn() => app_google_identity('code', $flow, $config, static fn() => token($bad)), 'invalid claim rejected: ' . $key);
}
foreach ([[], ['id_token'=>'malformed'], ['id_token'=>true], ['id_token'=>'a.!!!!.b']] as $tokens) {
    rejected(static fn() => app_google_identity('code', $flow, $config, static fn() => $tokens), 'missing or malformed token rejected');
}
rejected(static fn() => app_google_identity('code', $flow, $config, static function () { throw new RuntimeException('Network unavailable'); }), 'Google network failure rejected');
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$pdo->exec('PRAGMA foreign_keys=ON');
$pdo->exec('CREATE TABLE t_user (User_Id INTEGER PRIMARY KEY,User_Email TEXT,User_Name TEXT,User_Status TEXT)');
$pdo->exec('CREATE TABLE eoffice_google_accounts (google_sub TEXT PRIMARY KEY,User_Id INTEGER NOT NULL UNIQUE REFERENCES t_user(User_Id) ON DELETE CASCADE)');
$pdo->exec("INSERT INTO t_user VALUES (1,'qa-owner@siya.ac.th','Original name','Admin')");
$user = app_google_user($pdo, $identity);
check($user['User_Id'] === 1 && $user['User_Status'] === 'Admin' && $user['User_Name'] === 'Original name', 'first sign-in links existing user and preserves role/name');
check(app_google_user($pdo, $identity) === $user && $pdo->query('SELECT COUNT(*) FROM eoffice_google_accounts')->fetchColumn() === 1, 'repeat sign-in uses existing Google binding');
rejected(static fn() => app_google_user($pdo, ['sub'=>'different','email'=>$identity['email']]), 'different Google identity cannot reuse linked account', 'account_conflict');
rejected(static fn() => app_google_user($pdo, ['sub'=>$identity['sub'],'email'=>'changed@siya.ac.th']), 'changed email requires administrator review', 'account_conflict');
rejected(static fn() => app_google_user($pdo, ['sub'=>'unknown','email'=>'new@siya.ac.th']), 'unregistered user denied', 'not_registered');
check($pdo->query('SELECT COUNT(*) FROM t_user')->fetchColumn() === 1, 'Google login does not create users');
$pdo->exec("INSERT INTO t_user VALUES (2,'duplicate@siya.ac.th','One','User'),(3,'duplicate@siya.ac.th','Two','User')");
rejected(static fn() => app_google_user($pdo, ['sub'=>'duplicate','email'=>'duplicate@siya.ac.th']), 'ambiguous existing email denied', 'account_conflict');
$pdo->exec('DELETE FROM t_user WHERE User_Id=1');
check($pdo->query('SELECT COUNT(*) FROM eoffice_google_accounts')->fetchColumn() === 0, 'user deletion removes Google binding');
echo "Google auth logic: $passed passed\n";
