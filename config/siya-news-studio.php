<?php
require_once __DIR__.'/siya-news.php';

// Freeform layout document: bounded Konva-style elements, no HTML or data URLs.
function app_siya_news_studio_formats(): array {
    return [
        'a4_portrait'=>['width'=>794,'height'=>1123,'label'=>'A4 แนวตั้ง'],
        'a4_landscape'=>['width'=>1123,'height'=>794,'label'=>'A4 แนวนอน'],
        'presentation'=>['width'=>1280,'height'=>720,'label'=>'สไลด์ 16:9'],
        'square'=>['width'=>1080,'height'=>1080,'label'=>'โพสต์จัตุรัส'],
        'story'=>['width'=>1080,'height'=>1920,'label'=>'Story'],
        'poster'=>['width'=>800,'height'=>1200,'label'=>'โปสเตอร์'],
    ];
}

function app_siya_news_studio_text($value,int $max,string $field,bool $multiline=false): string {
    if(!is_string($value))throw new AppSiyaNewsError('ข้อมูลงานออกแบบไม่ถูกต้อง: '.$field);
    $value=str_replace(["\r\n","\r"],"\n",$value);
    $value=$multiline?preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u','',$value):preg_replace('/[\x00-\x1F\x7F]+/u',' ',$value);
    $value=trim($value??'');
    if(mb_strlen($value)>$max)throw new AppSiyaNewsError('ข้อความในงานออกแบบยาวเกินกำหนด: '.$field);
    return $value;
}

function app_siya_news_studio_number($value,float $min,float $max,string $field): float {
    if(!is_int($value)&&!is_float($value))throw new AppSiyaNewsError('ตัวเลขในงานออกแบบไม่ถูกต้อง: '.$field);
    $number=(float)$value;
    if(!is_finite($number)||$number<$min||$number>$max)throw new AppSiyaNewsError('ค่าตัวเลขในงานออกแบบเกินกำหนด: '.$field);
    return round($number,3);
}

function app_siya_news_studio_color($value,string $field,?string $default=null): ?string {
    if($value===null||$value==='')return $default;
    if(!is_string($value)||!preg_match('/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iD',$value))throw new AppSiyaNewsError('สีในงานออกแบบไม่ถูกต้อง: '.$field);
    return strtolower($value);
}

function app_siya_news_studio_bool($value,string $field): bool {
    if(!is_bool($value))throw new AppSiyaNewsError('ค่าการตั้งค่าไม่ถูกต้อง: '.$field);
    return $value;
}

