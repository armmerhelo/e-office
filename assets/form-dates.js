(() => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone:'Asia/Bangkok',calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit'
    });
    const today = (date = new Date()) => {
        const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type,part.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    };
    const addDays = (value,days) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isInteger(days)) return null;
        const date = new Date(`${value}T00:00:00Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) return null;
        date.setUTCDate(date.getUTCDate()+days);
        const result = date.toISOString().slice(0,10);
        return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
    };
    const afterOneHour = (date,time) => {
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
        const [hours,minutes] = time.split(':').map(Number),end = hours*60+minutes+60;
        const nextDate=addDays(date,Math.floor(end/1440));
        if (!nextDate) return null;
        return {date:nextDate,time:`${String(Math.floor(end/60)%24).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`};
    };
    const refreshBookingBounds = document => {
        const minimum=today();
        for(const id of ['startDate','endDate']) document.getElementById(id).setAttribute('min',minimum);
    };
    const attachBookingTimes = (form,document) => {
        if (form.dataset.eofficeBookingTimeReady==='true') return;
        form.dataset.eofficeBookingTimeReady='true';
        const refresh=()=>refreshBookingBounds(document);
        refresh();
        window.addEventListener?.('focus',refresh);window.addEventListener?.('pageshow',refresh);
        document.addEventListener?.('visibilitychange',()=>{if(!document.hidden)refresh();});
        for(const id of ['startDate','endDate']) {
            const field=document.getElementById(id);
            field.addEventListener('focus',refresh);field.addEventListener('input',refresh);
        }
        form.addEventListener('submit',event=>{
            refresh();
            if(form.checkValidity && !form.checkValidity()) {
                event.preventDefault();event.stopImmediatePropagation();form.reportValidity();
            }
        },true);
        const startDate=document.getElementById('startDate'),startTime=document.getElementById('startTime');
        const endDate=document.getElementById('endDate'),endTime=document.getElementById('endTime');
        let suggested=null,automaticDate=endDate.value,manualEnd=false;
        const preserveManualEnd = () => {
            if (form.dataset.eofficeDraftRestoring==='true') return;
            manualEnd=true;suggested=null;
        };
        for (const field of [endDate,endTime]) {
            field.addEventListener('input',preserveManualEnd);field.addEventListener('change',preserveManualEnd);
        }
        const suggest = event => {
            if (form.dataset.eofficeRequiresDraft==='true' && form.dataset.eofficeDraftInitialized!=='true' &&
                form.dataset.eofficeDraftState!=='unavailable' && event?.type!=='eoffice:draft-restored') return;
            const stillSuggested=suggested && endDate.value===suggested.date && endTime.value===suggested.time;
            const defaultDate=!endDate.value || endDate.value===automaticDate || endDate.value===startDate.value;
            if (!stillSuggested && (manualEnd || endTime.value || !defaultDate)) return;
            const result=afterOneHour(startDate.value,startTime.value);
            if (!result) return;
            endDate.value=result.date;endTime.value=result.time;suggested=result;automaticDate=result.date;manualEnd=false;
            endTime.classList.remove('border-red-500','ring-red-500');
        };
        startDate.addEventListener('change',suggest);startTime.addEventListener('change',suggest);
        form.addEventListener('eoffice:draft-restored',suggest);
        form.addEventListener('reset',()=>{suggested=null;automaticDate='';manualEnd=false;});
    };
    window.eofficeDates=Object.freeze({today,addDays,afterOneHour,refreshBookingBounds,attachBookingTimes});
})();
