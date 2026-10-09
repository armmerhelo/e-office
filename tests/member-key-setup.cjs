const assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {prepareTestMemberKey}=require('../scripts/test-member-key.cjs');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const project=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'opencode','member-key-setup-'));
const root=path.join(temp,'project'),directory=path.join(temp,'keys');
const env={...process.env,DB_DATABASE:'member_key_setup_test',EOFFICE_MOCK_SERVICES:'true',EOFFICE_MEMBER_VERSION_KEY:'',EOFFICE_SETTINGS_KEY:''};
const options={php,root,directory};let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
function fingerprint(config){
    const code="require $argv[1].'/config/member-management.php';echo app_member_version(['User_Id'=>1,'User_Name'=>'Fixture','User_Email'=>'fixture@example.test','User_Status'=>'User','User_Password'=>'synthetic'],[]);";
    return cp.execFileSync(php,['-r',code,root],{env:config,encoding:'utf8'});
}
function privateConfig(values){fs.writeFileSync(path.join(root,'config','local.php'),'<?php return json_decode('+JSON.stringify(JSON.stringify(values))+',true);',{mode:0o600});}
async function run(){try{
    fs.mkdirSync(path.join(root,'config'),{recursive:true});
    for(const name of ['bootstrap.php','permissions.php','member-management.php','sign-routing.php'])fs.copyFileSync(path.join(project,'config',name),path.join(root,'config',name));
    const setup=()=>prepareTestMemberKey(env,options);
    let first;
    test('local first setup creates a valid private key before serving',()=>{
        first=setup();assert.equal(Buffer.from(first.EOFFICE_MEMBER_VERSION_KEY,'base64').length,32);
        assert.match(fingerprint(first),/^[a-f0-9]{64}$/);
        assert.equal(fs.readdirSync(directory).length,1);
    });
    test('local restarts preserve the key and versions across workers',()=>{
        const again=setup();assert.equal(again.EOFFICE_MEMBER_VERSION_KEY,first.EOFFICE_MEMBER_VERSION_KEY);
        assert.equal(fingerprint(first),fingerprint(again));
    });
    test('environment and settings-key fallback are honored without a new key',()=>{
        const dedicated=crypto.randomBytes(32).toString('base64'),settings=crypto.randomBytes(32).toString('base64');
        assert.equal(prepareTestMemberKey({...env,EOFFICE_MEMBER_VERSION_KEY:dedicated,EOFFICE_SETTINGS_KEY:settings},options).EOFFICE_MEMBER_VERSION_KEY,dedicated);
        assert.equal(prepareTestMemberKey({...env,EOFFICE_SETTINGS_KEY:settings},options).EOFFICE_MEMBER_VERSION_KEY,settings);
        assert.equal(fs.readdirSync(directory).length,1);
    });
    test('private config keys use the same precedence as PHP',()=>{
        const key=crypto.randomBytes(32).toString('base64');privateConfig({EOFFICE_SETTINGS_KEY:key});
        const configEnv={...env};delete configEnv.EOFFICE_MEMBER_VERSION_KEY;delete configEnv.EOFFICE_SETTINGS_KEY;
        assert.equal(prepareTestMemberKey(configEnv,options).EOFFICE_MEMBER_VERSION_KEY,key);
        assert.equal(prepareTestMemberKey({...configEnv,EOFFICE_SETTINGS_KEY:''},options).EOFFICE_MEMBER_VERSION_KEY,first.EOFFICE_MEMBER_VERSION_KEY);
    });
    test('invalid configured or persisted keys are never silently replaced',()=>{
        assert.throws(()=>prepareTestMemberKey({...env,EOFFICE_MEMBER_VERSION_KEY:'invalid'},options),/configuration validation failed/);
        const file=path.join(directory,fs.readdirSync(directory)[0]);fs.writeFileSync(file,'corrupt');
        assert.throws(setup,/refusing to replace/);assert.equal(fs.readFileSync(file,'utf8'),'corrupt');
        fs.writeFileSync(file,first.EOFFICE_MEMBER_VERSION_KEY);
    });
    test('test setup refuses real databases and non-mock services',()=>{
        assert.throws(()=>prepareTestMemberKey({...env,DB_DATABASE:'production'},options),/isolated mock/);
        assert.throws(()=>prepareTestMemberKey({...env,EOFFICE_MOCK_SERVICES:'false'},options),/isolated mock/);
    });
    test('serve:test passes its prepared key to both seed and web server',()=>{
        let prepared=false,seeded=false,served=false;
        const stop=new Error('stop after inspecting spawn');
        const fakeCp={spawnSync(_php,_args,opts){assert.ok(prepared);assert.equal(opts.env.EOFFICE_MEMBER_VERSION_KEY,first.EOFFICE_MEMBER_VERSION_KEY);seeded=true;return{status:0,stdout:'{"users":{"recipient":1}}'};},spawn(_php,_args,opts){assert.ok(seeded);assert.equal(opts.env.EOFFICE_MEMBER_VERSION_KEY,first.EOFFICE_MEMBER_VERSION_KEY);served=true;throw stop;}};
        const fakeRequire=name=>name==='node:child_process'?fakeCp:name==='./test-member-key.cjs'?{prepareTestMemberKey(input){prepared=true;assert.equal(input.EOFFICE_MOCK_SERVICES,'true');return{...input,EOFFICE_MEMBER_VERSION_KEY:first.EOFFICE_MEMBER_VERSION_KEY};}}:require(name);
        assert.throws(()=>vm.runInNewContext(fs.readFileSync(path.join(project,'scripts','serve-test.cjs'),'utf8'),{require:fakeRequire,process:{env:{TEST_DATABASE:'fixture_test'},argv:[]},console}),error=>error===stop);
        assert.ok(prepared&&seeded&&served);
    });
    // Use the real snapshot API, an isolated database and two successive PHP
    // server processes to verify that setup produces reusable runtime tokens.
    const database=`eoffice_members_${process.pid}_test`,port=Number(process.env.MEMBER_SETUP_TEST_PORT||8171);
    const httpEnv={...env,DB_DATABASE:database,APP_URL:`http://localhost:${port}`};
    const fixture=action=>{
        const result=cp.spawnSync(php,['tests/member-fixture.php',action],{cwd:project,env:httpEnv,encoding:'utf8'});
        if(result.status!==0)throw Error(result.stdout+result.stderr);return result.stdout;
    };
    let created=false,server;
    try{
        const users=JSON.parse(fixture('seed'));created=true;
        fs.copyFileSync(path.join(project,'config','settings.php'),path.join(root,'config','settings.php'));
        fs.mkdirSync(path.join(root,'management'),{recursive:true});
        fs.copyFileSync(path.join(project,'management','get_user_departments_api.php'),path.join(root,'management','get_user_departments_api.php'));
        fs.writeFileSync(path.join(root,'config','local.php'),'<?php return require '+JSON.stringify(path.join(project,'config','local.php').replace(/\\/g,'/'))+';');
        const snapshots=[];
        for(let iteration=0;iteration<2;iteration++){
            const runtime=prepareTestMemberKey(httpEnv,options);
            server=cp.spawn(php,['-S',`localhost:${port}`,'-t',root],{cwd:root,env:runtime,stdio:'ignore'});
            let ready=false;
            for(let attempt=0;attempt<50;attempt++){
                try{
                    const response=await fetch(`http://localhost:${port}/management/get_user_departments_api.php?User_Id=${users.basic.id}`,{headers:{Cookie:users.admin.cookie}});
                    assert.equal(response.status,200);snapshots.push((await response.json()).member_version);ready=true;break;
                }catch(error){if(error.code==='ERR_ASSERTION')throw error;await new Promise(resolve=>setTimeout(resolve,100));}
            }
            assert.ok(ready,'prepared PHP server becomes ready');
            await new Promise(resolve=>{server.once('exit',resolve);server.kill();});server=null;
        }
        assert.equal(snapshots[0],snapshots[1]);assert.match(snapshots[0],/^[a-f0-9]{64}$/);
        passed++;console.log('PASS prepared local servers return HTTP 200 snapshots with stable versions after restart');
    }finally{
        if(server)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});
        if(created)fixture('drop');
    }
    console.log(`Member local key setup: ${passed} passed`);
}finally{fs.rmSync(temp,{recursive:true,force:true});}}
run().catch(error=>{console.error(error);process.exitCode=1;});
