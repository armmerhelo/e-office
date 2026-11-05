<?php
require_once __DIR__.'/../config/siya-news-studio.php';
require_once __DIR__.'/../config/siya-news-studio-schema.php';
app_method('GET','POST');
$actor=app_user();
if(!app_can($actor,'news_producer'))app_fail('Admin ต้องมอบสิทธิ์ผู้จัดทำวารสารก่อน',403);

$pdo=app_pdo();
$id=static function($value): int {$id=filter_var($value,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]);if(!$id)app_fail('รหัสชุดจัดหน้าไม่ถูกต้อง');return (int)$id;};
$version=static function($value): int {$v=filter_var($value,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]);if(!$v)app_fail('กรุณาโหลดชุดจัดหน้าใหม่ก่อนบันทึก');return (int)$v;};
$finish=static function(PDO $pdo): void {if($pdo->inTransaction())$pdo->commit();};

try{
    if($_SERVER['REQUEST_METHOD']==='GET'){
        $action=app_text($_GET,'action',20)?:'list';
        if($action==='list')app_json(['status'=>'success','data'=>app_siya_news_studio_layout_list($pdo,(int)$actor['User_Id'])]);
        if($action==='pool'){
            $ids=app_text($_GET,'ids',1000);$rows=[];
            if($ids!==''){
                $list=array_values(array_unique(array_filter(array_map('intval',explode(',',$ids)),static fn($id)=>$id>0)));
                if(count($list)>80)app_fail('จำนวนข่าวอ้างอิงเกินกำหนด');
                $rows=app_siya_news_studio_pool_by_ids($pdo,$list);
            }else $rows=app_siya_news_studio_pool($pdo,app_text($_GET,'q',100),100);
            app_json(['status'=>'success','data'=>$rows]);
        }
        if($action==='detail'){
            $layout=app_siya_news_studio_layout($pdo,$id($_GET['id']??null),$actor);
            $q=$pdo->prepare('SELECT v.version,v.created_at,u.User_Name actor_name FROM eoffice_siya_news_layout_revisions v LEFT JOIN t_user u ON u.User_Id=v.actor_id WHERE v.layout_id=? ORDER BY v.version DESC LIMIT 12');$q->execute([(int)$layout['id']]);
            app_json(['status'=>'success','data'=>[
                'id'=>(int)$layout['id'],'title'=>(string)$layout['title'],'version'=>(int)$layout['version'],
                'document'=>json_decode((string)$layout['document'],true,32,JSON_THROW_ON_ERROR),
                'updated_at'=>$layout['updated_at'],'history'=>$q->fetchAll()
            ]]);
        }
        app_fail('ไม่รองรับรายการนี้');
    }

    $data=app_input();
    if(!array_key_exists('_expected_owner',$data))app_fail('กรุณาโหลดหน้าใหม่ก่อนทำรายการ',409);
    app_expected_owner($data,$actor);
    $action=app_text($data,'action',20);
    $title=app_siya_news_studio_text($data['title']??'ชุดจัดหน้าใหม่',120,'title');
    if($title==='')$title='ชุดจัดหน้าใหม่';

    if($action==='create'){
        [$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_producer']);
        $q=$pdo->prepare('SELECT COUNT(*) FROM eoffice_siya_news_layouts WHERE owner_id=?');$q->execute([(int)$current['User_Id']]);
        if((int)$q->fetchColumn()>=50)throw new AppSiyaNewsError('สร้างชุดจัดหน้าได้สูงสุด 50 ชุด กรุณาลบชุดเก่าก่อน');
        $document=app_siya_news_studio_new_document($title);
        $pdo->prepare('INSERT INTO eoffice_siya_news_layouts(owner_id,title,document,version) VALUES(?,?,?,1)')
            ->execute([(int)$current['User_Id'],$title,json_encode($document,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
        $layout=['id'=>(int)$pdo->lastInsertId(),'title'=>$title,'document'=>json_encode($document,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),'version'=>1];
        app_siya_news_studio_snapshot($pdo,$layout,(int)$current['User_Id']);app_audit('siya_news.layout',$current,$layout['id'],['action'=>'create']);$finish($pdo);
        app_json(['status'=>'success','id'=>$layout['id'],'version'=>1,'title'=>$title,'document'=>$document]);
    }

    if($action==='save'){
        $layoutId=$id($data['id']??null);$expected=$version($data['version']??null);
        if(!is_array($data['document']??null))app_fail('ข้อมูลชุดจัดหน้าไม่ถูกต้อง');
        $document=app_siya_news_studio_document($data['document']);
        $encoded=json_encode($document,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
        if(strlen($encoded)>400000)throw new AppSiyaNewsError('ชุดจัดหน้ามีขนาดใหญ่เกินกำหนด');
        [$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_producer']);
        try{
            $layout=app_siya_news_studio_layout($pdo,$layoutId,$current,true);
            if((int)$layout['version']!==$expected)throw new AppSiyaNewsError('ชุดจัดหน้าถูกบันทึกจากที่อื่นแล้ว กรุณาโหลดข้อมูลล่าสุด',409);
            app_siya_news_studio_references($pdo,$document);
            $next=(int)$layout['version']+1;
            $pdo->prepare('UPDATE eoffice_siya_news_layouts SET title=?,document=?,version=? WHERE id=?')->execute([$title,$encoded,$next,$layoutId]);
            $fresh=array_merge($layout,['title'=>$title,'document'=>$encoded,'version'=>$next]);
            app_siya_news_studio_snapshot($pdo,$fresh,(int)$current['User_Id']);app_audit('siya_news.layout',$current,$layoutId,['action'=>'save']);$finish($pdo);
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        app_json(['status'=>'success','version'=>$next,'title'=>$title,'updated_at'=>date('Y-m-d H:i:s')]);
    }

    if($action==='restore'){
        $layoutId=$id($data['id']??null);$expected=$version($data['version']??null);$revision=$version($data['revision']??null);
        [$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_producer']);
        try{
            $layout=app_siya_news_studio_layout($pdo,$layoutId,$current,true);
            if((int)$layout['version']!==$expected)throw new AppSiyaNewsError('ชุดจัดหน้าถูกบันทึกจากที่อื่นแล้ว กรุณาโหลดข้อมูลล่าสุด',409);
            $q=$pdo->prepare('SELECT snapshot FROM eoffice_siya_news_layout_revisions WHERE layout_id=? AND version=?');$q->execute([$layoutId,$revision]);
            $snapshot=$q->fetchColumn();$snapshot=is_string($snapshot)?json_decode($snapshot,true,32,JSON_THROW_ON_ERROR):null;
            if(!is_array($snapshot)||!is_array($snapshot['document']??null))throw new AppSiyaNewsError('ไม่พบเวอร์ชันที่ต้องการย้อนกลับ',404);
            $document=app_siya_news_studio_document($snapshot['document']);
            app_siya_news_studio_references($pdo,$document);
            $restoredTitle=app_siya_news_studio_text($snapshot['title']??$layout['title'],120,'title')?:$layout['title'];
            $encoded=json_encode($document,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);$next=(int)$layout['version']+1;
            $pdo->prepare('UPDATE eoffice_siya_news_layouts SET title=?,document=?,version=? WHERE id=?')->execute([$restoredTitle,$encoded,$next,$layoutId]);
            $fresh=array_merge($layout,['title'=>$restoredTitle,'document'=>$encoded,'version'=>$next]);
            app_siya_news_studio_snapshot($pdo,$fresh,(int)$current['User_Id']);app_audit('siya_news.layout_restore',$current,$layoutId,['version'=>$revision]);$finish($pdo);
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        app_json(['status'=>'success','version'=>$next,'title'=>$restoredTitle,'document'=>$document]);
    }

    if($action==='delete'){
        $layoutId=$id($data['id']??null);$expected=$version($data['version']??null);
        [$pdo,$current]=app_siya_news_mutation_start(['User_Id'=>$actor['User_Id'],'User_Status'=>$actor['User_Status']],['news_producer']);
        try{
            $layout=app_siya_news_studio_layout($pdo,$layoutId,$current,true);
            if((int)$layout['version']!==$expected)throw new AppSiyaNewsError('ชุดจัดหน้าถูกบันทึกจากที่อื่นแล้ว กรุณาโหลดข้อมูลล่าสุด',409);
            app_audit('siya_news.layout_delete',$current,$layoutId);$pdo->prepare('DELETE FROM eoffice_siya_news_layouts WHERE id=?')->execute([$layoutId]);$finish($pdo);
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        app_json(['status'=>'success']);
    }

    app_fail('ไม่รองรับรายการนี้');
}catch(AppSiyaNewsError $e){if($pdo->inTransaction())$pdo->rollBack();app_fail($e->getMessage(),$e->status);}
catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();error_log('SIYA NEWS Studio failure ('.get_class($e).')');app_fail('บันทึกชุดจัดหน้าไม่สำเร็จ กรุณาลองใหม่',503);}
