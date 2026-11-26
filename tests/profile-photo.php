<?php
if (PHP_SAPI !== 'cli') exit;
require __DIR__.'/../config/profile-photo.php';

$passed = 0;
function check(bool $condition, string $name): void {
    global $passed;
    if (!$condition) throw new RuntimeException('FAILED '.$name);
    $passed++;
    echo 'PASS '.$name.PHP_EOL;
}

$square = app_profile_photo_crop(800, 800);
check($square === ['x'=>0, 'y'=>0, 'side'=>800], 'square photos remain centered');
$landscape = app_profile_photo_crop(1200, 800);
check($landscape['x'] === 200 && $landscape['y'] === 0 && $landscape['side'] === 800, 'landscape photos stay horizontally centered without vertical crop');
$portrait = app_profile_photo_crop(1333, 2000);
$centerY = (int)((2000 - 1333) / 2);
check($portrait['x'] === 0 && $portrait['side'] === 1333, 'portrait crop keeps the full width');
check($portrait['y'] === (int)round((2000 - 1333) * APP_PROFILE_PHOTO_TOP_BIAS), 'portrait crop uses the documented upward bias');
check($portrait['y'] < $centerY && $portrait['y'] >= 0, 'portrait crop preserves the upper part instead of cutting the hairline');
check($portrait['y'] + $portrait['side'] <= 2000, 'portrait crop stays inside the source image');
$tall = app_profile_photo_crop(100, 1000);
check($tall['side'] === 100 && $tall['y'] >= 0 && $tall['y'] + $tall['side'] <= 1000, 'very tall photos keep a valid square inside the image');
echo 'Profile photo crop: '.$passed.' passed'.PHP_EOL;
