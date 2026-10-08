(() => {
    const message=document.getElementById('message'),status=document.getElementById('status'),runs=document.getElementById('runs');
    function line(text,parent=status){const item=document.createElement('p');item.textContent=text;parent.appendChild(item);}
    async function load(){
        status.replaceChildren();runs.replaceChildren();message.textContent='กำลังตรวจสถานะ…';
        try{
            const response=await fetch('../api/drive_archive_status.php',{credentials:'same-origin',cache:'no-store'});const data=await response.json();
            if(!response.ok)throw Error(data.message||'ตรวจสถานะไม่สำเร็จ');
            line('ระบบสำรอง: '+(data.enabled?'เปิด':'ยังไม่เปิด'));line('การเชื่อมต่อ: '+(data.configured?'ตั้งค่าแล้ว':'รอตั้งค่า Apps Script'));
            if(data.enabled){
                line('นำไฟล์เก่าออกจากเซิร์ฟเวอร์: '+(data.eviction_enabled?'เปิดตามเงื่อนไขตรวจสอบ':'ยังไม่เปิด'));
                line('Worker ล่าสุด: '+(data.state?.worker_at||'ยังไม่ทำงาน'));line('สแกนครบครั้งแรก: '+(data.state?.full_scan_at||'ยังไม่ครบ'));
                for(const count of data.counts||[])line(count.status+': '+count.files+' เวอร์ชัน / '+Number(count.bytes).toLocaleString()+' bytes');
                if(Number(data.retry?.deferred)>0)line('รอ retry '+data.retry.deferred+' เวอร์ชัน — รอบถัดไปหลัง '+data.retry.next_retry);
                for(const run of data.backups||[])line(run.backup_date+' — '+(run.status==='database_only'?'สำรองฐานข้อมูลแล้ว / เอกสารยังซิงก์ไม่ครบ':run.status)+(run.error_code?' / '+run.error_code:''),runs);
                if(data.state?.error_code)line(data.state.error_code==='cloud_retry_pending'?'Google ตอบชั่วคราวไม่สำเร็จ — จะทำต่อหลังเวลารอ retry':data.state.error_code==='verification_review_required'?'พบไฟล์ที่ตรวจสอบไม่ผ่าน — เก็บต้นฉบับไว้และรอผู้ดูแลตรวจสอบ':'พบข้อผิดพลาด: '+data.state.error_code);
            }
            message.textContent='ตรวจสถานะแล้ว';
        }catch(error){message.textContent=error.message;}
    }
    document.getElementById('refresh').addEventListener('click',load);load();
})();
