<?php
require_once __DIR__ . '/../../config/bootstrap.php';
function getDatabaseConnection(): PDO { return app_pdo(); }
