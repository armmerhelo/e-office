(() => {
    const form=document.getElementById('filters'),rows=document.getElementById('audit-rows');
    const feedback=document.getElementById('audit-feedback'),results=document.getElementById('audit-results');
    const prev=document.getElementById('audit-prev'),next=document.getElementById('audit-next'),pageNumber=document.getElementById('audit-page-number');
    const targetLabels={user:'สมาชิก',document:'เอกสาร',department:'กลุ่มงาน',routing:'Auto send',booking:'จองห้อง',maintenance:'แจ้งซ่อม',number:'จองเลขคำสั่ง',api_key:'API Key'};
    const metaLabels={method:'วิธีเข้าสู่ระบบ',action:'คำสั่งงาน',from:'ค่าเดิม',to:'ค่าใหม่',permissions:'สิทธิ์',department_ids:'ID กลุ่มงาน',reset_password:'ตั้งรหัสผ่านใหม่',receipt_departments:'ฝ่ายที่ลงทะเบียนรับ',auto_sent_user_ids:'ID ผู้รับ Auto send',count:'จำนวนรายการ',year:'ปี',number:'เลขคำสั่ง',reference:'รหัสอ้างอิง Key'};
    let page=1,pages=1,sequence=0,filters=new URLSearchParams(),controller;
    const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);if(className)el.className=className;return el;};
    function render(data) {
        rows.replaceChildren();
        for(const row of data.data) {
            const tr=node('tr'),time=node('td');
            time.append(node('time',new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date(row.occurred_at))));
            time.firstChild.dateTime=row.occurred_at;
            const actor=node('td',row.actor_name);if(row.actor_id!==null)actor.append(node('span',`ID ${row.actor_id}`,'audit-secondary'));
            const event=node('td',row.label);event.append(node('span',row.event,'audit-secondary'));
            const target=node('td',`${targetLabels[row.target_type]||row.target_type}${row.target_id!==null?' #'+row.target_id:''}`);
            const outcome=node('td');outcome.append(node('span',row.outcome==='success'?'สำเร็จ':'ไม่สำเร็จ',`audit-badge${row.outcome==='failure'?' audit-badge--failure':''}`));
            const detail=node('td'),disclosure=node('details'),list=node('dl');disclosure.append(node('summary','ดูรายละเอียด'));
            const add=(key,value)=>{list.append(node('dt',key),node('dd',value));};
            add('Log ID',row.id);add('IP',row.ip_address||'—');add('เบราว์เซอร์',row.user_agent||'—');
            for(const [key,value] of Object.entries(row.metadata||{}))add(metaLabels[key]||key,Array.isArray(value)?value.join(', '):(typeof value==='boolean'?(value?'ใช่':'ไม่ใช่'):value??'—'));
            disclosure.append(list);detail.append(disclosure);tr.append(time,actor,event,target,outcome,detail);rows.append(tr);
        }
        if(!data.data.length){const tr=node('tr'),td=node('td','ไม่พบประวัติที่ตรงกับตัวกรอง');td.colSpan=6;tr.append(td);rows.append(tr);}
    }
    async function load(requestedPage=page) {
        const request=++sequence;controller?.abort();controller=new AbortController();
        prev.disabled=true;next.disabled=true;results.setAttribute('aria-busy','true');
        feedback.dataset.error='false';feedback.textContent='กำลังโหลดประวัติ…';
        const params=new URLSearchParams(filters);params.set('page',requestedPage);params.set('limit',25);
        try {
            const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]);
            const response=await fetch(`get_audit_logs_api.php?${params}`,{credentials:'same-origin',cache:'no-store',signal});
            const data=await response.json();if(request!==sequence)return;
            if(!response.ok||data.status!=='success')throw Error(data.message||'โหลดประวัติไม่สำเร็จ');
            const category=form.elements.namedItem('category');
            if(category.options.length===1)for(const [value,label] of Object.entries(data.categories)){const option=node('option',label);option.value=value;category.append(option);}
            page=data.page;pages=data.pages;render(data);
            pageNumber.textContent=`หน้า ${page.toLocaleString('th-TH')} / ${pages.toLocaleString('th-TH')}`;
            feedback.textContent=`พบ ${data.total.toLocaleString('th-TH')} รายการ · เรียงจากใหม่ไปเก่า`;
        } catch(error) {
            if(request!==sequence||error.name==='AbortError')return;
            rows.replaceChildren();pageNumber.textContent='';pages=1;page=1;
            feedback.dataset.error='true';feedback.textContent=`${error.name==='TimeoutError'?'โหลดประวัติใช้เวลานานเกินไป':error.message} — กดรีเฟรชเพื่อลองใหม่`;
        } finally {
            if(request===sequence){results.setAttribute('aria-busy','false');prev.disabled=page<=1;next.disabled=page>=pages;}
        }
    }
    form.addEventListener('submit',event=>{
        event.preventDefault();
        const from=form.elements.namedItem('from'),to=form.elements.namedItem('to');
        to.setCustomValidity(from.value&&to.value&&from.value>to.value?'วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น':'');
        if(!form.reportValidity())return;
        filters=new URLSearchParams(new FormData(form));load(1);
    });
    form.addEventListener('input',()=>form.elements.namedItem('to').setCustomValidity(''));
    form.addEventListener('reset',()=>{form.elements.namedItem('to').setCustomValidity('');filters=new URLSearchParams();load(1);});
    document.getElementById('audit-refresh').addEventListener('click',()=>load());
    prev.addEventListener('click',()=>load(page-1));next.addEventListener('click',()=>load(page+1));
    window.eofficeRegisterModuleRefresh?.(()=>load());
    load();
})();
