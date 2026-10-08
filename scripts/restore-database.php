<?php
// Imports a verified JSONL snapshot into an EMPTY isolated test database only.
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
ini_set('zend.exception_ignore_args','1');
require __DIR__.'/../config/bootstrap.php';
$database=app_settings()['database'];
if(!preg_match('/^[A-Za-z0-9_]+_test$/',$database))throw new RuntimeException('Restore target must be an isolated _test database');
$pdo=app_pdo();
if($pdo->query('SHOW TABLES')->fetchColumn()!==false)throw new RuntimeException('Restore target must be empty');
$pdo->exec('SET FOREIGN_KEY_CHECKS=0');$mode=(string)$pdo->query('SELECT @@SESSION.sql_mode')->fetchColumn();$timezone=(string)$pdo->query('SELECT @@SESSION.time_zone')->fetchColumn();
$pdo->exec('SET SESSION sql_mode='.$pdo->quote($mode.($mode!==''?',':'').'NO_AUTO_VALUE_ON_ZERO'));
$tables=[];$statements=[];$rows=0;$ended=false;$started=false;$version=0;
try{
    while(($line=fgets(STDIN))!==false){
        if($ended)throw new RuntimeException('Data after end record');
        $record=json_decode($line,true,512,JSON_THROW_ON_ERROR);$kind=$record['kind']??'';
        if(!$started){
            if($kind!=='metadata'||!in_array($record['version']??null,[1,2],true))throw new RuntimeException('Invalid snapshot metadata');$version=$record['version'];
            if(isset($record['time_zone'])){if($record['time_zone']!=='+00:00')throw new RuntimeException('Unsupported snapshot time zone');$pdo->exec("SET SESSION time_zone='+00:00'");}
            $started=true;continue;
        }
        if($kind==='schema'){
            if($pdo->inTransaction())$pdo->commit();
            $table=$record['table']??'';$sql=$record['sql']??'';
            $quoted='`'.str_replace('`','``',$table).'`';
            if($table===''||isset($tables[$table])||!str_starts_with($sql,'CREATE TABLE '.$quoted.' '))throw new RuntimeException('Invalid snapshot schema');
            $pdo->exec($sql);$tables[$table]=[];
            foreach($pdo->query('SHOW COLUMNS FROM '.$quoted)->fetchAll() as $column)if(!preg_match('/\b(?:VIRTUAL|STORED|PERSISTENT) GENERATED\b/i',$column['Extra']))$tables[$table][]=$column['Field'];
        }elseif($kind==='row'){
            $table=$record['table']??'';$data=$record['data']??null;
            if(!isset($tables[$table])||!is_array($data))throw new RuntimeException('Row without schema');
            $binary=$record['binary']??[];
            if(!is_array($binary)||!array_is_list($binary)||($version===1&&$binary!==[]))throw new RuntimeException('Invalid binary column metadata');
            $seen=[];
            foreach($binary as $column){
                if(!is_string($column)||isset($seen[$column])||!isset($data[$column])||!is_string($data[$column]))throw new RuntimeException('Invalid binary column');$seen[$column]=true;
                $bytes=base64_decode($data[$column],true);if($bytes===false)throw new RuntimeException('Invalid binary data');$data[$column]=$bytes;
            }
            $columns=$tables[$table];foreach($columns as $column)if(!array_key_exists($column,$data))throw new RuntimeException('Missing row column');
            if(!$pdo->inTransaction())$pdo->beginTransaction();
            if(!isset($statements[$table])){
                $names=array_map(static fn($name)=>'`'.str_replace('`','``',$name).'`',$columns);
                $statements[$table]=$pdo->prepare('INSERT INTO `'.str_replace('`','``',$table).'` ('.implode(',',$names).') VALUES ('.implode(',',array_fill(0,count($columns),'?')).')');
            }
            $statements[$table]->execute(array_map(static fn($column)=>$data[$column],$columns));$rows++;
        }elseif($kind==='end'){
            if(($record['tables']??null)!==count($tables)||($record['rows']??null)!==$rows)throw new RuntimeException('Snapshot counts mismatch');$ended=true;
        }else throw new RuntimeException('Unknown snapshot record');
    }
    if(!$ended)throw new RuntimeException('Incomplete snapshot');
    if($pdo->inTransaction())$pdo->commit();
    echo json_encode(['restored'=>true,'database'=>$database,'tables'=>count($tables),'rows'=>$rows],JSON_THROW_ON_ERROR).PHP_EOL;
}finally{if($pdo->inTransaction())$pdo->rollBack();$pdo->exec('SET FOREIGN_KEY_CHECKS=1');$pdo->exec('SET SESSION sql_mode='.$pdo->quote($mode));$pdo->exec('SET SESSION time_zone='.$pdo->quote($timezone));}
