<?php
require_once __DIR__.'/../config/siya-news-studio.php';
function studio_assert(bool $value,string $name): void {if(!$value)throw new RuntimeException($name);}
function studio_reject(array $document,string $name): void {
    $rejected=false;try{app_siya_news_studio_document($document);}catch(AppSiyaNewsError $e){$rejected=true;}
    studio_assert($rejected,$name);
}
$base=['id'=>'e1','type'=>'Text','x'=>40,'y'=>60,'rotation'=>0,'opacity'=>1,'scaleX'=>1,'scaleY'=>1,'visible'=>true,'name'=>'หัวข้อ','width'=>400,'height'=>120,'text'=>"หัวข้อข่าว\nบรรทัดสอง",'fontFamily'=>'Prompt','fontSize'=>36,'fontStyle'=>'bold','align'=>'left','fill'=>'#1e293b','lineHeight'=>1.25,'letterSpacing'=>0];
$image=['id'=>'e2','type'=>'Image','x'=>40,'y'=>220,'rotation'=>0,'opacity'=>1,'scaleX'=>1,'scaleY'=>1,'visible'=>true,'name'=>'ภาพข่าว','newsId'=>12,'imageId'=>str_repeat('a',32),'width'=>600,'height'=>320];
$document=['schema'=>'siya-studio/2','pages'=>[['id'=>'p1','format'=>'a4_portrait','bg'=>'#ffffff','elements'=>[$base,$image]]]];
$clean=app_siya_news_studio_document($document);
studio_assert($clean['pages'][0]['safeMargin']===38.0&&$clean['pages'][0]['snap']===true,'legacy page defaults');
$decorated=$document;
$decorated['pages'][0]['safeMargin']=48;$decorated['pages'][0]['showSafeMargin']=true;$decorated['pages'][0]['snap']=false;
$decorated['pages'][0]['elements'][0]=array_replace($base,['locked'=>true,'lineHeight'=>1.6,'letterSpacing'=>2,'textDecoration'=>'underline']);
$decorated['pages'][0]['elements'][1]=array_replace($image,['stroke'=>'#ff0000','strokeWidth'=>8,'cornerRadius'=>24,'cropView'=>['x'=>0.3,'y'=>0.8,'zoom'=>2]]);
$validated=app_siya_news_studio_document($decorated);
studio_assert($validated['pages'][0]['elements'][0]['locked']&&$validated['pages'][0]['elements'][0]['textDecoration']==='underline','lock and underline');
studio_assert($validated['pages'][0]['elements'][1]['cropView']['zoom']===2.0&&$validated['pages'][0]['elements'][1]['cornerRadius']===24.0,'non-destructive crop and border');
foreach([
    ['cropView'=>['x'=>-1,'y'=>.5,'zoom'=>1]],['cropView'=>['x'=>.5,'y'=>.5,'zoom'=>6]],
    ['cropView'=>'invalid'],['strokeWidth'=>101],['cornerRadius'=>-1],['locked'=>'false'],
] as $extra){$bad=$document;$bad['pages'][0]['elements'][1]=array_replace($image,$extra);studio_reject($bad,'invalid decoration');}
foreach(['safeMargin'=>201,'snap'=>'false','showSafeMargin'=>1] as $key=>$value){$bad=$document;$bad['pages'][0][$key]=$value;studio_reject($bad,'invalid page option '.$key);}
foreach(['normal','bold','italic','italic bold'] as $style){
    $candidate=$document;$candidate['pages'][0]['elements'][0]['fontFamily']='Sarabun';$candidate['pages'][0]['elements'][0]['fontStyle']=$style;
    $validated=app_siya_news_studio_document($candidate)['pages'][0]['elements'][0];
    studio_assert($validated['fontFamily']==='Sarabun'&&$validated['fontStyle']===$style,'Sarabun '.$style.' preserved');
}
studio_assert($clean['schema']==='siya-studio/2'&&count($clean['pages'])===1,'valid freeform document');
studio_assert($clean['pages'][0]['elements'][0]['text']==="หัวข้อข่าว\nบรรทัดสอง",'text preserves new lines');
studio_assert($clean['pages'][0]['elements'][1]['imageId']===str_repeat('a',32),'image reference preserved');
studio_assert(app_siya_news_studio_new_document('ชุดทดสอบ')['pages'][0]['format']==='a4_portrait','default page');
$formats=array_keys(app_siya_news_studio_formats());
foreach($formats as $format){
    $candidate=$document;$candidate['pages'][0]['format']=$format;
    studio_assert(app_siya_news_studio_document($candidate)['pages'][0]['format']===$format,'format '.$format);
}
$withElements=static fn(array $elements): array=>['schema'=>'siya-studio/2','pages'=>[['id'=>'p1','format'=>'a4_portrait','bg'=>'#ffffff','elements'=>$elements]]];
$withPage=static fn(array $page): array=>['schema'=>'siya-studio/2','pages'=>[$page]];
$invalidList=[
    ['schema'=>'other','pages'=>$document['pages']],
    ['schema'=>'siya-studio/2','pages'=>[]],
    ['schema'=>'siya-studio/2','pages'=>array_fill(0,41,$document['pages'][0])],
    $withPage(array_replace($document['pages'][0],['format'=>'letter'])),
    $withElements([array_replace($base,['type'=>'Html'])]),
    $withElements([array_replace($base,['id'=>'bad id'])]),
    $withElements([array_replace($base,['fill'=>'red'])]),
    $withElements([array_replace($base,['x'=>99999])]),
    $withElements([array_replace($base,['fontSize'=>2])]),
    $withElements([array_replace($image,['imageId'=>'bad'])]),
    $withElements([array_replace($image,['newsId'=>0])]),
    $withElements([array_replace($image,['width'=>0])]),
    $withElements([array_replace($base,['id'=>'dup']),array_replace($image,['id'=>'dup'])]),
    $withElements([array_replace($base,['text'=>str_repeat('ก',10001)])]),
];
foreach($invalidList as $index=>$invalid)studio_reject($invalid,'invalid document '.$index);
$text=app_siya_news_studio_text("ชื่อ\r\nใหม่",120,'title',true);
studio_assert($text==="ชื่อ\nใหม่",'multiline normalization');
$rejected=false;try{app_siya_news_studio_text(str_repeat('ก',121),120,'title');}catch(AppSiyaNewsError $e){$rejected=true;}
studio_assert($rejected,'overlong line rejected');
echo "PASS studio freeform validation: schema, formats, pages, elements, colors, bounds, references, IDs and text limits\n";
