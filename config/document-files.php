<?php
require_once __DIR__.'/bootstrap.php';
class AppDocumentFileBusy extends RuntimeException {}

// A DB deadlock can release row locks before filesystem compensation runs.
// This stable, document-scoped mutex survives a DB rollback. Every publisher,
// cache writer and archive scanner/evictor acquires it BEFORE its DB row locks.
final class AppDocumentFileLock {
    private $handle=null;

    public function __construct(int $id, float $timeout=30.0) {
        if ($id<1) throw new InvalidArgumentException('Invalid document lock');
        if (app_pdo()->inTransaction()) throw new LogicException('Acquire document file lock before starting the transaction');
        $directory=rtrim(app_settings()['storage'],'/\\').'/.document-locks';
        if (!is_dir($directory) && !@mkdir($directory,0750,true) && !is_dir($directory)) throw new RuntimeException('Document lock storage unavailable');
        $handle=@fopen($directory.'/'.$id.'.lock','c+b');
        if (!$handle) throw new RuntimeException('Document lock unavailable');
        $deadline=microtime(true)+$timeout;
        do {
            if (flock($handle,LOCK_EX|LOCK_NB)) { $this->handle=$handle; return; }
            usleep(20000);
        } while (microtime(true)<$deadline);
        fclose($handle);
        throw new AppDocumentFileBusy('Document is busy; please retry');
    }

    public function release(): void {
        if (is_resource($this->handle)) { flock($this->handle,LOCK_UN); fclose($this->handle); }
        $this->handle=null;
    }

    public function __destruct() { $this->release(); }
}

function app_document_file_lock(int $id, float $timeout=30.0): AppDocumentFileLock {
    try { return new AppDocumentFileLock($id,$timeout); }
    catch (AppDocumentFileBusy $e) {
        if (PHP_SAPI==='cli') throw $e;
        header('Retry-After: 2');
        app_fail('เอกสารกำลังถูกใช้งาน กรุณาลองใหม่อีกครั้ง',503);
    }
}

// Used before rollback while the file mutex is still held, including when the
// DB has already rolled back a deadlock victim. Never ignore a restore failure.
function app_restore_signed_file(string $target, ?string $backup, bool $installed): void {
    clearstatcache(true,$target);
    if ($backup!==null) {
        clearstatcache(true,$backup);
        if (!is_file($backup)) throw new RuntimeException('Signed backup missing during recovery');
        if (is_file($target) && !unlink($target)) throw new RuntimeException('Signed file removal failed during recovery');
        if (!rename($backup,$target)) throw new RuntimeException('Signed backup restoration failed');
    } elseif ($installed && is_file($target) && !unlink($target)) {
        throw new RuntimeException('Signed file removal failed during recovery');
    }
}
