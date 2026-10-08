<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/amss-links.php';
$passed=0;
function check(bool $ok,string $name):void {global $passed;if(!$ok)throw new RuntimeException($name);$passed++;echo "PASS $name\n";}
$url='https://amss.sesact.go.th/modules/bookregister/upload_files2/1769410561x2033142038_1.pdf';
check(app_amss_pdf_url($url)===$url,'direct AMSS PDF recognized');
check(app_amss_pdf_url(str_replace('https:','http:',$url))===$url,'legacy HTTP upgraded to HTTPS');
check(app_amss_pdf_url('HTTP://amss.sesact.go.th:80/a.pdf')==='https://amss.sesact.go.th/a.pdf','uppercase HTTP with standard port accepted');
check(app_amss_pdf_url('https://AMSS.SESACT.GO.TH/files/document.PDF?download=1#page=2')==='https://amss.sesact.go.th/files/document.PDF?download=1','case, query and fragment normalization');
foreach(['https://amss.sesact.go.th/','https://amss.sesact.go.th/login.php',
    'https://amss.sesact.go.th.attacker.example/a.pdf','https://example.com/a.pdf',
    'https://user:password@amss.sesact.go.th/a.pdf','https://amss.sesact.go.th:8443/a.pdf',
    'file:///a.pdf','ftp://amss.sesact.go.th/a.pdf'] as $bad)
    check(app_amss_pdf_url($bad)===null,'not imported: '.$bad);
foreach(['127.0.0.1','10.0.0.1','192.168.1.1','172.16.0.1','169.254.169.254','0.0.0.0','224.0.0.1','::1',
    '100.64.0.1','100.127.255.254','192.0.0.8','192.0.2.1','198.18.0.1','198.19.255.254','198.51.100.1','203.0.113.1'] as $ip)
    check(!app_amss_public_ip($ip),'non-public address blocked: '.$ip);
check(app_amss_public_ip('8.8.8.8'),'public IPv4 accepted');
app_amss_validate_pdf("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");check(true,'PDF bytes accepted');
foreach(['<html>Login required</html>',"%PDF-1.4\ntruncated",str_repeat('x',20*1024*1024+1)] as $bad){
    try{app_amss_validate_pdf($bad);throw new RuntimeException('Invalid PDF accepted');}
    catch(AppAmssException $e){check(true,'invalid or oversized PDF rejected');}
}
echo "AMSS validation: $passed passed\n";