function app_siya_news_studio_element(array $element,int $index): array {
    $type=$element['type']??'';
    $allowed=['Text','Rect','Circle','RegularPolygon','Star','Line','Image'];
    if(!is_string($type)||!in_array($type,$allowed,true))throw new AppSiyaNewsError('ชนิดองค์ประกอบไม่ถูกต้อง');
    $id=$element['id']??'';if(!is_string($id)||!preg_match('/^[A-Za-z0-9_-]{1,40}$/D',$id))throw new AppSiyaNewsError('รหัสองค์ประกอบไม่ถูกต้อง');
    $base=[
        'id'=>$id,'type'=>$type,
        'x'=>app_siya_news_studio_number($element['x']??0,-20000,20000,'x'),
        'y'=>app_siya_news_studio_number($element['y']??0,-20000,20000,'y'),
        'rotation'=>app_siya_news_studio_number($element['rotation']??0,-3600,3600,'rotation'),
        'opacity'=>app_siya_news_studio_number($element['opacity']??1,0,1,'opacity'),
        'scaleX'=>app_siya_news_studio_number($element['scaleX']??1,0.01,20,'scaleX'),
        'scaleY'=>app_siya_news_studio_number($element['scaleY']??1,0.01,20,'scaleY'),
        'visible'=>array_key_exists('visible',$element)?(bool)$element['visible']:true,
        'locked'=>app_siya_news_studio_bool($element['locked']??false,'locked'),
        'name'=>app_siya_news_studio_text($element['name']??'','80','name'),
    ];
    if($type==='Text'){
        $font=(string)($element['fontFamily']??'Prompt');
        if(!in_array($font,['Prompt','Noto Sans Thai','Sarabun','Arial','Georgia','sans-serif'],true))$font='Prompt';
        $style=(string)($element['fontStyle']??'normal');
        if(!in_array($style,['normal','bold','italic','italic bold'],true))$style='normal';
        $align=(string)($element['align']??'left');
        if(!in_array($align,['left','center','right','justify'],true))$align='left';
        $base+= [
            'width'=>app_siya_news_studio_number($element['width']??400,10,10000,'width'),
            'text'=>app_siya_news_studio_text($element['text']??'','10000','text',true),
            'fontFamily'=>$font,'fontSize'=>app_siya_news_studio_number($element['fontSize']??24,6,400,'fontSize'),
            'fontStyle'=>$style,'align'=>$align,'fill'=>app_siya_news_studio_color($element['fill']??'#1e293b','fill','#1e293b'),
            'lineHeight'=>app_siya_news_studio_number($element['lineHeight']??1.25,0.8,3,'lineHeight'),
            'letterSpacing'=>app_siya_news_studio_number($element['letterSpacing']??0,-20,100,'letterSpacing'),
            'textDecoration'=>($element['textDecoration']??'')==='underline'?'underline':'',
        ];
        if(isset($element['height']))$base['height']=app_siya_news_studio_number($element['height'],1,10000,'height');
    }elseif($type==='Rect'){
        $base+= [
            'width'=>app_siya_news_studio_number($element['width']??200,1,10000,'width'),
            'height'=>app_siya_news_studio_number($element['height']??120,1,10000,'height'),
            'fill'=>app_siya_news_studio_color($element['fill']??'#4f46e5','fill','#4f46e5'),
            'cornerRadius'=>app_siya_news_studio_number($element['cornerRadius']??0,0,500,'cornerRadius'),
            'stroke'=>app_siya_news_studio_color($element['stroke']??null,'stroke'),
            'strokeWidth'=>app_siya_news_studio_number($element['strokeWidth']??0,0,100,'strokeWidth'),
        ];
    }elseif($type==='Circle'){
        $base+= [
            'radius'=>app_siya_news_studio_number($element['radius']??60,0.5,5000,'radius'),
            'fill'=>app_siya_news_studio_color($element['fill']??'#4f46e5','fill','#4f46e5'),
            'stroke'=>app_siya_news_studio_color($element['stroke']??null,'stroke'),
            'strokeWidth'=>app_siya_news_studio_number($element['strokeWidth']??0,0,100,'strokeWidth'),
        ];
    }elseif($type==='RegularPolygon'){
        $sides=$element['sides']??3;if(!is_int($sides)||$sides<3||$sides>12)throw new AppSiyaNewsError('จำนวนด้านของรูปทรงไม่ถูกต้อง');
        $base+= [
            'sides'=>$sides,
            'radius'=>app_siya_news_studio_number($element['radius']??60,0.5,5000,'radius'),
            'fill'=>app_siya_news_studio_color($element['fill']??'#4f46e5','fill','#4f46e5'),
            'stroke'=>app_siya_news_studio_color($element['stroke']??null,'stroke'),
            'strokeWidth'=>app_siya_news_studio_number($element['strokeWidth']??0,0,100,'strokeWidth'),
        ];
    }elseif($type==='Star'){
        $points=$element['numPoints']??5;if(!is_int($points)||$points<3||$points>20)throw new AppSiyaNewsError('จำนวนแฉกของดาวไม่ถูกต้อง');
        $base+= [
            'numPoints'=>$points,
            'innerRadius'=>app_siya_news_studio_number($element['innerRadius']??40,0.5,5000,'innerRadius'),
            'outerRadius'=>app_siya_news_studio_number($element['outerRadius']??90,0.5,5000,'outerRadius'),
            'fill'=>app_siya_news_studio_color($element['fill']??'#4f46e5','fill','#4f46e5'),
            'stroke'=>app_siya_news_studio_color($element['stroke']??null,'stroke'),
            'strokeWidth'=>app_siya_news_studio_number($element['strokeWidth']??0,0,100,'strokeWidth'),
        ];
    }elseif($type==='Line'){
        $points=$element['points']??null;if(!is_array($points)||!array_is_list($points)||count($points)<4||count($points)>200||count($points)%2!==0)throw new AppSiyaNewsError('จุดของเส้นไม่ถูกต้อง');
        $clean=[];foreach($points as $point)$clean[]=app_siya_news_studio_number($point,-20000,20000,'point');
        $cap=$element['lineCap']??'round';if(!in_array($cap,['butt','round','square'],true))$cap='round';
        $join=$element['lineJoin']??'round';if(!in_array($join,['miter','round','bevel'],true))$join='round';
        $base+= [
            'points'=>$clean,'stroke'=>app_siya_news_studio_color($element['stroke']??'#4f46e5','stroke','#4f46e5'),
            'strokeWidth'=>app_siya_news_studio_number($element['strokeWidth']??6,1,100,'strokeWidth'),
            'lineCap'=>$cap,'lineJoin'=>$join,
        ];
    }else{
        $imageId=$element['imageId']??'';if(!is_string($imageId)||!preg_match('/^[a-f0-9]{32}$/D',$imageId))throw new AppSiyaNewsError('รหัสภาพในงานออกแบบไม่ถูกต้อง');
        $newsId=filter_var($element['newsId']??null,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]);if(!$newsId)throw new AppSiyaNewsError('ข่าวของภาพไม่ถูกต้อง');
        $base+= [
            'newsId'=>(int)$newsId,'imageId'=>$imageId,
            'width'=>app_siya_news_studio_number($element['width']??400,1,10000,'width'),
            'height'=>app_siya_news_studio_number($element['height']??300,1,10000,'height'),
            'stroke'=>app_siya_news_studio_color($element['stroke']??null,'stroke'),
            'strokeWidth'=>app_siya_news_studio_number($element['strokeWidth']??0,0,100,'strokeWidth'),
            'cornerRadius'=>app_siya_news_studio_number($element['cornerRadius']??0,0,500,'cornerRadius'),
        ];
        if(isset($element['cropView'])){
            $crop=$element['cropView'];
            if(!is_array($crop))throw new AppSiyaNewsError('ข้อมูลครอปภาพไม่ถูกต้อง');
            $base['cropView']=[
                'x'=>app_siya_news_studio_number($crop['x']??0.5,0,1,'crop.x'),
                'y'=>app_siya_news_studio_number($crop['y']??0.5,0,1,'crop.y'),
                'zoom'=>app_siya_news_studio_number($crop['zoom']??1,1,5,'crop.zoom'),
            ];
        }
    }
    return $base;
}

