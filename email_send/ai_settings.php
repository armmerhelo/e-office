<?php
require_once __DIR__.'/../config/order-emails.php';
app_method('GET','POST');$actor=app_admin();
function order_settings_public(): array {
    $row=app_order_settings();$ready=true;try{app_order_secret_key();}catch(AppOrderAIException $e){$ready=false;}
    $configured=$row['api_key_cipher']!==null?strlen(base64_decode($row['api_key_cipher'],true)?:'')>28:app_env('GEMINI_API_KEY')!=='';
    return ['enabled'=>(bool)$row['enabled'],'activated_at'=>$row['activated_at'],'worker_at'=>$row['worker_at'],
        'model'=>$row['model']??app_env('GEMINI_MODEL','gemini-2.5-flash'),'key_configured'=>$configured,
        'key_source'=>$row['api_key_cipher']!==null?'admin':'server','encryption_ready'=>$ready,'updated_at'=>$row['updated_at']];
}
try{
    if($_SERVER['REQUEST_METHOD']==='GET')app_json(['status'=>'success','settings'=>order_settings_public()]);
    $input=app_input();$action=app_text($input,'action',30,true);
    if(in_array($action,['models','test'],true)){
        $key=app_text($input,'api_key',512);$row=app_order_settings();
        $config=$key!==''?['key'=>$key,'model'=>$row['model']??app_env('GEMINI_MODEL','gemini-2.5-flash')]:app_order_ai_config($row);
        if($action==='models')app_json(['status'=>'success','models'=>app_order_models($config['key'])]);
        if(isset($input['model']))$config['model']=app_order_model(app_text($input,'model',150,true));
        app_order_ai_test($config);app_json(['status'=>'success','message'=>'เชื่อมต่อและทดสอบโมเดลสำเร็จ']);
    }
    if($action!=='save')app_fail('คำสั่งไม่ถูกต้อง');
    $key=app_text($input,'api_key',512);$clear=$input['clear_key']??false;$enabled=$input['enabled']??null;
    if(!is_bool($clear)||!is_bool($enabled))app_fail('ข้อมูลไม่ถูกต้อง');
    $model=app_order_model(app_text($input,'model',150,true));
    if($key!==''&&preg_match('/[\x00-\x20\x7f]/',$key))app_fail('API key ไม่ถูกต้อง');
    if($clear&&$key!=='')app_fail('เลือกเปลี่ยนหรือล้าง key อย่างใดอย่างหนึ่ง');
    $cipher=$key!==''||$clear?app_order_encrypt($clear?'':$key):null;
    $before=app_order_settings();
    $config=$key!==''||$clear?['key'=>$clear?'':$key,'model'=>$model]:($enabled?app_order_ai_config($before):['key'=>'','model'=>$model]);$config['model']=$model;
    if($enabled&&!app_settings()['mock']&&$config['key']==='')app_fail('กรุณาตั้งค่า API key ก่อนเปิดใช้งาน');
    // Validate the candidate before storing it. No actual documents are sent.
    if(($enabled||$key!=='')&&!app_settings()['mock'])app_order_ai_test($config);
    $pdo=app_pdo();$pdo->beginTransaction();
    try{
        $latest=$pdo->query('SELECT * FROM eoffice_order_settings WHERE id=1 FOR UPDATE')->fetch();
        if($latest['api_key_cipher']!==$before['api_key_cipher']||$latest['model']!==$before['model']){$pdo->rollBack();app_fail('การตั้งค่าถูกแก้ไขระหว่างทดสอบ กรุณาโหลดใหม่',409);}
        $current=app_user(true,true);if($current['User_Status']!=='Admin'){$pdo->rollBack();app_fail('เฉพาะ Admin สูงสุดเท่านั้น',403);}
        $pdo->prepare('UPDATE eoffice_order_settings SET enabled=?,activated_at=IF(?=1,COALESCE(activated_at,NOW()),activated_at),model=?,updated_by=?,updated_at=NOW() WHERE id=1')->execute([(int)$enabled,(int)$enabled,$model,$actor['User_Id']]);
        if($cipher!==null)$pdo->prepare('UPDATE eoffice_order_settings SET api_key_cipher=? WHERE id=1')->execute([$cipher]);
        app_order_audit('settings_saved',(int)$actor['User_Id']);$pdo->commit();
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
    app_json(['status'=>'success','message'=>'บันทึกการตั้งค่าแล้ว','settings'=>order_settings_public()]);
}catch(AppOrderAIException $e){app_json(['status'=>'error','message'=>'ตั้งค่า AI ไม่สำเร็จ','code'=>$e->reason],400);}
