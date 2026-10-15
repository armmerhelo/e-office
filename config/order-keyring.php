<?php
// References are random identifiers, never a substring or digest of the credential.
function app_order_key(int $id,bool $lock=false): ?array {
    $q=app_pdo()->prepare('SELECT * FROM eoffice_order_api_keys WHERE id=?'.($lock?' FOR UPDATE':''));$q->execute([$id]);return $q->fetch()?:null;
}

function app_order_key_config(array $entry,string $model): array {
    if($entry['deleted_at']!==null||!$entry['enabled']||$entry['cipher']===null)throw new AppOrderAIException('api_key_inactive');
    return ['key'=>app_order_decrypt($entry['cipher']),'model'=>$model,'key_id'=>(int)$entry['id']];
}

function app_order_key_insert(string $cipher,string $label,int $actor,int $days=90): int {
    if((int)app_pdo()->query('SELECT COUNT(*) FROM eoffice_order_api_keys WHERE deleted_at IS NULL')->fetchColumn()>=50)throw new AppOrderAIException('keyring_full');
    app_pdo()->prepare('INSERT INTO eoffice_order_api_keys (reference,label,cipher,created_by,remind_days) VALUES (?,?,?,?,?)')->execute(['key_'.bin2hex(random_bytes(8)),$label,$cipher,$actor,$days]);
    return (int)app_pdo()->lastInsertId();
}

function app_order_key_health(?int $id,?string $error=null): void {
    if($id===null)return;
    if($id>0){
        if($error===null)app_pdo()->prepare('UPDATE eoffice_order_api_keys SET last_success_at=NOW() WHERE id=? AND deleted_at IS NULL')->execute([$id]);
        else app_pdo()->prepare('UPDATE eoffice_order_api_keys SET last_error_at=NOW(),last_error_code=? WHERE id=? AND deleted_at IS NULL')->execute([$error,$id]);
    }
    elseif($error===null)app_pdo()->exec('INSERT INTO eoffice_order_key_health (key_id,last_success_at) VALUES (0,NOW()) ON DUPLICATE KEY UPDATE last_success_at=NOW()');
    else app_pdo()->prepare('INSERT INTO eoffice_order_key_health (key_id,last_error_at,last_error_code) VALUES (0,NOW(),?) ON DUPLICATE KEY UPDATE last_error_at=NOW(),last_error_code=VALUES(last_error_code)')->execute([$error]);
}

function app_order_keyring_public(array $settings): array {
    $rows=app_pdo()->query('SELECT * FROM eoffice_order_api_keys WHERE deleted_at IS NULL ORDER BY id DESC')->fetchAll();$keys=[];
    $usage=app_pdo()->query('SELECT key_id,COUNT(*) requests,SUM(prompt_tokens) input_tokens,SUM(output_tokens) output_tokens,SUM(total_tokens) total_tokens FROM eoffice_order_ai_usage WHERE created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY key_id')->fetchAll();$byKey=[];
    foreach($usage as $u)$byKey[$u['key_id']===null?'unattributed':(string)$u['key_id']]=$u;
    foreach($rows as $row){
        $usable=false;try{$usable=$row['cipher']!==null&&app_order_decrypt($row['cipher'])!=='';}catch(AppOrderAIException $e){}
        $keys[]=['id'=>(int)$row['id'],'reference'=>$row['reference'],'label'=>$row['label'],'enabled'=>(bool)$row['enabled'],
            'active'=>(int)($settings['active_key_id']??0)===(int)$row['id'],'usable'=>$usable,'created_at'=>$row['created_at'],
            'remind_days'=>(int)$row['remind_days'],'rotation_due'=>time()-strtotime($row['created_at'])>=(int)$row['remind_days']*86400,
            'tested_at'=>$row['tested_at'],'tested_model'=>$row['tested_model'],'test_code'=>$row['test_code'],
            'last_success_at'=>$row['last_success_at'],'last_error_at'=>$row['last_error_at'],'last_error_code'=>$row['last_error_code'],
            'usage'=>$byKey[(string)$row['id']]??['requests'=>0,'input_tokens'=>0,'output_tokens'=>0,'total_tokens'=>0]];
    }
    return ['keys'=>$keys,'server'=>['configured'=>app_env('GEMINI_API_KEY')!=='','active'=>$settings['active_key_id']===null&&$settings['api_key_cipher']===null,'usage'=>$byKey['0']??null,'health'=>app_pdo()->query('SELECT last_success_at,last_error_at,last_error_code FROM eoffice_order_key_health WHERE key_id=0')->fetch()?:null],
        'unattributed_usage'=>$byKey['unattributed']??null];
}
