<?php
// Authenticated, chunked encryption. Each archive derives its own AES-256-GCM
// key from a fresh salt; counters and an authenticated footer detect reordering,
// tampering, truncation and trailing data without loading an archive in memory.
final class AppBackupWriter {
    private $handle;
    private string $key;
    private string $aad;
    private string $buffer='';
    private int $sequence=0;
    private int $bytes=0;
    private $hash;
    private bool $finished=false;
    public function __construct(string $path,string $masterKey,string $encoding='opaque') {
        if(strlen($masterKey)!==32)throw new RuntimeException('Backup key must contain 32 bytes');
        $this->handle=fopen($path,'xb');if(!$this->handle)throw new RuntimeException('Backup output already exists or is unavailable');
        chmod($path,0600);$salt=random_bytes(32);
        $header=json_encode(['version'=>1,'cipher'=>'aes-256-gcm','salt'=>base64_encode($salt),'encoding'=>$encoding,'key_id'=>substr(hash('sha256',$masterKey),0,16)],JSON_THROW_ON_ERROR);
        $this->key=hash_hkdf('sha256',$masterKey,32,'eoffice-backup-v1',$salt);$this->aad=hash('sha256',$header,true);$this->hash=hash_init('sha256');
        $this->raw("EOFFICE-AEAD-1\n".pack('N',strlen($header)).$header);
    }
    private function raw(string $bytes): void {
        $offset=0;while($offset<strlen($bytes)){$count=fwrite($this->handle,substr($bytes,$offset));if($count===false||$count===0)throw new RuntimeException('Backup write failed');$offset+=$count;}
    }
    private function record(string $type,string $plain): void {
        if($this->sequence>=4294967294)throw new RuntimeException('Backup record limit exceeded');
        $sequence=++$this->sequence;$tag='';$iv=pack('N3',0,0,$sequence);
        $cipher=openssl_encrypt($plain,'aes-256-gcm',$this->key,OPENSSL_RAW_DATA,$iv,$tag,$this->aad.pack('N',$sequence).$type,16);
        if($cipher===false||strlen($tag)!==16)throw new RuntimeException('Backup encryption failed');
        $this->raw($type.pack('N',strlen($cipher)).$tag.$cipher);
    }
    public function write(string $bytes): void {
        if($this->finished)throw new RuntimeException('Backup is already finished');
        $this->bytes+=strlen($bytes);hash_update($this->hash,$bytes);$this->buffer.=$bytes;
        while(strlen($this->buffer)>=65536){$this->record('D',substr($this->buffer,0,65536));$this->buffer=substr($this->buffer,65536);}
    }
    public function finish(): array {
        if($this->finished)throw new RuntimeException('Backup is already finished');
        if($this->buffer!==''){$this->record('D',$this->buffer);$this->buffer='';}
        $result=['bytes'=>$this->bytes,'sha256'=>hash_final($this->hash),'chunks'=>$this->sequence];
        $this->record('F',json_encode($result,JSON_THROW_ON_ERROR));if(!fflush($this->handle))throw new RuntimeException('Backup flush failed');fclose($this->handle);$this->handle=null;$this->finished=true;
        return $result;
    }
    public function __destruct(){if(is_resource($this->handle))fclose($this->handle);}
}

function app_backup_read_exact($handle,int $bytes): string {
    $result='';while(strlen($result)<$bytes){$part=fread($handle,$bytes-strlen($result));if($part===false||$part==='')throw new RuntimeException('Incomplete encrypted backup');$result.=$part;}return $result;
}
function app_backup_publish(string $temporary,string $output): void {
    // Same-directory hard-link creation is atomic and never replaces a path
    // another worker created after our initial existence check.
    if(!@link($temporary,$output))throw new RuntimeException('Backup output exists or cannot be published');
    if(!unlink($temporary))throw new RuntimeException('Backup temporary output cleanup failed');
}
function app_backup_verify(string $path,string $masterKey,?callable $emit=null): array {
    if(strlen($masterKey)!==32)throw new RuntimeException('Backup key must contain 32 bytes');
    $handle=fopen($path,'rb');if(!$handle)throw new RuntimeException('Backup input unavailable');
    try{
        if(app_backup_read_exact($handle,15)!=="EOFFICE-AEAD-1\n")throw new RuntimeException('Unsupported backup format');
        $length=unpack('N',app_backup_read_exact($handle,4))[1];if($length<1||$length>4096)throw new RuntimeException('Invalid backup header');
        $header=app_backup_read_exact($handle,$length);$info=json_decode($header,true,16,JSON_THROW_ON_ERROR);$salt=base64_decode($info['salt']??'',true);
        if(($info['version']??null)!==1||($info['cipher']??'')!=='aes-256-gcm'||$salt===false||strlen($salt)!==32)throw new RuntimeException('Invalid backup header');
        $key=hash_hkdf('sha256',$masterKey,32,'eoffice-backup-v1',$salt);$aad=hash('sha256',$header,true);$sequence=0;$bytes=0;$hash=hash_init('sha256');
        while(true){
            $type=app_backup_read_exact($handle,1);$length=unpack('N',app_backup_read_exact($handle,4))[1];
            if(!in_array($type,['D','F'],true)||$length<1||$length>65536||$sequence>=4294967294)throw new RuntimeException('Invalid backup record');
            $tag=app_backup_read_exact($handle,16);$cipher=app_backup_read_exact($handle,$length);$sequence++;
            $plain=openssl_decrypt($cipher,'aes-256-gcm',$key,OPENSSL_RAW_DATA,pack('N3',0,0,$sequence),$tag,$aad.pack('N',$sequence).$type);
            if($plain===false)throw new RuntimeException('Backup authentication failed');
            if($type==='D'){$bytes+=strlen($plain);hash_update($hash,$plain);if($emit)$emit($plain);continue;}
            $footer=json_decode($plain,true,16,JSON_THROW_ON_ERROR);$digest=hash_final($hash);
            if(($footer['bytes']??null)!==$bytes||($footer['chunks']??null)!==$sequence-1||!hash_equals($footer['sha256']??'',$digest)||fread($handle,1)!=='')throw new RuntimeException('Backup footer validation failed');
            return ['verified'=>true,'bytes'=>$bytes,'sha256'=>$digest,'chunks'=>$sequence-1,'encoding'=>$info['encoding']??'opaque'];
        }
    }finally{fclose($handle);}
}
