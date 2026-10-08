<?php
// Imports a verified JSONL snapshot into an EMPTY isolated test database only.
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
ini_set('zend.exception_ignore_args','1');
require __DIR__.'/../config/bootstrap.php';
$database=app_settings()['database'];
if(!preg_match('/^[A-Za-z0-9_]+_test$/',$database))throw new RuntimeException('Restore target must be an isolated _test database');
$pdo=app_pdo();
if($pdo->query('SHOW TABLES')->fetchColumn()!==false)throw new RuntimeException('Restore target must be empty');
$pdo->exec('SET FOREIGN_KEY_CHECKS=0');$tables=[];$statements=[];$rows=0;$ended=false;$started=false;
try{
    while(($line=fgets(STDIN))!==false){
        if($ended)throw new RuntimeException('Data after end record');
        $record=json_decode($line,true,512,JSON_THROW_ON_ERROR);$kind=$record['kind']??'';
        if(!$started){if($kind!=='metadata'||($record['version']??null)!==1)throw new RuntimeException('Invalid snapshot metadata');$started=true;continue;}
        if($kind==='schema'){
            if($pdo->inTransaction())$pdo->commit();
            $table=$record['table']??'';$sql=$record['sql']??'';
            $quoted='`'.str_replace('`','``',$table).'`';
            if($table===''||isset($tables[$table])||!str_starts_with($sql,'CREATE TABLE '.$quoted.' '))throw new RuntimeException('Invalid snapshot schema');
            $pdo->exec($sql);$tables[$table]=[];
            foreach($pdo->query('SHOW COLUMNS FROM '.$quoted)->fetchAll() as $column)if(!str_contains($column['Extra'],'GENERATED'))$tables[$table][]=$column['Field'];
        }elseif($kind==='row'){
            $table=$record['table']??'';$data=$record['data']??null;
            if(!isset($tables[$table])||!is_array($data))throw new RuntimeException('Row without schema');
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
}finally{if($pdo->inTransaction())$pdo->rollBack();$pdo->exec('SET FOREIGN_KEY_CHECKS=1');}