function app_siya_news_studio_document(array $document): array {
    if(($document['schema']??'')!=='siya-studio/2')throw new AppSiyaNewsError('รูปแบบงานออกแบบไม่ถูกต้อง');
    $pages=$document['pages']??null;if(!is_array($pages)||!array_is_list($pages)||count($pages)<1||count($pages)>40)throw new AppSiyaNewsError('จำนวนหน้าไม่ถูกต้อง (1–40 หน้า)');
    $formats=app_siya_news_studio_formats();$clean=[];$seenPages=[];$seenElements=[];$elementCount=0;$textLength=0;
    foreach($pages as $page){
        if(!is_array($page))throw new AppSiyaNewsError('ข้อมูลหน้าไม่ถูกต้อง');
        $id=$page['id']??'';if(!is_string($id)||!preg_match('/^[A-Za-z0-9_-]{1,40}$/D',$id)||isset($seenPages[$id]))throw new AppSiyaNewsError('รหัสหน้าไม่ถูกต้องหรือซ้ำ');
        $seenPages[$id]=true;
        $format=$page['format']??'';if(!is_string($format)||!isset($formats[$format]))throw new AppSiyaNewsError('ขนาดหน้ากระดาษไม่ถูกต้อง');
        $elements=$page['elements']??null;if(!is_array($elements)||!array_is_list($elements)||count($elements)>200)throw new AppSiyaNewsError('จำนวนองค์ประกอบในหน้าไม่ถูกต้อง');
        $cleanElements=[];
        foreach($elements as $element){
            if(!is_array($element))throw new AppSiyaNewsError('ข้อมูลองค์ประกอบไม่ถูกต้อง');
            $cleanElement=app_siya_news_studio_element($element,$elementCount);
            if(isset($seenElements[$cleanElement['id']]))throw new AppSiyaNewsError('รหัสองค์ประกอบซ้ำ');
            $seenElements[$cleanElement['id']]=true;
            $elementCount++;if($elementCount>2000)throw new AppSiyaNewsError('งานออกแบบมีองค์ประกอบมากเกินกำหนด');
            if($cleanElement['type']==='Text')$textLength+=mb_strlen($cleanElement['text']);
            $cleanElements[]=$cleanElement;
        }
        if($textLength>150000)throw new AppSiyaNewsError('ข้อความในงานออกแบบรวมมากเกินกำหนด');
        $clean[]=['id'=>$id,'format'=>$format,'bg'=>app_siya_news_studio_color($page['bg']??'#ffffff','bg','#ffffff'),
            'safeMargin'=>app_siya_news_studio_number($page['safeMargin']??38,0,200,'safeMargin'),
            'showSafeMargin'=>app_siya_news_studio_bool($page['showSafeMargin']??false,'showSafeMargin'),
            'snap'=>app_siya_news_studio_bool($page['snap']??true,'snap'),
            'elements'=>$cleanElements];
    }
    return ['schema'=>'siya-studio/2','pages'=>$clean];
}

