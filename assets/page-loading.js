/* Shared content-only skeleton for module navigation and document lists. */
(() => {
    const element=(tag,className)=>{
        const node=document.createElement(tag);node.className=className;return node;
    };
    const bar=className=>element('div',`eoffice-skeleton__bar ${className||''}`);
    window.eofficePageLoading=Object.freeze({
        show(target,{kind='page',label='กำลังโหลดเนื้อหา'}={}) {
            if(!target)return;
            target.dataset.loading='true';target.setAttribute('aria-busy','true');
            const root=element('div',`eoffice-skeleton eoffice-skeleton--${kind}`);
            const message=element('span','eoffice-skeleton__label');if(target.getAttribute('role')!=='status')message.setAttribute('role','status');message.textContent=label;
            const decoration=element('div','eoffice-skeleton__decoration');decoration.setAttribute('aria-hidden','true');
            const toolbar=element('div','eoffice-skeleton__toolbar');toolbar.append(bar('eoffice-skeleton__search'),bar('eoffice-skeleton__action'));decoration.append(toolbar);
            if(kind==='page') {
                const cards=element('div','eoffice-skeleton__cards');
                for(let i=0;i<3;i++) {
                    const card=element('div','eoffice-skeleton__card');card.append(bar('eoffice-skeleton__short'),bar('eoffice-skeleton__value'),bar('eoffice-skeleton__medium'));cards.append(card);
                }
                decoration.append(cards);
            }
            const panel=element('div','eoffice-skeleton__panel');
            for(let i=0;i<6;i++) {
                const row=element('div','eoffice-skeleton__row');row.append(bar('eoffice-skeleton__short'),bar(''),bar('eoffice-skeleton__medium'));panel.append(row);
            }
            decoration.append(panel);root.append(message,decoration);target.replaceChildren(root);
        },
        finish(target) {
            if(!target)return;
            delete target.dataset.loading;target.removeAttribute('aria-busy');
        }
    });
})();
