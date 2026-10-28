<?php
require_once __DIR__.'/../config/bootstrap.php';app_method('GET');$user=app_user();$pdo=app_pdo();$page=max(1,(int)($_GET['page']??1));$limit=max(1,min(200,(int)($_GET['limit']??10)));$year=app_text($_GET,'year',10)?:'all';$search=app_text($_GET,'search',200);
$export=($_GET['export']??'')==='1';
// Export all rows and attachment metadata from the same InnoDB read view.
// REPEATABLE READ is explicit because normal application writes use READ COMMITTED.
if($export){$pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');$pdo->beginTransaction();}
try {
$where="l.recipient_email=? AND l.delivery_status='success' AND d.Is_Delete='active'";$params=[$user['User_Email']];if($year!=='all'){$where.=' AND d.Doc_Year=?';$params[]=$year;}
if($search!==''){
    // Treat SQL wildcard characters as literal search text, including order/year.
    $pattern='%'.strtr($search,['!'=>'!!','%'=>'!%','_'=>'!_']).'%';
    $where.=" AND (d.Doc_Name LIKE ? ESCAPE '!' OR CONCAT(COALESCE(d.External_Number,''),'/',d.Doc_Year) LIKE ? ESCAPE '!')";
    $params[]=$pattern;$params[]=$pattern;
}
$q=$pdo->prepare("SELECT COUNT(DISTINCT d.Doc_Id) FROM email_logs l JOIN t_document d ON CAST(l.doc_id AS UNSIGNED)=d.Doc_Id WHERE $where");$q->execute($params);$total=(int)$q->fetchColumn();$offset=($page-1)*$limit;
$paging=$export?'':" LIMIT $limit OFFSET $offset";
$q=$pdo->prepare("SELECT d.Doc_Id doc_id,MAX(l.file_name) file_name,MAX(l.created_at) date_received,MAX(d.Doc_Name) doc_name,MAX(d.External_Number) external_number,MAX(d.Doc_Year) doc_year FROM email_logs l JOIN t_document d ON CAST(l.doc_id AS UNSIGNED)=d.Doc_Id WHERE $where GROUP BY d.Doc_Id ORDER BY MAX(d.Doc_Year) DESC,MAX(d.External_Number) DESC,d.Doc_Id DESC$paging");$q->execute($params);$rows=$q->fetchAll();
foreach($rows as &$row){$f=$pdo->prepare("SELECT DISTINCT l.file_name FROM email_logs l JOIN t_document_upload u ON u.Doc_File_Link=(SELECT Doc_File_Link FROM t_document WHERE Doc_Id=?) AND CONVERT(u.Doc_Upload_Path USING utf8mb4) COLLATE utf8mb4_unicode_ci=CONVERT(l.file_name USING utf8mb4) COLLATE utf8mb4_unicode_ci WHERE l.doc_id=? AND l.recipient_email=? AND l.delivery_status='success'");$f->execute([$row['doc_id'],(string)$row['doc_id'],$user['User_Email']]);$row['files']=$f->fetchAll(PDO::FETCH_COLUMN);}unset($row);
$q=$pdo->prepare("SELECT DISTINCT d.Doc_Year FROM email_logs l JOIN t_document d ON CAST(l.doc_id AS UNSIGNED)=d.Doc_Id WHERE l.recipient_email=? AND l.delivery_status='success' AND d.Is_Delete='active' ORDER BY d.Doc_Year DESC");$q->execute([$user['User_Email']]);
$years=$q->fetchAll(PDO::FETCH_COLUMN);
if($export)$pdo->commit();
} catch(Throwable $error) {
    if($export&&$pdo->inTransaction())$pdo->rollBack();
    throw $error;
}
app_json(['status'=>'success','user_name'=>$user['User_Name'],'user_email'=>$user['User_Email'],'years'=>$years,'pagination'=>['current_page'=>$export?1:$page,'limit'=>$export?$total:$limit,'total_items'=>$total,'total_pages'=>$export?($total?1:0):(int)ceil($total/$limit)],'data'=>$rows]);
