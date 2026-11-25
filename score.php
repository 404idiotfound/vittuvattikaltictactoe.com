<?php
/**
 * POST /api/score.php
 *   {"result":"p1"|"p2"|"draw"}  -> record a finished round
 *   {"action":"reset"}            -> clear this visitor's session scoreboard
 * Session scores belong to the visitor; all-time totals are shared.
 */
declare(strict_types=1);
require __DIR__ . '/../config.php';

$body = require_post_with_csrf();
throttle('score', 0.4);

if (($body['action'] ?? '') === 'reset') {
    $_SESSION['scores'] = ['p1' => 0, 'draw' => 0, 'p2' => 0];
    json_response(['ok' => true, 'scores' => $_SESSION['scores'], 'global' => read_stats()]);
}

$result = (string) ($body['result'] ?? '');
if (!in_array($result, ['p1', 'p2', 'draw'], true)) {
    json_response(['ok' => false, 'error' => 'invalid result'], 422);
}

$_SESSION['scores'][$result]++;
$global = bump_stats(['matches' => 1, $result => 1]);

json_response(['ok' => true, 'scores' => $_SESSION['scores'], 'global' => $global]);
