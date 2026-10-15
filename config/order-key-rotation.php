<?php
require_once __DIR__.'/order-emails.php';
function app_order_rotate_settings_key(string $old,string $new): int {
    if(strlen($old)!==32||strlen($new)!==32||hash_equals($old,$new))throw new InvalidArgumentException('Two different 32-byte keys required');
    $pdo=app_pdo();if($pdo->inTransaction())throw new RuntimeException('Rotation requires its own transaction');
    $q=$pdo->query("SELECT GET_LOCK('eoffice:orders',0)");if(!$q->fetchColumn())throw new RuntimeException('Order worker is running');
    $pdo->beginTransaction();
    try{
        $row=$pdo->query('SELECT * FROM eoffice_order_settings WHERE id=1 FOR UPDATE')->fetch();
        if($row['enabled'])throw new RuntimeException('Pause order processing before rotation');
        $updates=[];foreach(['api_key_cipher','smtp_password_cipher'] as $field)if($row[$field]!==null)$updates[$field]=app_order_encrypt(app_order_decrypt($row[$field],$old),$new);
        $keys=$pdo->query('SELECT id,cipher FROM eoffice_order_api_keys WHERE cipher IS NOT NULL ORDER BY id FOR UPDATE')->fetchAll();$ciphertexts=[];
        foreach($keys as $entry)$ciphertexts[(int)$entry['id']]=app_order_encrypt(app_order_decrypt($entry['cipher'],$old),$new);
        foreach($updates as $field=>$cipher)$pdo->prepare("UPDATE eoffice_order_settings SET $field=? WHERE id=1")->execute([$cipher]);
        foreach($ciphertexts as $id=>$cipher)$pdo->prepare('UPDATE eoffice_order_api_keys SET cipher=? WHERE id=?')->execute([$cipher,$id]);
        // The compatibility copy must remain identical to the selected vault entry.
        if($row['active_key_id']!==null&&isset($ciphertexts[(int)$row['active_key_id']]))$pdo->prepare('UPDATE eoffice_order_settings SET api_key_cipher=? WHERE id=1')->execute([$ciphertexts[(int)$row['active_key_id']]]);
        $pdo->exec('UPDATE eoffice_order_settings SET revision=revision+1,updated_at=NOW() WHERE id=1');
        app_order_event('encryption_rotated',['credentials'=>count($updates)+count($ciphertexts)]);
        $pdo->commit();return count($updates)+count($ciphertexts);
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
    finally{$pdo->query("SELECT RELEASE_LOCK('eoffice:orders')");}
}
