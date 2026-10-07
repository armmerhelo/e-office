<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/bootstrap.php';
if(!str_ends_with(app_settings()['database'],'_test'))throw new RuntimeException('Seed allowed only on *_test databases');
$pdo=app_pdo();$ids=[];
foreach(['admin'=>'Admin','owner'=>'User','recipient'=>'User','outsider'=>'User'] as $name=>$role){
 $email='qa-'.$name.'@siya.ac.th';$q=$pdo->prepare('SELECT User_Id FROM t_user WHERE User_Email=?');$q->execute([$email]);$id=$q->fetchColumn();
 if(!$id){$pdo->prepare('INSERT INTO t_user (User_Name,User_Email,User_Password,User_Status,User_Token) VALUES (?,?,?,?,?)')->execute(['QA '.$name,$email,password_hash('Review-Test-2026!',PASSWORD_DEFAULT),$role,bin2hex(random_bytes(32))]);$id=$pdo->lastInsertId();}
 $ids[$name]=(int)$id;
}
// A valid vector PDF with a landscape page for rendering/export assertions.
$objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
$content='BT /F1 24 Tf 50 500 Td (E-OFFICE TEST DOCUMENT) Tj ET';$objects[]='<< /Length '.strlen($content)." >>\nstream\n$content\nendstream";
$pdf="%PDF-1.4\n";$offsets=[0];foreach($objects as $i=>$obj){$offsets[]=strlen($pdf);$pdf.=($i+1)." 0 obj\n$obj\nendobj\n";}$xref=strlen($pdf);$pdf.="xref\n0 6\n0000000000 65535 f \n";foreach(array_slice($offsets,1) as $offset)$pdf.=sprintf("%010d 00000 n \n",$offset);$pdf.="trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n";
$image=imagecreatetruecolor(10,10);ob_start();imagepng($image);$png=ob_get_clean();imagedestroy($image);
echo json_encode(['users'=>$ids,'pdf'=>base64_encode($pdf),'png'=>base64_encode($png)],JSON_THROW_ON_ERROR);
