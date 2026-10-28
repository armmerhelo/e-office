<?php
require_once __DIR__.'/../config/order-emails.php';
require_once __DIR__.'/settings-actions.php';
require_once __DIR__.'/keyring-actions.php';
app_method('GET','POST');$actor=app_admin();
function order_settings_public(): array {
    $row=app_order_settings();$ready=true;try{app_order_secret_key();}catch(AppOrderAIException $e){$ready=false;}
    $configured=!empty($row['active_key_id'])||($row['api_key_cipher']!==null?strlen(base64_decode($row['api_key_cipher'],true)?:'')>28:app_env('GEMINI_API_KEY')!=='');
    $usable=$configured;try{if($configured)app_order_ai_config($row);}catch(AppOrderAIException $e){$usable=false;}
    $diagnostics=app_order_diagnostics($row);
    $aiAt=$usable?order_tested_at('ai_test',order_ai_fingerprint(app_order_ai_config($row))):null;
    try{$smtpAt=order_tested_at('smtp_test',order_smtp_fingerprint(app_order_smtp($row)));}catch(AppOrderAIException $e){$smtpAt=null;}
    foreach(['ai'=>$aiAt,'smtp'=>$smtpAt] as $kind=>$at){$diagnostics[$kind.'_tested']=$at!==null;$diagnostics[$kind.'_tested_at']=$at;$diagnostics[$kind.'_test_expires_at']=$at!==null?date(DATE_ATOM,strtotime($at)+86400):null;}
    foreach($diagnostics['events'] as &$event)unset($event['details']['fingerprint']);unset($event);
    return ['enabled'=>(bool)$row['enabled'],'activated_at'=>$row['activated_at'],'worker_at'=>$row['worker_at'],
        'key_usable'=>$usable,'options'=>app_order_options($row),'diagnostics'=>$diagnostics,'smtp_password_configured'=>!empty($row['smtp_password_cipher']),
        'keyring'=>app_order_keyring_public($row),
        'model'=>$row['model']??app_env('GEMINI_MODEL','gemini-2.5-flash'),'key_configured'=>$configured,
        'key_source'=>$row['api_key_cipher']!==null?'admin':'server','encryption_ready'=>$ready,'updated_at'=>$row['updated_at'],'revision'=>(int)$row['revision']];
}
try{
    if($_SERVER['REQUEST_METHOD']==='GET')app_json(['status'=>'success','settings'=>order_settings_public()]);
    $input=app_input();$action=app_text($input,'action',30,true);
    if($action==='save_template')order_save_template($input,$actor);
    order_keyring_action($action,$input,$actor);
    order_extended_action($action,$input,$actor);
    if(in_array($action,['models','test'],true)){
        $key=app_text($input,'api_key',512);$row=app_order_settings();
        $config=$key!==''?['key'=>$key,'model'=>$row['model']??app_env('GEMINI_MODEL','gemini-2.5-flash')]:app_order_ai_config($row);
        if($action==='models')app_json(['status'=>'success','models'=>app_order_models($config['key'],$config['key_id']??null)]);
        if(isset($input['model']))$config['model']=app_order_model(app_text($input,'model',150,true));
        $started=microtime(true);
        try{app_order_ai_test($config);app_order_event('ai_test',['success'=>true,'model'=>$config['model'],'fingerprint'=>order_ai_fingerprint($config),'duration_ms'=>(int)((microtime(true)-$started)*1000)],(int)$actor['User_Id']);}
        catch(AppOrderAIException $e){app_order_event('ai_test',['success'=>false,'model'=>$config['model'],'code'=>$e->reason],(int)$actor['User_Id']);throw $e;}
        app_json(['status'=>'success','message'=>'เชื่อมต่อและทดสอบโมเดลสำเร็จ','tested_at'=>date(DATE_ATOM),'expires_at'=>date(DATE_ATOM,time()+86400)]);
    }
    if($action!=='save')app_fail('คำสั่งไม่ถูกต้อง');
    $key=app_text($input,'api_key',512);$clear=$input['clear_key']??false;$enabled=$input['enabled']??null;
    if(!is_bool($clear)||!is_bool($enabled))app_fail('ข้อมูลไม่ถูกต้อง');
    $model=app_order_model(app_text($input,'model',150,true));
    $revision=$input['revision']??null;
    if(!is_int($revision)||$revision<0)app_fail('กรุณาโหลดการตั้งค่าใหม่ก่อนบันทึก',409);
    if($key!==''&&preg_match('/[\x00-\x20\x7f]/',$key))app_fail('API key ไม่ถูกต้อง');
    if($clear&&$key!=='')app_fail('เลือกเปลี่ยนหรือล้าง key อย่างใดอย่างหนึ่ง');
    $cipher=$key!==''||$clear?app_order_encrypt($clear?'':$key):null;
    $before=app_order_settings();
    if(isset($input['options'])&&!is_array($input['options']))app_fail('ข้อมูลตัวเลือกไม่ถูกต้อง');
    $oldOptions=app_order_options($before);$options=app_order_validate_options($input['options']??[],$oldOptions);
    $smtpPassword=$options['smtp_source']==='admin'?app_text($input,'smtp_password',512):'';$smtpCipher=$smtpPassword!==''?app_order_encrypt($smtpPassword):null;
    $smtp=[];
    if($enabled&&!$options['analysis_only'])$smtp=app_order_smtp($before,$options,$smtpPassword!==''?$smtpPassword:null);
    if((int)$before['revision']!==$revision)app_fail('การตั้งค่าถูกแก้ไขแล้ว กรุณาโหลดใหม่',409);
    $config=$key!==''||$clear?['key'=>$clear?'':$key,'model'=>$model]:($enabled?app_order_ai_config($before):['key'=>'','model'=>$model]);$config['model']=$model;
    if($enabled&&!app_settings()['mock']&&$config['key']==='')app_fail('กรุณาตั้งค่า API key ก่อนเปิดใช้งาน');
    if($clear&&$enabled)app_fail('ต้องหยุดส่งก่อนล้าง API key');
    if($enabled&&!$options['analysis_only']&&!app_settings()['mock']){
        if(!app_order_smtp_ready($smtp))app_fail('กรุณาตั้งค่า SMTP ให้ครบก่อนเปิดส่ง');
        if(!order_smtp_tested($smtp))app_fail('กรุณาส่งอีเมลทดสอบด้วย SMTP ชุดนี้ให้ผ่านก่อนเปิดส่ง (ผลทดสอบมีอายุ 24 ชั่วโมง)');
        if(!$before['enabled']&&(!isset($before['worker_at'])||time()-strtotime($before['worker_at'])>900))app_fail('ยังไม่พบ Cron ที่ทำงานภายใน 15 นาที กรุณาตรวจ Cron ก่อนเปิดส่ง');
    }
    // Validate the candidate before storing it. No actual documents are sent.
    if(($enabled||$key!=='')&&!app_settings()['mock'])app_order_ai_test($config);
    $pdo=app_pdo();$pdo->beginTransaction();
    try{
        $latest=$pdo->query('SELECT * FROM eoffice_order_settings WHERE id=1 FOR UPDATE')->fetch();
        if((int)$latest['revision']!==$revision||$latest['api_key_cipher']!==$before['api_key_cipher']||$latest['model']!==$before['model']||$latest['enabled']!==$before['enabled']){$pdo->rollBack();app_fail('การตั้งค่าถูกแก้ไขระหว่างทดสอบ กรุณาโหลดใหม่',409);}
        $current=app_user(true,true);if($current['User_Status']!=='Admin'){$pdo->rollBack();app_fail('เฉพาะ Admin สูงสุดเท่านั้น',403);}
        $pdo->prepare('UPDATE eoffice_order_settings SET enabled=?,activated_at=IF(?=1,COALESCE(activated_at,NOW()),activated_at),model=?,updated_by=?,updated_at=NOW(),revision=revision+1 WHERE id=1')->execute([(int)$enabled,(int)$enabled,$model,$actor['User_Id']]);
        if($cipher!==null)$pdo->prepare('UPDATE eoffice_order_settings SET api_key_cipher=? WHERE id=1')->execute([$cipher]);
        if($cipher!==null){
            $newId=$clear?null:app_order_key_insert($cipher,'Key ใหม่ '.date('Y-m-d H:i'),(int)$actor['User_Id']);
            $pdo->prepare('UPDATE eoffice_order_settings SET active_key_id=? WHERE id=1')->execute([$newId]);
            if($newId!==null){$config['key_id']=$newId;$pdo->prepare('UPDATE eoffice_order_api_keys SET tested_at=?,tested_model=? WHERE id=?')->execute([app_settings()['mock']?null:date('Y-m-d H:i:s'),$model,$newId]);}
        }
        $pdo->prepare('UPDATE eoffice_order_settings SET options_json=? WHERE id=1')->execute([json_encode($options,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
        if($smtpCipher!==null)$pdo->prepare('UPDATE eoffice_order_settings SET smtp_password_cipher=? WHERE id=1')->execute([$smtpCipher]);
        $changes=[];foreach($options as $k=>$v)if($v!==$oldOptions[$k])$changes[$k]=['before'=>$oldOptions[$k],'after'=>$v];
        if($before['model']!==$model)$changes['model']=['before'=>$before['model'],'after'=>$model];
        if((bool)$before['enabled']!==$enabled)$changes['enabled']=['before'=>(bool)$before['enabled'],'after'=>$enabled];
        if($cipher!==null)$changes['api_key']=$clear?'cleared':'changed';if($smtpCipher!==null)$changes['smtp_password']='changed';
        app_order_event('settings_saved',['changes'=>$changes],(int)$actor['User_Id']);
        if(($enabled||$key!=='')&&!app_settings()['mock'])app_order_event('ai_test',['success'=>true,'model'=>$config['model'],'fingerprint'=>order_ai_fingerprint($config)],(int)$actor['User_Id']);
        // Reconcile every policy-held job against the destination policy, even
        // when its stored reason came from an earlier intermediate mode.
        $hold=$options['analysis_only']?'analysis_only':($options['require_approval']?'approval_required':null);
        if($hold!==null)$pdo->prepare("UPDATE eoffice_order_jobs SET error_code=? WHERE status='awaiting_approval' AND error_code IN ('analysis_only','approval_required')")->execute([$hold]);
        else $pdo->exec("UPDATE eoffice_order_jobs SET status='queued',error_code=NULL WHERE status='awaiting_approval' AND error_code IN ('analysis_only','approval_required')");
        app_order_audit('settings_saved',(int)$actor['User_Id']);$pdo->commit();
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
    app_json(['status'=>'success','message'=>'บันทึกการตั้งค่าแล้ว','settings'=>order_settings_public()]);
}catch(AppOrderAIException $e){app_json(['status'=>'error','message'=>'ตั้งค่า AI ไม่สำเร็จ','code'=>$e->reason],400);}
