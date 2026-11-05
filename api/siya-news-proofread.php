<?php
require_once __DIR__.'/../config/siya-news.php';
require_once __DIR__.'/../config/siya-news-proofread.php';
app_method('POST');$actor=app_user();
if(!app_siya_news_can_access($actor)||(!app_can($actor,'news_submit')&&!app_can($actor,'news_editor')))app_fail('ไม่มีสิทธิ์ตรวจคำข่าว',403);
$data=app_input();
if(!array_key_exists('_expected_owner',$data))app_fail('กรุณาโหลดหน้าใหม่ก่อนตรวจคำ',409);
app_expected_owner($data,$actor);
if(($data['consent']??false)!==true)app_fail('กรุณายืนยันการส่งข้อความไปช่วยตรวจคำ');
try{
    if(($data['id']??null)!==null){
        $id=filter_var($data['id'],FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]);if(!$id)app_fail('รหัสข่าวไม่ถูกต้อง');
        app_siya_news_editable(app_pdo(),(int)$id,$actor);
    }elseif(!app_can($actor,'news_submit'))app_fail('ไม่มีสิทธิ์สร้างข่าว',403);
    $source=['title'=>app_text($data,'title',255),'body'=>app_text($data,'body',30000)];
    if($source['title']===''&&$source['body']==='')app_fail('กรุณากรอกข้อความก่อนตรวจคำ');
    // Atomic per-account cooldown, outside the public root. No news text is stored here.
    $handle=fopen(app_siya_news_root().'/proofread-'.(int)$actor['User_Id'].'.lock','c+');
    if(!$handle||!flock($handle,LOCK_EX))throw new RuntimeException('Proofread throttle unavailable');
    try{
        $stamp=stream_get_contents($handle);if($stamp===false)throw new RuntimeException('Proofread throttle read failed');$last=(int)$stamp;
        if(time()-$last<20){flock($handle,LOCK_UN);fclose($handle);$handle=null;app_fail('กรุณารอ 20 วินาทีก่อนตรวจคำอีกครั้ง',429);}
        $stamp=(string)time();
        if(!rewind($handle)||!ftruncate($handle,0)||fwrite($handle,$stamp)!==strlen($stamp)||!fflush($handle))throw new RuntimeException('Proofread throttle write failed');
    }finally{if(is_resource($handle)){flock($handle,LOCK_UN);fclose($handle);}}
    $items=app_siya_news_proofread($source);
    app_json(['status'=>'success','suggestions'=>$items,'mock'=>(bool)app_settings()['mock']]);
}catch(AppSiyaNewsError $e){app_fail($e->getMessage(),$e->status);}
catch(Throwable $e){app_fail('ยังตรวจคำไม่ได้ กรุณาติดต่อผู้ดูแลเพื่อตรวจการตั้งค่า AI หรือทดลองใหม่ภายหลัง ข้อความของคุณยังไม่ถูกแก้ไข',503);}
