<?php
require_once __DIR__ . '/bootstrap.php';
$host = app_settings()['host'];
$username = app_settings()['username'];
$password = app_settings()['password'];
$database = app_settings()['database'];
$conn = app_mysqli();
