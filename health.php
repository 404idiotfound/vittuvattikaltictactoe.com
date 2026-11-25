<?php
/**
 * GET /api/health.php  -> quick deployment check (use it for uptime monitors).
 * Reports only yes/no facts, never paths or versions of your server.
 */
declare(strict_types=1);
require __DIR__ . '/../config.php';

$checks = [
    'php_ok'          => PHP_VERSION_ID >= 80100,
    'stats_writable'  => is_writable(STATS_FILE) || (!is_file(STATS_FILE) && is_writable(dirname(STATS_FILE))),
    'heads_found'     => count(array_filter(available_heads(), fn ($h) => !$h['empty'])),
    'music_tracks'    => count(music_tracks()),
];
$ok = $checks['php_ok'] && $checks['stats_writable'] && $checks['heads_found'] >= 2;
json_response(['ok' => $ok, 'version' => APP_VERSION, 'checks' => $checks], $ok ? 200 : 503);