function app_siya_news_studio_references(PDO $pdo,array $document): void {
    $ids=[];
    foreach($document['pages'] as $page)foreach($page['elements'] as $element)if($element['type']==='Image')$ids[$element['newsId']]=true;
    $ids=array_keys($ids);if(!$ids)return;
    $marks=implode(',',array_fill(0,count($ids),'?'));
    $q=$pdo->prepare("SELECT id,status,approved_version FROM eoffice_siya_news WHERE id IN ($marks)");
    $q->execute($ids);$news=[];
    foreach($q->fetchAll() as $row)$news[(int)$row['id']]=$row;
    $approved=[];
    foreach($ids as $id){
        $row=$news[$id]??null;
        if(!$row||$row['status']!=='approved'||$row['approved_version']===null)throw new AppSiyaNewsError('มีภาพจากข่าวที่ไม่ได้ผ่านตรวจแล้ว กรุณาโหลดคลังข่าวใหม่');
        $snapshot=$pdo->prepare('SELECT snapshot FROM eoffice_siya_news_revisions WHERE news_id=? AND version=?');$snapshot->execute([$id,(int)$row['approved_version']]);
        $decoded=$snapshot->fetchColumn();$decoded=is_string($decoded)?json_decode($decoded,true,32,JSON_THROW_ON_ERROR):null;
        if(!is_array($decoded)||!is_array($decoded['image_ids']??null))throw new AppSiyaNewsError('ไม่พบภาพของข่าวที่ผ่านตรวจ กรุณาโหลดคลังข่าวใหม่');
        $approved[$id]=$decoded['image_ids'];
    }
    foreach($document['pages'] as $page)foreach($page['elements'] as $element)if($element['type']==='Image'&&!in_array($element['imageId'],$approved[$element['newsId']],true))throw new AppSiyaNewsError('ภาพที่เลือกไม่ได้อยู่ในข่าวเวอร์ชันที่ผ่านตรวจ กรุณาเลือกภาพใหม่');
}

