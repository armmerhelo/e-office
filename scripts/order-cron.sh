#!/bin/sh
# Invoked by the hosting account's cron, outside web-PHP open_basedir rules.
# Prefer the site's CloudLinux PHP 8.3 and verify CLI/extensions before running.
ROOT=$(CDPATH= cd -P -- "$(dirname -- "$0")/.." && pwd) || exit 1
for PHP in /opt/alt/php83/usr/bin/php /usr/local/php83/bin/php /usr/local/bin/php /usr/bin/php; do
    [ -x "$PHP" ] || continue
    if "$PHP" -r 'exit(PHP_SAPI === "cli" && PHP_VERSION_ID >= 80100 && extension_loaded("pdo_mysql") && extension_loaded("curl") && extension_loaded("fileinfo") && extension_loaded("openssl") && extension_loaded("mbstring") ? 0 : 1);' 2>/dev/null; then
        exec "$PHP" "$ROOT/scripts/order-emails.php"
    fi
done
echo 'Order cron: no compatible PHP 8.1+ CLI with required extensions was found.' >&2
exit 1
