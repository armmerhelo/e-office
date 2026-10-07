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
check($params['scope'] === 'openid email profile' && $params['nonce'] === $flow['nonce'] && !isset($params['hd']), 'profile scope and nonce without restricting account selection');
check(app_google_flow('https://attacker.example')['document_id'] === '', 'arbitrary return URL rejected');
$claims = ['iss'=>'https://accounts.google.com','aud'=>'test-client','sub'=>'123456','exp'=>time()+300,'iat'=>time(),'nonce'=>$flow['nonce'],'email'=>'QA-OWNER@siya.ac.th','email_verified'=>true,'hd'=>'siya.ac.th'];
$identity = app_google_identity('test-code', $flow, $config, static function ($fields) use ($claims, $flow, $config) {
    check($fields['code'] === 'test-code' && $fields['code_verifier'] === $flow['verifier'] && $fields['client_secret'] === $config['client_secret'] && $fields['redirect_uri'] === $config['redirect_uri'], 'code exchange binds client, redirect and PKCE');
    return token($claims);
});
check($identity['sub'] === '123456' && $identity['email'] === 'qa-owner@siya.ac.th' && $identity['hd'] === 'siya.ac.th', 'verified Workspace identity accepted and email normalized');
foreach ([['iss','https://attacker.example'],['aud','another-client'],['azp','another-client'],['exp',time()-1],['exp','9999999999'],['iat',time()+3600],['nonce','wrong'],['sub',''],['email_verified',false],['email_verified','false'],['hd','other.ac.th'],['hd',null],['email','not-an-email'],['email',[]]] as [$key,$value]) {
    $bad = $claims; $bad[$key] = $value;
    rejected(static fn() => app_google_identity('code', $flow, $config, static fn() => token($bad)), 'invalid claim rejected: ' . $key);
}
foreach ([[], ['id_token'=>'malformed'], ['id_token'=>true], ['id_token'=>'a.!!!!.b']] as $tokens) {
    rejected(static fn() => app_google_identity('code', $flow, $config, static fn() => $tokens), 'missing or malformed token rejected');
}
rejected(static fn() => app_google_identity('code', $flow, $config, static function () { throw new RuntimeException('Network unavailable'); }), 'Google network failure rejected');
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$pdo->exec('PRAGMA foreign_keys=ON');
$pdo->exec('CREATE TABLE t_user (User_Id INTEGER PRIMARY KEY,User_Email TEXT,User_Name TEXT,User_Status TEXT,User_Password TEXT,User_Token TEXT)');
$pdo->exec('CREATE TABLE eoffice_google_accounts (google_sub TEXT PRIMARY KEY,User_Id INTEGER NOT NULL UNIQUE REFERENCES t_user(User_Id) ON DELETE CASCADE)');
$pdo->exec("INSERT INTO t_user (User_Id,User_Email,User_Name,User_Status) VALUES (1,'qa-owner@siya.ac.th','Original name','Admin')");
$user = app_google_user($pdo, $identity);
check($user['User_Id'] === 1 && $user['User_Status'] === 'Admin' && $user['User_Name'] === 'Original name', 'first sign-in links existing user and preserves role/name');
check(app_google_user($pdo, $identity) === $user && $pdo->query('SELECT COUNT(*) FROM eoffice_google_accounts')->fetchColumn() === 1, 'repeat sign-in uses existing Google binding');
rejected(static fn() => app_google_user($pdo, ['sub'=>'different','email'=>$identity['email']]), 'different Google identity cannot reuse linked account', 'account_conflict');
rejected(static fn() => app_google_user($pdo, ['sub'=>$identity['sub'],'email'=>'changed@siya.ac.th']), 'changed email requires administrator review', 'account_conflict');
rejected(static fn() => app_google_user($pdo, ['sub'=>'unknown','email'=>'new@siya.ac.th','hd'=>'siya.ac.th']), 'new school user requires onboarding', 'signup_required');
check($pdo->query('SELECT COUNT(*) FROM t_user')->fetchColumn() === 1, 'Google login does not create users');
$pdo->exec("INSERT INTO t_user (User_Id,User_Email,User_Name,User_Status) VALUES (2,'duplicate@siya.ac.th','One','User'),(3,'duplicate@siya.ac.th','Two','User')");
rejected(static fn() => app_google_user($pdo, ['sub'=>'duplicate','email'=>'duplicate@siya.ac.th']), 'ambiguous existing email denied', 'account_conflict');
$pdo->exec('DELETE FROM t_user WHERE User_Id=1');
check($pdo->query('SELECT COUNT(*) FROM eoffice_google_accounts')->fetchColumn() === 0, 'user deletion removes Google binding');
$gmailClaims=$claims; $gmailClaims['email']='existing@gmail.com'; $gmailClaims['sub']='gmail-id'; unset($gmailClaims['hd']);
$gmail=app_google_identity('code',$flow,$config,static fn()=>token($gmailClaims));
check($gmail['email']==='existing@gmail.com' && $gmail['hd']==='', 'verified Gmail token accepted without Workspace domain');
$pdo->exec("INSERT INTO t_user (User_Id,User_Email,User_Name,User_Status) VALUES (4,'existing@gmail.com','Gmail admin','Admin')");
check(app_google_user($pdo,$gmail)['User_Status']==='Admin', 'existing external Gmail signs in and keeps role');
$workspaceClaims=$claims; $workspaceClaims['email']='existing@another-school.ac.th'; $workspaceClaims['hd']='another-school.ac.th'; $workspaceClaims['sub']='external-workspace'; $workspaceClaims['name']='Google Profile Name';
$workspace=app_google_identity('code',$flow,$config,static fn()=>token($workspaceClaims));
$pdo->exec("INSERT INTO t_user (User_Id,User_Email,User_Name,User_Status) VALUES (6,'existing@another-school.ac.th','Existing workspace user','User')");
check(app_google_user($pdo,$workspace)['User_Name']==='Existing workspace user' && $workspace['name']==='Google Profile Name','external Workspace identity signs into existing account and keeps stored profile');
rejected(static fn()=>app_google_user($pdo,['sub'=>'unknown-external','email'=>'new@gmail.com']), 'external account cannot self-register', 'not_registered');
rejected(static fn()=>app_google_user($pdo,['sub'=>'unknown-external','email'=>'new@gmail.com'], 'New user'), 'signup name cannot bypass external registration restriction', 'not_registered');
$school=['sub'=>'new-school','email'=>'new-school@siya.ac.th','hd'=>'siya.ac.th'];
rejected(static fn()=>app_google_user($pdo,$school,''), 'blank signup name rejected','invalid_name');
$new=app_google_user($pdo,$school,'New School User');
check($new['User_Name']==='New School User' && $new['User_Status']==='User', 'school signup creates ordinary user with Google binding');
check(password_get_info($new['User_Password'])['algoName']!=='unknown', 'Google-only user receives unpredictable hashed password');
check(app_google_user($pdo,$school)['User_Id']===$new['User_Id'], 'new Google account can sign in again');
$thirdParty=['sub'=>'third-party','email'=>'existing@example.org','hd'=>''];
$pdo->prepare("INSERT INTO t_user (User_Id,User_Email,User_Name,User_Status,User_Password) VALUES (8,'existing@example.org','External editor','Editor',?)")->execute([password_hash('Google-Link-Test-2026!',PASSWORD_DEFAULT)]);
rejected(static fn()=>app_google_user($pdo,$thirdParty), 'third-party email requires existing account ownership proof','link_required');
rejected(static fn()=>app_google_user($pdo,$thirdParty,null,'wrong'), 'wrong linking password rejected','invalid_password');
check(app_google_user($pdo,$thirdParty,null,'Google-Link-Test-2026!')['User_Status']==='Editor','correct password links third-party identity preserving role');
check(app_google_user($pdo,$thirdParty)['User_Id']===8,'linked third-party identity signs in without password next time');
$session=['google_login'=>$flow];
try { app_google_consume_flow($session,'old-state'); } catch(DomainException $e) {}
check(app_google_consume_flow($session,$flow['state'])===$flow,'stale callback does not consume valid current flow');
$session=['google_signup'=>['identity'=>$school,'mode'=>'signup','expires_at'=>time()+60]];
check(app_google_signup_pending($session)['mode']==='signup','valid school onboarding retained');
$session['google_signup']['expires_at']=time()-1;
rejected(static fn()=>app_google_signup_pending($session),'expired onboarding rejected','signup_expired');
echo "Google auth logic: $passed passed\n";
