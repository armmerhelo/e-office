<?php
// Fill the new credentials on the production host, then save as config/local.php.
// This template is never activated or uploaded by the staging deployment tool.
return [
    'DB_HOST' => 'localhost', 'DB_PORT' => '3306',
    'DB_DATABASE' => 'siyaacth_eoffice', 'DB_USERNAME' => 'siyaacth_eoffice',
    'DB_PASSWORD' => '',
    'APP_URL' => 'https://e-office.siya.ac.th',
    'GOOGLE_CLIENT_ID' => '',
    'GOOGLE_CLIENT_SECRET' => '',
    // base64_encode(random_bytes(32)); or reuse a configured EOFFICE_SETTINGS_KEY.
    'EOFFICE_MEMBER_VERSION_KEY' => '',
    'EOFFICE_MOCK_SERVICES' => 'false',
    'EOFFICE_REMOTE_FILES' => 'false',
    'EOFFICE_STORAGE' => '/absolute/private/path/file_document',
];
