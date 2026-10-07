<?php
require_once __DIR__.'/../config/bootstrap.php';
function document_list(string $mode): never {
    app_method('POST');$d=app_input();$pdo=app_pdo();$user=$mode==='public'?null:app_user();$uid=(int)($user['User_Id']??0);
    $year=(string)($d['Year']??date('Y')+543);if(!preg_match('/^\d{4}$/',$year))app_fail('Invalid year');
    $search=app_text($d,'search_txt',255);$page=max(1,(int)($d['Page_number']??$d['page']??1));$limit=max(1,min(200,(int)($d['limit']??20)));$offset=($page-1)*$limit;
    $start=(int)($d['Page_start']??0);$end=(int)($d['Page_end']??0);$paginationLimit=$limit;
    if($start>0&&$end>=$start){$limit=min(5000,($end-$start+1)*20);$offset=($start-1)*20;$paginationLimit=20;}
    $params=[];$where="d.Is_Delete='active'";$stamp=$mode==='send'&&($d['doc_type']??'')==='Stamp';$id=(int)($d['Doc_Id']??0);
    if($id>0&&$mode==='received'){$where.=' AND d.Doc_Id=?';$params[]=$id;}else{$where.=' AND d.Doc_Year=?';$params[]=$year;}
    if($mode==='public')$where.=" AND d.Doc_Type='External'";
    elseif($mode==='received'){$where.=' AND (EXISTS (SELECT 1 FROM t_access_rights a WHERE a.Doc_Id=d.Doc_Id AND a.User_Id=?) OR EXISTS (SELECT 1 FROM t_access_rights_department a JOIN t_user_department u ON u.Department_Id=a.Department_Id WHERE a.Doc_Id=d.Doc_Id AND u.User_Id=?))';$params[]=$uid;$params[]=$uid;
      if(in_array($d['Read_Status_find']??'', ['NotRead','Readed'],true)){$exists="EXISTS (SELECT 1 FROM t_access_rights r WHERE r.Doc_Id=d.Doc_Id AND r.User_Id=? AND r.Status='Readed')";$where.=' AND '.(($d['Read_Status_find']==='NotRead')?'NOT ':'').$exists;$params[]=$uid;}}
    elseif($stamp){$where.=" AND EXISTS (SELECT 1 FROM t_access_rights a WHERE a.Doc_Id=d.Doc_Id AND a.User_Id=? AND a.Is_Signed='true')";$params[]=$uid;}
    else{$where.=' AND d.User_Id=?';$params[]=$uid;if(in_array($d['doc_type']??'', ['Internal','External'],true)){$where.=' AND d.Doc_Type=?';$params[]=$d['doc_type'];}}
    if($search!==''){$where.=' AND (d.Doc_Id LIKE ? OR d.Doc_Name LIKE ? OR d.Doc_Number LIKE ? OR d.Doc_Date LIKE ? OR d.Doc_Number_Receive LIKE ? OR d.Doc_Receive_From LIKE ?)';array_push($params,...array_fill(0,6,'%'.$search.'%'));}
    $q=$pdo->prepare("SELECT COUNT(*) FROM t_document d WHERE $where");$q->execute($params);$total=(int)$q->fetchColumn();$pages=(int)ceil($total/$paginationLimit);
    $order=$mode==='public'?'d.External_Number DESC,d.Doc_Id DESC':'d.Doc_Id DESC';
    $q=$pdo->prepare("SELECT d.*,u.User_Name owner_name FROM t_document d JOIN t_user u ON u.User_Id=d.User_Id WHERE $where ORDER BY $order LIMIT $limit OFFSET $offset");$q->execute($params);$documents=$q->fetchAll();if(!$documents)app_json([]);
    $ids=array_column($documents,'Doc_Id');$links=array_column($documents,'Doc_File_Link');$marks=implode(',',array_fill(0,count($ids),'?'));
    $files=[];$q=$pdo->prepare("SELECT * FROM t_document_upload WHERE Doc_File_Link IN ($marks) ORDER BY Doc_Upload_Id");$q->execute($links);foreach($q as $file)$files[$file['Doc_File_Link']][]=['file_id'=>$file['Doc_Upload_Id'],'path'=>$file['Doc_Upload_Path'],'detail'=>$file['Doc_Upload_Detail']];
    $access=[];$q=$pdo->prepare("SELECT a.*,u.User_Name FROM t_access_rights a JOIN t_user u ON u.User_Id=a.User_Id WHERE a.Doc_Id IN ($marks) ORDER BY a.id");$q->execute($ids);foreach($q as $a)$access[$a['Doc_Id']][$a['User_Id']]=$a;
    $groups=[];$q=$pdo->prepare("SELECT a.Doc_Id,g.Department_Id,g.Department_Name FROM t_access_rights_department a JOIN t_department g ON g.Department_Id=a.Department_Id WHERE a.Doc_Id IN ($marks)");$q->execute($ids);foreach($q as $group)$groups[$group['Doc_Id']][$group['Department_Id']]=$group['Department_Name'];
    $rows=[];foreach($documents as $doc){$a=$access[$doc['Doc_Id']][$uid]??[];$recipients=[];$i=0;foreach($access[$doc['Doc_Id']]??[] as $recipient)$recipients[]=[$i++=>['user_id'=>$recipient['User_Id'],'user_name'=>$recipient['User_Name'],'user_status'=>$recipient['Status'],'date'=>$recipient['Date'],'Is_Signed'=>$recipient['Is_Signed']]];
      $row=[];foreach(['Doc_Id','Doc_Number','Doc_Year','Doc_Name','Doc_Url_Name','Doc_Url','Doc_Type','Doc_Date','Doc_Date_Update','Doc_Number_Receive','Doc_Date_Receive','Doc_Receive_From','Doc_Action','Doc_Other','Doc_File_Link','External_Number'] as $key)$row[strtolower($key)]=$doc[$key];
      $row+=['send_from'=>$doc['owner_name'],'status'=>$mode==='received'?($a['Status']??'NotRead'):$doc['Status'],'status_read'=>$a['Status']??null,'status_urgent'=>$doc['Status'],'date'=>$a['Date']??$doc['Doc_Date_Update'],'doc_number_receive_stamp'=>$a['Stamp_Recieve_Number']??'','doc_date_receive_stamp'=>$a['Stamp_Date_Recieve']??'','doc_upload_path'=>$files[$doc['Doc_File_Link']]??[],'Pagination'=>$pages,'Total_Records'=>$total,'user_send_to'=>[$recipients],'department_id'=>$groups[$doc['Doc_Id']]??[]];
      if($mode==='public')$row['doc_date']=$doc['Doc_Date_Receive'];if($stamp)$row['doc_date']=$a['Date']??$doc['Doc_Date'];$rows[]=$row;
    }
    app_json($rows);
}
