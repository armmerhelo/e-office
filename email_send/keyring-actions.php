<?php
function order_keyring_action(string $action,array $input,array $actor): void {
    if(!in_array($action,['key_add','key_test','key_activate','key_update','key_delete','key_server'],true))return;
    $before=app_order_settings();$revision=$input['revision']??null;
    if(!is_int($revision)||(int)$before['revision']!==$revision)app_fail('การตั้งค่าถูกแก้ไขแล้ว กรุณาโหลดค่าล่าสุด',409);
    $id=$input['key_id']??0;if(!is_int($id)||$id<0)app_fail('รหัส Key ไม่ถูกต้อง');
    // Server-mode identity is fixed; a stray client vault ID must never receive
    // test metadata from the server credential.
    if($action==='key_server')$id=0;
    $entry=null;$config=null;$reason=null;$started=microtime(true);
    if(!in_array($action,['key_add','key_server'],true)){
        $entry=app_order_key($id);if(!$entry||$entry['deleted_at']!==null)app_fail('ไม่พบ Key นี้',404);
    }
    $label='';$days=90;$cipher=null;
    if(in_array($action,['key_add','key_update'],true)){
        $label=app_text($input,'label',100,true);$days=$input['remind_days']??90;
        if(!is_int($days)||$days<1||$days>730)app_fail('กำหนดรอบเตือน 1–730 วัน');
    }
    if($action==='key_add'){
        $key=app_text($input,'api_key',512,true);if(preg_match('/[\x00-\x20\x7f]/',$key))app_fail('API key ไม่ถูกต้อง');$cipher=app_order_encrypt($key);
    }
    if(in_array($action,['key_activate','key_server','key_delete'],true)&&($input['confirmed']??false)!==true)app_fail('กรุณายืนยันการทำรายการ');
    if($action==='key_update'&&!is_bool($input['key_enabled']??null))app_fail('สถานะ Key ไม่ถูกต้อง');
    if($entry&&(int)$before['active_key_id']===$id&&($action==='key_delete'||($action==='key_update'&&!$input['key_enabled'])))app_fail('กรุณาสลับไป Key อื่นหรือหยุดใช้ Key ปัจจุบันก่อนพักใช้/ลบ',409);
    if(in_array($action,['key_test','key_activate','key_server'],true)){
        $model=app_order_model(app_text($input,'model',150,true));
        $config=$action==='key_server'?['key'=>(string)app_env('GEMINI_API_KEY'),'model'=>$model,'key_id'=>0]:app_order_key_config($entry,$model);
        if($config['key']==='')app_fail('เซิร์ฟเวอร์ยังไม่มี GEMINI_API_KEY');
        try{app_order_ai_test($config);}catch(AppOrderAIException $e){$reason=$e->reason;}
    }
    $pdo=app_pdo();$pdo->beginTransaction();
    try{
        $latest=$pdo->query('SELECT * FROM eoffice_order_settings WHERE id=1 FOR UPDATE')->fetch();
        if((int)$latest['revision']!==$revision){$pdo->rollBack();app_fail('การตั้งค่าเปลี่ยนระหว่างทดสอบ กรุณาโหลดใหม่',409);}
        $current=app_user(true,true);if($current['User_Status']!=='Admin'||(int)$current['User_Id']!==(int)$actor['User_Id']){$pdo->rollBack();app_fail('สิทธิ์หรือบัญชีเปลี่ยน กรุณาเข้าสู่ระบบใหม่',403);}
        if($entry){$locked=app_order_key($id,true);if(!$locked||$locked['deleted_at']!==null||$locked['cipher']!==$entry['cipher'])throw new RuntimeException('Key changed');}
        if($action==='key_add'){
            if((int)$pdo->query('SELECT COUNT(*) FROM eoffice_order_api_keys WHERE deleted_at IS NULL')->fetchColumn()>=50){$pdo->rollBack();app_fail('คลังรองรับ 50 Key กรุณาลบรายการที่เลิกใช้ก่อนเพิ่ม');}
            $id=app_order_key_insert($cipher,$label,(int)$actor['User_Id'],$days);
        }
        if($action==='key_update')$pdo->prepare('UPDATE eoffice_order_api_keys SET label=?,remind_days=?,enabled=? WHERE id=?')->execute([$label,$days,(int)$input['key_enabled'],$id]);
        if($action==='key_delete')$pdo->prepare('UPDATE eoffice_order_api_keys SET cipher=NULL,enabled=0,deleted_at=NOW() WHERE id=?')->execute([$id]);
        if($config!==null){
            if($id>0)$pdo->prepare('UPDATE eoffice_order_api_keys SET tested_at=NOW(),tested_model=?,test_code=? WHERE id=?')->execute([$config['model'],$reason,$id]);
            app_order_event('ai_test',['key_id'=>$config['key_id'],'success'=>$reason===null,'model'=>$config['model'],'code'=>$reason,'fingerprint'=>$reason===null?order_ai_fingerprint($config):null,'duration_ms'=>(int)((microtime(true)-$started)*1000)],(int)$actor['User_Id']);
        }
        if($reason===null&&in_array($action,['key_activate','key_server'],true)){
            $pdo->prepare('UPDATE eoffice_order_settings SET active_key_id=?,api_key_cipher=?,model=? WHERE id=1')->execute([$action==='key_server'?null:$id,$action==='key_server'?null:$entry['cipher'],$config['model']]);
        }
        $pdo->prepare('UPDATE eoffice_order_settings SET revision=revision+1,updated_by=?,updated_at=NOW() WHERE id=1')->execute([$actor['User_Id']]);
        $ref=$entry['reference']??($action==='key_server'?'server':app_order_key($id)['reference']);
        $details=['reference'=>$ref,'label'=>$label!==''?$label:($entry['label']??'เซิร์ฟเวอร์'),'success'=>$reason===null,'code'=>$reason];
        if($action==='key_update')$details['changes']=['key_reference'=>['before'=>$ref,'after'=>$ref],'key_label'=>['before'=>$entry['label'],'after'=>$label],'key_enabled'=>['before'=>(bool)$entry['enabled'],'after'=>$input['key_enabled']],'remind_days'=>['before'=>(int)$entry['remind_days'],'after'=>$days]];
        app_order_event($action,$details,(int)$actor['User_Id']);
        app_audit('email.'.$action,$current,$id,['reference'=>$ref],$reason===null?'success':'failure');
        $pdo->commit();
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
    if($reason!==null)app_json(['status'=>'error','code'=>$reason,'message'=>'ทดสอบ Key ไม่ผ่าน ระบบยังใช้ Key เดิม'],400);
    app_json(['status'=>'success','message'=>app_settings()['mock']?'บันทึกแล้ว (โหมดจำลอง ไม่เรียก Gemini จริง)':'จัดการ API Key เรียบร้อยแล้ว','settings'=>order_settings_public()]);
}
