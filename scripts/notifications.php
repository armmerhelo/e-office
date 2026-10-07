<?php
// Run periodically with the same environment as the web app.
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require __DIR__.'/../config/services.php';$pdo=app_pdo();
$q=$pdo->query("SELECT GET_LOCK('eoffice:outbox',0)");if(!$q->fetchColumn())exit;
try{
 $rows=$pdo->query("SELECT * FROM eoffice_outbox WHERE status='pending' ORDER BY id LIMIT 100")->fetchAll();
 foreach($rows as $row){$payload=json_decode($row['payload'],true);try{
  if(($payload['type']??'')==='drive_cleanup_required')continue;
  if(($payload['type']??'')==='document_notification')app_document_notification((int)$payload['user_id'],(int)$payload['doc_id']);
  $pdo->prepare("UPDATE eoffice_outbox SET status='success' WHERE id=?")->execute([$row['id']]);
 }catch(Throwable $e){error_log((string)$e);$pdo->prepare("UPDATE eoffice_outbox SET status='failed' WHERE id=?")->execute([$row['id']]);}}
 echo count($rows)." jobs processed\n";
}finally{$pdo->query("SELECT RELEASE_LOCK('eoffice:outbox')");}
