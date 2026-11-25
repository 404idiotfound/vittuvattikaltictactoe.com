<?php
/**
 * Vithuvattikal Tic Tac Toe - shared configuration & helpers.
 * Included by index.php and every file inside /api.
 */
declare(strict_types=1);

const APP_NAME    = 'Vithuvattikal Tic Tac Toe';
const APP_VERSION = '2.0.0';
const STATS_FILE  = __DIR__ . '/data/stats.json';

/* ------------------------------------------------------------------
 * Heads
 * The game has 6 head slots: assets/img/head1.png ... head6.png.
 * Drop a square transparent PNG with the right name into assets/img/
 * and it appears in the head picker automatically. Missing files are
 * simply skipped. Rename or describe a head by editing the arrays below.
 * ------------------------------------------------------------------ */
const HEAD_SLOTS = 6;

/** Name shown under each head in the picker. */
const HEAD_LABELS = [
    1 => 'Head 1',
    2 => 'Head 2',
    3 => 'Head 3',
    4 => 'Head 4',
    5 => 'Head 5',
    6 => 'Head 6',
];

/** Screen-reader description of each head (optional; falls back to the label). */
const HEAD_ALTS = [
    1 => 'Head one, smiling with a bob haircut',
    2 => 'Head two, in a black hijab',
];

/** true = show dashed "add head3.png" boxes for slots that have no file yet (handy while you are adding heads). */
const SHOW_EMPTY_SLOTS = false;

/* ------------------------------------------------------------------
 * Music
 * Every .mp3 / .ogg / .m4a / .wav inside assets/audio/ is a track, played
 * in file-name order (that is why they start with 01-, 02- ...). When one
 * ends the next one starts; after the last it goes back to the first.
 * ------------------------------------------------------------------ */
const AUDIO_DIR = __DIR__ . '/assets/audio';

/** Behaviour switches. Set the environment variable VTT_DEBUG=1 on a dev machine to see PHP errors. */
define('APP_DEBUG', getenv('VTT_DEBUG') === '1');
ini_set('display_errors', APP_DEBUG ? '1' : '0');
ini_set('log_errors', '1');
error_reporting(APP_DEBUG ? E_ALL : E_ALL & ~E_DEPRECATED & ~E_NOTICE);

$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 7,
        'path'     => '/',
        'secure'   => $isHttps,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}
if (empty($_SESSION['scores']) || !is_array($_SESSION['scores'])) {
    $_SESSION['scores'] = ['p1' => 0, 'draw' => 0, 'p2' => 0];
}

/** Send the headers every page / API answer should carry. */
function send_security_headers(bool $page = false): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: same-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    if ($page) {
        header(
            "Content-Security-Policy: default-src 'self'; img-src 'self' data:; media-src 'self'; " .
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " .
            "script-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
        );
    }
}

/** Heads that really exist on disk, in slot order. */
function available_heads(): array
{
    $out = [];
    for ($n = 1; $n <= HEAD_SLOTS; $n++) {
        $rel   = "assets/img/head{$n}.png";
        $label = HEAD_LABELS[$n] ?? "Head $n";
        $has   = is_file(__DIR__ . '/' . $rel);
        if ($has || SHOW_EMPTY_SLOTS) {
            $out[] = [
                'n'     => $n,
                'src'   => $rel . ($has ? '?v=' . filemtime(__DIR__ . '/' . $rel) : ''),
                'label' => $label,
                'alt'   => HEAD_ALTS[$n] ?? $label,
                'empty' => !$has,
            ];
        }
    }
    return $out;
}

/** Music files on disk, in file-name order. */
function music_tracks(): array
{
    $files = glob(AUDIO_DIR . '/*.{mp3,ogg,m4a,wav}', GLOB_BRACE) ?: [];
    sort($files, SORT_NATURAL | SORT_FLAG_CASE);
    $out = [];
    foreach ($files as $f) {
        $base  = pathinfo($f, PATHINFO_FILENAME);
        $title = ucwords(trim(preg_replace('/[-_\s]+/', ' ', preg_replace('/^\d+[-_.\s]*/', '', $base)) ?? $base));
        $out[] = [
            'src'   => 'assets/audio/' . rawurlencode(basename($f)) . '?v=' . filemtime($f),
            'title' => $title !== '' ? $title : $base,
        ];
    }
    return $out;
}

/** Send a JSON response and stop. */
function json_response(array $data, int $status = 200): never
{
    http_response_code($status);
    send_security_headers();
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Only accept POST requests carrying the session's CSRF token. */
function require_post_with_csrf(): array
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        json_response(['ok' => false, 'error' => 'POST required'], 405);
    }
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($token) || !hash_equals($_SESSION['csrf'], $token)) {
        json_response(['ok' => false, 'error' => 'Invalid token'], 403);
    }
    $raw  = file_get_contents('php://input', false, null, 0, 4096) ?: '[]';
    $body = json_decode($raw, true);
    return is_array($body) ? $body : [];
}

/** Very small per-visitor rate limit so the stats file can't be spammed. */
function throttle(string $key, float $minSeconds): void
{
    $now  = microtime(true);
    $last = (float) ($_SESSION['t_' . $key] ?? 0);
    if ($now - $last < $minSeconds) {
        json_response(['ok' => false, 'error' => 'Too many requests'], 429);
    }
    $_SESSION['t_' . $key] = $now;
}

/** Read the all-time stats file (shared by everyone playing on this server). */
function read_stats(): array
{
    $default = ['matches' => 0, 'p1' => 0, 'p2' => 0, 'draw' => 0, 'tosses' => 0];
    if (!is_file(STATS_FILE)) {
        return $default;
    }
    $data = json_decode((string) file_get_contents(STATS_FILE), true);
    return is_array($data) ? array_merge($default, $data) : $default;
}

/** Atomically add to the all-time stats. */
function bump_stats(array $increments): array
{
    $fh = @fopen(STATS_FILE, 'c+');
    if (!$fh) {
        return read_stats();
    }
    flock($fh, LOCK_EX);
    $raw  = stream_get_contents($fh);
    $data = json_decode($raw ?: '[]', true);
    $data = is_array($data) ? $data : [];
    $data = array_merge(['matches' => 0, 'p1' => 0, 'p2' => 0, 'draw' => 0, 'tosses' => 0], $data);
    foreach ($increments as $key => $by) {
        if (isset($data[$key])) {
            $data[$key] += (int) $by;
        }
    }
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($data));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return $data;
}
