<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/siya-news.php';require __DIR__.'/../config/siya-news-schema.php';
$s=app_settings();if(!$s['mock']||!preg_match('/^eoffice_siya_news_[a-z0-9_]+_test$/D',$s['database'])||!in_array($s['host'],['127.0.0.1','localhost'],true))throw new RuntimeException('Isolated local mock database required');
$pdo=app_pdo();$before=$pdo->query('SELECT id,status,version FROM eoffice_siya_news ORDER BY id')->fetchAll();
app_siya_news_migrate($pdo);app_siya_news_migrate($pdo);
foreach(['deleted_at','deleted_by','deleted_from_status'] as $name)if(!$pdo->query("SHOW COLUMNS FROM eoffice_siya_news LIKE '$name'")->fetch())throw new RuntimeException('Trash migration missing field');
if($before!==$pdo->query('SELECT id,status,version FROM eoffice_siya_news ORDER BY id')->fetchAll())throw new RuntimeException('Migration changed existing news');
echo "PASS additive trash columns, idempotent migration and existing news preservation\n";
