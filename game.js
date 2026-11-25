/* Vithuvattikal Tic Tac Toe - game logic
   PHP serves the page, the coin toss and the scores; everything else runs here.

   RULES
   1. Every player owns MAX_HEADS (3) heads.
   2. Players take turns putting a head on an empty square until all three are on the board.
   3. After that, each turn you slide ONE of your heads to a free square right beside it.
   4. Three of your heads in a row / column / diagonal wins, at any time (also while placing).
   5. The same position three times in a row is a draw. */
(() => {
  'use strict';
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------------- Settings you may want to change ---------------- */
  const MAX_HEADS      = 3;     // heads per player
  const ALLOW_DIAGONAL = true;  // true: a head may also slide diagonally to a neighbouring square
  const MAX_TURNS      = 150;   // safety net: round ends in a draw after this many turns in total
  const MUSIC_DEFAULT_VOLUME = 0.35;

  const BOOT  = JSON.parse($('#vtt-boot').textContent);
  const HEADS = BOOT.heads.map(h => ({ ...h, src: new URL(h.src, document.baseURI).href })); // absolute, so CSS url() works too
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

  /* neighbours of every square */
  const ADJ = Array.from({ length: 9 }, (_, i) => {
    const r = Math.floor(i / 3), c = i % 3, out = [];
    for (let j = 0; j < 9; j++) {
      if (j === i) continue;
      const dr = Math.abs(Math.floor(j / 3) - r), dc = Math.abs(j % 3 - c);
      if (ALLOW_DIAGONAL ? Math.max(dr, dc) === 1 : dr + dc === 1) out.push(j);
    }
    return out;
  });

  const S = {
    mode: 'pvp', diff: 'medium',
    chars: { p1: 0, p2: 1 },                       // index into HEADS for each seat
    names: { p1: 'Player 1', p2: 'Player 2' },
    board: Array(9).fill(null), placed: { p1: 0, p2: 0 }, sel: null,
    turn: 'p1', starter: 'p1', turns: 0, seen: {},
    over: false, thinking: false,
    scores: { ...BOOT.scores }, global: BOOT.global,
    sound: true, tossBusy: false, coinRot: 0, winLine: null,
  };
  try { S.sound = localStorage.getItem('vtt-sound') !== 'off'; } catch (e) {}

  const other   = s => (s === 'p1' ? 'p2' : 'p1');
  const headSrc = seat => HEADS[S.chars[seat]].src;
  const isCpu   = seat => S.mode === 'cpu' && seat === 'p2';
  const nameOf  = seat => S.names[seat];
  const inMovePhase = seat => S.placed[seat] >= MAX_HEADS;

  /* ---------------- Pure rules (used by the game and by the computer player) ---------------- */
  const winnerOf = b => {
    for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { seat: b[l[0]], line: l };
    return null;
  };
  function legalMoves(b, placed, seat) {
    const mv = [];
    if (placed[seat] < MAX_HEADS) {
      for (let i = 0; i < 9; i++) if (!b[i]) mv.push({ to: i });
    } else {
      for (let f = 0; f < 9; f++) if (b[f] === seat) for (const t of ADJ[f]) if (!b[t]) mv.push({ from: f, to: t });
    }
    return mv;
  }
  function applyMove(b, placed, seat, m) {
    const nb = b.slice(), np = { p1: placed.p1, p2: placed.p2 };
    if (m.from === undefined) { nb[m.to] = seat; np[seat]++; } else { nb[m.from] = null; nb[m.to] = seat; }
    return [nb, np];
  }

  /* ---------------- Server calls ---------------- */
  async function api(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': BOOT.csrf },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  /* ---------------- Sound effects (Web Audio, no files) ---------------- */
  let ac;
  function tone(freq, dur = .12, type = 'sine', delay = 0, vol = .12) {
    if (!S.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .02);
    } catch (e) {}
  }
  const sfx = {
    place: seat => tone(seat === 'p1' ? 520 : 390, .14, 'triangle'),
    pick:  () => tone(760, .08, 'triangle', 0, .09),
    slide: seat => { const f = seat === 'p1' ? 440 : 330; tone(f, .1, 'triangle'); tone(f * 1.5, .12, 'triangle', .07); },
    nope:  () => tone(160, .12, 'square', 0, .05),
    tick:  () => tone(1400, .04, 'square', 0, .04),
    win:   () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .28, 'triangle', i * .11, .14)),
    draw:  () => { tone(330, .25, 'sine'); tone(262, .35, 'sine', .22); },
    lose:  () => { tone(300, .2, 'sawtooth', 0, .07); tone(220, .35, 'sawtooth', .18, .07); },
  };

  /* ---------------- Screens ---------------- */
  function show(name) {
    ['setup', 'toss', 'game'].forEach(n => { $('#screen-' + n).hidden = n !== name; });
    $('#result').hidden = true;
    document.body.dataset.screen = name;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  /* ---------------- Setup ---------------- */
  function radio(group, attr, onPick) {
    $$(group + ' [' + attr + ']').forEach(btn => btn.addEventListener('click', () => {
      $$(group + ' [' + attr + ']').forEach(b => b.setAttribute('aria-checked', String(b === btn)));
      onPick(btn.getAttribute(attr));
    }));
  }
  const n2 = $('#name-p2');

  function paintPickers() {
    $$('.picker').forEach(pk => {
      const seat = pk.dataset.seat, oth = other(seat);
      $$('.pick[data-char]', pk).forEach(b => {
        const c = Number(b.dataset.char), taken = S.chars[oth] === c;
        b.setAttribute('aria-checked', String(S.chars[seat] === c));
        b.classList.toggle('taken', taken);
        const tag = $('.tag', b);
        tag.hidden = !taken;
        tag.textContent = taken ? (oth === 'p2' && S.mode === 'cpu' ? 'CPU' : oth === 'p1' ? 'P1' : 'P2') : '';
        b.title = taken ? 'Picking this swaps heads with the other player' : '';
      });
    });
  }
  $$('.picker').forEach(pk => pk.addEventListener('click', e => {
    const b = e.target.closest('.pick[data-char]'); if (!b) return;
    const seat = pk.dataset.seat, c = Number(b.dataset.char);
    if (S.chars[other(seat)] === c) S.chars[other(seat)] = S.chars[seat];   // swap, so both always differ
    S.chars[seat] = c;
    sfx.pick(); paintPickers();
  }));

  radio('.seg:has([data-mode])', 'data-mode', m => {
    S.mode = m;
    $('#diff-field').hidden = m !== 'cpu';
    $('#p2-label').textContent = m === 'cpu' ? 'Computer name' : 'Player 2 name';
    $('#p2-pick-label').textContent = m === 'cpu' ? "Pick the computer's head" : 'Player 2, pick your head';
    if (['Player 2', 'Computer'].includes(n2.value.trim()) || !n2.value.trim()) n2.value = m === 'cpu' ? 'Computer' : 'Player 2';
    paintPickers();
  });
  radio('.seg:has([data-diff])', 'data-diff', d => { S.diff = d; });
  paintPickers();

  function readNames() {
    const clean = (v, d) => v.replace(/\s+/g, ' ').trim().slice(0, 14) || d;
    S.names.p1 = clean($('#name-p1').value, 'Player 1');
    S.names.p2 = clean(n2.value, S.mode === 'cpu' ? 'Computer' : 'Player 2');
    if (S.names.p1.toLowerCase() === S.names.p2.toLowerCase()) S.names.p2 += ' 2';
  }

  $('#btn-start').addEventListener('click', () => { readNames(); openToss(); });

  const g = BOOT.global;
  if (g && (g.matches || g.tosses)) {
    $('#global-line').textContent = `Played on this server: ${g.matches} rounds, ${g.tosses} coin tosses.`;
  }

  /* ---------------- Coin toss ---------------- */
  function openToss() {
    show('toss');
    $('#toss-prompt').textContent = `${nameOf('p1')}, call it. The winner moves first.`;
    $('#toss-result').textContent = '';
    $('#btn-toss-play').hidden = true;
    $('#toss-calls').hidden = false;
    $$('#toss-calls .call').forEach(b => b.disabled = false);
    S.tossBusy = false;
  }

  async function doToss(call) {
    if (S.tossBusy) return;
    S.tossBusy = true;
    $$('#toss-calls .call').forEach(b => b.disabled = true);
    $('#toss-result').textContent = 'Flipping…';

    let result, won;
    try {
      const r = await api('api/toss.php', { call });
      result = r.result; won = r.won;
    } catch (e) { // offline / no PHP: fall back to the browser's secure RNG
      result = crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? 'heads' : 'tails';
      won = result === call;
    }

    const coin = $('#coin'), air = $('#coin-air');
    const ms = reduceMotion ? 300 : 2200;
    const target = result === 'heads' ? 0 : 180;
    const base = S.coinRot % 360;
    S.coinRot += 360 * 5 + ((target - base + 360) % 360);
    air.style.setProperty('--toss-ms', ms + 'ms');
    coin.style.transition = `transform ${ms}ms cubic-bezier(.25,.6,.3,1)`;
    air.classList.remove('flip'); void air.offsetWidth; air.classList.add('flip');
    coin.style.transform = `rotateY(${S.coinRot}deg)`;
    if (!reduceMotion) for (let i = 0; i < 14; i++) setTimeout(sfx.tick, i * 120 * (1 + i / 20));

    setTimeout(() => {
      S.starter = won ? 'p1' : 'p2';
      const who = nameOf(S.starter);
      $('#toss-result').textContent = `It's ${result}! ${who} ${won ? 'called it and ' : ''}goes first.`;
      won ? sfx.win() : sfx.draw();
      $('#toss-calls').hidden = true;
      $('#btn-toss-play').hidden = false;
      $('#btn-toss-play').focus();
      S.tossBusy = false;
    }, ms + 150);
  }
  $$('#toss-calls .call').forEach(b => b.addEventListener('click', () => doToss(b.dataset.call)));
  $('#btn-toss-back').addEventListener('click', () => show('setup'));
  $('#btn-toss-play').addEventListener('click', startRound);

  /* ---------------- Board ---------------- */
  const boardEl = $('#board');
  function buildBoard() {
    boardEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cell'; b.dataset.i = i; b.setAttribute('role', 'gridcell');
      boardEl.appendChild(b);
    }
  }
  const cellLabel = i => {
    const v = S.board[i];
    const where = `Row ${Math.floor(i / 3) + 1}, column ${i % 3 + 1}`;
    if (!v) return `${where}, empty`;
    return `${where}, ${nameOf(v)}'s head${S.sel === i ? ', selected' : ''}`;
  };

  boardEl.addEventListener('click', e => {
    const c = e.target.closest('.cell'); if (c) humanMove(Number(c.dataset.i));
  });
  boardEl.addEventListener('keydown', e => {
    const c = e.target.closest('.cell'); if (!c) return;
    const i = Number(c.dataset.i);
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
    if (d === undefined) return;
    const col = i % 3, n = i + d;
    if ((e.key === 'ArrowLeft' && col === 0) || (e.key === 'ArrowRight' && col === 2) || n < 0 || n > 8) return;
    e.preventDefault(); boardEl.children[n].focus();
  });

  function setGhost() { boardEl.style.setProperty('--ghost', `url("${headSrc(S.turn)}")`); }

  /** Make the DOM match the state. `anim` says which head just arrived and from where. */
  function renderBoard(anim) {
    const movePhase = !S.over && inMovePhase(S.turn);
    boardEl.classList.toggle('placing', !S.over && !movePhase);
    boardEl.classList.toggle('moving', movePhase);
    const targets = S.sel !== null ? ADJ[S.sel].filter(j => !S.board[j]) : [];
    const movable = movePhase && !isCpu(S.turn)
      ? S.board.map((v, i) => (v === S.turn && ADJ[i].some(j => !S.board[j]) ? i : -1)).filter(i => i >= 0) : [];

    for (let i = 0; i < 9; i++) {
      const cell = boardEl.children[i], v = S.board[i], had = cell.dataset.seat || '';
      if (had !== (v || '')) {
        cell.innerHTML = '';
        if (v) {
          const img = document.createElement('img');
          img.src = headSrc(v); img.alt = ''; img.draggable = false;
          if (anim && anim.to === i && anim.from !== undefined) img.className = 'flown';
          cell.appendChild(img);
          if (anim && anim.to === i && anim.from !== undefined && !reduceMotion) {
            const a = boardEl.children[anim.from].getBoundingClientRect(), z = cell.getBoundingClientRect();
            cell.style.zIndex = 6;
            img.animate([
              { transform: `translate(${a.left - z.left}px, ${a.top - z.top}px) scale(1.12)` },
              { transform: 'translate(0,0) scale(1)' },
            ], { duration: 340, easing: 'cubic-bezier(.3,1.2,.5,1)' }).onfinish = () => { cell.style.zIndex = ''; };
          }
        }
        cell.dataset.seat = v || '';
      }
      cell.classList.toggle('filled', !!v);
      cell.classList.toggle('sel', S.sel === i);
      cell.classList.toggle('target', targets.includes(i));
      cell.classList.toggle('can', movable.includes(i) && S.sel !== i);
      cell.setAttribute('aria-label', cellLabel(i) + (targets.includes(i) ? ', you can slide here' : ''));
    }
  }

  function renderTrays() {
    ['p1', 'p2'].forEach(seat => {
      const tray = $('#tray-' + seat), left = MAX_HEADS - S.placed[seat];
      tray.innerHTML = '';
      for (let k = 0; k < MAX_HEADS; k++) {
        const s = document.createElement('span');
        s.className = k < left ? 'slot hand' : 'slot used';
        if (k < left) { const im = document.createElement('img'); im.src = headSrc(seat); im.alt = ''; s.appendChild(im); }
        tray.appendChild(s);
      }
    });
  }

  function startRound() {
    S.board = Array(9).fill(null); S.placed = { p1: 0, p2: 0 }; S.sel = null; S.turns = 0; S.seen = {}; S.winLine = null;
    S.over = false; S.thinking = false; S.turn = S.starter;
    buildBoard();
    boardEl.className = 'board placing';
    $('#winline-l').classList.remove('draw');
    stopConfetti();
    show('game');
    updateScoreboard(); renderBoard(); renderTrays(); updateTurn();
    if (isCpu(S.turn)) cpuTurn();
  }

  function updateScoreboard(bump) {
    $('#sc-p1 img').src = headSrc('p1'); $('#sc-p2 img').src = headSrc('p2');
    $('#sc-p1 .nm').textContent = nameOf('p1'); $('#sc-p2 .nm').textContent = nameOf('p2');
    const set = (el, v, key) => {
      if (el.textContent !== String(v)) {
        el.textContent = v;
        if (bump === key) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
      }
    };
    set($('#sc-p1 .pt'), S.scores.p1, 'p1'); set($('#sc-p2 .pt'), S.scores.p2, 'p2'); set($('#sc-draw'), S.scores.draw, 'draw');
  }

  let hintTimer = 0;
  function hintFor(seat) {
    if (isCpu(seat)) return inMovePhase(seat) ? 'Sliding a head…' : 'Placing a head…';
    if (!inMovePhase(seat)) return `Put a head on any empty square · ${MAX_HEADS - S.placed[seat]} left to place`;
    return S.sel === null ? 'Tap one of your heads, then a free square next to it'
                          : 'Now tap a glowing square to slide there';
  }
  function updateTurn() {
    $('#sc-p1').classList.toggle('active', !S.over && S.turn === 'p1');
    $('#sc-p2').classList.toggle('active', !S.over && S.turn === 'p2');
    if (S.over) return;
    clearTimeout(hintTimer);
    const t = S.turn, hint = $('#turn-hint');
    $('#turn-img').src = headSrc(t);
    $('#turn-text').textContent = isCpu(t) ? `${nameOf(t)} is thinking…` : `${nameOf(t)}'s turn`;
    hint.textContent = hintFor(t); hint.classList.remove('warn');
    const ph = $('#phase'); ph.textContent = inMovePhase(t) ? 'Slide' : 'Place'; ph.dataset.k = inMovePhase(t) ? 'slide' : 'place';
    boardEl.classList.toggle('locked', isCpu(t));
    renderBoard(); setGhost();
  }
  function flash(msg) {
    sfx.nope();
    const hint = $('#turn-hint'); hint.textContent = msg; hint.classList.add('warn');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { if (!S.over) { hint.textContent = hintFor(S.turn); hint.classList.remove('warn'); } }, 2000);
  }

  /* ---------------- Turn handling ---------------- */
  function humanMove(i) {
    if (S.over || S.thinking || isCpu(S.turn)) return;
    const t = S.turn;
    if (!inMovePhase(t)) {                                   // placing phase
      if (S.board[i]) return flash('That square is taken');
      return commit(t, { to: i });
    }
    if (S.board[i] === t) {                                  // pick up / put down one of my heads
      S.sel = S.sel === i ? null : i;
      renderBoard(); updateTurn();
      if (S.sel !== null) {
        sfx.pick();
        if (!ADJ[i].some(j => !S.board[j])) { S.sel = null; renderBoard(); flash('That head is blocked, try another one'); }
      }
      return;
    }
    if (S.board[i]) return flash("That square has the other player's head");
    if (S.sel === null) return flash('Tap one of your heads first');
    if (!ADJ[S.sel].includes(i)) return flash('Slide to a free square right next to it');
    commit(t, { from: S.sel, to: i });
  }

  /** Play a move for `seat`, then check for a win and hand over the turn. */
  function commit(seat, m) {
    const [nb, np] = applyMove(S.board, S.placed, seat, m);
    S.board = nb; S.placed = np; S.sel = null; S.turns++;
    renderBoard({ from: m.from, to: m.to }); renderTrays();
    m.from === undefined ? sfx.place(seat) : sfx.slide(seat);

    const w = winnerOf(S.board);
    if (w) return endRound('win', w.seat, w.line);

    // hand over the turn (a player with no legal slide is skipped)
    let next = other(seat), skipped = '';
    if (!legalMoves(S.board, S.placed, next).length) {
      if (!legalMoves(S.board, S.placed, seat).length) return endRound('draw', null, null, 'Nobody can move any more.');
      skipped = nameOf(next); next = seat;
    }
    S.turn = next;

    const key = S.board.map(v => v || '-').join('') + S.turn;
    S.seen[key] = (S.seen[key] || 0) + 1;
    if (S.seen[key] >= 3) return endRound('draw', null, null, 'The same position came up three times.');
    if (S.turns >= MAX_TURNS) return endRound('draw', null, null, 'Too many turns without a winner.');

    updateTurn();
    if (skipped) flash(`${skipped} has no free square to slide to, so the turn is skipped.`);
    if (isCpu(S.turn)) cpuTurn();
  }

  /* ---------------- Computer player ---------------- */
  function cpuTurn() {
    S.thinking = true; boardEl.classList.add('locked');
    setTimeout(() => {
      S.thinking = false;
      if (S.over) return;
      commit('p2', cpuPick());
    }, reduceMotion ? 200 : 650 + Math.random() * 450);
  }
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const wins = (seat, m) => { const [nb] = applyMove(S.board, S.placed, seat, m); return !!winnerOf(nb); };

  function cpuPick() {
    const me = 'p2', foe = 'p1';
    const moves = legalMoves(S.board, S.placed, me);
    const winning = moves.filter(m => wins(me, m));

    if (S.diff === 'easy') return winning.length && Math.random() < .4 ? pick(winning) : pick(moves);

    if (S.diff === 'medium') {
      if (winning.length) return pick(winning);
      // keep moves after which the human cannot win straight away
      const safe = moves.filter(m => {
        const [nb, np] = applyMove(S.board, S.placed, me, m);
        return !legalMoves(nb, np, foe).some(fm => { const [b2] = applyMove(nb, np, foe, fm); return !!winnerOf(b2); });
      });
      const pool = safe.length ? safe : moves;
      const centre = pool.filter(m => m.to === 4);
      return centre.length && Math.random() < .55 ? pick(centre) : pick(pool);
    }

    // Unbeatable: alpha-beta search several moves ahead; random among equally good moves
    if (winning.length) return pick(winning);
    let best = -Infinity, bestMoves = [];
    for (const m of moves) {
      const [nb, np] = applyMove(S.board, S.placed, me, m);
      const s = -search(nb, np, foe, 5, -Infinity, Infinity);
      if (s > best) { best = s; bestMoves = [m]; } else if (s === best) bestMoves.push(m);
    }
    return pick(bestMoves);
  }

  /** Score for `seat`, who is about to move. */
  function search(b, placed, seat, depth, alpha, beta) {
    const mv = legalMoves(b, placed, seat);
    if (!mv.length) return -5;
    if (depth === 0) return evaluate(b, seat);
    let best = -Infinity;
    for (const m of mv) {
      const [nb, np] = applyMove(b, placed, seat, m);
      const s = winnerOf(nb) ? 1000 + depth : -search(nb, np, other(seat), depth - 1, -beta, -alpha);
      if (s > best) best = s;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  function evaluate(b, seat) {
    const foe = other(seat); let sc = b[4] === seat ? 3 : b[4] === foe ? -3 : 0;
    for (const [x, y, z] of LINES) {
      const l = [b[x], b[y], b[z]], mine = l.filter(v => v === seat).length, theirs = l.filter(v => v === foe).length;
      if (!theirs) sc += mine === 2 ? 10 : mine === 1 ? 1 : 0;
      if (!mine) sc -= theirs === 2 ? 10 : theirs === 1 ? 1 : 0;
    }
    return sc;
  }

  /* ---------------- Round end & win animations ---------------- */
  function endRound(kind, seat, line, reason) {
    S.over = true; S.thinking = false; S.sel = null;
    boardEl.classList.add('locked');
    renderBoard(); updateTurn();
    const result = kind === 'win' ? seat : 'draw';
    S.scores[result]++;                       // optimistic; server value replaces it below
    updateScoreboard(result);
    api('api/score.php', { result }).then(r => {
      if (r.ok) { S.scores = r.scores; updateScoreboard(); }
    }).catch(() => {});

    $('#phase').textContent = ''; $('#turn-hint').textContent = ''; $('#turn-hint').classList.remove('warn');
    if (kind === 'win') {
      S.winLine = line;
      line.forEach(i => boardEl.children[i].classList.add('win'));
      boardEl.classList.add('dim');
      drawWinLine(line);
      setTimeout(() => { sfx.win(); startConfetti(headSrc(seat)); }, 450);
      if (isCpu(seat)) setTimeout(sfx.lose, 1200);
      $('#turn-img').src = headSrc(seat);
      $('#turn-text').textContent = `${nameOf(seat)} wins!`;
      setTimeout(() => openResult('win', seat), reduceMotion ? 400 : 2300);
    } else {
      boardEl.classList.add('shake'); sfx.draw();
      $('#turn-text').textContent = 'It\'s a draw';
      $('#turn-hint').textContent = reason || '';
      setTimeout(() => openResult('draw', null, reason), reduceMotion ? 400 : 1100);
    }
  }

  function drawWinLine(line, noAnim) {
    const svg = $('#winline'), l = $('#winline-l');
    const sr = svg.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${sr.width} ${sr.height}`);
    const c = i => {
      const r = boardEl.children[i].getBoundingClientRect();
      return { x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height / 2, s: r.width };
    };
    const a = c(line[0]), z = c(line[2]);
    const dx = z.x - a.x, dy = z.y - a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, ext = a.s * .3;
    const x1 = a.x - ux * ext, y1 = a.y - uy * ext, x2 = z.x + ux * ext, y2 = z.y + uy * ext;
    l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.style.setProperty('--len', Math.hypot(x2 - x1, y2 - y1));
    if (noAnim) return;
    l.classList.remove('draw'); void l.getBoundingClientRect(); l.classList.add('draw');
  }
  addEventListener('resize', () => { if (S.over && S.winLine) drawWinLine(S.winLine, true); });

  function openResult(kind, seat, reason) {
    const medal = $('.medal'); medal.innerHTML = ''; medal.classList.toggle('draw', kind === 'draw');
    if (kind === 'win') {
      const img = document.createElement('img'); img.src = headSrc(seat); img.alt = '';
      medal.appendChild(img);
      $('#res-title').textContent = `${nameOf(seat)} wins!`;
      $('#res-sub').textContent = isCpu(seat)
        ? `${nameOf(seat)} took this one. Ready for a rematch?`
        : (S.mode === 'cpu' ? 'Three heads in a row. Nicely played.' : `Three heads in a row for ${nameOf(seat)}.`);
    } else {
      const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;width:90%;justify-content:center';
      [headSrc('p1'), headSrc('p2')].forEach(src => {
        const i = document.createElement('img'); i.src = src; i.alt = ''; i.style.cssText = 'width:48%;height:auto;animation:none';
        wrap.appendChild(i);
      });
      medal.appendChild(wrap);
      $('#res-title').textContent = 'It\'s a draw';
      $('#res-sub').textContent = reason || 'Nobody got three in a row.';
    }
    $('#result').hidden = false;
    $('#res-next').focus();
  }

  /* ---------------- Result buttons & tools ---------------- */
  $('#res-next').addEventListener('click', () => { S.starter = other(S.starter); startRound(); });
  $('#res-toss').addEventListener('click', openToss);
  $('#res-menu').addEventListener('click', () => show('setup'));
  $('#btn-restart').addEventListener('click', startRound);
  $('#btn-menu').addEventListener('click', () => show('setup'));
  $('#btn-reset-scores').addEventListener('click', async () => {
    S.scores = { p1: 0, draw: 0, p2: 0 }; updateScoreboard();
    try { const r = await api('api/score.php', { action: 'reset' }); if (r.ok) S.scores = r.scores; } catch (e) {}
  });

  const sndBtn = $('#btn-sound');
  function paintSound() {
    sndBtn.setAttribute('aria-pressed', String(S.sound));
    sndBtn.setAttribute('aria-label', S.sound ? 'Sound effects on' : 'Sound effects off');
    $('#snd-waves').style.display = S.sound ? '' : 'none';
  }
  sndBtn.addEventListener('click', () => {
    S.sound = !S.sound; paintSound();
    try { localStorage.setItem('vtt-sound', S.sound ? 'on' : 'off'); } catch (e) {}
  });
  paintSound();

  /* ---------------- Music player: plays the playlist, next track starts when one ends ---------------- */
  (function music() {
    const T = BOOT.tracks || [], dock = $('#dock');
    if (!T.length || !dock) return;
    const store = {
      get: (k, d) => { try { const v = localStorage.getItem('vtt-' + k); return v === null ? d : v; } catch (e) { return d; } },
      set: (k, v) => { try { localStorage.setItem('vtt-' + k, v); } catch (e) {} },
    };
    const au = new Audio();
    au.preload = 'metadata';
    let idx = Math.min(Number(store.get('track', 0)) || 0, T.length - 1);
    let wantOn = store.get('music', 'on') !== 'off';      // the person's preference (autoplay waits for a first tap)
    let shuffle = store.get('shuffle', 'off') === 'on';
    let errors = 0;
    au.volume = Math.min(1, Math.max(0, Number(store.get('vol', MUSIC_DEFAULT_VOLUME)) || 0));

    const els = { title: $('#mu-title'), count: $('#mu-count'), play: $('#mu-play'), prog: $('#mu-prog'),
                  vol: $('#mu-vol'), shuffle: $('#mu-shuffle'), fold: $('#mu-fold') };
    els.vol.value = Math.round(au.volume * 100);

    function paint() {
      const playing = !au.paused;
      dock.classList.toggle('playing', playing);
      els.play.setAttribute('aria-label', playing ? 'Pause music' : 'Play music');
      els.title.textContent = T[idx].title;
      els.count.textContent = `Track ${idx + 1} of ${T.length}`;
      els.shuffle.setAttribute('aria-pressed', String(shuffle));
      els.shuffle.setAttribute('aria-label', shuffle ? 'Shuffle on' : 'Shuffle off');
    }
    function setMeta() {
      if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: T[idx].title, artist: 'Vithuvattikal Tic Tac Toe',
        artwork: [{ src: new URL('assets/img/icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' }],
      });
    }
    function load(i, autoplay) {
      idx = (i + T.length) % T.length;
      store.set('track', idx);
      au.src = T[idx].src;
      els.prog.style.width = '0%';
      paint(); setMeta();
      if (autoplay) start();
    }
    function start() {
      wantOn = true; store.set('music', 'on');
      const p = au.play();
      if (p && p.catch) p.catch(() => { paint(); });     // blocked by the browser: stays paused until the next tap
    }
    function stop() { wantOn = false; store.set('music', 'off'); au.pause(); }
    function next(auto) {
      let i = idx + 1;
      if (shuffle && T.length > 1) { do { i = Math.floor(Math.random() * T.length); } while (i === idx); }
      load(i, auto || !au.paused || wantOn);
    }
    function prev() {
      if (au.currentTime > 3) { au.currentTime = 0; return; }
      load(idx - 1, !au.paused || wantOn);
    }

    au.addEventListener('ended', () => next(true));            // <- the "play the next one" part
    au.addEventListener('play', paint);
    au.addEventListener('pause', paint);
    au.addEventListener('playing', () => { errors = 0; paint(); });
    au.addEventListener('timeupdate', () => {
      if (au.duration) els.prog.style.width = (au.currentTime / au.duration * 100).toFixed(1) + '%';
    });
    au.addEventListener('error', () => {                         // broken file: skip it, but never loop forever
      if (++errors < T.length) next(true); else { els.title.textContent = 'Music unavailable'; els.count.textContent = ''; }
    });

    els.play.addEventListener('click', () => (au.paused ? start() : stop()));
    $('#mu-next').addEventListener('click', () => next(false));
    $('#mu-prev').addEventListener('click', prev);
    els.shuffle.addEventListener('click', () => { shuffle = !shuffle; store.set('shuffle', shuffle ? 'on' : 'off'); paint(); });
    els.vol.addEventListener('input', () => { au.volume = els.vol.value / 100; store.set('vol', au.volume); });
    els.fold.addEventListener('click', () => {
      const min = !dock.classList.contains('min');
      dock.classList.toggle('min', min);
      els.fold.setAttribute('aria-expanded', String(!min));
      els.fold.setAttribute('aria-label', min ? 'Show music player' : 'Minimise music player');
      store.set('dock', min ? 'min' : 'open');
    });
    if (store.get('dock', 'open') === 'min') { dock.classList.add('min'); els.fold.setAttribute('aria-expanded', 'false'); }

    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      try {
        ms.setActionHandler('play', start); ms.setActionHandler('pause', stop);
        ms.setActionHandler('nexttrack', () => next(false)); ms.setActionHandler('previoustrack', prev);
      } catch (e) {}
    }

    load(idx, false);
    // Browsers only allow sound after a tap, so the first tap anywhere (except on the player itself) starts the music.
    if (wantOn) {
      const first = e => {
        if (e.target.closest && e.target.closest('#dock')) return;
        removeEventListener('pointerdown', first, true); removeEventListener('keydown', first, true);
        if (au.paused && wantOn) start();
      };
      addEventListener('pointerdown', first, true); addEventListener('keydown', first, true);
    }
  })();

  /* ---------------- Confetti: the winner's head rains down ---------------- */
  const cv = $('#confetti'), cx = cv.getContext('2d');
  let parts = [], raf = 0, endAt = 0;
  const COLORS = ['#ffd978', '#e2546f', '#b9c9db', '#fff', '#c4546d', '#8e6f5b'];
  function fit() {
    const d = Math.min(devicePixelRatio || 1, 2);
    cv.width = innerWidth * d; cv.height = innerHeight * d; cx.setTransform(d, 0, 0, d, 0, 0);
  }
  addEventListener('resize', fit); fit();

  function startConfetti(src) {
    if (reduceMotion) return;
    stopConfetti();
    const img = new Image(); img.src = src;
    const make = (x, y, vx, vy) => {
      const head = Math.random() < .4;
      return { x, y, vx, vy, head, img, w: head ? 26 + Math.random() * 22 : 7 + Math.random() * 7, h: head ? 0 : 10 + Math.random() * 8,
        rot: Math.random() * 6.28, vr: (Math.random() - .5) * .3, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
    };
    for (let i = 0; i < 130; i++) {            // two side cannons
      const left = i % 2 === 0, sp = 9 + Math.random() * 10;
      parts.push(make(left ? 0 : innerWidth, innerHeight * .75, (left ? 1 : -1) * (2 + Math.random() * 6), -sp * (.9 + Math.random() * .6)));
    }
    for (let i = 0; i < 50; i++) parts.push(make(Math.random() * innerWidth, -30 - Math.random() * 300, (Math.random() - .5) * 2, 2 + Math.random() * 3));
    endAt = performance.now() + 5200;
    const step = now => {
      cx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(p => {
        p.vy += .22; p.vx *= .992; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot);
        if (p.head) cx.drawImage(p.img, -p.w / 2, -p.w / 2, p.w, p.w);
        else { cx.fillStyle = p.color; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
        cx.restore();
      });
      parts = parts.filter(p => p.y < innerHeight + 60);
      if (parts.length && now < endAt + 2500) raf = requestAnimationFrame(step); else stopConfetti();
    };
    raf = requestAnimationFrame(step);
  }
  function stopConfetti() { cancelAnimationFrame(raf); parts = []; cx.clearRect(0, 0, innerWidth, innerHeight); }

  document.body.dataset.screen = 'setup';

})();
