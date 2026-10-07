<?php
require_once __DIR__.'/../config/bootstrap.php';app_method('POST');app_user();$d=app_input();$search='%'.app_text($d,'name_serch',255).'%';$q=app_pdo()->prepare('SELECT Department_Id,Department_Name FROM t_department WHERE Department_Name LIKE ? ORDER BY Department_Name LIMIT 5000');$q->execute([$search]);app_json($q->fetchAll());
