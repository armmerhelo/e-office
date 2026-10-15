/* Local SVGs: booking icons work in the document and the module ShadowRoot. */
(() => {
    const paths={
        user:'M20 21v-2a7 7 0 00-14 0v2M17 7a4 4 0 11-8 0 4 4 0 018 0',
        users:'M16 21v-2a6 6 0 00-12 0v2M14 7a4 4 0 11-8 0 4 4 0 018 0M20 21v-2a6 6 0 00-3-5M17 3a4 4 0 010 8',
        calendar:'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2M7 15l3 3 6-6',
        days:'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2M7 14h.01M12 14h.01M17 14h.01M7 18h.01M12 18h.01M17 18h.01',
        building:'M4 22V4h12v18M16 10h4v12M2 22h20M8 8h4M8 12h4M8 16h4M9 22v-3h2v3',
        chevron:'M6 9l6 6 6-6',
        plug:'M9 3v5M15 3v5M7 8h10v3a5 5 0 01-10 0V8M12 16v5',
        send:'M22 2L9 15M22 2l-7 20-6-7-7-6 20-7',
        tv:'M4 6h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2M8 2l4 4 4-4',
        location:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1116 0M15 10a3 3 0 11-6 0 3 3 0 016 0',
        check:'M5 12l4 4L19 6',
        search:'M17 10a7 7 0 11-14 0 7 7 0 0114 0M15 15l6 6',
        folder:'M3 20V5a2 2 0 012-2h5l3 3h6a2 2 0 012 2v3M3 20l3-9h16l-3 9H3',
        edit:'M15 5l4 4M4 20l4-1L21 6a2.8 2.8 0 00-4-4L4 15v5M13 20h9',
        x:'M6 6l12 12M6 18L18 6',
        save:'M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h12l4 4v12a2 2 0 01-2 2M7 3v6h10V3M7 21v-8h10v8',
        success:'M21 12a9 9 0 11-18 0 9 9 0 0118 0M8 12l3 3 5-6',
        clock:'M21 12a9 9 0 11-18 0 9 9 0 0118 0M12 7v5l3 2',
        speaker:'M11 4L6 8H2v8h4l5 4V4M15 8a6 6 0 010 8M18 5a10 10 0 010 14',
        desktop:'M4 3h16a2 2 0 012 2v12H2V5a2 2 0 012-2M12 17v4M8 21h8',
        projector:'M2 4h20M4 4v12h16V4M12 16v6M8 22l4-3 4 3M10 7l6 3-6 3V7',
        coffee:'M3 8h13v7a5 5 0 01-5 5H8a5 5 0 01-5-5V8M16 9h2a3 3 0 010 6h-2M2 23h16M7 2v3M12 2v3',
        cancelled:'M21 12a9 9 0 11-18 0 9 9 0 0118 0M9 9l6 6M9 15l6-6',
        printer:'M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v8H6v-8M17 11h1',
        warning:'M21 12a9 9 0 11-18 0 9 9 0 0118 0M12 7v6M12 17h.01',
        identity:'M3 4h18v16H3V4M11 10a2 2 0 11-4 0 2 2 0 014 0M5 17a4 4 0 018 0M15 9h3M15 13h3'
    };
    const aliases={
        'ph-calendar-check':'calendar','ph-user':'user','ph-magnifying-glass':'search','ph-folder-open':'folder',
        'ph-pencil-simple':'edit','ph-x':'x','ph-floppy-disk':'save','ph-check-circle':'success','ph-clock':'clock',
        'ph-speaker-high':'speaker','ph-desktop':'desktop','ph-projector-screen':'projector','ph-coffee':'coffee',
        'ph-check-circle-fill':'success','ph-x-circle-fill':'cancelled','ph-clock-fill':'clock','ph-users':'users',
        'ph-printer':'printer','ph-warning-circle':'warning','ph-identification-card':'identity',
        'fa-user':'user','fa-building':'building','fa-chevron-down':'chevron','fa-calendar-days':'days',
        'fa-plug':'plug','fa-paper-plane':'send','fa-users':'users','fa-tv':'tv','fa-location-dot':'location','fa-check':'check'
    };
    function render(root) {
        const icons=[...(root.matches?.('i')?[root]:[]),...root.querySelectorAll('i')];
        for(const icon of icons) {
            const key=[...icon.classList].map(name=>aliases[name]).find(Boolean);
            if(!key || icon.dataset.bookingIcon===key)continue;
            const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
            for(const [name,value]of Object.entries({viewBox:'0 0 24 24',width:'100%',height:'100%',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(name,value);
            const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[key]);svg.append(path);
            icon.replaceChildren(svg);icon.dataset.bookingIcon=key;icon.setAttribute('aria-hidden','true');
            Object.assign(icon.style,{display:'inline-flex',width:'1em',height:'1em',fontStyle:'normal',lineHeight:'1',verticalAlign:'-0.125em'});
        }
    }
    function start() {
        const root=document.querySelector('.eoffice-module-view') || document.getElementById('bookingForm') || document.getElementById('editForm');
        if(!root)return;
        render(root);
        const observer=new MutationObserver(records=>{
            for(const record of records) {
                if(record.type==='attributes')render(record.target);
                else for(const node of record.addedNodes)if(node.nodeType===1)render(node);
            }
        });
        observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
        window.addEventListener('eoffice:module-dispose',()=>observer.disconnect(),{once:true});
    }
    window.eofficeBookingIcons=Object.freeze({render});
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
