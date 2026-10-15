/* Same-document module host. Shadow DOM isolates legacy module CSS and IDs;
 * per-module closures isolate scripts. This is not a security sandbox. */
(() => {
    const script = document.currentScript;
    const appRoot = new URL('../', script.src);
    const routes = Object.freeze({
        members:'management/user_manage.html', groups:'management/department_manage.html',
        book:'external_number_booking/external_number_booking.html', my_public:'email_send/my_dashboard.html',
        send_email:'email_send/doc_send_email.html', ai_settings:'email_send/ai_settings.html',
        room_booking:'room_booking/index.html', room_booking2:'room_booking/new_room.html',
        edit_room_booking:'room_booking/edit_room_booking.html', maintenance:'maintenance_requests/index.html',
        maintenance_admin:'maintenance_requests/admin.html'
    });
    const cache = new Map(), libraries = new Map();
    const roleIndependent=new Set(['room_booking','room_booking2','maintenance']);
    const accessStamp=()=>JSON.stringify([String(window.eofficeUser?.id),window.eofficeUser?.status,
        window.eofficeUser?.email,window.eofficeUser?.name,[...(window.eofficeUser?.permissions||[])].sort()]);
    let dataRevision=0;
    let popupOwner=null;
    let moduleUtilities;
    let active = null, sequence = 0;
    const host = document.createElement('section');host.id='module-viewport';host.hidden=true;
    document.getElementById('main_div').append(host);
    const status = document.createElement('div');status.className='eoffice-module-status';status.setAttribute('role','status');
    const stopLoading=()=>{window.eofficePageLoading.finish(status);host.removeAttribute('aria-busy');};
    const texts = new Map();
    const text = async url => {
        const key=String(url);
        if (!texts.has(key)) texts.set(key,fetch(key,{credentials:'same-origin',cache:'no-cache',signal:AbortSignal.timeout(30000)}).then(response=>{
            if (!response.ok) throw Error(`โหลด ${new URL(key).pathname} ไม่สำเร็จ (${response.status})`);
            return response.text();
        }).catch(error=>{texts.delete(key);throw error;}));
        return texts.get(key);
    };
    const absolute = (value,base) => new URL(value,base).href;
    const css = (source,base) => source.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,(all,quote,value)=>
        /^(?:data:|#)/.test(value)?all:`url("${absolute(value,base)}")`)
        .replace(/:root\b/g,':host').replace(/(^|[\s,{>+~])body(?=[\s,.#:{>+~\[]|$)/g,'$1.eoffice-runtime-body');
    async function library(url) {
        if (!libraries.has(url)) libraries.set(url,new Promise((resolve,reject)=>{
            const node=document.createElement('script');node.src=url;node.onload=resolve;node.onerror=()=>reject(Error('โหลด library ไม่สำเร็จ'));document.head.append(node);
        }).catch(error=>{libraries.delete(url);throw error;}));
        return libraries.get(url);
    }
    function context(view,url,body,shadow) {
        const values=Object.create(null),events=new EventTarget(),documentEvents=new EventTarget(),dirty=new Set(),retainedForms=new Set(),refreshers=new Set(),suspenders=new Set(),resumers=new Set(),suspendedDialogs=new Set();
        const ctx={view,url,body,shadow,events,dirty,active:false,currentScript:null,readyState:'loading',values,owner:String(window.eofficeUser?.id),disposed:false,
            access:accessStamp(),permissionStale:false,dataDirty:false,lastDataRevision:dataRevision,visited:false};
        const timers=new Set(),intervals=new Set(),abort=new AbortController();
        const bodyStyle=body.style;
        ctx.fetch=async(input,options={})=>{
            const method=String(options.method||(input instanceof Request?input.method:'GET')).toUpperCase(),read=['GET','HEAD'].includes(method);
            if(read && window.eofficeSessionState?.status==='pending')await new Promise((resolve,reject)=>{
                const finish=()=>{if(window.eofficeSessionState?.status==='pending'&&!ctx.disposed)return;cleanup();ctx.disposed?reject(new DOMException('Module disposed','AbortError')):resolve();};
                const cleanup=()=>{window.removeEventListener('eoffice:session-updated',finish);abort.signal.removeEventListener('abort',finish);};
                window.addEventListener('eoffice:session-updated',finish);abort.signal.addEventListener('abort',finish,{once:true});finish();
            });
            if(ctx.disposed || ctx.permissionStale || ctx.owner!==String(window.eofficeUser?.id) ||
                window.eofficeFormOwner?.hasConflict() || window.eofficeSessionState?.status!=='authenticated')throw new DOMException('บัญชีหรือสิทธิ์เปลี่ยนแล้ว กรุณาโหลดโมดูลใหม่','AbortError');
            const response=await fetch(input instanceof Request?input:absolute(String(input),url),{...options,
                signal:options.signal && AbortSignal.any?AbortSignal.any([options.signal,abort.signal]):options.signal||abort.signal});
            if(!read && response.ok) {
                const result=await response.clone().json().catch(()=>null);
                if(result?.status==='success')dataChanged(ctx);
            }
            return response;
        };
        const styledBody=new Proxy(body,{
            get(target,key) {
                if(key==='style')return new Proxy(bodyStyle,{
                    get(style,name){const value=Reflect.get(style,name,style);return typeof value==='function'?value.bind(style):value;},
                    set(style,name,value){style[name]=value;if(name==='overflow' && ctx.active)document.body.style.overflow=value||'auto';return true;}
                });
                const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
            }
        });
        const navigateModule=(value,replace=false)=>{
            const target=new URL(value,url),key=Object.keys(routes).find(key=>new URL(routes[key],appRoot).pathname===target.pathname);
            if(target.origin===appRoot.origin && key)return window.showView(key,replace?'load':undefined);
            if(target.origin===appRoot.origin && target.pathname===new URL('index.php',appRoot).pathname)return window.showView(target.searchParams.get('view')||'received',replace?'load':undefined);
            if(window.eofficeApproveDocumentLeaving?.()!==false)window.location[replace?'replace':'assign'](target.href);
        };
        const moduleLocation={
            get href(){return url.href;},set href(value){navigateModule(value);},get pathname(){return url.pathname;},get origin(){return url.origin;},
            get search(){return url.search;},get hash(){return url.hash;},get hostname(){return url.hostname;},
            assign:value=>navigateModule(value),replace:value=>navigateModule(value,true),
            reload:()=>window.location.reload(),toString:()=>url.href
        };
        const boundWindow=new Set(['alert','confirm','prompt','open','matchMedia','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','queueMicrotask','structuredClone','createImageBitmap','scrollTo','scrollBy','atob','btoa']);
        const moduleWindow=new Proxy(values,{
            get(target,key) {
                if (key===Symbol.unscopables) return undefined;
                if (['window','self','globalThis','parent','top'].includes(key)) return moduleWindow;
                if (key==='document') return moduleDocument;
                if (key==='location') return moduleLocation;
                if (key==='eofficeSessionState' || key==='eofficeUser') return window[key];
                if (key==='eofficeRegisterModuleRefresh') return fn=>refreshers.add(fn);
                if (key==='eofficeRegisterModuleSuspend') return fn=>suspenders.add(fn);
                if (key==='eofficeRegisterModuleResume') return fn=>resumers.add(fn);
                if (key==='Swal'&&window.Swal)return new Proxy(window.Swal,{
                    get(target,name) {
                        if(name==='fire')return (...args)=>{
                            if(ctx.loading&&!ctx.disposed&&!ctx.permissionStale)ctx.pendingPopup=args;
                            if(ctx.disposed||ctx.permissionStale||!ctx.active)return Promise.resolve({isConfirmed:false,isDismissed:true});
                            popupOwner=ctx;return target.fire(...args);
                        };
                        const value=Reflect.get(target,name,target);return typeof value==='function'?value.bind(target):value;
                    }
                });
                if (key==='addEventListener') return events.addEventListener.bind(events);
                if (key==='removeEventListener') return events.removeEventListener.bind(events);
                if (key==='dispatchEvent') return event=>{
                    if (event.type==='eoffice:permissions-changed') return window.dispatchEvent(new Event(event.type));
                    return events.dispatchEvent(event);
                };
                if (key in target) return target[key];
                if (key==='fetch') return ctx.fetch;
                if (key==='setInterval') return (fn,delay,...args)=>{const id=window.setInterval(()=>{if(ctx.active&&!ctx.disposed)fn(...args);},delay);intervals.add(id);return id;};
                if (key==='setTimeout') return (fn,delay,...args)=>{const id=window.setTimeout(()=>{timers.delete(id);if(!ctx.disposed)fn(...args);},delay);timers.add(id);return id;};
                if (key==='clearInterval') return id=>{intervals.delete(id);window.clearInterval(id);};
                if (key==='clearTimeout') return id=>{timers.delete(id);window.clearTimeout(id);};
                return boundWindow.has(key) && typeof window[key]==='function'?window[key].bind(window):window[key];
            },
            set(target,key,value) {
                if (key!=='eofficeUser' && key!=='eofficeSessionState') target[key]=value;
                return true;
            },has:()=>true
        });
        const moduleDocument=new Proxy(document,{
            get(target,key) {
                if (key==='body') return styledBody;
                if (key==='hidden') return document.hidden || !ctx.active;
                if (key==='visibilityState') return document.hidden || !ctx.active?'hidden':'visible';
                if (key==='head') return shadow;
                if (key==='activeElement') return shadow.activeElement || document.activeElement;
                if (key==='currentScript') return ctx.currentScript;
                if (key==='readyState') return ctx.readyState;
                if (key==='baseURI' || key==='URL') return url.href;
                if (key==='getElementById') return id=>shadow.getElementById(id);
                if (key==='querySelector') return selector=>selector==='body'?body:shadow.querySelector(selector);
                if (key==='querySelectorAll') return shadow.querySelectorAll.bind(shadow);
                if (key==='addEventListener') return (type,fn,options)=>
                    (type==='DOMContentLoaded'?documentEvents:shadow).addEventListener(type,fn,options);
                if (key==='removeEventListener') return (type,fn,options)=>
                    (type==='DOMContentLoaded'?documentEvents:shadow).removeEventListener(type,fn,options);
                if (key==='dispatchEvent') return event=>(event.type==='DOMContentLoaded'?documentEvents:shadow).dispatchEvent(event);
                const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
            },
            set(target,key,value){return Reflect.set(target,key,value,target);}
        });
        const scope=new Proxy(moduleWindow,{has:(_,key)=>!['__scope','__runtime'].includes(key)});
        ctx.scope=scope;ctx.window=moduleWindow;
        ctx.finish=()=>{
            ctx.readyState='interactive';documentEvents.dispatchEvent(new Event('DOMContentLoaded'));
            ctx.readyState='complete';events.dispatchEvent(new Event('load'));
            if(typeof values.onload==='function')values.onload.call(moduleWindow,new Event('load'));
        };
        ctx.setScript=src=>{ctx.currentScript={src};};
        ctx.observeHandlers=bind=>{
            const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)bind(node);});
            observer.observe(shadow,{childList:true,subtree:true});ctx.observer=observer;
        };
        const edited=event=>{
            const form=event.target.closest?.('form');
            if(!form || form.id==='filters' || form.classList.contains('filters') || form.dataset.eofficeDraftRestoring==='true')return;
            dirty.add(form);window.eofficeCancelDocumentLeaving?.();
        };
        for(const type of ['input','change','eoffice:form-dirty'])shadow.addEventListener(type,edited);
        for(const type of ['reset','eoffice:form-saved'])shadow.addEventListener(type,event=>{dirty.delete(event.target);retainedForms.delete(event.target);},true);
        shadow.addEventListener('close',event=>{
            const dialog=event.target;
            if(suspendedDialogs.delete(dialog)||dialog.open)return;
            for(const form of dialog.querySelectorAll?.('form')||[])retainedForms.delete(form);
        },true);
        ctx.hasChanges=()=>[...dirty].some(form=>{
            if(!form.isConnected)return false;
            if(retainedForms.has(form))return true;
            // Ignore explicitly closed/discarded dialogs, but not the cached
            // module host itself: its still-open forms must warn on full exit.
            for(let node=form;node && node!==body;node=node.parentElement) {
                const style=getComputedStyle(node);
                if(style.display==='none' || style.visibility==='hidden')return false;
            }
            return true;
        });
        ctx.closeDialogs=()=>{
            if(popupOwner===ctx){window.Swal?.close();popupOwner=null;}
            const dialogs=[...shadow.querySelectorAll('dialog[open]')];
            if(dialogs.length)for(const suspend of suspenders)suspend();
            for(const dialog of dialogs) {
                for(const form of dialog.querySelectorAll('form'))if(dirty.has(form))retainedForms.add(form);
                suspendedDialogs.add(dialog);
                dialog.close();
            }
            if(dialogs.length){const main=document.getElementById('main_div');main.tabIndex=-1;main.focus({preventScroll:true});}
        };
        ctx.refresh=()=>{
            ctx.dataDirty=true;
            if(ctx.refreshing)return ctx.refreshing;
            if((!ctx.active&&!ctx.loading) || ctx.disposed || ctx.permissionStale || !allowed(ctx.view))return Promise.resolve();
            ctx.refreshing=(async()=>{
                do {
                    const revision=dataRevision;ctx.dataDirty=false;
                    await Promise.all([...refreshers].map(fn=>fn()));
                    ctx.lastDataRevision=revision;
                    if(dataRevision!==revision)ctx.dataDirty=true;
                } while(ctx.dataDirty && (ctx.active||ctx.loading) && !ctx.disposed && !ctx.permissionStale && allowed(ctx.view));
            })().catch(error=>{if(!ctx.disposed)console.error('Module refresh failed:',error);}).finally(()=>{ctx.refreshing=null;});
            return ctx.refreshing;
        };
        ctx.prepare=()=>{
            ctx.loading=true;ctx.pendingPopup=null;
            return ctx.refresh().finally(()=>{ctx.loading=false;ctx.prepared=true;});
        };
        ctx.activate=(restoreScroll=false)=>{
            const revisit=ctx.visited;ctx.visited=true;
            const prepared=ctx.prepared;ctx.prepared=false;
            ctx.active=true;ctx.node.inert=false;
            if(bodyStyle.overflow==='hidden')document.body.style.overflow='hidden';
            if(restoreScroll) {
                document.getElementById('main_div').scrollTop=ctx.scrollTop || 0;
                window.scrollTo(ctx.scrollX || 0,ctx.scrollY || 0);
            }
            events.dispatchEvent(new Event('focus'));
            for(const resume of resumers)resume();
            if(ctx.pendingPopup){const args=ctx.pendingPopup;ctx.pendingPopup=null;popupOwner=ctx;window.Swal?.fire(...args);}
            if(!prepared&&(!revisit||(restoreScroll&&revisit)||ctx.dataDirty||ctx.lastDataRevision!==dataRevision))ctx.refresh();
        };
        ctx.dispose=()=>{ctx.closeDialogs();ctx.disposed=true;ctx.active=false;events.dispatchEvent(new Event('eoffice:module-dispose'));abort.abort();timers.forEach(id=>window.clearTimeout(id));intervals.forEach(id=>window.clearInterval(id));ctx.observer?.disconnect();ctx.node?.remove();};
        return ctx;
    }
    async function create(view) {
        const url=new URL(routes[view],appRoot),source=await text(url);
        const parsed=new DOMParser().parseFromString(source,'text/html');
        if(!parsed.querySelector('.eoffice-module-view')){texts.delete(url.href);throw Error('ไม่ได้รับหน้าโมดูลที่รองรับ กรุณาลองใหม่');}
        const node=document.createElement('div');node.className='eoffice-module-host';node.hidden=true;node.inert=true;
        const shadow=node.attachShadow({mode:'open'}),body=document.createElement('div');
        body.className=parsed.body.className+' eoffice-runtime-body eoffice-shell-ready';
        const ctx=context(view,url,body,shadow);ctx.node=node;
        try {
        const scripts=[...parsed.querySelectorAll('script')];
        const normal=scripts.filter(s=>!s.defer),deferred=scripts.filter(s=>s.defer);
        const sources=[];
        for(const item of [...normal,...deferred]) {
            if(item.type && !['text/javascript','application/javascript'].includes(item.type))continue;
            if(item.src) {
                const src=new URL(item.getAttribute('src'),url);
                if(src.pathname.endsWith('/app-navigation.js'))continue;
                if(src.origin!==url.origin) {
                    if(src.hostname==='cdn.tailwindcss.com')continue;
                    await library(src.href);continue;
                }
                sources.push({src:src.href,code:await text(src)});
            } else if(item.textContent.trim())sources.push({src:url.href,code:item.textContent});
        }
        scripts.forEach(item=>item.remove());
        for(const item of parsed.head.querySelectorAll('style,link[rel="stylesheet"]')) {
            if(item.tagName==='LINK' && /fonts\.googleapis\.com/.test(item.href)) {
                if(![...document.querySelectorAll('link[rel="stylesheet"]')].some(link=>link.href===item.href)) {
                    const font=document.createElement('link');font.rel='stylesheet';font.href=item.href;document.head.append(font);
                }
                continue;
            }
            const href=item.tagName==='LINK'?new URL(item.getAttribute('href'),url):url;
            if(/\/sidebar\.css$/.test(href.pathname))continue;
            const style=document.createElement('style');style.textContent=css(item.tagName==='STYLE'?item.textContent:await text(href),href);shadow.append(style);
        }
        if(!moduleUtilities) {
            // These templates originally use unlayered Tailwind 3 CDN utilities.
            // Flatten the local build's layer wrappers so a page's unlayered
            // universal reset cannot override every spacing utility (Tailwind 4).
            const parser=document.createElement('style');parser.media='not all';
            parser.textContent=await text(new URL('assets/tailwind.css',appRoot));document.head.append(parser);
            const flatten=rules=>[...rules].map(rule=>rule.constructor.name==='CSSLayerBlockRule'?flatten(rule.cssRules):rule.constructor.name==='CSSLayerStatementRule'?'':rule.cssText).join('\n');
            try{moduleUtilities=css(flatten(parser.sheet.cssRules),appRoot);}finally{parser.remove();}
        }
        const utilities=document.createElement('style');utilities.textContent=moduleUtilities;shadow.prepend(utilities);
        body.innerHTML=parsed.body.innerHTML;
        for(const item of body.querySelectorAll('[src],[href],[action]'))for(const attr of ['src','href','action']) {
            const value=item.getAttribute(attr);if(value && !value.startsWith('#'))item.setAttribute(attr,absolute(value,url));
        }
        const layout=document.createElement('style');layout.textContent=':host{display:block;min-width:0}.eoffice-runtime-body{margin:0!important;padding:0!important;min-height:0!important;height:auto!important;display:block!important}.eoffice-module-content{margin:0!important;padding:0!important;min-width:0;container-type:inline-size;container-name:eoffice-content}[hidden]{display:none!important}';
        shadow.append(layout,body);host.append(node);
        const program=sources.map(item=>`__runtime.setScript(${JSON.stringify(item.src)});\n${item.code}\n`).join('\n');
        // Inline and dynamically rendered handlers close over this module only.
        const bind=`
            function __bind(root) {
                const nodes=[...(root.nodeType===1?[root]:[]),...root.querySelectorAll('*')];
                for(const node of nodes)for(const attr of [...node.attributes])if(/^on[a-z]+$/.test(attr.name)) {
                    const handler=eval('(function(event){'+attr.value+'\\n})');
                    node.removeAttribute(attr.name);node[attr.name]=handler;
                }
            }
            __bind(__runtime.shadow);__runtime.observeHandlers(__bind);
        `;
        new Function('__scope','__runtime',`with(__scope){(function(){${program}\n${bind}\n}).call(window);}\n//# sourceURL=eoffice-module-${view}.js`)(ctx.scope,ctx);
        ctx.finish();node.inert=false;
        shadow.addEventListener('click',event=>{
            const link=event.target.closest?.('a[href]');
            if(!link || event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download'))return;
            const target=new URL(link.href),key=Object.keys(routes).find(k=>new URL(routes[k],appRoot).pathname===target.pathname);
            if(key && target.origin===appRoot.origin){event.preventDefault();window.showView(key);}
            else if(target.origin===appRoot.origin && target.pathname===new URL('index.php',appRoot).pathname && !target.searchParams.has('id')) {
                event.preventDefault();window.showView(target.searchParams.get('view') || (window.eofficeUser?'received':'public'));
            }
        });
        return ctx;
        } catch(error) {ctx.dispose();throw error;}
    }
    const allowed=view=>window.eofficeUser && !window.eofficeFormOwner?.hasConflict() && window.eofficeSessionState?.status==='authenticated' && (view==='ai_settings'?window.eofficeUser.status==='Admin':
        !({members:'members',groups:'departments',send_email:'email',maintenance_admin:'maintenance'}[view]) ||
        window.eofficeUser.permissions?.includes({members:'members',groups:'departments',send_email:'email',maintenance_admin:'maintenance'}[view]));
    const approve=()=>window.eofficeApproveDocumentLeaving?.(false,true)!==false;
    const waitForSession=()=>window.eofficeSessionState?.status!=='pending'?Promise.resolve():new Promise(resolve=>{
        const accepted=()=>{if(window.eofficeSessionState?.status==='pending')return;window.removeEventListener('eoffice:session-updated',accepted);resolve();};
        window.addEventListener('eoffice:session-updated',accepted);accepted();
    });
    function dataChanged(origin) {
        dataRevision++;
        for(const entry of cache.values())if(entry.ctx&&entry.ctx!==origin) {
            entry.ctx.dataDirty=true;
            if(entry.ctx.active)entry.ctx.refresh();
        }
    }
    const staleAccess=ctx=>!roleIndependent.has(ctx.view) && ctx.access!==accessStamp();
    const staleNotice=ctx=>{
        stopLoading();
        ctx.closeDialogs();ctx.active=false;ctx.node.inert=true;ctx.node.hidden=true;
        status.textContent='สิทธิ์ผู้ใช้เปลี่ยนแล้ว ต้องโหลดโมดูลตามสิทธิ์ใหม่ ข้อมูลที่ยังไม่บันทึกของฟอร์มเดิมจะถูกทิ้งเมื่อยืนยันโหลดใหม่';
        const reload=document.createElement('button');reload.type='button';reload.textContent='โหลดตามสิทธิ์ใหม่';reload.onclick=()=>window.eofficeModuleRouter.open(ctx.view,{page:'load'});status.append(' ',reload);host.append(status);
    };
    const deactivate=ctx=>{
        ctx.closeDialogs();
        ctx.scrollX=window.scrollX;ctx.scrollY=window.scrollY;ctx.scrollTop=document.getElementById('main_div').scrollTop;
        ctx.active=false;ctx.node.hidden=true;
    };
    function concealDocuments() {
        window.eofficeCloseDocumentOverlays?.();
        document.getElementById('main_div').dataset.contentMode='module';
        const area=document.getElementById('main-content-area');
        if(area){area.hidden=true;area.inert=true;}
        for(const id of ['doc-list','search_menu','pagination_html','document-modal']) {
            const element=document.getElementById(id);if(element)element.style.display='none';
        }
    }
    window.eofficeModuleHasChanges=()=>[...cache.values()].some(value=>value.ctx?.hasChanges());
    window.eofficeModuleRouter={
        owns(value) {
            const url=new URL(value,location.href);
            return url.origin===appRoot.origin && (Object.values(routes).some(path=>new URL(path,appRoot).pathname===url.pathname) ||
                (url.pathname===new URL('index.php',appRoot).pathname && !url.searchParams.has('id')));
        },
        async open(view,{page}={}) {
            if(!Object.hasOwn(routes,view) || !approve())return false;
            const request=++sequence;
            if(active)deactivate(active);active=null;
            document.body.style.overflow='auto';concealDocuments();host.hidden=false;
            window.eofficePageLoading.show(status);host.setAttribute('aria-busy','true');host.append(status);
            const target=new URL('index.php',appRoot);target.searchParams.set('view',view);
            if(target.href!==location.href)history[page==='load'||page==='history'?'replaceState':'pushState'](null,'',target);
            localStorage.setItem('currentPage',view);
            if(document.getElementById('sidebar').dataset.sidebarOpen==='true')window.toggleSidebar();
            document.querySelectorAll('#sidebar .menu-item').forEach(link=>{
                const path=new URL(link.href,location.href).pathname;
                link.classList.toggle('bg-indigo-700',path===new URL(routes[view],appRoot).pathname);
                link.classList.toggle('text-white',link.classList.contains('bg-indigo-700'));
            });
            try {
                await waitForSession();
                if(request!==sequence)return false;
                if(!allowed(view)) {
                    if(window.eofficeFormOwner?.hasConflict())throw Error('บัญชีผู้ใช้เปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ก่อนใช้งาน');
                    window.showView(window.eofficeUser?'received':'public','load');return false;
                }
                let ctx;
                do {
                    if(!cache.has(view)) {
                        const entry={ctx:null};entry.promise=create(view).then(ctx=>{entry.ctx=ctx;return ctx;}).catch(error=>{if(cache.get(view)===entry)cache.delete(view);throw error;});cache.set(view,entry);
                    }
                    const entry=cache.get(view);ctx=await entry.promise;
                    if(request!==sequence)return false;
                    if(ctx.permissionStale||staleAccess(ctx)) {
                        ctx.permissionStale=true;
                        if(ctx.hasChanges()&&!window.confirm('สิทธิ์ผู้ใช้เปลี่ยนแล้ว ต้องการทิ้งฟอร์มเดิมและโหลดข้อมูลตามสิทธิ์ใหม่หรือไม่?')){active=ctx;staleNotice(ctx);return false;}
                        ctx.dispose();if(cache.get(view)===entry)cache.delete(view);ctx=null;
                    }
                } while(!ctx);
                await waitForSession();
                if(request!==sequence)return false;
                if(ctx.permissionStale||staleAccess(ctx))return this.open(view,{page:'load'});
                if(!allowed(view)){window.showView(window.eofficeUser?'received':'public','load');return false;}
                await ctx.prepare();
                await waitForSession();
                if(request!==sequence)return false;
                if(ctx.permissionStale||staleAccess(ctx))return this.open(view,{page:'load'});
                if(!allowed(view)){window.showView(window.eofficeUser?'received':'public','load');return false;}
                stopLoading();status.remove();active=ctx;ctx.node.hidden=false;ctx.activate(true);document.title=ctx.body.querySelector('h1')?.textContent.trim()||'E-Office';
                return true;
            } catch(error) {
                if(request!==sequence)return false;
                stopLoading();
                status.textContent=error.message;const retry=document.createElement('button');retry.type='button';retry.textContent='ลองใหม่';retry.onclick=()=>this.open(view,{page:'load'});status.append(' ',retry);return false;
            }
        },
        leave() {
            if(!host.hidden && !approve())return false;
            sequence++;if(active)deactivate(active);active=null;stopLoading();status.remove();host.hidden=true;document.body.style.overflow='auto';
            document.getElementById('main_div').dataset.contentMode='document';
            const area=document.getElementById('main-content-area');
            if(area){area.hidden=false;area.inert=false;}
            document.querySelectorAll('#sidebar .menu-item').forEach(link=>link.classList.remove('bg-indigo-700','text-white'));
            document.getElementById('document-modal').style.removeProperty('display');document.title='E-Office ศรียานุสรณ์';return true;
        }
    };
    for(const type of ['focus','pageshow','eoffice:session-updated'])window.addEventListener(type,event=>{
        for(const entry of cache.values())if(entry.ctx)entry.ctx.events.dispatchEvent(type==='eoffice:session-updated'?new CustomEvent(type,{detail:window.eofficeSessionState}):new Event(type));
        if(type==='eoffice:session-updated'&&window.eofficeSessionState?.status==='authenticated')for(const entry of cache.values())if(entry.ctx&&staleAccess(entry.ctx)) {
            entry.ctx.permissionStale=true;entry.ctx.closeDialogs();entry.ctx.node.inert=true;entry.ctx.node.hidden=true;
        }
        if(type==='eoffice:session-updated' && active && !host.hidden) {
            if(window.eofficeSessionState?.status==='pending') {
                active.closeDialogs();active.active=false;active.node.inert=true;return;
            }
            if(!allowed(active.view)) {
                active.closeDialogs();active.active=false;active.node.inert=true;active.node.hidden=true;
                stopLoading();
                status.textContent=window.eofficeFormOwner?.hasConflict()?'บัญชีผู้ใช้เปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ก่อนใช้งาน':'กำลังรอยืนยันบัญชีและสิทธิ์ก่อนแสดงหน้าปัจจุบัน';host.append(status);
            } else if(active.permissionStale) {
                if(active.hasChanges())staleNotice(active);
                else window.eofficeModuleRouter.open(active.view,{page:'load'});
            } else {status.remove();active.node.hidden=false;active.activate();}
        }
    });
    document.addEventListener('visibilitychange',()=>{for(const entry of cache.values())entry.ctx?.shadow.dispatchEvent(new Event('visibilitychange'));});
    window.addEventListener('beforeunload',event=>{
        if(window.eofficeDocumentLeavingApproved?.())return;
        for(const entry of cache.values())if(entry.ctx) {
            const check=new Event('beforeunload',{cancelable:true});entry.ctx.events.dispatchEvent(check);
            if(check.defaultPrevented){event.preventDefault();event.returnValue='';}
        }
    });
    document.addEventListener('click',event=>{
        const link=event.target.closest?.('a[href]');
        if(!link || event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download'))return;
        const target=new URL(link.href),view=Object.keys(routes).find(key=>new URL(routes[key],appRoot).pathname===target.pathname);
        if(view && target.origin===appRoot.origin){event.preventDefault();window.showView(view);}
        else if(target.origin===appRoot.origin && target.pathname===new URL('index.php',appRoot).pathname && !target.searchParams.has('id')) {
            event.preventDefault();window.showView(target.searchParams.get('view') || (window.eofficeUser?'received':'public'));
        }
    });
})();
