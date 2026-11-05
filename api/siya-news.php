<?php
require_once __DIR__.'/../config/siya-news.php';
app_method('GET','POST');
$actor=app_user();
if(!app_siya_news_can_access($actor))app_fail('คุณยังไม่ได้รับสิทธิ์ SIYA NEWS',403);
$pdo=app_pdo();
$id=static function($value): int {$id=filter_var($value,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]);if(!$id)app_fail('รหัสข่าวไม่ถูกต้อง');return (int)$id;};
$version=static function($value): int {$v=filter_var($value,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]);if(!$v)app_fail('กรุณาโหลดข่าวใหม่ก่อนบันทึก');return (int)$v;};
$checkVersion=static function(array $news,int $expected): void {if((int)$news['version']!==$expected)throw new AppSiyaNewsError('ข่าวถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนทำรายการ',409);};
$fields=static function(array $data): array {return [
    'title'=>app_siya_news_text($data,'title',255), 'event_date'=>app_siya_news_date($data),
    'location'=>app_siya_news_text($data,'location',255), 'department'=>app_siya_news_text($data,'department',255),
    'body'=>app_siya_news_text($data,'body',30000)
];};
$finish=static function(PDO $pdo): void {if($pdo->inTransaction())$pdo->commit();};
try {
    if($_SERVER['REQUEST_METHOD']==='GET'){
        $action=app_text($_GET,'action',20)?:'list';
        if($action==='detail'){
            $news=app_siya_news_item($pdo,$id($_GET['id']??null),$actor,true,($_GET['scope']??'')==='trash');
            app_json(['status'=>'success','data'=>$news]);
        }
        if($action!=='list')app_fail('ไม่รองรับรายการนี้');
        $scope=app_text($_GET,'scope',20)?:'mine';$where='';$params=[];
        if($scope==='mine'){
            if(!app_can($actor,'news_submit'))app_fail('ไม่มีสิทธิ์ดูข่าวของฉัน',403);
            $where="n.owner_id=? AND n.status<>'deleted'";$params[]=(int)$actor['User_Id'];
        }elseif($scope==='review'){
            if(!app_can($actor,'news_editor'))app_fail('ไม่มีสิทธิ์ตรวจข่าว',403);
            $where="n.status='review'";
        }elseif($scope==='ready'){
            if(!app_can($actor,'news_producer'))app_fail('ไม่มีสิทธิ์ดูข่าวที่ผ่านตรวจ',403);
            $where="n.status='approved'";
        }elseif($scope==='all'){
            if(!app_can($actor,'news_editor'))app_fail('ไม่มีสิทธิ์ดูข่าวทั้งหมด',403);
            $where="n.status IN ('review','approved')";
        }elseif($scope==='trash'){
            $where="n.status='deleted'";
            if($actor['User_Status']!=='Admin'){
                $access=[];
                if(app_can($actor,'news_submit')){$access[]="(n.owner_id=? AND n.deleted_from_status='draft')";$params[]=(int)$actor['User_Id'];}
                if(app_can($actor,'news_editor'))$access[]="n.deleted_from_status IN ('review','approved')";
                if(!$access)app_fail('ไม่มีสิทธิ์ดูถังขยะข่าว',403);
                $where.=' AND ('.implode(' OR ',$access).')';
            }
        }else app_fail('ตัวกรองข่าวไม่ถูกต้อง');
        $search=app_text($_GET,'q',100);
        if($search!==''){$where.=' AND (n.title LIKE ? OR n.body LIKE ? OR n.department LIKE ?)';$needle='%'.$search.'%';array_push($params,$needle,$needle,$needle);}
        $limit=max(1,min(100,(int)($_GET['limit']??40)));$offset=max(0,(int)($_GET['offset']??0));
        $q=$pdo->prepare("SELECT n.id,n.owner_id,n.title,n.event_date,n.location,n.department,n.status,n.version,n.review_note,n.submitted_at,n.reviewed_at,n.used_at,n.created_at,n.updated_at,COALESCE((SELECT u.User_Name FROM t_user u WHERE u.User_Id=n.owner_id),CONCAT('สมาชิก #',n.owner_id)) owner_name,(SELECT COUNT(*) FROM eoffice_siya_news_images i WHERE i.news_id=n.id AND i.is_removed=0) image_count FROM eoffice_siya_news n WHERE $where ORDER BY n.updated_at DESC,n.id DESC LIMIT $limit OFFSET $offset");
        $q->execute($params);$rows=$q->fetchAll();foreach($rows as &$row){$row['id']=(int)$row['id'];$row['version']=(int)$row['version'];$row['image_count']=(int)$row['image_count'];$row['is_owner']=(int)$row['owner_id']===(int)$actor['User_Id'];if($scope==='ready')unset($row['review_note']);}unset($row);
        app_json(['status'=>'success','data'=>$rows,'scope'=>$scope]);
    }

    if(str_starts_with($_SERVER['CONTENT_TYPE']??'','multipart/form-data')){
        if(($_POST['action']??'')!=='upload')app_fail('คำขออัปโหลดไม่ถูกต้อง');
        $newsId=$id($_POST['id']??null);$expected=$version($_POST['version']??null);
        if(!app_can($actor,'news_submit')&&!app_can($actor,'news_editor'))app_fail('ไม่มีสิทธิ์อัปโหลดภาพ',403);
        $upload=$_FILES['image']??null;$maxBytes=20*1024*1024;
        if(!$upload||($upload['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_OK||!is_uploaded_file($upload['tmp_name'])||($upload['size']??0)<1||$upload['size']>$maxBytes)app_fail('ภาพไม่สมบูรณ์หรือมีขนาดเกิน 20 MB');
        $mime=(new finfo(FILEINFO_MIME_TYPE))->file($upload['tmp_name']);$mimes=app_siya_news_image_mimes();
        if(!isset($mimes[$mime]))app_fail('รองรับเฉพาะภาพ JPEG, PNG และ WebP');
        $imageInfo=@getimagesize($upload['tmp_name']);if(!$imageInfo||($imageInfo['mime']??'')!==$mime||((int)$imageInfo[0]*(int)$imageInfo[1])>100000000)app_fail('ไฟล์ภาพไม่ถูกต้องหรือมีความละเอียดสูงเกินไป');
        $ext=$mime==='image/jpeg'?'jpg':($mime==='image/png'?'png':'webp');$hash=hash_file('sha256',$upload['tmp_name']);$bytes=(int)$upload['size'];
        $original=basename(str_replace('\\','/',(string)$upload['name']));$original=preg_replace('/[\x00-\x1F\x7F]/u','',$original)??'';$original=mb_substr($original,0,255);if($original==='')$original='image.'.$ext;
        $imageId=bin2hex(random_bytes(16));$root=app_siya_news_root();$path=app_siya_news_image_path($imageId,$ext);$partial=$path.'.partial';$stored=false;
        try{
            [$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_submit','news_editor']);
            $news=app_siya_news_editable($pdo,$newsId,$current,true);$checkVersion($news,$expected);
            $q=$pdo->prepare('SELECT COUNT(*) FROM eoffice_siya_news_images WHERE news_id=? AND is_removed=0');$q->execute([$newsId]);if((int)$q->fetchColumn()>=10)throw new AppSiyaNewsError('ข่าวหนึ่งรายการแนบได้ไม่เกิน 10 ภาพ',409);
            if(!move_uploaded_file($upload['tmp_name'],$partial))throw new RuntimeException('SIYA NEWS image staging failed');chmod($partial,0600);
            if(!hash_equals($hash,hash_file('sha256',$partial))||!rename($partial,$path))throw new RuntimeException('SIYA NEWS image could not be safely stored');$stored=true;
            $q=$pdo->prepare('SELECT COALESCE(MAX(sort_order),-1)+1 FROM eoffice_siya_news_images WHERE news_id=? AND is_removed=0');$q->execute([$newsId]);$sort=(int)$q->fetchColumn();
            $pdo->prepare('INSERT INTO eoffice_siya_news_images(id,news_id,uploaded_by,original_name,extension,mime_type,bytes,sha256,sort_order) VALUES(?,?,?,?,?,?,?,?,?)')->execute([$imageId,$newsId,(int)$current['User_Id'],$original,$ext,$mime,$bytes,$hash,$sort]);
            $options=[];if($news['status']==='approved')$options=['status'=>'review','review_note'=>null,'clear_reviewer'=>true,'clear_reviewed'=>true,'clear_approval'=>true];
            $fresh=app_siya_news_next($pdo,$news,[],(int)$current['User_Id'],$options);app_audit('siya_news.image',$current,$newsId,['action'=>'upload','count'=>1]);$finish($pdo);
            app_json(['status'=>'success','image_id'=>$imageId,'version'=>(int)$fresh['version']]);
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();if($stored&&is_file($path))@unlink($path);if(is_file($partial))@unlink($partial);throw $e;}
    }

    $data=app_input();$action=app_text($data,'action',30);
    if(in_array($action,['trash','restore'],true)){
        if(!array_key_exists('_expected_owner',$data))app_fail('กรุณาโหลดหน้าใหม่ก่อนทำรายการ',409);app_expected_owner($data,$actor);
        $newsId=$id($data['id']??null);$expected=$version($data['version']??null);
        [$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_submit','news_editor']);
        try{
            $q=$pdo->prepare('SELECT * FROM eoffice_siya_news WHERE id=? FOR UPDATE');$q->execute([$newsId]);$news=$q->fetch();
            if(!$news)throw new AppSiyaNewsError('ไม่พบข่าว',404);
            if(!app_siya_news_can_trash($news,$current))throw new AppSiyaNewsError('ไม่มีสิทธิ์ลบหรือกู้คืนข่าวนี้',403);
            $checkVersion($news,$expected);
            if(($action==='trash'&&$news['status']==='deleted')||($action==='restore'&&$news['status']!=='deleted'))throw new AppSiyaNewsError('สถานะข่าวเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด',409);
            $from=$news['status'];$target=$action==='trash'?'deleted':(in_array($news['deleted_from_status'],['draft','changes_requested'],true)?$news['deleted_from_status']:'review');
            $meta=['deleted_at'=>$action==='trash'?date('Y-m-d H:i:s'):null,'deleted_by'=>$action==='trash'?(int)$current['User_Id']:null,'deleted_from_status'=>$action==='trash'?$from:null];
            $pdo->prepare('UPDATE eoffice_siya_news SET deleted_at=?,deleted_by=?,deleted_from_status=? WHERE id=?')->execute([$meta['deleted_at'],$meta['deleted_by'],$meta['deleted_from_status'],$newsId]);
            $fresh=app_siya_news_next($pdo,array_merge($news,$meta),[],(int)$current['User_Id'],['status'=>$target,'clear_approval'=>true,'clear_reviewer'=>true,'clear_reviewed'=>true]);
            app_audit('siya_news.'.$action,$current,$newsId,['from'=>$from,'to'=>$target]);$finish($pdo);
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        app_json(['status'=>'success','version'=>(int)$fresh['version'],'status_value'=>$fresh['status']]);
    }
    if($action==='create'){
        $values=$fields($data);[$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_submit']);
        $q=$pdo->prepare("INSERT INTO eoffice_siya_news(owner_id,title,event_date,location,department,body,status) VALUES(?,?,?,?,?,?,'draft')");$q->execute([(int)$current['User_Id'],$values['title'],$values['event_date'],$values['location'],$values['department'],$values['body']]);$newsId=(int)$pdo->lastInsertId();
        $q=$pdo->prepare('SELECT * FROM eoffice_siya_news WHERE id=?');$q->execute([$newsId]);$news=$q->fetch();app_siya_news_snapshot($pdo,$news,(int)$current['User_Id']);app_audit('siya_news.create',$current,$newsId);$finish($pdo);
        app_json(['status'=>'success','id'=>$newsId,'version'=>1]);
    }
    if($action==='save'){
        $newsId=$id($data['id']??null);$expected=$version($data['version']??null);$values=$fields($data);
        [$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_submit','news_editor']);
        try{$news=app_siya_news_editable($pdo,$newsId,$current,true);$checkVersion($news,$expected);$options=[];
            if($news['status']==='approved')$options=['status'=>'review','review_note'=>null,'clear_reviewer'=>true,'clear_reviewed'=>true,'clear_approval'=>true];
            $fresh=app_siya_news_next($pdo,$news,$values,(int)$current['User_Id'],$options);app_audit('siya_news.update',$current,$newsId);$finish($pdo);
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        app_json(['status'=>'success','version'=>(int)$fresh['version'],'status_value'=>$fresh['status']]);
    }
    if($action==='submit'){
        if(!app_can($actor,'news_submit'))app_fail('Admin ต้องมอบสิทธิ์ผู้ส่งข่าวก่อน',403);
        $newsId=$id($data['id']??null);$expected=$version($data['version']??null);
        [$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_submit']);
        try{$news=app_siya_news_editable($pdo,$newsId,$current,true);$checkVersion($news,$expected);
            if((int)$news['owner_id']!==(int)$current['User_Id']||!in_array($news['status'],['draft','changes_requested'],true))throw new AppSiyaNewsError('สถานะข่าวนี้ไม่สามารถส่งตรวจได้',409);
            if(trim($news['title'])===''||trim($news['body'])==='')throw new AppSiyaNewsError('กรุณากรอกหัวข้อและเนื้อหาข่าวก่อนส่งตรวจ');
            $fresh=app_siya_news_next($pdo,$news,[],(int)$current['User_Id'],['status'=>'review','review_note'=>null,'reviewer_id'=>null,'clear_reviewed'=>true,'submitted'=>true,'clear_approval'=>true]);app_audit('siya_news.submit',$current,$newsId);$finish($pdo);
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        app_json(['status'=>'success','version'=>(int)$fresh['version'],'status_value'=>$fresh['status']]);
    }
    if(in_array($action,['return','approve'],true)){
        if(!app_can($actor,'news_editor'))app_fail('ไม่มีสิทธิ์ตรวจข่าว',403);
        $newsId=$id($data['id']??null);$expected=$version($data['version']??null);$note=app_siya_news_text($data,'review_note',5000,$action==='return');
        [$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_editor']);
        try{$q=$pdo->prepare('SELECT * FROM eoffice_siya_news WHERE id=? FOR UPDATE');$q->execute([$newsId]);$news=$q->fetch();if(!$news)throw new AppSiyaNewsError('ไม่พบข่าว',404);$checkVersion($news,$expected);
            if($news['status']!=='review')throw new AppSiyaNewsError('ข่าวนี้ไม่ได้อยู่ในขั้นตอนตรวจคำ',409);
            if($action==='return')$fresh=app_siya_news_next($pdo,$news,[],(int)$current['User_Id'],['status'=>'changes_requested','review_note'=>$note,'reviewer_id'=>(int)$current['User_Id'],'reviewed'=>true]);
            else{if(trim($news['title'])===''||trim($news['body'])==='')throw new AppSiyaNewsError('กรุณากรอกหัวข้อและเนื้อหาข่าวก่อนผ่านตรวจ');$fresh=app_siya_news_next($pdo,$news,[],(int)$current['User_Id'],['status'=>'approved','review_note'=>$note,'reviewer_id'=>(int)$current['User_Id'],'reviewed'=>true]);$pdo->prepare('UPDATE eoffice_siya_news SET approved_version=? WHERE id=?')->execute([(int)$fresh['version'],$newsId]);}
            app_audit('siya_news.review',$current,$newsId,['action'=>$action]);$finish($pdo);
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        app_json(['status'=>'success','version'=>(int)$fresh['version'],'status_value'=>$fresh['status']]);
    }
    if($action==='images_update'){
        $newsId=$id($data['id']??null);$expected=$version($data['version']??null);$images=$data['images']??null;
        if(!is_array($images)||!array_is_list($images)||count($images)>10)app_fail('รายการภาพไม่ถูกต้อง');
        [$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_submit','news_editor']);
        try{$news=app_siya_news_editable($pdo,$newsId,$current,true);$checkVersion($news,$expected);$q=$pdo->prepare('SELECT id FROM eoffice_siya_news_images WHERE news_id=? AND is_removed=0 ORDER BY sort_order,id');$q->execute([$newsId]);$existing=array_column($q->fetchAll(),'id');$seen=[];
            if(count($images)!==count($existing))throw new AppSiyaNewsError('รายการภาพเปลี่ยนแล้ว กรุณาโหลดข่าวใหม่',409);
            $save=$pdo->prepare('UPDATE eoffice_siya_news_images SET caption=?,credit=?,sort_order=? WHERE id=? AND news_id=? AND is_removed=0');
            foreach($images as $index=>$image){if(!is_array($image)||!preg_match('/^[a-f0-9]{32}$/D',$image['id']??'')||!in_array($image['id'],$existing,true)||isset($seen[$image['id']]))throw new AppSiyaNewsError('รายการภาพไม่ตรงกับข่าว',409);$seen[$image['id']]=true;
                $caption=app_siya_news_text($image,'caption',500);$credit=app_siya_news_text($image,'credit',255);$save->execute([$caption,$credit,$index,$image['id'],$newsId]);}
            $options=[];if($news['status']==='approved')$options=['status'=>'review','review_note'=>null,'clear_reviewer'=>true,'clear_reviewed'=>true,'clear_approval'=>true];
            $fresh=app_siya_news_next($pdo,$news,[],(int)$current['User_Id'],$options);app_audit('siya_news.image',$current,$newsId,['action'=>'metadata','count'=>count($images)]);$finish($pdo);
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        app_json(['status'=>'success','version'=>(int)$fresh['version'],'status_value'=>$fresh['status']]);
    }
    if($action==='image_remove'){
        $newsId=$id($data['id']??null);$expected=$version($data['version']??null);$imageId=$data['image_id']??'';
        if(!is_string($imageId)||!preg_match('/^[a-f0-9]{32}$/D',$imageId))app_fail('รหัสภาพไม่ถูกต้อง');
        [$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_submit','news_editor']);
        try{$news=app_siya_news_editable($pdo,$newsId,$current,true);$checkVersion($news,$expected);$q=$pdo->prepare('UPDATE eoffice_siya_news_images SET is_removed=1 WHERE id=? AND news_id=? AND is_removed=0');$q->execute([$imageId,$newsId]);if(!$q->rowCount())throw new AppSiyaNewsError('ไม่พบภาพนี้ในข่าว',404);
            $options=[];if($news['status']==='approved')$options=['status'=>'review','review_note'=>null,'clear_reviewer'=>true,'clear_reviewed'=>true,'clear_approval'=>true];
            $fresh=app_siya_news_next($pdo,$news,[],(int)$current['User_Id'],$options);app_audit('siya_news.image',$current,$newsId,['action'=>'remove']);$finish($pdo);
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        app_json(['status'=>'success','version'=>(int)$fresh['version'],'status_value'=>$fresh['status']]);
    }
    if($action==='used'){
        if(!app_can($actor,'news_producer'))app_fail('ไม่มีสิทธิ์จัดทำวารสาร',403);
        $newsId=$id($data['id']??null);[$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_producer']);
        try{$q=$pdo->prepare("SELECT id FROM eoffice_siya_news WHERE id=? AND status='approved' FOR UPDATE");$q->execute([$newsId]);if(!$q->fetchColumn())throw new AppSiyaNewsError('ไม่พบข่าวที่ผ่านตรวจแล้ว',404);$pdo->prepare('UPDATE eoffice_siya_news SET used_at=COALESCE(used_at,NOW()),used_by=COALESCE(used_by,?) WHERE id=?')->execute([(int)$current['User_Id'],$newsId]);app_audit('siya_news.used',$current,$newsId);$finish($pdo);}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        app_json(['status'=>'success']);
    }
    app_fail('ไม่รองรับรายการนี้');
}catch(AppSiyaNewsError $e){if($pdo->inTransaction())$pdo->rollBack();app_fail($e->getMessage(),$e->status);}
catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
