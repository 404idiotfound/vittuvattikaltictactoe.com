# Vithuvattikal Tic Tac Toe (v2)

A PHP tic tac toe game where heads replace X and O, played over a see-through photo of the Vithuvattikal building.
Works on phones, tablets and laptops, with background music.

## The rules (new in v2)
1. Each player has only **3 heads**.
2. Take turns putting a head on an empty square until all 3 of yours are down.
3. After that, each turn you **slide one of your heads to a free square right beside it** (sideways, up, down or diagonally).
4. First to get **3 heads in a line** (row, column or diagonal) wins.
5. The same position 3 times = draw.

Want sideways/up/down only (no diagonal slides)? In `assets/js/game.js` set `ALLOW_DIAGONAL = false`.
Want 4 heads each, etc.? Change `MAX_HEADS`.

## Features
- 6 head slots; both players choose their own head (picking one the other player has swaps them)
- Two players, or vs computer (Easy, Medium, Unbeatable); the computer plays the sliding phase too
- Coin toss with a 3D flip; the result is decided on the server (`api/toss.php`) with `random_int()`
- Place/slide hints, heads-in-hand trays, selected-head and "you can slide here" highlights, win line, confetti
- Music player: 5 original tracks, the next one starts when one ends, plus prev / next / shuffle / volume / minimise
- Layout: phone = one column; laptop or phone on its side = board left, scores and controls right
- Session scoreboard saved by PHP; all-time totals in `data/stats.json`

## Run it
Quick (PHP 8.1+ installed):

    cd vithuvattikal-tictactoe
    php -S localhost:8000

Then open http://localhost:8000
(set `VTT_DEBUG=1` in the environment on your dev machine to see PHP errors).

XAMPP / WAMP / Laragon: copy the folder into `htdocs` (or `www`) and open
http://localhost/vithuvattikal-tictactoe/

## Deploying
1. Upload the folder (shared hosting, VPS, or any PHP 8.1+ host).
2. Make `data/stats.json` writable by PHP (chmod 664 or 666). The folder `data/` is blocked from the web.
3. Apache: `.htaccess` already handles security headers, compression, caching and blocks internal files.
   Once you have an SSL certificate, uncomment the 3 HTTPS-redirect lines in it.
   nginx: use `nginx.conf.example` as a starting point.
4. Open `/api/health.php` - it should show `"ok": true` (use it for uptime monitoring too).
5. On a phone, "Add to home screen" installs it like an app (`manifest.webmanifest` + icons are included).

## Adding heads (4 free slots)
Drop square, transparent PNGs into `assets/img/` named exactly:

    head3.png  head4.png  head5.png  head6.png

They appear in the picker automatically, no code change. Names and descriptions are in `config.php`
(`HEAD_LABELS`, `HEAD_ALTS`). Set `SHOW_EMPTY_SLOTS = true` there to see dashed placeholder boxes while you prepare them.

## Adding music
Put `.mp3` / `.ogg` / `.m4a` / `.wav` files into `assets/audio/`. They play in file-name order
(`01-...`, `02-...`), then loop. Titles come from the file names. The 5 included tracks were
synthesised for this project, so there is nothing to license; if you add your own songs, use music you may publish.

## Structure
    index.php              page; session, CSRF token, head picker, music list
    config.php             settings (heads, music), session, CSRF, JSON helpers, stats file
    api/toss.php           server-side coin flip
    api/score.php          record round result / reset scoreboard
    api/health.php         deployment check
    assets/css/style.css   responsive layout
    assets/js/game.js      rules, computer player, animations, sound effects, music player, confetti
    assets/img/            head1..head6.png, background.jpg, favicon + app icons
    assets/audio/          01..05 mp3 tracks
    data/stats.json        all-time totals (blocked from the web)
    manifest.webmanifest   installable web app info
    .htaccess / nginx.conf.example   server settings

## Customising
- Swap a head: replace its `headN.png`. Swap the background: replace `assets/img/background.jpg`.
- Fonts load from Google Fonts; offline, the game falls back to system fonts.
- Music volume starts at 35% (`MUSIC_DEFAULT_VOLUME` in `game.js`). Browsers only allow sound after a tap, so music starts on the first tap.
