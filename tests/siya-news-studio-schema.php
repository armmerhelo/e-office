<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/siya-news.php';require __DIR__.'/../config/siya-news-studio-schema.php';
$s=app_settings();if(!$s['mock']||!preg_match('/^eoffice_siya_news_[a-z0-9_]+_test$/D',$s['database'])||!in_array($s['host'],['127.0.0.1','localhost'],true))throw new RuntimeException('Isolated local mock database required');
$pdo=app_pdo();$newsBefore=$pdo->query('SELECT COUNT(*) FROM eoffice_siya_news')->fetchColumn();
app_siya_news_studio_migrate($pdo);app_siya_news_studio_migrate($pdo);
foreach(['eoffice_siya_news_layouts','eoffice_siya_news_layout_revisions'] as $table)if(!$pdo->query("SHOW TABLES LIKE '$table'")->fetchColumn())throw new RuntimeException('Missing studio table: '.$table);
$columns=$pdo->query('SHOW COLUMNS FROM eoffice_siya_news_layouts')->fetchAll(PDO::FETCH_COLUMN);foreach(['id','owner_id','title','document','version','updated_at'] as $column)if(!in_array($column,$columns,true))throw new RuntimeException('Missing layout column: '.$column);
if((int)$newsBefore!==(int)$pdo->query('SELECT COUNT(*) FROM eoffice_siya_news')->fetchColumn())throw new RuntimeException('Studio migration changed news');
echo "PASS studio additive schema, required layout columns, idempotent migration and news preservation\n";
