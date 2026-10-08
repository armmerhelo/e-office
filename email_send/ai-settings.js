(() => {
    const U=OrderUI,el=id=>document.getElementById(id);let busy=false;
    function render(settings){el('enabled').checked=settings.enabled;el('model').value=settings.model;el('summary').textContent=`API key: ${settings.key_configured?'ตั้งค่าแล้ว (ปิดบังค่า)':'ยังไม่มี'} · แหล่งที่มา: ${settings.key_source==='admin'?'หน้า Admin':'เซิร์ฟเวอร์'}\nกุญแจเข้ารหัส: ${settings.encryption_ready?'พร้อม':'ยังไม่พร้อม'}\nเปิดใช้ครั้งแรก: ${settings.activated_at||'—'}\nCron ล่าสุด: ${settings.worker_at||'ยังไม่พบการทำงาน'}`;}
    async function run(action){
        if(busy)return;busy=true;document.querySelectorAll('button').forEach(button=>button.disabled=true);U.message('message','กำลังดำเนินการ…');
        try{
            const data={action,api_key:el('api-key').value,model:el('model').value};
            if(action==='save'){data.enabled=el('enabled').checked;data.clear_key=el('clear-key').checked;}
            const result=await U.request('ai_settings.php',data);
            if(result.models){el('models').replaceChildren();for(const model of result.models){const option=document.createElement('option');option.value=model.id;option.label=model.label;el('models').append(option);}U.message('message',`โหลด ${result.models.length} โมเดลแล้ว เลือกจากช่อง AI model`);}
            else U.message('message',result.message);
            if(result.settings){render(result.settings);el('api-key').value='';el('clear-key').checked=false;}
        }catch(error){U.message('message',error.message,true);}finally{busy=false;document.querySelectorAll('button').forEach(button=>button.disabled=false);}
    }
    el('settings-form').onsubmit=event=>{event.preventDefault();run('save');};el('load-models').onclick=()=>run('models');el('test-ai').onclick=()=>run('test');
    U.request('ai_settings.php').then(result=>render(result.settings)).catch(error=>{U.message('message',error.message,true);el('settings-form').hidden=true;});
})();
