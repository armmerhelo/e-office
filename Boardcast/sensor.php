<?php
require_once __DIR__.'/../config/boardcast.php';app_method('GET','POST');
if(isset($_GET['Temp'])){boardcast_writer();$values=[];foreach(['Temp','Humidity','Moisture','Light','PH'] as $key){$v=filter_var($_GET[$key]??null,FILTER_VALIDATE_FLOAT);if($v===false)app_fail('Invalid sensor value');$values[]=$v;}
 boardcast_db()->prepare('INSERT INTO data_sensor (Temp,Humidity,Moisture,Light,PH) VALUES (?,?,?,?,?)')->execute($values);app_json(['status'=>'success']);
}
$pdo=boardcast_db();if(($_GET['mode']??'')==='latest')app_json($pdo->query('SELECT * FROM data_sensor ORDER BY ID DESC LIMIT 1')->fetch()?:[]);
app_json(array_reverse($pdo->query('SELECT * FROM data_sensor ORDER BY ID DESC LIMIT 20')->fetchAll()));
