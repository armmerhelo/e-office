window.OrderKeyring = (()=>{
    const el=id=>document.getElementById(id),U=OrderUI;
    let saved=null,runAction=null;
    const drafts=new Map();
    const dirty=()=>Boolean(el('keyring-label').value||el('keyring-secret').value||el('keyring-days').value!=='90'||[...drafts.values()].some(d=>d.label.value.trim()!==d.original.label||Number(d.days.value)!==d.original.remind_days));
    function render(settings,dateTime,callback,preserveDrafts=false){
        const addition=preserveDrafts?[el('keyring-label').value,el('keyring-secret').value,el('keyring-days').value]:null;
        const pending=preserveDrafts?[...drafts].map(([id,d])=>[id,{label:d.label.value.trim()!==d.original.label?d.label.value:null,days:Number(d.days.value)!==d.original.remind_days?d.days.value:null}]):[];
        saved=settings;runAction=callback;drafts.clear();
        el('keyring-label').value='';el('keyring-secret').value='';el('keyring-days').value='90';
        const ring=settings.keyring;
        el('keyring-source').textContent=ring.server.active&&ring.server.configured?'ปัจจุบันใช้ Key จากเซิร์ฟเวอร์':ring.keys.find(k=>k.active)?'Key หลัก: '+ring.keys.find(k=>k.active).label:'ยังไม่มี Key พร้อมใช้งานที่เลือกไว้';
        el('keyring-list').replaceChildren();
        for(const key of ring.keys){
            const card=U.node('article',undefined,'keyring-entry');
            card.append(U.node('h3',`${key.label}${key.active?' · ตัวหลัก':''} · ${key.enabled?'พร้อมเลือกใช้':'พักใช้'}`),U.node('p',key.reference,'muted'));
            const label=U.node('input');label.value=key.label;label.maxLength=100;label.setAttribute('aria-label','ชื่อ Key '+key.reference);
            const days=U.node('input');days.type='number';days.min='1';days.max='730';days.value=String(key.remind_days);days.setAttribute('aria-label','รอบเตือนเปลี่ยน Key (วัน) '+key.reference);
            drafts.set(key.id,{label,days,original:key});
            card.append(label,U.node('span','เตือนหมุนเวียน (วัน)','field-help'),days);
            card.append(U.node('p',`เพิ่ม ${dateTime(key.created_at,'—')} · ${key.rotation_due?'ถึงรอบเปลี่ยน Key แล้ว':'รอบเตือน '+key.remind_days+' วัน'}`,key.rotation_due?'status-warning':'field-help'));
            card.append(U.node('p',`ถอดรหัส: ${key.usable?'ได้':'ไม่ได้'} · ทดสอบ ${dateTime(key.tested_at,'ยังไม่เคย')} · ${key.tested_model||'—'}${key.test_code?' · '+U.error(key.test_code):''}`,'field-help'));
            card.append(U.node('p',`สำเร็จล่าสุด ${dateTime(key.last_success_at,'—')} · ผิดพลาดล่าสุด ${dateTime(key.last_error_at,'—')}${key.last_error_code?' · '+U.error(key.last_error_code):''}`,'field-help'));
            const usage=key.usage;
            card.append(U.node('p',`30 วัน: ${Number(usage.requests).toLocaleString()} คำขอ · Input ${Number(usage.input_tokens).toLocaleString()} / Output ${Number(usage.output_tokens).toLocaleString()} / รวม ${Number(usage.total_tokens).toLocaleString()} tokens`,'field-help'));
            const actions=U.node('div',undefined,'keyring-actions');
            actions.append(U.button('บันทึกชื่อ/รอบเตือน',()=>runAction('key_update',{key_id:key.id,label:label.value.trim(),remind_days:Number(days.value),key_enabled:key.enabled})));
            if(key.enabled){
                actions.append(U.button('ทดสอบ',()=>runAction('key_test',{key_id:key.id})));
                if(!key.active)actions.append(U.button('ทดสอบและเลือกเป็นตัวหลัก',()=>{if(confirm(`ทดสอบแล้วสลับใช้ “${key.label}” สำหรับคำขอ AI ถัดไป?`))runAction('key_activate',{key_id:key.id,confirmed:true});}));
            }
            if(!key.active){
                actions.append(U.button(key.enabled?'พักใช้':'เปิดให้เลือกใช้',()=>runAction('key_update',{key_id:key.id,label:label.value.trim(),remind_days:Number(days.value),key_enabled:!key.enabled})));
                actions.append(U.button('ลบ Key',()=>{if(confirm(`ลบข้อมูลลับของ “${key.label}” ออกจาก E-Office?\nประวัติยังอยู่ และไม่ได้เพิกถอนที่ Google`))runAction('key_delete',{key_id:key.id,confirmed:true});},true));
            }
            card.append(actions);el('keyring-list').append(card);
        }
        if(!ring.keys.length)el('keyring-list').append(U.node('p','ยังไม่มี Key ในคลัง','muted'));
        if(ring.server.usage)el('keyring-list').append(U.node('p',`Key เซิร์ฟเวอร์ · 30 วัน: ${ring.server.usage.requests} คำขอ / ${ring.server.usage.total_tokens} tokens`,'field-help'));
        if(ring.server.health)el('keyring-list').append(U.node('p',`Key เซิร์ฟเวอร์ · สำเร็จล่าสุด ${dateTime(ring.server.health.last_success_at,'—')} · ผิดพลาด ${dateTime(ring.server.health.last_error_at,'—')}${ring.server.health.last_error_code?' · '+U.error(ring.server.health.last_error_code):''}`,'field-help'));
        if(ring.unattributed_usage)el('keyring-list').append(U.node('p',`ข้อมูลเก่า/Key ทดลองที่ยังไม่จัดเก็บ: ${ring.unattributed_usage.requests} คำขอ (ไม่ระบุ Key)`,'field-help'));
        if(addition)[el('keyring-label').value,el('keyring-secret').value,el('keyring-days').value]=addition;
        for(const [id,values] of pending){const entry=drafts.get(id);if(entry){if(values.label!==null)entry.label.value=values.label;if(values.days!==null)entry.days.value=values.days;}}
    }
    el('keyring-add').onclick=()=>{
        if(!el('keyring-label').value.trim()||!el('keyring-secret').value.trim()){U.message('keyring-message','กรุณากรอกชื่อและ API Key',true);return;}
        if(!el('keyring-days').reportValidity())return;
        runAction('key_add',{label:el('keyring-label').value.trim(),api_key:el('keyring-secret').value.trim(),remind_days:Number(el('keyring-days').value)});
    };
    el('keyring-server').onclick=()=>{if(confirm('ทดสอบแล้วกลับไปใช้ GEMINI_API_KEY จากเซิร์ฟเวอร์?\nKey ในคลังจะคงไว้ และไม่มีการสลับกลับอัตโนมัติ'))runAction('key_server',{confirmed:true});};
    function confirmDrafts(action,extra){
        const otherEntry=[...drafts.entries()].some(([id,d])=>(action!=='key_update'||id!==extra.key_id)&&(d.label.value.trim()!==d.original.label||Number(d.days.value)!==d.original.remind_days));
        const newDraft=action!=='key_add'&&(el('keyring-label').value||el('keyring-secret').value||el('keyring-days').value!=='90');
        return !(otherEntry||newDraft)||confirm('มีแบบร่าง Key อื่นที่ยังไม่บันทึก ยกเลิกแบบร่างเหล่านั้นและทำรายการนี้ต่อ?');
    }
    return {render,dirty,confirmDrafts,controls:()=>{el('keyring-server').disabled=!saved?.keyring.server.configured;el('keyring-add').disabled=!saved?.encryption_ready;}};
})();