function app_siya_news_studio_pool(PDO $pdo,string $search='',int $limit=100): array {
    $where="n.status='approved'";$params=[];
    if($search!==''){$where.=' AND (n.title LIKE ? OR n.body LIKE ? OR n.department LIKE ?)';$needle='%'.$search.'%';array_push($params,$needle,$needle,$needle);}
    $limit=max(1,min(100,$limit));
    $q=$pdo->prepare("SELECT n.id,n.title,n.event_date,n.department,n.approved_version,n.reviewed_at,r.snapshot
        FROM eoffice_siya_news n JOIN eoffice_siya_news_revisions r ON r.news_id=n.id AND r.version=n.approved_version
        WHERE $where ORDER BY n.reviewed_at DESC,n.id DESC LIMIT $limit");
    $q->execute($params);
    return app_siya_news_studio_pool_rows($q->fetchAll());
}

function app_siya_news_studio_pool_by_ids(PDO $pdo,array $ids): array {
    $ids=array_values(array_filter(array_map('intval',$ids),static fn($id)=>$id>0));
    if(!$ids)return [];
    $marks=implode(',',array_fill(0,count($ids),'?'));
    $q=$pdo->prepare("SELECT n.id,n.title,n.event_date,n.department,n.approved_version,n.reviewed_at,r.snapshot
        FROM eoffice_siya_news n JOIN eoffice_siya_news_revisions r ON r.news_id=n.id AND r.version=n.approved_version
        WHERE n.status='approved' AND n.id IN ($marks)");
    $q->execute($ids);
    return app_siya_news_studio_pool_rows($q->fetchAll());
}

function app_siya_news_studio_pool_rows(array $rows): array {
    $out=[];
    foreach($rows as $row){
        $data=json_decode((string)$row['snapshot'],true,32,JSON_THROW_ON_ERROR);
        if(!is_array($data))continue;
        $images=[];
        foreach($data['images']??[] as $image){
            if(!is_array($image)||!is_string($image['id']??null)||!preg_match('/^[a-f0-9]{32}$/D',$image['id']))continue;
            $images[]=['id'=>$image['id'],'caption'=>(string)($image['caption']??''),'credit'=>(string)($image['credit']??''),'original_name'=>(string)($image['original_name']??''),'url'=>'../api/siya-news-image.php?id='.$image['id']];
        }
        $body=(string)($data['body']??'');if(mb_strlen($body)>4000)$body=mb_substr($body,0,4000).'…';
        $out[]=['id'=>(int)$row['id'],'title'=>(string)($data['title']??$row['title']),'event_date'=>$data['event_date']??$row['event_date'],'department'=>(string)($data['department']??$row['department']),'body'=>$body,'version'=>(int)$row['approved_version'],'images'=>$images];
    }
    return $out;
}

function app_siya_news_studio_new_document(string $title): array {
    $id=bin2hex(random_bytes(6));
    return ['schema'=>'siya-studio/2','pages'=>[[
        'id'=>'p'.$id,'format'=>'a4_portrait','bg'=>'#ffffff','elements'=>[
            ['id'=>'t'.$id,'type'=>'Text','x'=>64,'y'=>80,'width'=>666,'text'=>$title,'fontFamily'=>'Prompt','fontSize'=>46,'fontStyle'=>'bold','align'=>'left','fill'=>'#1e293b','lineHeight'=>1.25,'letterSpacing'=>0,'rotation'=>0,'opacity'=>1,'scaleX'=>1,'scaleY'=>1,'visible'=>true,'name'=>'หัวข้อ'],
            ['id'=>'s'.$id,'type'=>'Text','x'=>64,'y'=>148,'width'=>666,'text'=>'โรงเรียนศรียานุสรณ์','fontFamily'=>'Prompt','fontSize'=>20,'fontStyle'=>'normal','align'=>'left','fill'=>'#64748b','lineHeight'=>1.4,'letterSpacing'=>0,'rotation'=>0,'opacity'=>1,'scaleX'=>1,'scaleY'=>1,'visible'=>true,'name'=>'คำโปรย'],
        ],
    ]]];
}

function app_siya_news_studio_layout(PDO $pdo,int $id,array $user,bool $lock=false): array {
    $q=$pdo->prepare('SELECT * FROM eoffice_siya_news_layouts WHERE id=?'.($lock?' FOR UPDATE':''));$q->execute([$id]);$layout=$q->fetch();
    if(!$layout)throw new AppSiyaNewsError('ไม่พบชุดจัดหน้า',404);
    if($user['User_Status']!=='Admin'&&(int)$layout['owner_id']!==(int)$user['User_Id'])throw new AppSiyaNewsError('ไม่มีสิทธิ์เข้าถึงชุดจัดหน้านี้',403);
    return $layout;
}

function app_siya_news_studio_layout_list(PDO $pdo,int $ownerId): array {
    $q=$pdo->prepare('SELECT id,title,version,document,updated_at FROM eoffice_siya_news_layouts WHERE owner_id=? ORDER BY updated_at DESC,id DESC LIMIT 50');$q->execute([$ownerId]);
    $rows=[];
    foreach($q->fetchAll() as $row){
        $document=json_decode((string)$row['document'],true,32,JSON_THROW_ON_ERROR);
        $rows[]=['id'=>(int)$row['id'],'title'=>(string)$row['title'],'version'=>(int)$row['version'],'page_count'=>count($document['pages']??[]),'updated_at'=>$row['updated_at']];
    }
    return $rows;
}

function app_siya_news_studio_snapshot(PDO $pdo,array $layout,int $actorId): void {
    $snapshot=['title'=>$layout['title'],'document'=>json_decode((string)$layout['document'],true,32,JSON_THROW_ON_ERROR)];
    $pdo->prepare('INSERT INTO eoffice_siya_news_layout_revisions(layout_id,version,actor_id,snapshot) VALUES(?,?,?,?)')
        ->execute([(int)$layout['id'],(int)$layout['version'],$actorId,json_encode($snapshot,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
    $q=$pdo->prepare('SELECT version FROM eoffice_siya_news_layout_revisions WHERE layout_id=? ORDER BY version DESC LIMIT 1 OFFSET 29');$q->execute([(int)$layout['id']]);
    $cutoff=$q->fetchColumn();
    if($cutoff!==false)$pdo->prepare('DELETE FROM eoffice_siya_news_layout_revisions WHERE layout_id=? AND version<?')->execute([(int)$layout['id'],(int)$cutoff]);
}
