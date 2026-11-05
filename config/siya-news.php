<?php
require_once __DIR__.'/bootstrap.php';

function app_siya_news_roles(): array { return ['news_submit','news_editor','news_producer']; }
class AppSiyaNewsError extends RuntimeException { public function __construct(string $message,public readonly int $status=400){parent::__construct($message);} }
function app_siya_news_can_access(array $user): bool {
    foreach(app_siya_news_roles() as $role)if(app_can($user,$role))return true;
    return false;
}
function app_siya_news_root(): string {
    $web=realpath(dirname(__DIR__));if($web===false)throw new RuntimeException('SIYA NEWS web root unavailable');
    $private=trim((string)app_env('EOFFICE_SIYA_NEWS_STORAGE'));
    if($private!==''){
        if($private[0]!=='/'&&!preg_match('/^[A-Za-z]:[\\\\\/]/D',$private))throw new RuntimeException('EOFFICE_SIYA_NEWS_STORAGE must be an absolute path');
        $candidates=[$private];
    }else $candidates=[dirname(app_settings()['storage']).'/siya-news',dirname($web).'/siya-news-private'];
    $normalize=static fn(string $path): string=>PHP_OS_FAMILY==='Windows'?strtolower(str_replace('\\','/',$path)):str_replace('\\','/',$path);
    $webPath=rtrim($normalize($web),'/');
    foreach($candidates as $candidate){
        $probe=dirname($candidate);while(!file_exists($probe)&&dirname($probe)!==$probe)$probe=dirname($probe);
        $parent=realpath($probe);if($parent===false)continue;$parentPath=rtrim($normalize($parent),'/');
        if($parentPath===$webPath||str_starts_with($parentPath,$webPath.'/'))continue;
        if(!is_dir($candidate)&&!@mkdir($candidate,0700,true)&&!is_dir($candidate))continue;
        $real=realpath($candidate);if($real===false)continue;$realPath=rtrim($normalize($real),'/');
        if($realPath===$webPath||str_starts_with($realPath,$webPath.'/'))continue;
        @chmod($real,0700);return $real;
    }
    throw new RuntimeException('SIYA NEWS storage must be provisioned outside web root');
}
function app_siya_news_image_path(string $id,string $extension): string {
    if(!preg_match('/^[a-f0-9]{32}$/D',$id)||!in_array($extension,['jpg','png','webp'],true))throw new RuntimeException('Invalid SIYA NEWS image identity');
    return app_siya_news_root().'/'.$id.'.'.$extension;
}
function app_siya_news_image_mimes(): array {
    return ['image/jpeg'=>['jpg','jpeg'],'image/png'=>['png'],'image/webp'=>['webp']];
}
function app_siya_news_text(array $input,string $key,int $max,bool $required=false): string {
    $value=$input[$key]??'';
    if(!is_string($value)||mb_strlen($value)>$max)app_fail('ข้อมูลข่าวไม่ถูกต้อง: '.$key);
    $value=trim($value);
    if($required&&$value==='')app_fail('กรุณากรอก'.(['title'=>'หัวข้อข่าว','body'=>'เนื้อหาข่าว'][$key]??$key));
    return $value;
}
function app_siya_news_date(array $input): ?string {
    $value=$input['event_date']??'';
    if($value===''||$value===null)return null;
    if(!is_string($value))app_fail('วันที่จัดกิจกรรมไม่ถูกต้อง');
    return app_date($value);
}
function app_siya_news_snapshot(PDO $pdo,array $news,int $actorId): void {
    $q=$pdo->prepare('SELECT id,original_name,extension,mime_type,bytes,caption,credit,sort_order FROM eoffice_siya_news_images WHERE news_id=? AND is_removed=0 ORDER BY sort_order,id');
    $q->execute([(int)$news['id']]);
    $snapshot=['title'=>$news['title'],'event_date'=>$news['event_date'],'location'=>$news['location'],'department'=>$news['department'],
        'body'=>$news['body'],'status'=>$news['status'],'review_note'=>$news['review_note'],'images'=>$q->fetchAll()];
    $snapshot['image_ids']=array_column($snapshot['images'],'id');
    $pdo->prepare('INSERT INTO eoffice_siya_news_revisions(news_id,version,actor_id,snapshot) VALUES(?,?,?,?)')
        ->execute([(int)$news['id'],(int)$news['version'],$actorId,json_encode($snapshot,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
}
function app_siya_news_item(PDO $pdo,int $id,array $user,bool $withHistory=false): array {
    $q=$pdo->prepare('SELECT n.*,COALESCE(o.User_Name,CONCAT("สมาชิก #",n.owner_id)) AS owner_name,r.User_Name AS reviewer_name FROM eoffice_siya_news n LEFT JOIN t_user o ON o.User_Id=n.owner_id LEFT JOIN t_user r ON r.User_Id=n.reviewer_id WHERE n.id=?');
    $q->execute([$id]);$news=$q->fetch();
    if(!$news)app_fail('ไม่พบข่าว',404);
    $isOwner=(int)$news['owner_id']===(int)$user['User_Id'];$editor=app_can($user,'news_editor');$producer=app_can($user,'news_producer');$submitter=app_can($user,'news_submit')&&$isOwner;
    $editorAccess=$editor&&in_array($news['status'],['review','approved'],true);
    if(!$submitter&&!$editorAccess&&!($producer&&$news['status']==='approved'))app_fail('คุณไม่มีสิทธิ์เข้าถึงข่าวนี้',403);
    $news['is_owner']=$isOwner;
    if(!$submitter&&!$editorAccess){
        $q=$pdo->prepare('SELECT snapshot FROM eoffice_siya_news_revisions WHERE news_id=? AND version=?');$q->execute([$id,(int)$news['approved_version']]);
        $approved=$q->fetchColumn();$approved=is_string($approved)?json_decode($approved,true,32,JSON_THROW_ON_ERROR):null;
        if(!is_array($approved)||!is_array($approved['images']??null))app_fail('ไม่พบข้อมูลข่าวเวอร์ชันที่ผ่านตรวจแล้ว',503);
        foreach(['title','event_date','location','department','body'] as $field)$news[$field]=$approved[$field]??null;
        $news['images']=$approved['images'];$news['approved_snapshot']=true;
    }else{
        $q=$pdo->prepare('SELECT id,original_name,extension,mime_type,bytes,sha256,caption,credit,sort_order,storage_state,uploaded_at FROM eoffice_siya_news_images WHERE news_id=? AND is_removed=0 ORDER BY sort_order,id');
        $q->execute([$id]);$news['images']=$q->fetchAll();
    }
    foreach($news['images'] as &$image){$image['bytes']=(int)$image['bytes'];$image['sort_order']=(int)$image['sort_order'];$image['url']='api/siya-news-image.php?id='.$image['id'];unset($image['sha256']);if(!$editorAccess)unset($image['storage_state']);}unset($image);
    if($withHistory&&($submitter||$editorAccess)){
        $q=$pdo->prepare('SELECT v.version,v.snapshot,v.created_at,u.User_Name AS actor_name FROM eoffice_siya_news_revisions v LEFT JOIN t_user u ON u.User_Id=v.actor_id WHERE v.news_id=? ORDER BY v.version DESC LIMIT 100');
        $q->execute([$id]);$news['history']=$q->fetchAll();foreach($news['history'] as &$row)$row['snapshot']=json_decode($row['snapshot'],true,32,JSON_THROW_ON_ERROR);unset($row);
    }
    if(!$submitter&&!$editorAccess){unset($news['review_note'],$news['reviewer_id'],$news['reviewer_name'],$news['history']);}
    return $news;
}
function app_siya_news_editable(PDO $pdo,int $id,array $user,bool $lock=false): array {
    $q=$pdo->prepare('SELECT * FROM eoffice_siya_news WHERE id=?'.($lock?' FOR UPDATE':''));$q->execute([$id]);$news=$q->fetch();
    if(!$news)throw new AppSiyaNewsError('ไม่พบข่าว',404);
    $owner=(int)$news['owner_id']===(int)$user['User_Id'];$submitter=$owner&&app_can($user,'news_submit')&&in_array($news['status'],['draft','changes_requested','approved'],true);
    $editor=app_can($user,'news_editor')&&in_array($news['status'],['review','approved'],true);
    if(!$submitter&&!$editor)throw new AppSiyaNewsError('คุณไม่มีสิทธิ์แก้ไขข่าวนี้',403);
    return $news;
}
function app_siya_news_next(PDO $pdo,array $news,array $changes,int $actorId,array $options=[]): array {
    $version=(int)$news['version']+1;$status=$options['status']??$news['status'];
    $note=array_key_exists('review_note',$options)?$options['review_note']:$news['review_note'];
    $reviewerId=($options['clear_reviewer']??false)?null:(array_key_exists('reviewer_id',$options)?$options['reviewer_id']:($news['reviewer_id']===null?null:(int)$news['reviewer_id']));
    $values=array_merge(['title'=>$news['title'],'event_date'=>$news['event_date'],'location'=>$news['location'],'department'=>$news['department'],'body'=>$news['body']],$changes);
    $submitted=($options['submitted']??false)?date('Y-m-d H:i:s'):$news['submitted_at'];
    $reviewed=($options['reviewed']??false)?date('Y-m-d H:i:s'):(($options['clear_reviewed']??false)?null:$news['reviewed_at']);
    $clearApproval=(bool)($options['clear_approval']??false);
    $pdo->prepare('UPDATE eoffice_siya_news SET title=?,event_date=?,location=?,department=?,body=?,status=?,version=?,review_note=?,reviewer_id=?,submitted_at=?,reviewed_at=?,approved_version=IF(?,NULL,approved_version),used_at=IF(?,NULL,used_at),used_by=IF(?,NULL,used_by) WHERE id=?')
        ->execute([$values['title'],$values['event_date'],$values['location'],$values['department'],$values['body'],$status,$version,$note,$reviewerId,$submitted,$reviewed,$clearApproval?1:0,$clearApproval?1:0,$clearApproval?1:0,(int)$news['id']]);
    $fresh=array_merge($news,$values,['status'=>$status,'version'=>$version,'review_note'=>$note,'reviewer_id'=>$reviewerId,'approved_version'=>$clearApproval?null:$news['approved_version'],'used_at'=>$clearApproval?null:$news['used_at'],'used_by'=>$clearApproval?null:$news['used_by']]);
    app_siya_news_snapshot($pdo,$fresh,$actorId);return $fresh;
}
function app_siya_news_mutation_start(array $actor,array $roles): array {
    $pdo=app_pdo();if($pdo->inTransaction())throw new RuntimeException('SIYA NEWS transaction already active');$pdo->beginTransaction();
    $q=$pdo->prepare('SELECT User_Id,User_Status,User_Name FROM t_user WHERE User_Id=? LOCK IN SHARE MODE');$q->execute([(int)$actor['User_Id']]);$current=$q->fetch();
    $session=app_user(false,true);
    if(!$current||!$session||(int)$session['User_Id']!==(int)$actor['User_Id'])throw new AppSiyaNewsError('กรุณาเข้าสู่ระบบใหม่',401);
    $current=array_merge($actor,$current);$allowed=$current['User_Status']==='Admin';
    if(!$allowed){$marks=implode(',',array_fill(0,count($roles),'?'));$q=$pdo->prepare("SELECT permission FROM eoffice_permissions WHERE User_Id=? AND permission IN ($marks) LOCK IN SHARE MODE");$q->execute([(int)$current['User_Id'],...$roles]);$allowed=(bool)$q->fetchColumn();}
    if(!$allowed)throw new AppSiyaNewsError('คุณไม่มีสิทธิ์ทำรายการนี้',403);
    return [$pdo,$current];
}
