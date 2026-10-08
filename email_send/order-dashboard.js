(() => {
    const U=OrderUI,el=id=>document.getElementById(id);let page=1,total=0,activeDoc=null,busy=false,listRequest=0,detailRequest=0;
    async function load(){
        const requestId=++listRequest;
        try{
            const q=new URLSearchParams({page,year:el('year').value,search:el('search').value,state:el('state').value});
            const result=await U.request('order_jobs.php?'+q);if(requestId!==listRequest)return;total=result.total;
            if(el('year').options.length===1)result.years.forEach(year=>el('year').add(new Option('พ.ศ. '+year,year)));
            el('settings-link').hidden=!result.is_admin;
            const worker=result.worker;
            el('worker-status').textContent=(worker.enabled?'เปิดส่งอัตโนมัติ':'หยุดส่งชั่วคราว / ยังไม่เปิดใช้')+' · เปิดใช้ครั้งแรก: '+(worker.activated_at||'—')+' · Cron ล่าสุด: '+(worker.last_run||'ยังไม่พบการทำงาน');
            el('rows').replaceChildren();
            for(const item of result.data){
                const tr=U.node('tr'),doc=U.node('td'),status=U.node('td'),counts=U.node('td'),actions=U.node('td');
                doc.append(U.node('strong',item.doc_number+' · '+item.doc_year),U.node('p',item.doc_name));
                status.append(U.badge(item.status));if(item.error_code)status.append(U.node('p',U.error(item.error_code),'muted'));
                counts.textContent=`สำเร็จ ${item.success_count} / รอ ${item.pending_count} / ตรวจสอบ ${item.attention_count}`;
                actions.append(U.button(item.status?'รายละเอียด':'นำเข้าคิว',()=>item.status?openDetail(item):action(item.doc_id,'enqueue')));
                tr.append(doc,status,counts,actions);el('rows').append(tr);
            }
            if(!result.data.length){const tr=U.node('tr'),td=U.node('td','ไม่พบคำสั่งตามเงื่อนไข');td.colSpan=4;tr.append(td);el('rows').append(tr);}
            el('page-info').textContent=`หน้า ${page} / ${Math.max(1,Math.ceil(total/20))} · ${total} คำสั่ง`;el('prev').disabled=page<=1;el('next').disabled=page*20>=total;
        }catch(error){U.message('message',error.message,true);}
    }
    async function action(docId,name,extra={}){
        if(busy)return;busy=true;
        try{const result=await U.request('order_jobs.php',{doc_id:docId,action:name,...extra});U.message('message',result.message);U.message('detail-message',result.message);await load();if(activeDoc&&el('detail').open)await detail();}
        catch(error){U.message(el('detail').open?'detail-message':'message',error.message,true);}finally{busy=false;}
    }
    async function openDetail(item){activeDoc=item;el('detail-title').textContent=item.doc_number+' · '+item.doc_name;U.message('detail-message','');el('detail').showModal();await detail();}
    async function detail(){
        const requestId=++detailRequest,docId=activeDoc.doc_id;
        try{
            const result=await U.request('order_jobs.php?doc_id='+docId);if(requestId!==detailRequest||activeDoc.doc_id!==docId)return;
            el('detail-status').replaceChildren(U.badge(result.job?.status));
            if(result.job?.error_code)el('detail-status').append(U.node('span',' · '+U.error(result.job.error_code)));
            el('file-rows').replaceChildren();
            for(const file of result.files){const tr=U.node('tr'),status=U.node('td');status.append(U.badge(file.status));tr.append(U.node('td',file.caption||file.file_name),status,U.node('td',file.attempts+' ครั้ง · '+U.error(file.error_code)+(file.retry_at?' · ลองใหม่ '+file.retry_at:'')));el('file-rows').append(tr);}
            el('recipient-rows').replaceChildren();
            for(const recipient of result.recipients){
                const tr=U.node('tr'),name=U.node('td'),status=U.node('td'),actions=U.node('td');name.append(U.node('div',recipient.recipient_name),U.node('div',recipient.recipient_email,'muted'));status.append(U.badge(recipient.status));
                if(recipient.status==='pending')actions.append(U.button('ยกเลิก',()=>action(activeDoc.doc_id,'cancel_recipient',{recipient_id:recipient.id}),true));
                if(['failed','uncertain','sending','cancelled'].includes(recipient.status))actions.append(U.button('ส่งใหม่',()=>{
                    if(confirm('ตรวจสอบผลส่งแล้วหรือไม่? หาก SMTP รับอีเมลไปแล้ว การส่งใหม่อาจทำให้ผู้รับได้รับซ้ำ'))action(activeDoc.doc_id,'retry_recipient',{recipient_id:recipient.id,confirmed:true});
                }));
                tr.append(name,status,U.node('td',(recipient.sent_at||recipient.attempted_at||'—')+' · '+recipient.attempts+' ครั้ง · '+U.error(recipient.error_code)),actions);el('recipient-rows').append(tr);
            }
        }catch(error){U.message('detail-message',error.message,true);}
    }
    el('filters').addEventListener('submit',event=>{event.preventDefault();page=1;load();});
    el('prev').onclick=()=>{page--;load();};el('next').onclick=()=>{page++;load();};el('close-detail').onclick=()=>el('detail').close();el('refresh-detail').onclick=detail;
    el('reanalyze').onclick=()=>{if(confirm('อ่าน PDF ทุกไฟล์ใหม่ โดยไม่ส่งซ้ำให้ผู้ที่สำเร็จแล้ว และคงรายการผลส่งไม่แน่ชัดไว้ให้ตรวจสอบ'))action(activeDoc.doc_id,'reanalyze',{confirmed:true});};
    el('cancel-job').onclick=()=>{if(confirm('หยุดงานที่ยังไม่ส่ง? อีเมลที่ส่งแล้วเรียกคืนไม่ได้'))action(activeDoc.doc_id,'cancel_job');};
    el('add-recipient').onsubmit=event=>{event.preventDefault();action(activeDoc.doc_id,'add_recipient',{email:el('recipient-email').value});};
    // Do not replace a focused/hovered action while an operator is using it.
    load();setInterval(()=>{if(!document.hidden&&!busy&&!el('detail').open&&!document.querySelector('#rows:hover')&&!document.activeElement?.closest('form,table'))load();},15000);
})();
