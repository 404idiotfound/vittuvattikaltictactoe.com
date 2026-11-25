<?php
/**
 * POST /api/toss.php   body: {"call":"heads"|"tails"}
 * The coin is flipped on the server with a cryptographically secure RNG,
 * so the result can't be tampered with from the browser.
 */
declare(strict_types=1);
require __DIR__ . '/../config.php';

$body = require_post_with_csrf();
throttle('toss', 0.8);
$call = strtolower((string) ($body['call'] ?? ''));
if (!in_array($call, ['heads', 'tails'], true)) {
    json_response(['ok' => false, 'error' => 'call must be heads or tails'], 422);
}

$result = random_int(0, 1) === 0 ? 'heads' : 'tails';
bump_stats(['tosses' => 1]);

json_response([
    'ok'     => true,
    'call'   => $call,
    'result' => $result,
    'won'    => $call === $result,
]);
