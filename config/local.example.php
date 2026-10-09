<?php
return [
    'DB_HOST' => '127.0.0.1', 'DB_DATABASE' => 'document2',
    'DB_USERNAME' => 'root', 'DB_PASSWORD' => '',
    'APP_URL' => 'http://localhost',
    'GOOGLE_CLIENT_ID' => '',
    'GOOGLE_CLIENT_SECRET' => '',
    'GEMINI_API_KEY' => '',
    'GEMINI_MODEL' => 'gemini-2.5-flash',
    // Generate once on the server: base64_encode(random_bytes(32)). Keep private.
    'EOFFICE_SETTINGS_KEY' => '',
    // Optional dedicated member-version signing key; otherwise uses SETTINGS_KEY.
    // Both use base64_encode(random_bytes(32)); keep stable and server-private.
    'EOFFICE_MEMBER_VERSION_KEY' => '',
    // Private scheduler token (64 lowercase hex characters) and backup master key.
    'EOFFICE_CRON_TOKEN' => '',
    'EOFFICE_BACKUP_KEY' => '', // base64_encode(random_bytes(32)); preserve for recovery.
    // 'EOFFICE_BACKUP_DIRECTORY' => '/absolute/path/outside/public_html/backups',
    'EOFFICE_DRIVE_ARCHIVE_ENABLED' => 'false',
    'EOFFICE_DRIVE_ARCHIVE_URL' => '', // dedicated authenticated Apps Script /exec route
    'EOFFICE_DRIVE_ARCHIVE_SECRET' => '', // 64 random lowercase hex, same Script Property
    'EOFFICE_DRIVE_EVICT_ENABLED' => 'false', // enable after remote recovery validation
    'EOFFICE_DRIVE_EVICT_GRACE_DAYS' => '14', // minimum 7
    'EOFFICE_MOCK_SERVICES' => 'true',
    'EOFFICE_REMOTE_FILES' => 'false',
];
