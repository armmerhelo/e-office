#!/bin/sh
ROOT=$(CDPATH= cd -P -- "$(dirname -- "$0")/.." && pwd) || exit 1
ACTION=${1:-worker}
case "$ACTION" in worker|backup|health) ;; *) echo 'Invalid archive action' >&2; exit 1 ;; esac
for PHP in /opt/alt/php83/usr/bin/php /usr/local/php83/bin/php /usr/local/bin/php /usr/bin/php; do
    [ -x "$PHP" ] || continue
    if "$PHP" -r 'exit(PHP_SAPI === "cli" && PHP_VERSION_ID >= 80100 && extension_loaded("pdo_mysql") && extension_loaded("curl") && extension_loaded("openssl") && extension_loaded("zlib") ? 0 : 1);' 2>/dev/null; then
        exec "$PHP" "$ROOT/scripts/drive-archive.php" "$ACTION"
    fi
done
echo 'Drive archive: compatible PHP CLI unavailable' >&2
exit 1
