<?php
require_once __DIR__.'/../config/bootstrap.php';app_method('POST');app_user();$d=app_input();$search='%'.app_text($d,'name_serch',255).'%';$q=app_pdo()->prepare('SELECT User_Id,User_Name AS message FROM t_user WHERE User_Name LIKE ? ORDER BY User_Name LIMIT 5000');$q->execute([$search]);app_json($q->fetchAll());
