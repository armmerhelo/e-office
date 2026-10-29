const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/notifications.js','utf8');
function setup({mock=false,hostname='e-office.example',appId='configured-app-id',user=null}={}) {
    const events = new Map(), requests = [], warnings = [], buttons = [];
    let reloads=0, confirmReload=false;
    const window = {
        EOFFICE_MOCK_SERVICES:mock, EOFFICE_PUSH_APP_ID:appId,
        eofficeSessionState:{status:user?'authenticated':'pending',user},
        addEventListener:(name,fn)=>events.set(name,fn),
        removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);}
    };
    window.confirm=()=>confirmReload;
    let fail = false, init, held = null, initFailures = 0, initCalls = 0;
    const timers = [];
    const subscription = {id:'subscription-id',optedIn:true,addEventListener:(name,fn)=>events.set('push:'+name,fn)};
    vm.runInNewContext(source, {
        window, location:{hostname,reload:()=>{reloads++;}}, URL, AbortController,
        document:{currentScript:{src:'https://e-office.example/office/assets/notifications.js?v=1'},body:{appendChild:b=>buttons.push(b)},createElement:()=>({style:{},addEventListener(name,fn){this[name]=fn;}})},
        console:{warn:(...args)=>warnings.push(args)},
        setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},
        fetch:async (url,options)=>{
            requests.push({url:String(url),...options,body:JSON.parse(options.body)});
            if (held) {const wait=held;held=null;await wait;}
            return {ok:!fail,json:async()=>({status:fail?'error':'success'})};
        }
    });
    return {window,requests,warnings,subscription,
        start:async()=>window.OneSignalDeferred[0]({init:async options=>{init=options;initCalls++;if(initFailures-->0)throw Error('SDK unavailable');},User:{PushSubscription:subscription}}),
        session:async(status,user=null)=>{window.eofficeSessionState={status,user};await events.get('eoffice:session-updated')();},
        change:async()=>events.get('push:change')(), fail:value=>{fail=value;}, timers,
        hold:promise=>{held=promise;},get init(){return init;},
        failInit:count=>{initFailures=count;},get initCalls(){return initCalls;},
        online:async()=>events.get('online')?.(),buttons,get reloads(){return reloads;},confirmReload:value=>{confirmReload=value;}
    };
}
(async()=>{
    const app=setup();await app.start();
    assert.equal(app.init.appId,'configured-app-id');
    assert.equal(app.requests.length,0,'SDK readiness must not bypass session readiness');
    await app.session('authenticated',{id:12});
    assert.equal(app.requests.length,1,'HttpOnly authentication must not require reading cookies');
    assert.equal(app.requests[0].url,'https://e-office.example/office/api/create_user_notification.php');
    assert.equal(app.requests[0].credentials,'same-origin');
    assert.deepEqual(app.requests[0].body,{target_Id:'subscription-id',active:true,_expected_owner:12});
    await app.change();assert.equal(app.requests.length,1,'unchanged subscription is deduplicated');
    app.subscription.id='new-subscription';await app.change();assert.equal(app.requests.length,2);
    await app.session('guest');await app.change();assert.equal(app.requests.length,2,'guests do not register');
    await app.session('authenticated',{id:13});assert.equal(app.requests.at(-1).body._expected_owner,13);
    app.subscription.optedIn=false;await app.change();assert.equal(app.requests.length,4,'opt-out unregisters');
    assert.equal(app.requests.at(-1).body.active,false);
    app.subscription.optedIn=true;app.fail(true);await app.change();
    assert.equal(app.warnings.length,1,'API errors are not logged as success');
    app.fail(false);await app.timers.at(-1)();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(app.requests.length,6,'failed registrations retry without focus or reload');
    const concurrent=setup({user:{id:21}});let release;
    concurrent.hold(new Promise(resolve=>{release=resolve;}));
    const started=concurrent.start();await new Promise(resolve=>setImmediate(resolve));
    concurrent.subscription.id='changed-while-pending';await concurrent.change();
    await concurrent.session('authenticated',{id:22});release();await started;
    assert.equal(concurrent.requests.length,2,'in-flight changes are serialized and replayed');
    assert.equal(concurrent.requests.at(-1).body._expected_owner,22);
    assert.equal(concurrent.requests.at(-1).body.target_Id,'changed-while-pending');
    const sameOwner=setup({user:{id:21}});let finish;
    sameOwner.hold(new Promise(resolve=>{finish=resolve;}));
    const oldRequest=sameOwner.start();await new Promise(resolve=>setImmediate(resolve));
    await sameOwner.session('pending');await sameOwner.session('authenticated',{id:21});
    finish();await oldRequest;
    assert.equal(sameOwner.requests.length,2,'old same-owner response must not suppress registration for the refreshed session');
    const recovering=setup({user:{id:21}});recovering.failInit(1);await recovering.start();
    assert.equal(recovering.requests.length,0);
    await recovering.online();assert.equal(recovering.initCalls,1,'SDK single-init lock is respected even after failure');
    assert.equal(recovering.buttons.length,1,'failed init exposes actionable recovery');
    assert.equal(recovering.reloads,0,'failure never automatically discards edits');
    recovering.buttons[0].click();assert.equal(recovering.reloads,0,'cancel preserves current page');
    recovering.confirmReload(true);recovering.buttons[0].click();assert.equal(recovering.reloads,1,'confirmed recovery reloads a fresh SDK instance');
    const ready=setup({user:{id:14}});await ready.start();assert.equal(ready.requests.length,1,'session ready before SDK also registers');
    for(const options of [{mock:true},{hostname:'localhost'},{hostname:'127.0.0.1'},{hostname:'[::1]'},{appId:''}]) {
        assert.equal(setup(options).window.OneSignalDeferred,undefined);
    }
    const index=fs.readFileSync('index.php','utf8').replace(/<!--[\s\S]*?-->/g,'');
    assert.ok(index.includes("app_env('ONESIGNAL_APP_ID')"),'frontend uses same app configuration as worker');
    assert.ok(!index.includes('sendIdToBackend') && !source.includes('getCookie'),'push registration never reads HttpOnly cookie');
    assert.ok(fs.readFileSync('api/create_user_notification.php','utf8').includes('app_expected_owner($data, $user)'));
    console.log('PASS notification registration: HttpOnly session, SDK/session timing, account/subscription changes, opt-out, retries, configuration and mock guards');
})().catch(error=>{console.error(error);process.exitCode=1;});
