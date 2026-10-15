window.OrderSettingsControls = (() => {
    const el=id=>document.getElementById(id), U=OrderUI;
    const fields=[...document.querySelectorAll('[data-option]')];
    document.querySelectorAll('[data-settings-section]').forEach(button=>button.addEventListener('click',()=>{
        const target=el(button.dataset.settingsSection);target.setAttribute('tabindex','-1');target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'smooth'});
    }));
    function values(){return Object.fromEntries(fields.map(f=>[f.id,f.type==='checkbox'?f.checked:f.type==='number'?Number(f.value):f.value.trim()]));}
    function dirty(saved){return Boolean(saved&&(el('smtp-password').value||JSON.stringify(values())!==JSON.stringify(Object.fromEntries(fields.map(f=>[f.id,saved.options[f.id]])))));}
    function render(saved,dateTime){
        for(const f of fields){if(f.type==='checkbox')f.checked=Boolean(saved.options[f.id]);else f.value=saved.options[f.id];}
        el('smtp-password').value='';el('smtp-password-state').textContent=saved.smtp_password_configured?'มีรหัสผ่านที่บันทึกแล้ว เว้นว่างเพื่อใช้ค่าเดิม':'ยังไม่มีรหัสผ่าน SMTP ที่บันทึกผ่าน Admin';
        const d=saved.diagnostics;
        el('smtp-admin').hidden=saved.options.smtp_source!=='admin';
        el('effective-smtp').textContent=d.smtp.effective.host?`SMTP ที่บันทึก: ${d.smtp.effective.host}:${d.smtp.effective.port} · ${d.smtp.effective.security} · ผู้ส่ง ${d.smtp.effective.from} · ${d.smtp.configured?'ตั้งค่าครบ (ยังไม่ยืนยันผลส่ง)':'ตั้งค่ายังไม่ครบ'}`:'ยังไม่มี SMTP พร้อมใช้งาน';
        el('base-url').textContent=`ลิงก์ในอีเมลใช้ ${d.base_url} · การเปิดเอกสารใช้สิทธิ์และการเข้าสู่ระบบตามระบบเอกสาร ควรทดสอบลิงก์ด้วยบัญชีผู้รับจริง`;
        const active=['waiting_files','analyzing','sending','queued','awaiting_approval'].reduce((n,k)=>n+(d.counts[k]||0),0);
        el('queue-impact').textContent=`งานค้าง ${active} งาน · ผู้รับรอส่ง ${d.pending_recipients} คน · งานต้องตรวจสอบ ${d.counts.review||0} งาน`;
        el('last-editor').textContent=`แก้ไขล่าสุด: ${d.updated_by||'—'} · ${dateTime(saved.updated_at,'ยังไม่เคยบันทึก')}`;
        const cronNames={healthy:'ปกติ',late:'ล่าช้าเกิน 7 นาที',offline:'ขาดการติดต่อเกิน 15 นาที',missing:'ยังไม่พบ'};
        el('worker-detail').textContent=`Cron: ${cronNames[d.cron.state]} · จบสำเร็จล่าสุด ${dateTime(d.cron.finished_at,'—')}${d.cron.result?` · ประมวลผล ${d.cron.result.processed} งาน / ขัดข้อง ${d.cron.result.failed} งาน`:''}`;
        el('readiness-checks').replaceChildren();
        for(const [text,ok] of [['API key ถอดรหัสได้',saved.key_usable],['AI ชุดปัจจุบันทดสอบผ่านใน 24 ชม.',d.ai_tested],['SMTP ตั้งค่าครบ',d.smtp.configured],['SMTP ชุดปัจจุบันส่งทดสอบผ่านใน 24 ชม.',d.smtp_tested],['Cron ตามรอบ',d.cron.state==='healthy'],['URL ระบบเป็น HTTPS',d.base_url.startsWith('https://')]])el('readiness-checks').append(U.node('li',(ok?'✓ ':'! ')+text,ok?'status-good':'status-warning'));
        if(d.mock)el('readiness-checks').append(U.node('li','โหมดจำลอง: การทดสอบไม่เรียกบริการจริง','status-warning'));
        el('ai-usage').replaceChildren();
        for(const u of d.usage)el('ai-usage').append(U.node('p',`${u.model}: ${Number(u.requests).toLocaleString()} คำขอ · Input ${Number(u.input_tokens).toLocaleString()} / Output+Thinking ${Number(u.output_tokens).toLocaleString()} / รวม ${Number(u.total_tokens).toLocaleString()} tokens · ประมาณ $${u.estimated_usd}`));
        if(!d.usage.length)el('ai-usage').append(U.node('p','ยังไม่มีข้อมูลการใช้งาน','muted'));
        const names={settings_saved:'บันทึกการตั้งค่า',ai_test:'ทดสอบ AI',pdf_test:'ทดลอง PDF',smtp_check:'ตรวจ SMTP',smtp_test:'ส่งเมลทดสอบ',key_add:'เพิ่ม Key',key_test:'ทดสอบ Key',key_activate:'สลับ Key หลัก',key_update:'แก้ไข/พักใช้ Key',key_delete:'ลบ Key',key_server:'ใช้ Key เซิร์ฟเวอร์',encryption_rotated:'เปลี่ยนกุญแจเข้ารหัส'};
        const labels={model:'โมเดล',enabled:'เปิดระบบ',api_key:'API key',smtp_password:'รหัสผ่าน SMTP',analysis_only:'วิเคราะห์อย่างเดียว',require_approval:'ตรวจผู้รับก่อนส่ง',smtp_source:'แหล่ง SMTP',smtp_host:'SMTP Host',smtp_port:'Port',smtp_security:'TLS',smtp_username:'บัญชี SMTP',smtp_from:'ผู้ส่ง',smtp_name:'ชื่อผู้ส่ง',smtp_reply_to:'Reply-To',subject:'หัวเรื่อง',intro:'ข้อความเกริ่น',signature:'ลายเซ็น',input_price:'ราคา Input',output_price:'ราคา Output'};
        el('settings-history').replaceChildren();
        for(const event of d.events){
            const box=U.node('details'),title=U.node('summary',`${names[event.event]||event.event} · ${event.actor||'ระบบ'} · ${dateTime(event.created_at,'—')}`);box.append(title);
            const details=event.details;
            if(details.changes)for(const [key,v] of Object.entries(details.changes))box.append(U.node('p',`${labels[key]||key}: ${typeof v==='object'?`${v.before??'—'} → ${v.after}`:v}`));
            else if(event.event==='encryption_rotated')box.append(U.node('p',`เข้ารหัสข้อมูลลับใหม่ ${details.credentials} รายการ`));
            else box.append(U.node('p',`${details.success?'ผ่าน':'ไม่ผ่าน'}${details.label?' · '+details.label:''}${details.reference?' · '+details.reference:''}${details.model?' · '+details.model:''}${details.duration_ms!==undefined?' · '+details.duration_ms+' ms':''}${details.code?' · '+U.error(details.code):''}`));
            el('settings-history').append(box);
        }
        if(!d.events.length)el('settings-history').append(U.node('p','ยังไม่มีประวัติหลังอัปเกรด','muted'));
    }
    async function run(action,data){
        if(action==='smtp_test'){
            if(!el('test-email').value||!el('test-email').reportValidity())throw Error('กรุณากรอกอีเมลทดสอบ');
            data.test_email=el('test-email').value.trim();
        }
        if(action==='pdf_test'){
            const file=el('test-pdf').files[0];
            if(!file||file.size>5*1024*1024||!file.name.toLowerCase().endsWith('.pdf'))throw Error('กรุณาเลือก PDF ไม่เกิน 5 MB');
            data.pdf_base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('อ่านไฟล์ไม่สำเร็จ'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
            el('pdf-mentions').replaceChildren();
        }
        const result=await U.request('ai_settings.php',data);
        if(action==='preview'){
            el('preview-subject').textContent=result.subject;el('mail-preview').hidden=false;
            el('mail-preview').replaceChildren(U.node('p',result.intro),U.node('p','PDF ตัวอย่าง (ลิงก์สาธิต): '+result.base_url+'/api/view_file.php?Doc_Id=…'),U.node('p',result.signature));
        }else if(action==='pdf_test'){
            U.message('pdf-result',result.message);
            for(const m of result.mentions)el('pdf-mentions').append(U.node('li',`${m.name} → ${m.matched_name||'ไม่พบ/ไม่มั่นใจ ต้องตรวจสอบ'}`,m.user_id?'status-good':'status-warning'));
            if(!result.mentions.length)el('pdf-mentions').append(U.node('li','ไม่พบรายชื่อในเอกสาร'));
        }else U.message('smtp-result',result.message);
    }
    const invalidate=event=>{
        const id=event.target.id;
        if(id.startsWith('smtp')||id==='test-email')U.message('smtp-result','ค่าที่กรอกเปลี่ยนแล้ว กรุณาทดสอบชุดนี้อีกครั้ง');
        if(['subject','intro','signature'].includes(id)){el('mail-preview').hidden=true;el('preview-subject').textContent='แม่แบบเปลี่ยนแล้ว กดดูตัวอย่างอีกครั้ง';}
        if(['test-pdf','api-key','model','model-options'].includes(id)){el('pdf-mentions').replaceChildren();U.message('pdf-result','');}
    };
    el('settings-form').addEventListener('input',invalidate);el('settings-form').addEventListener('change',invalidate);
    return {values,dirty,render,run};
})();
