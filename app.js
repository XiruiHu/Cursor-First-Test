/* eslint-disable no-console */
(() => {
  const COLS = 10;
  const ROWS = 20;
  const QUEUE_SIZE = 6; // internal queue length

  const TYPES = ["I", "O", "T", "S", "Z", "J", "L"];

  // Color palette (neon sci-fi)
  const COLORS = {
    I: "rgba(45,252,255,1)", // cyan
    O: "rgba(255,220,64,1)", // neon gold
    T: "rgba(255,61,247,1)", // magenta
    S: "rgba(124,255,107,1)", // green
    Z: "rgba(255,79,79,1)", // red
    J: "rgba(105,151,255,1)", // blue
    L: "rgba(255,143,61,1)" // orange
  };

  // Base shapes for rotation=0 on a 4x4 grid.
  // Rotation is derived algorithmically to avoid manual mistakes.
  // Coordinates are [x, y] in {0..3}x{0..3}.
  const SHAPE_R0 = {
    I: [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1]
    ],
    O: [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2]
    ],
    T: [
      [1, 1],
      [0, 2],
      [1, 2],
      [2, 2]
    ],
    S: [
      [1, 1],
      [2, 1],
      [0, 2],
      [1, 2]
    ],
    Z: [
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 2]
    ],
    J: [
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 2]
    ],
    L: [
      [2, 1],
      [0, 2],
      [1, 2],
      [2, 2]
    ]
  };

  const canvas = document.getElementById("tetris");
  const nextCanvas = document.getElementById("next-canvas");
  const overlay = document.getElementById("overlay");

  const scoreEl = document.getElementById("score");
  const levelEl = document.getElementById("level");
  const linesEl = document.getElementById("lines");

  const startBtn = document.getElementById("startBtn");
  const pauseBtn = document.getElementById("pauseBtn");

  const optGhost = document.getElementById("optGhost");
  const optGrid = document.getElementById("optGrid");
  const optHardDrop = document.getElementById("optHardDrop");

  const srStatus = document.getElementById("sr-status");

  const ctx = canvas.getContext("2d");
  const nextCtx = nextCanvas.getContext("2d");

  // Board state: ROWS x COLS filled with null or color string
  let board = [];

  // Active piece
  let piece = null;
  let nextQueue = [];
  let currentBag = [];

  let state = "idle"; // idle | playing | paused | gameover

  let score = 0;
  let lines = 0;
  let level = 1;

  // Timing
  let dropCounter = 0;
  let lastTime = 0;
  let softDrop = false;

  // Resize-dependent sizes (in CSS pixels)
  let cell = 24;
  let boardPxW = 0;
  let boardPxH = 0;

  // Precomputed starfield in normalized coords
  let stars = [];

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function fillBag() {
    currentBag = shuffle(TYPES);
  }

  function ensureQueue() {
    while (nextQueue.length < QUEUE_SIZE) {
      if (currentBag.length === 0) fillBag();
      nextQueue.push(currentBag.pop());
    }
  }

  function resetBoard() {
    board = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));
  }

  function spawnPiece() {
    ensureQueue();
    const type = nextQueue.shift();
    nextQueue.push(currentBag.length ? currentBag.pop() : (fillBag(), currentBag.pop()));

    piece = {
      type,
      rotation: 0,
      x: 3,
      y: -2
    };

    if (collides(piece.x, piece.y, piece.rotation)) {
      state = "gameover";
      runningDisableControls();
      srStatus.textContent = "Game over. Press Start to play again.";
    }
  }

  function rotationPoints(type, rotation) {
    const base = SHAPE_R0[type];
    const times = ((rotation % 4) + 4) % 4;
    let pts = base.map(([x, y]) => [x, y]);

    // Clockwise rotation mapping for 4x4 grid:
    // (x, y) -> (3 - y, x)
    for (let t = 0; t < times; t++) {
      pts = pts.map(([x, y]) => [3 - y, x]);
    }
    return pts;
  }

  function getCells(type, rotation) {
    return rotationPoints(type, rotation);
  }

  function collides(x, y, rotation) {
    const cells = getCells(piece.type, rotation);
    for (const [cx, cy] of cells) {
      const bx = x + cx;
      const by = y + cy;
      if (bx < 0 || bx >= COLS) return true;
      if (by >= ROWS) return true;
      if (by >= 0 && board[by][bx]) return true;
    }
    return false;
  }

  function tryMove(dx, dy) {
    if (!piece) return false;
    const nx = piece.x + dx;
    const ny = piece.y + dy;
    if (!collides(nx, ny, piece.rotation)) {
      piece.x = nx;
      piece.y = ny;
      return true;
    }
    return false;
  }

  function tryRotate(dir) {
    if (!piece) return false;
    const newRot = (piece.rotation + dir + 4) % 4;
    // Simple wall kicks to keep gameplay snappy.
    const kicks = [
      [0, 0],
      [-1, 0],
      [1, 0],
      [-2, 0],
      [2, 0],
      [0, -1],
      [-1, -1],
      [1, -1]
    ];
    for (const [kx, ky] of kicks) {
      const nx = piece.x + kx;
      const ny = piece.y + ky;
      if (!collides(nx, ny, newRot)) {
        piece.x = nx;
        piece.y = ny;
        piece.rotation = newRot;
        return true;
      }
    }
    return false;
  }

  function lockPiece() {
    if (!piece) return;
    const cells = getCells(piece.type, piece.rotation);
    for (const [cx, cy] of cells) {
      const bx = piece.x + cx;
      const by = piece.y + cy;
      if (by < 0) {
        state = "gameover";
        runningDisableControls();
        srStatus.textContent = "Game over.";
        return;
      }
      board[by][bx] = COLORS[piece.type];
    }
    clearLinesAndScore();
    spawnPiece();
  }

  function clearLinesAndScore() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (board[y].every((cell) => cell !== null)) {
        board.splice(y, 1);
        board.unshift(Array.from({ length: COLS }, () => null));
        cleared++;
        y++;
      }
    }

    if (cleared > 0) {
      lines += cleared;
      level = Math.floor(lines / 10) + 1;

      const lineScore = [0, 100, 300, 500, 800];
      score += lineScore[cleared] * level;
      updateStats();
    }
  }

  function getDropInterval() {
    // Faster with level; clamp to keep it playable.
    const base = 800;
    const interval = base - (level - 1) * 60;
    return Math.max(100, interval);
  }

  function hardDrop() {
    if (!piece) return;
    while (tryMove(0, 1)) {
      // keep moving down until lock
    }
    lockPiece();
  }

  function softDropTick() {
    if (!piece) return;
    // If ArrowDown is held, increase drop rate.
    const original = getDropInterval();
    const boosted = Math.max(35, original * 0.15);
    dropCounter += lastTime ? boosted : 0;
  }

  function drawRoundedRect(ctx2, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx2.beginPath();
    ctx2.moveTo(x + rr, y);
    ctx2.arcTo(x + w, y, x + w, y + h, rr);
    ctx2.arcTo(x + w, y + h, x, y + h, rr);
    ctx2.arcTo(x, y + h, x, y, rr);
    ctx2.arcTo(x, y, x + w, y, rr);
    ctx2.closePath();
  }

  function drawBackground() {
    ctx.clearRect(0, 0, boardPxW, boardPxH);

    // Sci-fi nebula fill
    const bgGrad = ctx.createLinearGradient(0, 0, boardPxW, boardPxH);
    bgGrad.addColorStop(0, "rgba(45,252,255,0.045)");
    bgGrad.addColorStop(0.5, "rgba(255,61,247,0.025)");
    bgGrad.addColorStop(1, "rgba(124,255,107,0.02)");
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, 0, boardPxW, boardPxH);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, boardPxW, boardPxH);

    // Stars
    for (const s of stars) {
      ctx.fillStyle = `rgba(215,226,255,${s.a})`;
      ctx.beginPath();
      ctx.arc(s.x * boardPxW, s.y * boardPxH, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Scanlines
    ctx.save();
    ctx.globalAlpha = 0.10;
    for (let y = 0; y < boardPxH; y += 4) {
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(0, y, boardPxW, 1);
    }
    ctx.restore();
  }

  function drawGrid() {
    if (!optGrid.checked) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(45,252,255,0.08)";
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cell + 0.5, 0);
      ctx.lineTo(x * cell + 0.5, boardPxH);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cell + 0.5);
      ctx.lineTo(boardPxW, y * cell + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBlockAtGrid(bx, by, color, alpha = 1, outlineOnly = false) {
    const px = bx * cell;
    const py = by * cell;

    const baseAlpha = alpha;
    ctx.save();
    ctx.globalAlpha = baseAlpha;

    // Neon glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    if (!outlineOnly) {
      const grad = ctx.createLinearGradient(px, py, px + cell, py + cell);
      grad.addColorStop(0, color.replace("1)", "0.95)"));
      grad.addColorStop(1, "rgba(255,255,255,0.10)");
      ctx.fillStyle = grad;
      ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
    } else {
      ctx.fillStyle = "rgba(0,0,0,0)";
    }

    ctx.strokeRect(px + 1, py + 1, cell - 2, cell - 2);

    // Inner highlight
    ctx.shadowBlur = 0;
    ctx.globalAlpha = baseAlpha;
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(px + 3, py + 3, cell - 6, 2);

    ctx.restore();
  }

  function drawLockedBoard() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = board[y][x];
        if (!c) continue;
        drawBlockAtGrid(x, y, c, 1, false);
      }
    }
  }

  function drawPiece(pieceToDraw, opts = {}) {
    const { alpha = 1, outlineOnly = false, typeOverride = null, rotationOverride = null } = opts;
    const type = typeOverride ?? pieceToDraw.type;
    const rotation = rotationOverride ?? pieceToDraw.rotation;
    const cells = getCells(type, rotation);

    for (const [cx, cy] of cells) {
      const bx = pieceToDraw.x + cx;
      const by = pieceToDraw.y + cy;
      if (by < 0) continue; // don't draw above viewport
      if (bx < 0 || bx >= COLS || by >= ROWS) continue;
      drawBlockAtGrid(bx, by, COLORS[type], alpha, outlineOnly);
    }
  }

  function getGhostPiece() {
    if (!piece) return null;
    const ghost = { ...piece };
    while (!collides(ghost.x, ghost.y + 1, ghost.rotation)) {
      ghost.y += 1;
    }
    return ghost;
  }

  function drawOverlayText() {
    overlay.classList.toggle("overlay--show", state !== "playing");
    if (state === "paused") {
      overlay.innerHTML = `<div class="overlay__text">PAUSED</div><div class="overlay__sub">Press P to resume</div>`;
    } else if (state === "idle") {
      overlay.innerHTML = `<div class="overlay__text">PRESS START</div><div class="overlay__sub">Arrow keys + Space</div>`;
    } else if (state === "gameover") {
      overlay.innerHTML = `<div class="overlay__text">GAME OVER</div><div class="overlay__sub">Press Start to retry</div>`;
    }
  }

  function draw() {
    drawBackground();
    drawGrid();
    drawLockedBoard();

    if (piece) {
      // Ghost piece
      if (optGhost.checked && state !== "gameover") {
        const ghost = getGhostPiece();
        if (ghost && ghost !== piece) {
          drawPiece(ghost, { alpha: 0.25, outlineOnly: true });
        }
      }

      // Current piece
      drawPiece(piece, { alpha: 1, outlineOnly: false });
    }

    updateNextCanvas();
    drawOverlayText();
  }

  function updateNextCanvas() {
    const w = nextCanvas.clientWidth;
    const h = nextCanvas.clientHeight;
    if (w === 0 || h === 0) return;

    // Clear
    nextCtx.clearRect(0, 0, w, h);

    // Panel glow
    const bg = nextCtx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "rgba(255,61,247,0.05)");
    bg.addColorStop(0.5, "rgba(45,252,255,0.03)");
    bg.addColorStop(1, "rgba(124,255,107,0.03)");
    nextCtx.fillStyle = "rgba(0,0,0,0.10)";
    nextCtx.fillRect(0, 0, w, h);
    nextCtx.fillStyle = bg;
    nextCtx.fillRect(0, 0, w, h);

    // Mini draw settings
    const half = Math.floor(h / 2);

    const next1 = nextQueue[0];
    const next2 = nextQueue[1] ?? nextQueue[0];

    // Draw two pieces in a split preview.
    renderMiniPiece(next1, 0, half, true);
    renderMiniPiece(next2, half, h, false);
  }

  function renderMiniPiece(type, y0, y1, emphasize) {
    if (!type || !COLORS[type]) return;
    const w = nextCanvas.clientWidth;
    const h = nextCanvas.clientHeight;
    const miniCell = Math.floor(Math.min(w / 4, (y1 - y0) / 4));
    if (miniCell <= 0) return;
    const originX = Math.floor((w - miniCell * 4) / 2);
    const originY = y0 + Math.floor((y1 - y0 - miniCell * 4) / 2);

    nextCtx.save();
    nextCtx.shadowBlur = 18;
    nextCtx.lineWidth = 2;

    const cells = getCells(type, 0);
    for (const [cx, cy] of cells) {
      const px = originX + cx * miniCell;
      const py = originY + cy * miniCell;

      const color = COLORS[type];
      nextCtx.shadowColor = color;

      // Fill
      const grad = nextCtx.createLinearGradient(px, py, px + miniCell, py + miniCell);
      grad.addColorStop(0, color.replace("1)", "0.95)"));
      grad.addColorStop(1, "rgba(255,255,255,0.12)");
      nextCtx.fillStyle = grad;
      nextCtx.globalAlpha = emphasize ? 0.95 : 0.8;
      nextCtx.fillRect(px + 1, py + 1, miniCell - 2, miniCell - 2);

      // Stroke
      nextCtx.strokeStyle = color;
      nextCtx.globalAlpha = emphasize ? 0.85 : 0.7;
      nextCtx.strokeRect(px + 1, py + 1, miniCell - 2, miniCell - 2);

      // Highlight
      nextCtx.shadowBlur = 0;
      nextCtx.globalAlpha = emphasize ? 0.35 : 0.26;
      nextCtx.fillStyle = "rgba(255,255,255,0.18)";
      nextCtx.fillRect(px + 3, py + 3, miniCell - 6, 2);
    }

    nextCtx.restore();
  }

  function updateStats() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    linesEl.textContent = String(lines);
  }

  function runningDisableControls() {
    startBtn.disabled = false;
    pauseBtn.disabled = true;
  }

  function runningEnableControls() {
    startBtn.disabled = false;
    pauseBtn.disabled = false;
  }

  function setPauseUI() {
    pauseBtn.textContent = state === "paused" ? "Resume" : "Pause";
  }

  function startGame() {
    resetBoard();
    score = 0;
    lines = 0;
    level = 1;
    updateStats();

    currentBag = [];
    nextQueue = [];
    fillBag();
    ensureQueue();

    // Ensure bag/queue are consistent for spawn.
    piece = null;
    dropCounter = 0;
    softDrop = false;
    state = "playing";
    setPauseUI();
    srStatus.textContent = "Game started. Good luck.";

    runningEnableControls();
    spawnPiece();
  }

  function togglePause() {
    if (state === "idle") return;
    if (state === "gameover") return;
    if (state === "playing") {
      state = "paused";
    } else if (state === "paused") {
      state = "playing";
      // reset timers so we don't drop instantly
      dropCounter = 0;
      lastTime = 0;
    }
    setPauseUI();
    srStatus.textContent = state === "paused" ? "Paused." : "Resumed.";
  }

  // Resize: adapt board to viewport.
  function resize() {
    const dpr = window.devicePixelRatio || 1;

    // Sidebar is fixed width in CSS; board canvas should stretch to fill the game area.
    // We use the actual rendered game area's size to compute a "cell" size that fits 10x20.
    const gameArea = document.getElementById("game-area");
    const rect = gameArea.getBoundingClientRect();
    const maxW = rect.width;
    const maxH = rect.height;

    // Keep some padding in case the layout changes.
    const pad = 24;
    const usableW = Math.max(260, maxW - pad);
    const usableH = Math.max(420, maxH - pad);

    const newCell = Math.floor(Math.min(usableW / COLS, usableH / ROWS));
    cell = Math.max(12, Math.min(newCell, 42)); // keep it readable

    boardPxW = COLS * cell;
    boardPxH = ROWS * cell;

    canvas.style.width = `${boardPxW}px`;
    canvas.style.height = `${boardPxH}px`;

    canvas.width = Math.floor(boardPxW * dpr);
    canvas.height = Math.floor(boardPxH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Next canvas size (logical px)
    const nextRect = nextCanvas.getBoundingClientRect();
    const nW = Math.max(160, nextRect.width);
    const nH = Math.max(120, nextRect.height);
    nextCanvas.style.width = `${nW}px`;
    nextCanvas.style.height = `${nH}px`;
    nextCanvas.width = Math.floor(nW * dpr);
    nextCanvas.height = Math.floor(nH * dpr);
    nextCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Stars regenerate on resize
    const starCount = Math.floor((boardPxW * boardPxH) / 20000);
    stars = Array.from({ length: starCount }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.2,
      a: 0.25 + Math.random() * 0.75
    }));

    draw();
  }

  // Input
  function focusBoard() {
    canvas.focus?.();
  }

  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", () => focusBoard());

  window.addEventListener("keydown", (e) => {
    const key = e.key;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(key)) e.preventDefault();

    if (key === "Enter") {
      if (state === "idle" || state === "gameover") startGame();
      return;
    }

    if (key.toLowerCase() === "p") {
      togglePause();
      setPauseUI();
      return;
    }

    if (state !== "playing") return;

    if (key === "ArrowLeft") tryMove(-1, 0);
    if (key === "ArrowRight") tryMove(1, 0);
    if (key === "ArrowUp") tryRotate(1);
    if (key === "ArrowDown") softDrop = true;
    if (key === " ") {
      if (optHardDrop.checked) hardDrop();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowDown") softDrop = false;
  });

  startBtn.addEventListener("click", () => startGame());
  pauseBtn.addEventListener("click", () => togglePause());

  // Main loop
  function tick(time) {
    const t = time ?? 0;
    if (!lastTime) lastTime = t;
    const delta = t - lastTime;
    lastTime = t;

    if (state === "playing") {
      const interval = getDropInterval();
      const boostedInterval = softDrop ? Math.max(35, interval * 0.15) : interval;

      dropCounter += delta;
      while (dropCounter >= boostedInterval) {
        dropCounter -= boostedInterval;
        if (!tryMove(0, 1)) {
          lockPiece();
          break;
        }
      }
    }

    draw();
    requestAnimationFrame(tick);
  }

  function initUI() {
    runningDisableControls();
    pauseBtn.disabled = true;
    startBtn.disabled = false;
    state = "idle";
    setPauseUI();
    updateStats();
    drawOverlayText();
    overlay.classList.toggle("overlay--show", true);
  }

  function main() {
    initUI();
    resize();
    window.addEventListener("resize", resize);

    // Ensure a valid "piece" is available for collision routines.
    // We'll keep it null until start.
    piece = {
      type: "I",
      rotation: 0,
      x: 3,
      y: -2
    };

    resetBoard();
    srStatus.textContent = "Tetris ready. Press Start.";
    requestAnimationFrame(tick);
  }

  // Collision helper uses `piece.type`. When `piece` is null, it shouldn't happen.
  // To keep code simple we keep a dummy piece in idle state and replace on start.
  main();
})();

