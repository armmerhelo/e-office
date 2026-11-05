(() => {
    const root=document.getElementById('siya-news-app');if(!root)return;
    const $=id=>document.getElementById(id);
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const labels={draft:'ร่าง',review:'รอตรวจคำ',changes_requested:'ส่งกลับแก้ไข',approved:'ผ่านตรวจ — พร้อมทำกราฟิก',deleted:'อยู่ในถังขยะ'};
    const state={scope:'',query:'',rows:[],selected:null,loading:false,busy:false,editing:false,dirty:false,detailRequest:0,listRequest:0};
    const roles=()=>window.eofficeUser?.permissions||[];
    const has=role=>roles().includes(role)||window.eofficeUser?.status==='Admin';
    const url=path=>new URL(path,location.href).href;
    const thaiDate=value=>value?new Date(String(value).replace(' ','T')).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}):'ไม่ระบุวันที่';
    function markClean(){state.dirty=false;root.querySelectorAll('form').forEach(form=>form.dispatchEvent(new Event('eoffice:form-saved',{bubbles:true})));}
    const hasPendingUpload=(batch=state.uploadBatch)=>Boolean(batch?.items.some(item=>['queued','uploading','failed','uncertain'].includes(item.status)));
    function mayLeave(){
        if(state.busy)return false;
        const pending=hasPendingUpload();
        if(!(state.dirty||pending||state.unconfirmedWrite))return true;
        if(!confirm(pending?'ยังมีภาพค้างหรือยังยืนยันผลไม่ได้ ต้องการออกและทิ้งคิวอัปโหลดพร้อมการแก้ไขที่ยังไม่บันทึกหรือไม่? ภาพที่อยู่บน Server จะไม่ถูกลบ กรุณาตรวจรายการก่อนเลือกส่งซ้ำ':state.unconfirmedWrite?'ยังยืนยันผลคำสั่งก่อนหน้าไม่ได้ ต้องการออกจากฟอร์มเพื่อตรวจรายการล่าสุดหรือไม่? คัดลอกข้อความที่ยังต้องเก็บก่อนออก':'มีการแก้ไขที่ยังไม่บันทึก ต้องการทิ้งการแก้ไขและออกจากข่าวนี้หรือไม่? กด “ยกเลิก” เพื่อกลับไปบันทึกก่อน'))return false;
        if(pending)state.uploadBatch=null;
        return true;
    }
    function focusDetail(){root.classList.add('show-detail');$('news-detail').focus({preventScroll:true});if(matchMedia('(max-width:680px)').matches)$('news-detail').scrollIntoView({block:'start'});}
    function contentChanged(){return state.editing&&Object.entries(valuesFromForm()).some(([key,value])=>value!==(state.selected[key]||''));}
    function imageValues(){return [...$('news-detail').querySelectorAll('.news-image-card')].map((card,index)=>({id:card.dataset.imageId,caption:card.querySelector('[data-caption]').value,credit:card.querySelector('[data-credit]').value,sort_order:index}));}
    function imagesChanged(){return state.editing&&JSON.stringify(imageValues())!==JSON.stringify((state.selected.images||[]).map((image,index)=>({id:image.id,caption:image.caption||'',credit:image.credit||'',sort_order:index})));}
    async function post(payload){
        if(state.unconfirmedWrite)throw Error('ยังยืนยันผลคำสั่งก่อนหน้าไม่ได้ กรุณาตรวจรายการและเปิดข่าวล่าสุดก่อนส่งคำสั่งซ้ำ ข้อความในฟอร์มยังอยู่ให้คัดลอกเก็บไว้');
        try{const result=await request('../api/siya-news.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(payload.action!=='used'&&(!Number.isInteger(Number(result.version))||Number(result.version)<1))throw Error('คำตอบยืนยันเวอร์ชันไม่สมบูรณ์');if(payload.action==='create'&&(!Number.isInteger(Number(result.id))||Number(result.id)<1))throw Error('คำตอบยืนยันรหัสข่าวไม่สมบูรณ์');return result;}
        catch(error){if(error.status===409&&error.definitiveRejection){state.unconfirmedWrite=true;throw Error(error.message+' · กรุณาตรวจรายการและเปิดข่าวล่าสุดก่อนส่งซ้ำ');}if(!error.definitiveRejection){state.unconfirmedWrite=true;throw Error(error.message+' · ยังยืนยันผลการบันทึกไม่ได้ กรุณาตรวจรายการและเปิดข่าวล่าสุดก่อนส่งซ้ำ');}throw error;}
    }
    function lockControls(){if(!state.busy)return;root.querySelectorAll('button,input,textarea').forEach(el=>{if(!el.disabled){state.lockedControls.add(el);el.disabled=true;}});}
    async function runAction(task,zone='review'){if(state.busy)return;state.busy=true;state.lockedControls=new Set();state.feedbackZone=zone;root.setAttribute('aria-busy','true');lockControls();try{await task();}catch(error){message(error.message,true);}finally{state.busy=false;state.feedbackZone=null;root.removeAttribute('aria-busy');state.lockedControls.forEach(el=>{if(el.isConnected)el.disabled=false;});state.lockedControls.clear();renderUploadProgress();}}
    async function request(path,options={}){
        const controller=new AbortController();let timeout;
        const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(Error('คำขอหมดเวลา กรุณาตรวจข้อมูลล่าสุดก่อนลองใหม่'));},120000);});
        // Keep the deadline active through response-body parsing, not only headers.
        try{
            const response=await Promise.race([fetch(path,{credentials:'same-origin',signal:controller.signal,...options}),deadline]);
            const type=response.headers.get('content-type')||'';const data=type.includes('application/json')?await Promise.race([response.json(),deadline]):null;
            if(!response.ok||data?.status==='error'){const error=Error(data?.message||`คำขอไม่สำเร็จ (${response.status})`);error.status=response.status;error.definitiveRejection=data?.status==='error'&&response.status>=400&&response.status<500&&response.status!==408;throw error;}
            if(!data||data.status!=='success')throw Error('คำตอบจากเซิร์ฟเวอร์ไม่สมบูรณ์ กรุณาตรวจข้อมูลล่าสุดก่อนลองใหม่');
            return data;
        }finally{clearTimeout(timeout);}
    }
    function message(text,error=false,zone=state.feedbackZone||'review'){const global=$('news-message'),local=state.selected?$(zone==='review'?'news-detail-message':'news-message-'+zone):null;root.querySelectorAll('[data-news-feedback]').forEach(box=>{box.hidden=true;box.textContent='';});global.textContent=text;global.classList.toggle('error',error);global.hidden=!text||Boolean(local);if(local){local.textContent=text;local.classList.toggle('error',error);local.hidden=!text;}if($('refresh-news-list'))$('refresh-news-list').hidden=!state.unconfirmedWrite;}
    const feedback=zone=>`<div id="news-message-${zone}" class="news-message" role="status" data-news-feedback hidden></div>`;
    const viewer=$('news-image-viewer');let previewTrigger=null;
    function openImage(image,trigger){
        if(state.busy)return;
        previewTrigger=trigger;
        const card=trigger.closest('.news-image-card'),caption=card?.querySelector('[data-caption]')?.value??image.caption??'',credit=card?.querySelector('[data-credit]')?.value??image.credit??'';
        const unsaved=caption!==(image.caption||'')||credit!==(image.credit||'');
        const full=$('news-full-image');
        $('news-viewer-title').textContent=image.original_name;
        $('news-viewer-caption').textContent=[caption,credit&&'เครดิต: '+credit,unsaved&&'คำบรรยาย / เครดิตที่แก้ไขยังไม่บันทึก'].filter(Boolean).join(' · ');
        $('news-viewer-status').textContent='กำลังโหลดภาพ…';full.hidden=true;
        full.onload=()=>{full.hidden=false;$('news-viewer-status').textContent='';};
        full.onerror=()=>{$('news-viewer-status').textContent='เปิดภาพไม่ได้ กรุณาปิดแล้วลองอีกครั้ง';};
        full.alt=caption||image.original_name;full.src=url('../'+image.url);viewer.showModal();$('close-news-viewer').focus({preventScroll:true});
    }
    $('close-news-viewer').addEventListener('click',()=>viewer.close());
    // The viewer has one keyboard action; keep Tab/Shift+Tab inside the modal.
    viewer.addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();$('close-news-viewer').focus({preventScroll:true});}});
    viewer.addEventListener('close',()=>{const full=$('news-full-image');full.onload=null;full.onerror=null;full.removeAttribute('src');if(previewTrigger?.isConnected)previewTrigger.focus({preventScroll:true});previewTrigger=null;});
    viewer.addEventListener('click',event=>{if(event.target!==viewer)return;const bounds=viewer.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)viewer.close();});
    function scopeOptions(){const list=[];if(has('news_submit'))list.push(['mine','ข่าวของฉัน']);if(has('news_editor'))list.push(['review','รอตรวจคำ'],['all','คลังบรรณาธิการ']);if(has('news_producer'))list.push(['ready','พร้อมจัดทำ']);if(has('news_submit')||has('news_editor'))list.push(['trash','ถังขยะ']);return list;}
    function renderTabs(){const tabs=$('news-tabs');tabs.replaceChildren();for(const [value,label] of scopeOptions()){const button=document.createElement('button');button.type='button';button.className='news-tab';button.id='news-tab-'+value;button.textContent=label;button.setAttribute('role','tab');button.setAttribute('aria-controls','news-list');button.setAttribute('aria-selected',String(value===state.scope));button.tabIndex=value===state.scope?0:-1;button.addEventListener('click',()=>{if(value===state.scope||!mayLeave())return;markClean();state.detailRequest++;state.scope=value;renderTabs();loadList();clearDetail();$('news-tab-'+value).focus();});tabs.append(button);} $('news-list').setAttribute('aria-labelledby','news-tab-'+state.scope);$('create-news').hidden=!has('news_submit');}
    $('news-tabs').addEventListener('keydown',event=>{const buttons=[...$('news-tabs').querySelectorAll('[role=tab]')],index=buttons.indexOf(event.target);if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].click();});
    function statusBadge(status){return `<span class="status-badge" data-status="${esc(status)}">${esc(labels[status]||status)}</span>`;}
    function renderList(){const list=$('news-list');list.replaceChildren();if(!state.rows.length){const empty=document.createElement('p');empty.className='empty-state';empty.textContent=state.loading?'กำลังโหลดรายการข่าว…':'ยังไม่มีข่าวในรายการนี้';list.append(empty);return;}
        for(const item of state.rows){const button=document.createElement('button');button.type='button';button.dataset.newsId=String(item.id);button.className='news-list-item'+(Number(state.selected?.id)===Number(item.id)?' selected':'');button.innerHTML=`<strong>${esc(item.title||'ร่างข่าว (ยังไม่มีหัวข้อ)')}</strong><p>${esc(item.department||'ไม่ระบุกลุ่มงาน')} · ${esc(thaiDate(item.event_date))}</p><div class="news-item-meta">${statusBadge(item.status)}<small>${Number(item.image_count)} ภาพ · ${esc(item.owner_name)}</small></div>`;button.addEventListener('click',()=>{if(!mayLeave())return;runAction(async()=>{await loadDetail(item.id,false);focusDetail();});});list.append(button);}lockControls();
    }
    async function loadList(append=false){
        if(!state.scope||append&&state.loading)return false;
        const ticket=++state.listRequest;state.loading=true;if(!append)state.rows=[];renderList();$('news-load-more').disabled=true;
        try{const params=new URLSearchParams({action:'list',scope:state.scope,limit:'100',offset:String(append?state.listOffset||0:0)});if(state.query)params.set('q',state.query);const data=await request('../api/siya-news.php?'+params);if(ticket!==state.listRequest)return false;if(!Array.isArray(data.data))throw Error('คำตอบรายการข่าวไม่ถูกต้อง');state.listOffset=(append?state.listOffset||0:0)+data.data.length;state.hasMore=data.data.length===100;state.rows=append?[...new Map([...state.rows,...data.data].map(item=>[Number(item.id),item])).values()]:data.data;return true;}
        catch(error){if(ticket!==state.listRequest)return false;if(!append){state.rows=[];state.hasMore=false;}message(error.message,true);return false;}
        finally{if(ticket===state.listRequest){state.loading=false;renderList();$('news-load-more').hidden=!state.hasMore;$('news-load-more').disabled=state.busy;if(state.busy)state.lockedControls.add($('news-load-more'));}}
    }
    function clearDetail(){state.selected=null;state.unconfirmedWrite=false;state.editing=false;root.classList.remove('show-detail');$('news-detail').innerHTML='<div class="empty-detail"><div class="empty-detail__icon" aria-hidden="true">✎</div><h2>เลือกข่าวเพื่อเริ่มทำงาน</h2><p>ข่าวที่คุณมีสิทธิ์จะปรากฏในรายการทางซ้าย</p></div>';renderList();}
    function ownerCanEdit(news){return Boolean((news.is_owner||Number(news.owner_id)===Number(window.eofficeUser?.id))&&has('news_submit')&&['draft','changes_requested','approved'].includes(news.status));}
    function editorCanEdit(news){return has('news_editor')&&['review','approved'].includes(news.status);}
    function canEdit(news){return ownerCanEdit(news)||editorCanEdit(news);}
    function producerCanRead(news){return has('news_producer')&&news.status==='approved';}
    async function loadDetail(id,editing=state.editing){const ticket=++state.detailRequest;try{const data=await request('../api/siya-news.php?action=detail&id='+encodeURIComponent(id)+(state.scope==='trash'?'&scope=trash':''));if(ticket!==state.detailRequest)return;const news=data.data;if(!news||Number(news.id)!==Number(id)||!Array.isArray(news.images)||!Object.hasOwn(labels,news.status)||!['title','body','location','department'].every(key=>typeof news[key]==='string'))throw Error('ข้อมูลรายละเอียดข่าวไม่ครบ กรุณาลองโหลดใหม่');const note=editing&&Number(state.selected?.id)===Number(id)?state.selected.pendingReviewNote:undefined;markClean();state.unconfirmedWrite=false;state.selected=news;state.editing=editing&&canEdit(news);renderDetail();if(note!==undefined&&$('news-review-note')){$('news-review-note').value=note;if(note!==String(news.review_note||''))$('news-review-note').dispatchEvent(new Event('input',{bubbles:true}));}renderList();}catch(error){message(error.message,true);throw error;}}
    function historyMarkup(history){if(!history?.length)return '';return `<details class="news-section news-history"><summary>ดูประวัติการตรวจและแก้ไข <span class="news-hint">(${history.length} เวอร์ชัน${history.length>12?' · แสดงล่าสุด 12':''})</span></summary><div class="history-list">${history.slice(0,12).map(row=>`<details class="history-row"><summary><strong>เวอร์ชัน ${Number(row.version)} · ${esc(row.actor_name||'สมาชิกเดิม')}</strong><br>${esc(new Date(String(row.created_at).replace(' ','T')).toLocaleString('th-TH'))} · ${esc(labels[row.snapshot?.status]||row.snapshot?.status||'บันทึก')}</summary><p><strong>${esc(row.snapshot?.title||'ไม่มีหัวข้อ')}</strong></p><p>${esc(row.snapshot?.body||'')}</p>${row.snapshot?.review_note?`<p>หมายเหตุ: ${esc(row.snapshot.review_note)}</p>`:''}</details>`).join('')}</div></details>`;}
    function imageMarkup(news,editable){if(!news.images?.length)return `<p class="news-hint">ยังไม่มีภาพแนบ</p>`;return `<div class="news-image-grid">${news.images.map((image,index)=>`<article class="news-image-card" data-image-id="${esc(image.id)}"><div class="news-image-preview"><img src="${esc(url('../'+image.url))}" alt="${esc(image.caption||image.original_name)}" loading="lazy"><span class="broken" hidden>ดูภาพไม่ได้</span></div><div class="news-image-info"><strong title="${esc(image.original_name)}">${esc(image.original_name)}</strong>${has('news_editor')?`<p class="news-hint">${image.storage_state==='review'?'ตรวจสอบไฟล์ — แจ้งผู้ดูแล E-Office':['archived','remote'].includes(image.storage_state)?'จัดเก็บบน Google Drive':'จัดเก็บบน Server'}</p>`:''}${editable?`<label class="image-field-label" for="caption-${esc(image.id)}">คำบรรยายภาพ ${index+1}</label><input id="caption-${esc(image.id)}" data-caption placeholder="คำบรรยายภาพ" value="${esc(image.caption)}"><label class="image-field-label" for="credit-${esc(image.id)}">เครดิตภาพ</label><input id="credit-${esc(image.id)}" data-credit placeholder="เครดิตภาพ (ถ้ามี)" value="${esc(image.credit)}">`:`<p class="image-caption">${esc(image.caption||'ยังไม่มีคำบรรยายภาพ')}</p><p class="news-hint image-credit">เครดิต: ${esc(image.credit||'ไม่ระบุ')}</p>`}<div class="image-actions">${editable?`<button type="button" class="news-button" data-move="-1" ${index===0?'disabled':''} aria-label="เลื่อนภาพขึ้น">↑</button><button type="button" class="news-button" data-move="1" ${index===news.images.length-1?'disabled':''} aria-label="เลื่อนภาพลง">↓</button><button type="button" class="news-button danger" data-remove>นำออก</button>`:''}<a class="news-button" href="${esc(url('../'+image.url))}" download>ดาวน์โหลด</a></div></div></article>`).join('')}</div>`;}
    function renderDetail(){const news=state.selected;if(!news)return;const editable=canEdit(news)&&state.editing,editor=has('news_editor'),producer=producerCanRead(news)&&!state.editing;const ownerDraft=ownerCanEdit(news);const isReview=news.status==='review'&&editor;
        const canSubmit=ownerDraft&&['draft','changes_requested'].includes(news.status);
        const html=`<button type="button" class="news-button news-back" id="news-back">← กลับรายการข่าว</button><div class="detail-title"><div><p class="eyebrow">${news.id?'ข่าว #'+Number(news.id)+' · เวอร์ชัน '+Number(news.version):'สร้างข่าวใหม่'}</p><h2>${esc(news.title||'ร่างข่าว (ยังไม่มีหัวข้อ)')}</h2><p class="detail-subtitle">ส่งโดย ${esc(news.owner_name)} · แก้ไขล่าสุด ${esc(news.updated_at?thaiDate(news.updated_at):'ยังไม่บันทึก')}</p></div><div class="detail-status">${statusBadge(news.status)}</div></div>
        <button type="button" class="news-button" id="refresh-news-list" hidden>ตรวจรายการข่าวล่าสุดก่อนส่งซ้ำ</button>
        <div class="detail-toolbar">${canEdit(news)&&!state.editing?'<button type="button" class="news-button" id="edit-news">แก้ไขข่าว</button>':''}${state.editing&&news.id?'<button type="button" class="news-button" id="cancel-edit">กลับโหมดอ่าน</button>':''}${producer?`<button class="news-button" type="button" id="copy-news">คัดลอกข้อความ</button><a class="news-button primary" href="${esc(url('../api/siya-news-export.php?id='+news.id))}">ดาวน์โหลดชุดข่าว ZIP</a>${!news.used_at?'<button class="news-button" type="button" id="mark-used">บันทึกว่านำไปใช้แล้ว</button>':'<span>นำไปใช้แล้ว</span>'}`:''}${news.can_delete?'<button class="news-button danger" type="button" id="delete-news">ย้ายไปถังขยะ</button>':''}${news.can_restore?'<button class="news-button primary" type="button" id="restore-news">กู้คืนข่าว</button>':''}</div>${feedback('toolbar')}
        ${news.status==='deleted'?`<div class="review-note" role="note">ข่าวอยู่ในถังขยะตั้งแต่ ${esc(thaiDate(news.deleted_at))} · เก็บข้อความ ภาพ และประวัติไว้ กู้คืนก่อนดูภาพหรือใช้งานต่อ${['review','approved'].includes(news.deleted_from_status)?' · เมื่อกู้คืนจะกลับเข้าคิวตรวจคำ ไม่ผ่านตรวจอัตโนมัติ':''}</div>`:''}
        ${editable&&news.status==='approved'?'<div class="review-note" role="note">การบันทึกเนื้อหาหรือภาพจะส่งข่าวกลับเข้าคิวตรวจคำ และพักการดาวน์โหลดสำหรับผู้จัดทำวารสารจนกว่าจะผ่านตรวจอีกครั้ง</div>':''}
        ${news.review_note?`<div class="review-note"><strong>${news.status==='changes_requested'?'ข้อเสนอแนะจากผู้ตรวจ':'หมายเหตุผู้ตรวจ'}:</strong> ${esc(news.review_note)}</div>`:''}
        ${!state.editing?`<article class="news-reading"><dl><dt>วันที่จัดกิจกรรม</dt><dd>${esc(thaiDate(news.event_date))}</dd><dt>กลุ่มงาน / ผู้รับผิดชอบ</dt><dd>${esc(news.department||'—')}</dd><dt>สถานที่</dt><dd>${esc(news.location||'—')}</dd></dl><h3>รายละเอียดข่าว</h3><p>${esc(news.body||'ยังไม่มีเนื้อหา')}</p></article>`:''}
        <form id="news-content-form" data-eoffice-draft-state="none"><div class="news-form-grid" ${!state.editing?'hidden':''}>
        <div class="news-field full"><label for="news-title">หัวข้อข่าว</label><input class="news-input" id="news-title" maxlength="255" value="${esc(news.title)}" ${editable?'':'disabled'}></div>
        <div class="news-field"><label for="news-event-date">วันที่จัดกิจกรรม</label><input class="news-input" id="news-event-date" type="date" value="${esc(news.event_date||'')}" ${editable?'':'disabled'}></div>
        <div class="news-field"><label for="news-department">กลุ่มงาน / ผู้รับผิดชอบ</label><input class="news-input" id="news-department" maxlength="255" value="${esc(news.department)}" ${editable?'':'disabled'}></div>
        <div class="news-field full"><label for="news-location">สถานที่</label><input class="news-input" id="news-location" maxlength="255" value="${esc(news.location)}" ${editable?'':'disabled'}></div>
          <div class="news-field full"><label for="news-body">รายละเอียดข่าว</label><textarea class="news-textarea" id="news-body" maxlength="30000" placeholder="เขียนรายละเอียด ใครทำอะไร ที่ไหน เมื่อไร และผลที่เกิดขึ้น" ${editable?'':'disabled'}>${esc(news.body)}</textarea><p class="news-hint">${isReview?'ผู้ตรวจสามารถแก้เนื้อหาได้ ปุ่มผ่านตรวจจะบันทึกเนื้อหาและภาพล่าสุดก่อนอนุมัติ':'บันทึกเป็นร่างก่อนได้ เมื่อส่งตรวจแล้วผู้ตรวจจะเป็นผู้แก้ไขเนื้อหาและตรวจความถูกต้อง'}</p></div>
          </div>${editable?'<section class="news-proofread" aria-labelledby="news-proofread-title"><h3 id="news-proofread-title">ตัวช่วยตรวจคำผิด</h3><p class="news-hint" id="news-proofread-hint">ส่งเฉพาะหัวข้อและรายละเอียดข่าวไปยังบริการ AI ภายนอกเพื่อช่วยตรวจคำผิด · คำแนะนำอาจคลาดเคลื่อน ควรตรวจชื่อเฉพาะและข้อเท็จจริงเอง · ไม่บันทึกหรือผ่านตรวจอัตโนมัติ</p><button class="news-button eo-btn" type="button" id="check-news-spelling" aria-describedby="news-proofread-hint">ช่วยตรวจคำผิด</button><div id="news-proofread-results" role="status" aria-live="polite"></div></section><div class="detail-actions"><button class="news-button" type="button" id="save-news-content">บันทึกเนื้อหาและภาพ</button><span class="news-hint">ไม่อนุมัติข่าว · หมายเหตุจะบันทึกเมื่อผ่านตรวจ</span></div>':''}${feedback('content')}</form>
        <section class="news-section" id="news-images-section"><div class="news-section-heading"><h3>ภาพประกอบ <span class="news-hint">(${news.status==='deleted'?Number(news.image_count||0):news.images.length}/10)</span></h3>${editable?'<button type="button" class="news-button" id="add-news-images">＋ เพิ่มภาพ</button>':''}</div>
        ${editable?'<input class="news-hidden" id="news-image-files" type="file" accept="image/jpeg,image/png,image/webp" multiple><p class="news-hint">JPEG, PNG หรือ WebP · ไม่เกิน 20 MB ต่อภาพ · ต้นฉบับจะเก็บบน Server 30 วันก่อนย้ายไป Google Drive</p>':''}
        ${news.status==='deleted'?`<p class="news-hint">เก็บภาพประกอบไว้ ${Number(news.image_count||0)} ภาพ · กรุณากู้คืนข่าวก่อนเปิดภาพ</p>`:news.images.length?`<form id="news-image-meta-form">${imageMarkup(news,editable)}</form>`:imageMarkup(news,editable)}<div id="news-upload-progress" role="status" aria-live="polite"></div>${feedback('images')}</section>
        <form id="news-review-form" class="news-review-section" ${editable||canSubmit||isReview?'':'hidden'}>
         ${isReview?`<div class="news-field"><h3>ผลการตรวจ</h3><label for="news-review-note">หมายเหตุผู้ตรวจ (ถ้ามี)</label><textarea class="news-textarea" id="news-review-note" maxlength="5000" aria-describedby="news-review-hint" placeholder="บันทึกหมายเหตุประกอบการผ่านตรวจ">${esc(news.review_note||'')}</textarea><p id="news-review-hint" class="news-hint">ผู้ตรวจแก้เนื้อหาและภาพได้โดยตรง เลือกบันทึกไว้ก่อน หรือบันทึกและผ่านตรวจเมื่อเรียบร้อย</p></div>`:''}
         <div class="detail-actions news-action-bar"><span id="news-save-state" role="status">${state.editing?'ยังไม่มีการแก้ไข':''}</span>${editable?`<button class="news-button ${canSubmit||isReview?'':'primary'}" type="button" id="save-news">${news.status==='approved'?'บันทึกและส่งตรวจใหม่':'บันทึกการแก้ไขทั้งหมด'}</button>`:''}${canSubmit?`<button class="news-button success" type="button" id="submit-news">บันทึกและส่งตรวจคำ</button>`:''}${isReview?`<button class="news-button success" type="button" id="approve-news">บันทึกและผ่านตรวจ</button>`:''}</div></form>
        <div id="news-detail-message" class="news-message" role="status" data-news-feedback hidden></div>${historyMarkup(news.history)}`;
        $('news-detail').innerHTML=html;
        $('news-detail').querySelectorAll('.news-button').forEach(button=>{button.classList.add('eo-btn');if(button.matches('.primary,.success'))button.classList.add('eo-btn--primary');if(button.classList.contains('danger'))button.classList.add('eo-btn--danger-text');});
        bindDetail(news,editable,canSubmit,isReview,producer);
        renderUploadProgress();
        lockControls();
    }
    function valuesFromForm(){return {title:$('news-title').value,event_date:$('news-event-date').value,department:$('news-department').value,location:$('news-location').value,body:$('news-body').value};}
    function bindProofread(news){
        const button=$('check-news-spelling'),box=$('news-proofread-results');if(!button)return;
        const owner=window.eofficeUser?.id;
        const source=()=>({title:$('news-title').value,body:$('news-body').value});let checked=null,items=[],applying=false,hadSuggestions=false;
        for(const id of ['news-title','news-body'])$(id).addEventListener('input',()=>{if(applying||!checked)return;checked=null;items=[];box.textContent='ข้อความเปลี่ยนแล้ว กรุณาตรวจคำอีกครั้ง';});
        function render(){
            box.innerHTML=items.length?`<p class="news-hint">เหลือ ${items.length} คำแนะนำ · เลือกแก้ทีละจุด แล้วบันทึกข่าวตามปกติ</p><ul class="news-proofread-list">${items.map((item,index)=>`<li><div><span class="news-hint">${item.field==='title'?'หัวข้อข่าว':'รายละเอียดข่าว'}</span><p><del>${esc(item.original)}</del> → <strong>${esc(item.replacement)}</strong></p><p class="news-hint">${esc(item.reason)}</p></div><button type="button" class="news-button eo-btn" data-proofread-index="${index}">ใช้คำแก้${checked[item.field].split(item.original).length>2?' (จุดแรก)':''}</button></li>`).join('')}</ul>`:`<p class="news-hint">${hadSuggestions?'ไม่มีคำแนะนำเดิมเหลือแล้ว หากมีคำซ้ำหรือคำแนะนำทับซ้อน ให้ตรวจคำอีกครั้ง':'ตัวช่วยไม่พบคำผิดที่แนะนำให้แก้ ไม่ใช่การรับรองว่าข้อความถูกต้องทั้งหมด'}</p>`;
            box.querySelectorAll('[data-proofread-index]').forEach(apply=>apply.addEventListener('click',()=>{
                if(state.busy||!checked)return;
                if(String(owner)!==String(window.eofficeUser?.id)){checked=null;items=[];box.textContent='บัญชีเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ก่อนตรวจคำ';return;}
                if(JSON.stringify(source())!==JSON.stringify(checked)){checked=null;box.textContent='ข้อความเปลี่ยนแล้ว กรุณาตรวจคำอีกครั้ง';return;}
                const item=items[Number(apply.dataset.proofreadIndex)],input=$(item.field==='title'?'news-title':'news-body');
                const start=item.start;if(input.value.slice(start,start+item.original.length)!==item.original)return;
                const next=input.value.slice(0,start)+item.replacement+input.value.slice(start+item.original.length);
                if([...next].length>(item.field==='title'?255:30000)){message('คำแก้ทำให้ข้อความยาวเกินกำหนด กรุณาปรับข้อความเอง',true,'content');return;}input.value=next;
                applying=true;input.dispatchEvent(new Event('input',{bubbles:true}));applying=false;checked=source();
                const end=start+item.original.length,shift=item.replacement.length-item.original.length;
                items=items.filter(row=>row!==item&&(row.field!==item.field||row.start+row.original.length<=start||row.start>=end));
                items.forEach(row=>{if(row.field===item.field&&row.start>=end)row.start+=shift;});
                render();input.focus();input.setSelectionRange(start,start+item.replacement.length);
            }));
        }
        button.addEventListener('click',()=>{
            if(state.busy||!confirm('ส่งหัวข้อและรายละเอียดข่าวปัจจุบันไปยังบริการ AI ภายนอกเพื่อช่วยตรวจคำผิดหรือไม่? ระบบจะไม่แก้ไขหรือบันทึกข่าวเอง'))return;
            runAction(async()=>{
                const snapshot=source();checked=null;items=[];box.textContent='กำลังช่วยตรวจคำผิด…';
                try{
                    if(!Number.isInteger(Number(owner))||Number(owner)<1||String(owner)!==String(window.eofficeUser?.id))throw Error('กรุณาเข้าสู่ระบบใหม่ก่อนตรวจคำ');
                    const data=await request('../api/siya-news-proofread.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:news.id||null,...snapshot,consent:true,_expected_owner:owner})});
                    if(!box.isConnected)return;
                    if(JSON.stringify(source())!==JSON.stringify(snapshot)){box.textContent='ข้อความเปลี่ยนแล้ว กรุณาตรวจคำอีกครั้ง';return;}
                    if(String(owner)!==String(window.eofficeUser?.id))throw Error('บัญชีเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ก่อนตรวจคำ');
                    if(!Array.isArray(data.suggestions)||data.suggestions.length>60||data.suggestions.some(item=>!item||!['title','body'].includes(item.field)||!['original','replacement','reason'].every(key=>typeof item[key]==='string'&&item[key].trim().length>0&&[...item[key]].length<=500)||item.original===item.replacement||!snapshot[item.field].includes(item.original)))throw Error('ผลตรวจคำไม่สมบูรณ์ กรุณาลองใหม่');
                    const normalized=data.suggestions.map(item=>({...item,replacement:item.replacement.replace(/\r\n?/g,'\n'),start:snapshot[item.field].indexOf(item.original)}));
                    if(normalized.some(item=>item.original===item.replacement||(item.field==='title'&&item.replacement.includes('\n'))))throw Error('ผลตรวจคำไม่สมบูรณ์ กรุณาลองใหม่');
                    checked=snapshot;items=normalized;hadSuggestions=items.length>0;render();
                    if(data.mock)box.insertAdjacentHTML('afterbegin','<p class="news-hint">โหมดทดสอบ: ผลสังเคราะห์ ไม่ได้ส่งข้อความไปบริการภายนอก</p>');
                }catch(error){if(box.isConnected)box.textContent=error.message;}
            },'content');
        });
    }
    async function saveContent(showMessage=true){const news=state.selected;const values=state.editing?valuesFromForm():null;const images=imagesChanged()?imageValues():null;const note=$('news-review-note')?.value;
        // Validate every pending field before the first write of a multi-step save.
        if(values)for(const [key,max] of Object.entries({title:255,location:255,department:255,body:30000}))if([...values[key]].length>max)throw Error('ข้อความยาวเกินกำหนด: '+key);
        if(values?.event_date&&!/^\d{4}-\d{2}-\d{2}$/.test(values.event_date))throw Error('วันที่กิจกรรมไม่ถูกต้อง');
        if(images)for(const image of images){if([...image.caption].length>500||[...image.credit].length>255)throw Error('คำบรรยายภาพไม่เกิน 500 ตัวอักษร และเครดิตภาพไม่เกิน 255 ตัวอักษร');}
        if(note!==undefined&&[...note].length>5000)throw Error('หมายเหตุไม่เกิน 5,000 ตัวอักษร');
        if(!news.id||contentChanged()){const result=await post({action:news.id?'save':'create',...(values||{}),...(news.id?{id:news.id,version:news.version}:{})});news.id=result.id||news.id;news.version=result.version;news.status=result.status_value||news.status;Object.assign(news,values);}
        if(images){const result=await post({action:'images_update',id:news.id,version:news.version,images});news.version=result.version;news.status=result.status_value||news.status;news.images=news.images.map(image=>({...image,...images.find(item=>item.id===image.id)})).sort((a,b)=>a.sort_order-b.sort_order);}
        // Keep the current form intact until every write succeeds, including review notes.
        if(note!==undefined)news.pendingReviewNote=note;if(showMessage){await loadDetail(news.id,news.status!=='approved'&&state.editing);await loadList();message('บันทึกเนื้อหาและภาพแล้ว'+(note?' · หมายเหตุจะบันทึกเมื่อผ่านตรวจ':''));}return news;
    }
    function renderUploadProgress(){
        const box=$('news-upload-progress'),batch=state.uploadBatch;
        if(!box)return;box.replaceChildren();
        if(!batch||Number(batch.newsId)!==Number(state.selected?.id))return;
        const labels={queued:'ยังไม่ได้ส่ง',uploading:'กำลังส่ง…',success:'บันทึกแล้ว',failed:'ส่งไม่สำเร็จ',uncertain:'ยังยืนยันผลไม่ได้ — ตรวจภาพในรายการก่อนเลือกส่งซ้ำ',confirmed:'ผู้ใช้ยืนยันว่าพบภาพในรายการแล้ว',cancelled:'ยกเลิกจากคิวแล้ว — ไม่ได้ลบภาพบน Server'};
        const heading=document.createElement('p');heading.className='news-hint';heading.textContent=`อัปโหลดสำเร็จ ${batch.items.filter(item=>item.status==='success').length}/${batch.items.length} ภาพ · ยืนยันพบแล้ว ${batch.items.filter(item=>item.status==='confirmed').length} · ยกเลิก ${batch.items.filter(item=>item.status==='cancelled').length}`;box.append(heading);
        const list=document.createElement('ul');list.className='news-upload-list';
        batch.items.forEach((item,index)=>{
            const row=document.createElement('li');row.textContent=item.file.name+' — '+labels[item.status];row.dataset.uploadState=item.status;
            const resolve=(status,label)=>{const button=document.createElement('button');button.type='button';button.className='news-button eo-btn';button.dataset.resolveUpload=status;button.dataset.uploadIndex=String(index);button.textContent=label;button.disabled=state.busy;button.addEventListener('click',()=>{
                if(state.busy||state.uploadBatch!==batch)return;
                const prompt=status==='confirmed'?`ตรวจรายการและเปิดภาพแล้ว พบภาพ “${item.file.name}” บน Server จริงหรือไม่? การยืนยันนี้ไม่ใช่การอัปโหลดหรือบันทึกใหม่`:`ยกเลิก “${item.file.name}” จากคิวหรือไม่? หากภาพถูกบันทึกบน Server แล้ว ภาพนั้นจะยังอยู่และจะไม่ถูกลบ`;
                if(!confirm(prompt))return;item.status=status;renderUploadProgress();message(status==='confirmed'?'ยืนยันพบภาพในรายการแล้ว · ไม่ส่งภาพนี้ซ้ำ':'ยกเลิกภาพจากคิวแล้ว · ไม่ได้ลบภาพบน Server',false,'images');
            });row.append(button);};
            if(item.status==='uncertain')resolve('confirmed','ตรวจแล้ว พบภาพในรายการ');
            if(['queued','failed','uncertain'].includes(item.status))resolve('cancelled','ยกเลิกจากคิว');
            list.append(row);
        });box.append(list);
        if(batch.items.some(item=>['failed','queued'].includes(item.status))){const retry=document.createElement('button');retry.type='button';retry.className='news-button eo-btn';retry.id='retry-news-upload';retry.textContent='ลองส่งเฉพาะภาพที่ยังไม่สำเร็จ';retry.disabled=state.busy;retry.addEventListener('click',()=>runAction(()=>uploadFiles([],true),'images'));box.append(retry);}
    }
    async function uploadFiles(files,retry=false){
        let news=state.selected;
        if(!retry){
            if(!files.length)return;
            if(news.images.length+files.length>10)throw Error('ข่าวหนึ่งรายการแนบได้ไม่เกิน 10 ภาพ กรุณาเลือกใหม่ให้พอดีกับจำนวนที่เหลือ');
            for(const file of files)if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>20*1024*1024)throw Error('ภาพไม่ถูกต้องหรือเกิน 20 MB: '+file.name);
            if(hasPendingUpload()&&!confirm('ยังมีคิวภาพค้าง ต้องการทิ้งคิวเดิมและเริ่มชุดใหม่หรือไม่? กด “ยกเลิก” เพื่อเก็บคิวเดิมแล้วใช้ปุ่มส่งต่อ ภาพที่บันทึกบน Server แล้วจะไม่ถูกลบ'))return;
            news=await saveContent(false);
            state.uploadBatch={newsId:news.id,items:files.map(file=>({file,status:'queued'}))};
        }else{
            if(Number(state.uploadBatch?.newsId)!==Number(news.id))return;
            await saveContent(false);await loadDetail(news.id);news=state.selected;
        }
        const batch=state.uploadBatch;
        for(const item of batch.items){
            if(!['queued','failed'].includes(item.status))continue;
            if(news.images.length>=10){item.status='failed';renderUploadProgress();throw Error('ครบ 10 ภาพแล้ว กรุณาตรวจรายการก่อนส่งต่อ');}
            item.status='uploading';renderUploadProgress();
            const form=new FormData();form.set('action','upload');form.set('id',news.id);form.set('version',news.version);form.set('image',item.file);
            const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),120000);
            try{
                const result=await request('../api/siya-news.php',{method:'POST',body:form,signal:controller.signal});
                if(!Number.isInteger(Number(result.version))||Number(result.version)<1||!/^[a-f0-9]{32}$/.test(result.image_id||''))throw Error('ยืนยันผลการบันทึกภาพไม่ได้ กรุณาตรวจรายการก่อนลองใหม่');
                item.status='success';news.version=result.version;
            }catch(error){
                // A dropped response (including server/proxy errors) may follow a committed upload.
                item.status=error.definitiveRejection?'failed':'uncertain';
                try{await loadDetail(news.id);news=state.selected;}catch{}
                renderUploadProgress();
                throw Error('หยุดอัปโหลดที่ '+item.file.name+' · '+error.message+' · ภาพที่บันทึกแล้วจะไม่ถูกส่งซ้ำ'+(item.status==='uncertain'?' กรุณาตรวจรายการภาพก่อนเลือกส่งภาพนี้อีกครั้ง':''));
            }finally{clearTimeout(timeout);}
            renderUploadProgress();
            // Refresh failures after a successful receipt must never mark that file retryable.
            await loadDetail(news.id);news=state.selected;
        }
        await loadList();renderUploadProgress();
        message(batch.items.some(item=>item.status==='uncertain')?'ส่งภาพที่เหลือแล้ว แต่ยังมีภาพที่ต้องตรวจสอบผลในรายการ':batch.items.some(item=>['confirmed','cancelled'].includes(item.status))?'ส่งภาพที่เหลือแล้ว · คิวนี้มีรายการยืนยันพบภาพหรือยกเลิกไว้':'อัปโหลดภาพครบแล้ว');
    }
    async function bindDetail(news,editable,canSubmit,isReview,producer){bindProofread(news);$('save-news')?.addEventListener('click',()=>runAction(()=>saveContent()));
        const capturedOwner=window.eofficeUser?.id;
        const trashAction=action=>{
            if(state.busy)return;
            if(hasPendingUpload()){message('กรุณาจัดการคิวอัปโหลดให้ครบก่อนย้ายข่าวไปถังขยะ',true,'images');return;}
            const prompt=action==='trash'?'ย้ายข่าวนี้ไปถังขยะหรือไม่? ข่าวจะหายจากรายการปกติและดาวน์โหลดไม่ได้ แต่ยังกู้คืนได้ การแก้ไขที่ยังไม่บันทึกจะไม่ถูกเก็บ':'กู้คืนข่าวนี้หรือไม่? ข่าวที่เคยส่งตรวจหรือผ่านตรวจจะกลับเข้าคิวตรวจคำ';
            if(!confirm(prompt))return;
            runAction(async()=>{
                await post({action,id:news.id,version:news.version,_expected_owner:capturedOwner});markClean();state.detailRequest++;clearDetail();const refreshed=await loadList();
                const result=action==='trash'?'ย้ายข่าวไปถังขยะแล้ว · กู้คืนได้ที่แท็บถังขยะ':'กู้คืนข่าวแล้ว · ดูได้ในรายการข่าวตามสิทธิ์ของคุณ';
                message(result+(refreshed?'':' · แต่โหลดรายการไม่สำเร็จ กรุณาเลือกแท็บอื่นแล้วกลับมาหรือรีเฟรชหน้า โดยไม่ต้องทำคำสั่งซ้ำ'),!refreshed);$('news-tab-'+state.scope)?.focus();
            },'toolbar');
        };
        $('delete-news')?.addEventListener('click',()=>trashAction('trash'));
        $('restore-news')?.addEventListener('click',()=>trashAction('restore'));
        $('refresh-news-list')?.addEventListener('click',()=>runAction(async()=>{if(!await loadList())return;root.classList.remove('show-detail');message('โหลดรายการล่าสุดแล้ว กรุณาเลือกข่าวเพื่อตรวจผลการบันทึกก่อนส่งซ้ำ',false,'toolbar');}));
        $('save-news-content')?.addEventListener('click',()=>runAction(()=>saveContent(),'content'));
        $('news-detail').querySelectorAll('.news-image-preview').forEach((preview,index)=>{const image=news.images[index],button=document.createElement('button');button.type='button';button.className='news-image-preview news-open-image';button.setAttribute('aria-label','ดูภาพเต็ม: '+image.original_name);button.setAttribute('aria-haspopup','dialog');button.append(...preview.childNodes);const hint=document.createElement('span');hint.className='news-open-image__hint';hint.textContent='ดูภาพเต็ม';button.append(hint);preview.replaceWith(button);button.addEventListener('click',()=>openImage(image,button));});
        $('edit-news')?.addEventListener('click',()=>{if(!mayLeave())return;markClean();state.editing=true;renderDetail();$('news-title').focus();});
        $('cancel-edit')?.addEventListener('click',()=>{if(!mayLeave())return;runAction(()=>loadDetail(news.id,false));});
        $('news-back')?.addEventListener('click',()=>{if(!mayLeave())return;markClean();state.detailRequest++;clearDetail();$('create-news').hidden?$('news-search').focus():$('create-news').focus();});
        $('add-news-images')?.addEventListener('click',()=>$('news-image-files').click());
        const transition=action=>{
            if(state.busy)return;
            if(hasPendingUpload()){message('ยังมีภาพค้างหรือยังยืนยันผลไม่ได้ กรุณาส่งต่อ ยืนยันพบภาพ หรือยกเลิกจากคิวให้ครบก่อนเปลี่ยนสถานะข่าว',true,'images');return;}
            const field=$('news-review-note'),note=field?.value.trim()||'';
            const content=state.editing?valuesFromForm():state.selected;
            if(['submit','approve'].includes(action)&&(!content.title.trim()||!content.body.trim())){message('กรุณากรอกหัวข้อและเนื้อหาข่าวก่อนส่งตรวจหรือผ่านตรวจ',true,'content');return;}
            return runAction(async()=>{const latest=await saveContent(false);await post({action,id:latest.id,version:latest.version,review_note:note});await loadDetail(latest.id,false);await loadList();message(action==='approve'?'บันทึกและผ่านตรวจคำแล้ว พร้อมให้ผู้จัดทำวารสารนำไปใช้':'บันทึกและส่งข่าวให้บรรณาธิการตรวจคำแล้ว');});
        };
        $('submit-news')?.addEventListener('click',()=>transition('submit'));
        $('approve-news')?.addEventListener('click',()=>transition('approve'));
        $('news-content-form')?.addEventListener('submit',event=>{event.preventDefault();if(editable)runAction(()=>saveContent(),'content');});
        $('news-review-form')?.addEventListener('submit',event=>event.preventDefault());
        $('news-image-files')?.addEventListener('change',event=>{const input=event.target,files=[...input.files];if(!files.length)return;runAction(async()=>{try{await uploadFiles(files);}finally{input.value='';}},'images');});
        $('news-image-meta-form')?.addEventListener('submit',event=>{event.preventDefault();runAction(()=>saveContent(),'images');});
        $('news-detail').querySelectorAll('[data-move]').forEach(button=>button.addEventListener('click',()=>{const cards=[...$('news-detail').querySelectorAll('.news-image-card')],card=button.closest('.news-image-card'),index=cards.indexOf(card),next=index+Number(button.dataset.move);if(next<0||next>=cards.length)return;const parent=card.parentElement;if(next<index)parent.insertBefore(card,cards[next]);else parent.insertBefore(cards[next],card);cards.forEach(item=>item.querySelectorAll('[data-move]').forEach(control=>control.disabled=false));parent.firstElementChild?.querySelector('[data-move="-1"]')?.setAttribute('disabled','');parent.lastElementChild?.querySelector('[data-move="1"]')?.setAttribute('disabled','');$('news-image-meta-form').dispatchEvent(new Event('eoffice:form-dirty',{bubbles:true}));}));
        $('news-detail').querySelectorAll('[data-remove]').forEach(button=>button.addEventListener('click',()=>{if(!confirm('บันทึกการแก้ไขและนำภาพนี้ออกจากข่าวหรือไม่? หากข่าวผ่านตรวจแล้วจะกลับเข้าคิวตรวจใหม่'))return;const imageId=button.closest('.news-image-card').dataset.imageId;runAction(async()=>{const latest=await saveContent(false);await post({action:'image_remove',id:latest.id,version:latest.version,image_id:imageId});await loadDetail(latest.id);await loadList();message('นำภาพออกจากข่าวแล้ว');},'images');}));
        $('news-detail').querySelectorAll('.news-image-preview img').forEach(image=>image.addEventListener('error',()=>{image.hidden=true;image.nextElementSibling.hidden=false;}));
        $('copy-news')?.addEventListener('click',async()=>{const text=[news.title,news.event_date&&`วันที่กิจกรรม: ${news.event_date}`,news.location&&`สถานที่: ${news.location}`,news.department&&`กลุ่มงาน: ${news.department}`,'',news.body].filter(value=>value!==false&&value!==null).join('\n');try{await navigator.clipboard.writeText(text);if(state.selected===news)message('คัดลอกข้อความข่าวแล้ว',false,'toolbar');}catch{if(state.selected===news)message('ไม่สามารถคัดลอกอัตโนมัติได้',true,'toolbar');}});
        $('mark-used')?.addEventListener('click',()=>runAction(async()=>{await post({action:'used',id:news.id});await loadDetail(news.id,false);await loadList();message('บันทึกการนำข่าวไปใช้แล้ว');},'toolbar'));
    }
    function createDraft(){if(!has('news_submit')||!mayLeave())return;markClean();state.unconfirmedWrite=false;state.detailRequest++;state.editing=true;state.selected={id:null,version:0,title:'',event_date:null,location:'',department:'',body:'',status:'draft',owner_id:window.eofficeUser?.id,is_owner:true,owner_name:window.eofficeUser?.name||'',images:[],history:[]};renderDetail();focusDetail();$('news-title').focus();}
    function edited(event){if(!event.target.closest?.('form'))return;state.dirty=true;const label=$('news-save-state');if(label)label.textContent='มีการแก้ไขที่ยังไม่บันทึก';}
    root.addEventListener('input',edited);root.addEventListener('change',edited);root.addEventListener('eoffice:form-dirty',edited);
    window.addEventListener('beforeunload',event=>{if(state.dirty||state.busy||state.unconfirmedWrite||hasPendingUpload()){event.preventDefault();event.returnValue='';}});
    window.eofficeRegisterModuleChanges?.(()=>state.dirty||state.busy||state.unconfirmedWrite||hasPendingUpload());
    $('create-news').addEventListener('click',createDraft);
    $('news-load-more').addEventListener('click',()=>loadList(true));
    let searchTimer; $('news-search').addEventListener('input',()=>{clearTimeout(searchTimer);state.query=$('news-search').value.trim();searchTimer=setTimeout(loadList,220);});
    async function start(){if(window.eofficeSessionState?.status==='pending')await new Promise(resolve=>window.addEventListener('eoffice:session-updated',function done(event){if(event.detail?.status!=='pending'){window.removeEventListener('eoffice:session-updated',done);resolve();}}));if(!window.eofficeUser||!scopeOptions().length){message('กรุณาเข้าสู่ระบบด้วยบัญชีที่ได้รับสิทธิ์ SIYA NEWS',true);return;}state.scope=has('news_editor')?'review':has('news_producer')?'ready':'mine';renderTabs();await loadList();}
    window.addEventListener('eoffice:permissions-changed',()=>{if(!scopeOptions().length){state.rows=[];clearDetail();message('สิทธิ์ SIYA NEWS ถูกถอนแล้ว กรุณาโหลดหน้าใหม่',true);return;}renderTabs();});
    start();
})();
