<?php
require_once __DIR__.'/../config/bootstrap.php';app_method('POST');$user=app_user();$data=app_input();
$encoded=app_text($data,'image_data',6*1024*1024,true);$bytes=base64_decode($encoded,true);
if($bytes===false||strlen($bytes)>4*1024*1024)app_fail('Invalid image');
$info=@getimagesizefromstring($bytes);if(!$info||$info[0]*$info[1]>16000000||!in_array($info[2],[IMAGETYPE_PNG,IMAGETYPE_JPEG],true))app_fail('Only PNG/JPEG images allowed');
$image=@imagecreatefromstring($bytes);if(!$image)app_fail('Invalid image');
$dir=__DIR__.'/generated_images';if(!is_dir($dir))mkdir($dir,0755,true);$name=$user['User_Id'].'_'.bin2hex(random_bytes(16)).'.png';
if(!imagepng($image,$dir.'/'.$name))throw new RuntimeException('Image save failed');imagedestroy($image);
app_json(['success'=>true,'file_path'=>'generated_images/'.$name]);
