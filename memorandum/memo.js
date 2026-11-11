(() => {
    const $ = id => document.getElementById(id);
    const form = $('memo-form');
    if (!form) return;

    const fields = {
        department: $('department'), number: $('memo-number'), date: $('memo-date'),
        subject: $('subject'), recipient: $('recipient'), body: $('body-text'),
        closing: $('closing'), signer: $('signer'), position: $('position')
    };
    const preview = {
        department: $('preview-department'), number: $('preview-number'), date: $('preview-date'),
        subject: $('preview-subject'), recipient: $('preview-recipient'), body: $('preview-body'),
        closing: $('preview-closing'), signer: $('preview-signer'), position: $('preview-position')
    };
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const panels = new Map(tabs.map(tab => [tab, $(tab.getAttribute('aria-controls'))]));
    const setText = (node, value, fallback) => {
        const text=value.trim();node.textContent=toThaiNumerals(text||fallback);node.classList.toggle('paper-fallback',!text);
    };
    const toThaiNumerals = value => value.replace(/[0-9]/g,d=>String.fromCharCode(d.charCodeAt(0)+0x0e50-0x30));

    const today = new Date();
    fields.date.value = [today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');

    function thaiDate(value) {
        if (!value) return '';
        const date = new Date(`${value}T00:00:00`);
        if (Number.isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat('th-TH-u-ca-buddhist',{day:'numeric',month:'long',year:'numeric'}).format(date);
    }

    function updatePreview() {
        setText(preview.department,fields.department.value,'[ส่วนราชการ]');
        setText(preview.number,fields.number.value,'[เลขที่]');
        setText(preview.date,thaiDate(fields.date.value),'[วันที่]');
        setText(preview.subject,fields.subject.value,'[ชื่อเรื่อง]');
        setText(preview.recipient,fields.recipient.value,'[ผู้รับ]');
        setText(preview.signer,fields.signer.value.trim()?`(${fields.signer.value.trim()})`:'','(ชื่อผู้ลงนาม)');
        setText(preview.position,fields.position.value.trim()?`ตำแหน่ง ${fields.position.value.trim()}`:'','ตำแหน่ง');

        const paragraphs = fields.body.value.split(/\n\s*\n/).map(value=>value.replace(/\s*\n\s*/g,' ').trim()).filter(Boolean);
        preview.body.replaceChildren();
        if (!paragraphs.length) {
            const placeholder = document.createElement('p');placeholder.className='paper-placeholder';
            placeholder.textContent='เนื้อหาบันทึกข้อความจะแสดงบริเวณนี้';preview.body.append(placeholder);
        } else {
            for (const value of paragraphs) {
                const paragraph=document.createElement('p');paragraph.textContent=toThaiNumerals(value);preview.body.append(paragraph);
            }
        }
        const closing=fields.closing.value.trim();
        preview.closing.textContent=toThaiNumerals(closing);preview.closing.hidden=!closing;
    }

    Object.values(fields).forEach(field=>field.addEventListener('input',updatePreview));
    Object.values(fields).forEach(field=>field.addEventListener('change',updatePreview));

    $('fill-sample').addEventListener('click',()=>{
        const example={
            department:'[ชื่อหน่วยงาน] สังกัด[ฝ่าย] อำเภอเมือง จังหวัด[จังหวัด]',
            number:'',
            date:'2025-10-01',
            subject:'ขออนุมัติข้อตกลงในการพัฒนางาน (PA) ประจำปีงบประมาณ พ.ศ. 2569',
            recipient:'ผู้อำนวยการสถาบัน[ชื่อหน่วยงาน]',
            body:'ด้วย ข้าพเจ้า [ชื่อและนามสกุล] ตำแหน่ง [ตำแหน่ง] [ชื่อหน่วยงาน] กลุ่มสาระการเรียนรู้ วิทยาศาสตร์และเทคโนโลยี ได้จัดทำข้อตกลงในการพัฒนางาน (PA) ประจำปีงบประมาณ พ.ศ. 2569 (ระหว่างวันที่ 1 ตุลาคม 2568 – 30 กันยายน 2569) เพื่อเป็นการวางแผนการพัฒนาคุณภาพการศึกษา ตามประเด็นท้าทายในการพัฒนาคุณภาพผู้เรียนโดยมุ่งจัดทำให้สอดคล้องกับมาตรฐานตำแหน่ง [ตำแหน่ง] ครู ด้วย\n\nในการนี้ ข้าพเจ้าจึงขออนุมัติข้อตกลงในการพัฒนางาน (PA) ประจำปีงบประมาณ พ.ศ. 2569 เพื่อใช้เป็นหลักฐานประกอบการพัฒนาคุณภาพการศึกษาของ[หน่วยงาน] ต่อไป',
            closing:'จึงเรียนมาเพื่อโปรดทราบและพิจารณา',
            signer:'[ชื่อและนามสกุล]',
            position:'[ตำแหน่งและวิทยฐานะ]'
        };
        for(const [key,value] of Object.entries(example)) fields[key].value=value;
        updatePreview();
    });

    function activateTab(tab,focus=true) {
        for (const item of tabs) {
            const active=item===tab;
            item.classList.toggle('is-active',active);item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;
            panels.get(item).hidden=!active;
        }
        if(focus)tab.focus();
    }
    tabs.forEach((tab,index)=>{
        tab.addEventListener('click',()=>activateTab(tab,false));
        tab.addEventListener('keydown',event=>{
            let next=index;
            if(event.key==='ArrowRight')next=(index+1)%tabs.length;
            else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
            else if(event.key==='Home')next=0;
            else if(event.key==='End')next=tabs.length-1;
            else return;
            event.preventDefault();activateTab(tabs[next]);
        });
    });

    const localImages=new Map();
    const imageInputs=[
        {input:$('emblem-file'),image:$('emblem-preview'),defaultSrc:new URL('assets/garuda-reference.png',document.baseURI).href,help:$('emblem-help')},
        {input:$('signature-file'),image:$('signature-preview'),defaultSrc:'',help:$('signature-help')}
    ];
    const restoreImage=item=>{
        item.image.hidden=!item.defaultSrc;
        if(item.defaultSrc)item.image.src=item.defaultSrc;
        else item.image.removeAttribute('src');
    };
    for(const item of imageInputs){
        item.defaultHelp=item.help.textContent;
        item.input.addEventListener('change',()=>{
            const previous=localImages.get(item.input.id);
            if(previous){URL.revokeObjectURL(previous);localImages.delete(item.input.id);}
            const file=item.input.files?.[0];
            if(!file){restoreImage(item);item.help.textContent=item.defaultHelp;return;}
            if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024){
                item.input.value='';restoreImage(item);
                item.help.textContent='รองรับเฉพาะ PNG, JPEG หรือ WebP ขนาดไม่เกิน 2 MB';return;
            }
            item.help.textContent=item.defaultHelp;
            const url=URL.createObjectURL(file);localImages.set(item.input.id,url);item.image.src=url;item.image.hidden=false;
            if(item.placeholder)item.placeholder.hidden=true;
        });
    }

    form.addEventListener('reset',()=>{
        window.setTimeout(()=>{fields.date.value=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
            for(const item of imageInputs){
                const url=localImages.get(item.input.id);if(url)URL.revokeObjectURL(url);localImages.delete(item.input.id);
                restoreImage(item);item.help.textContent=item.defaultHelp;
            }
            updatePreview();
        },0);
    });

    const rootDocument=document.documentElement.ownerDocument;
    const printStyle=rootDocument.createElement('style');
    printStyle.textContent='@page{size:A4 portrait;margin:1cm 2.5cm 2cm 25.04mm}@media print{body,body.eoffice-module-page{min-height:0!important;background:#fff!important}body.eoffice-module-page::before{display:none!important;content:none!important}html.memo-printing #sidebar,html.memo-printing #mobile-header,html.memo-printing #overlay,html.memo-printing #main-content-area{display:none!important}html.memo-printing #app-layout{display:block!important;min-height:0!important;height:auto!important}html.memo-printing #main_div{display:block!important;margin:0!important;padding:0!important;overflow:visible!important;min-height:0!important}html.memo-printing #module-viewport{display:block!important;visibility:visible!important}html.memo-printing .eoffice-module-content{margin:0!important;padding:0!important}html.memo-printing .eoffice-module-view{margin:0!important;padding:0!important}}';
    const printMode=()=>{rootDocument.documentElement.classList.add('memo-printing');if(!printStyle.isConnected)rootDocument.head.append(printStyle);};
    const clearPrintMode=()=>{rootDocument.documentElement.classList.remove('memo-printing');printStyle.remove();};
    $('print-memo').addEventListener('click',async()=>{
        activateTab(tabs[0],false);
        try{await document.fonts?.ready;}catch{}
        if(!document.hidden)window.print();
    });
    window.addEventListener('beforeprint',()=>{activateTab(tabs[0],false);printMode();});
    window.addEventListener('afterprint',clearPrintMode);
    window.addEventListener('eoffice:module-dispose',()=>{clearPrintMode();for(const url of localImages.values())URL.revokeObjectURL(url);localImages.clear();},{once:true});
    updatePreview();
})();
