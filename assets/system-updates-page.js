(() => {
    const ownerId = window.eofficeUser?.id;
    const list = document.getElementById('updates-list');
    const feedback = document.getElementById('updates-feedback');
    const retry = document.getElementById('updates-retry');
    let latestId, loading = false;
    const make = (tag, className, text) => {
        const node = document.createElement(tag);
        node.className = className;
        if (text) node.textContent = text;
        return node;
    };
    function markVisibleRead() {
        if (!document.hidden && latestId) window.eofficeSystemUpdates.markRead(latestId, ownerId);
    }
    async function render({force = false} = {}) {
        if (loading) return;
        loading = true;
        list.setAttribute('aria-busy', 'true');
        retry.hidden = true; feedback.hidden = false;
        feedback.textContent = 'กำลังโหลดประวัติอัปเดต…';
        try {
            const items = await window.eofficeSystemUpdates.load({force});
            const cards = items.map((item, index) => {
                const card = make('article', 'update-card');
                const meta = make('div', 'update-meta');
                const date = make('time', '', new Intl.DateTimeFormat('th-TH', {dateStyle:'long', timeZone:'Asia/Bangkok'}).format(new Date(item.date + 'T00:00:00+07:00')));
                date.dateTime = item.date; meta.append(date);
                if (item.version) meta.append(make('span', '', `เวอร์ชัน ${item.version}`));
                if (!index) meta.append(make('span', 'update-latest', 'ล่าสุด'));
                card.append(meta, make('h2', '', item.title), make('p', 'update-summary', item.summary));
                for (const [key,label] of [['added','เพิ่มใหม่'],['improved','ปรับปรุง'],['fixed','แก้ไข']]) {
                    if (!item[key].length) continue;
                    const section = make('section', `update-section update-section--${key}`);
                    const bullets = make('ul', '');
                    for (const text of item[key]) bullets.append(make('li', '', text));
                    section.append(make('h3', '', label), bullets); card.append(section);
                }
                return card;
            });
            list.replaceChildren(...cards);
            latestId = items[0]?.id;
            feedback.hidden = items.length > 0;
            feedback.textContent = 'ยังไม่มีรายการอัปเดตระบบ';
            markVisibleRead();
        } catch {
            feedback.hidden = false;
            feedback.textContent = 'โหลดประวัติอัปเดตไม่สำเร็จ กรุณาลองใหม่';
            retry.hidden = false;
        } finally { loading = false; list.setAttribute('aria-busy', 'false'); }
    }
    const refreshVisible = () => {
        if (!document.hidden) return render({force:true});
    };
    retry.addEventListener('click', () => render({force:true}));
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('pageshow', refreshVisible);
    window.eofficeRegisterModuleResume?.(refreshVisible);
    render({force:true});
})();
