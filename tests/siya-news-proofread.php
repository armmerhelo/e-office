<?php
require_once __DIR__.'/../config/siya-news-proofread.php';
function proofread_assert(bool $value): void {if(!$value)throw new RuntimeException('Proofread assertion failed');}
$source=['title'=>'ขออนุญาติ','body'=>'ข่าวทดสอบ'];
$item=['field'=>'title','original'=>'อนุญาติ','replacement'=>'อนุญาต','reason'=>'สะกดผิด'];
proofread_assert(app_siya_news_proofread_validate([$item],$source)===[$item]);
proofread_assert(app_siya_news_proofread_validate([$item,$item],$source)===[$item]);
proofread_assert(app_siya_news_proofread_validate([],$source)===[]);
$newline=['field'=>'body','original'=>'ข่าว','replacement'=>"ข่าว\r\nใหม่",'reason'=>'ทดสอบ newline'];
proofread_assert(app_siya_news_proofread_validate([$newline],$source)[0]['replacement']==="ข่าว\nใหม่");
foreach([null,['bad'],[array_replace($item,['field'=>'secret'])],[array_replace($item,['original'=>'ไม่อยู่ในข่าว'])],[array_replace($item,['replacement'=>'อนุญาติ'])],[array_replace($item,['replacement'=>"อนุญาต\r\nใหม่"])],[array_replace($item,['reason'=>[]])],array_fill(0,61,$item)] as $invalid){
    $rejected=false;try{app_siya_news_proofread_validate($invalid,$source);}catch(AppOrderAIException $e){$rejected=true;}proofread_assert($rejected);
}
echo "PASS proofread source validation, allowed fields, deduplication and malformed/oversized response rejection\n";
$response=static fn(string $text,string $finish='STOP'): array=>['candidates'=>[['finishReason'=>$finish,'content'=>['parts'=>[['text'=>$text]]]]]];
proofread_assert(app_siya_news_proofread_response($response(json_encode([$item])),$source)===[$item]);
proofread_assert(app_siya_news_proofread_response($response('[]'),$source)===[]);
$split=['candidates'=>[['finishReason'=>'STOP','content'=>['parts'=>[['thought'=>true,'text'=>'private reasoning'],['text'=>'['],['text'=>substr(json_encode([$item]),1)]]]]]];
proofread_assert(app_siya_news_proofread_response($split,$source)===[$item]);
foreach([$response('{}'),$response('null'),$response('[[]]'),$response('[true]'),$response('["text"]'),$response('not JSON'),$response('[]','MAX_TOKENS'),$response('[]','SAFETY'),[],['candidates'=>[['finishReason'=>'STOP','content'=>['parts'=>[['text'=>[]]]]]]]] as $invalid){
    $rejected=false;try{app_siya_news_proofread_response($invalid,$source);}catch(AppOrderAIException $e){$rejected=true;}proofread_assert($rejected);
}
echo "PASS provider response parsing: completion, split parts, thought exclusion, object/scalar/truncated/blocked response rejection\n";
