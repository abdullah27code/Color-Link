const STORAGE_KEY = 'color-link-progress-v1';

const PALETTE = ['#ff6b6b', '#ffd166', '#4ecdc4', '#5f9dff', '#c084fc', '#63ff96', '#ff7f50', '#6ee7ff', '#f472b6'];
const TOTAL_LEVELS = 100;

function colorKeyFor(index) {
  return String.fromCharCode(65 + index);
}

function buildSnakeCells(size, vertical = false) {
  const cells = [];

  if (!vertical) {
    for (let y = 0; y < size; y += 1) {
      const row = [];
      for (let x = 0; x < size; x += 1) row.push([x, y]);
      if (y % 2 === 1) row.reverse();
      cells.push(...row);
    }
  } else {
    for (let x = 0; x < size; x += 1) {
      const col = [];
      for (let y = 0; y < size; y += 1) col.push([x, y]);
      if (x % 2 === 1) col.reverse();
      cells.push(...col);
    }
  }

  return cells;
}

function makeAdvancedLevel({ id, size, difficulty, segments, vertical = false }) {
  const pairs = {};
  const snakePath = buildSnakeCells(size, vertical);
  let cursor = 0;

  segments.forEach((len, index) => {
    const key = colorKeyFor(index);
    const segment = snakePath.slice(cursor, cursor + len);
    cursor += len;

    pairs[key] = {
      color: PALETTE[index % PALETTE.length],
      start: segment[0],
      end: segment[segment.length - 1],
      solutionPath: segment
    };
  });

  if (cursor < snakePath.length) {
    const lastKey = colorKeyFor(segments.length - 1);
    const extension = snakePath.slice(cursor);
    pairs[lastKey].solutionPath.push(...extension);
    pairs[lastKey].end = extension[extension.length - 1];
  }

  return { id, size, difficulty, pairs };
}

function splitSegments(totalCells, segmentCount, seed) {
  const base = Array.from({ length: segmentCount }, () => 3);
  let remaining = totalCells - segmentCount * 3;
  let cursor = seed;

  while (remaining > 0) {
    cursor = (cursor * 1664525 + 1013904223) % 2147483647;
    const idx = cursor % segmentCount;
    base[idx] += 1;
    remaining -= 1;
  }

  return base;
}

function difficultyFor(levelId) {
  if (levelId <= 15) return 'Isınma';
  if (levelId <= 30) return 'Kolay';
  if (levelId <= 45) return 'Orta';
  if (levelId <= 65) return 'Zor';
  if (levelId <= 85) return 'Uzman';
  return 'Efsane';
}

const LEVELS = Array.from({ length: TOTAL_LEVELS }, (_, i) => {
  const id = i + 1;
  const size = 5 + (i % 5); // 5..9
  const totalCells = size * size;
  const difficultyFactor = Math.floor(i / 20);
  const segmentCount = Math.max(4, Math.min(9, size + 1 - difficultyFactor));
  const segments = splitSegments(totalCells, segmentCount, id * 97);
  const vertical = i % 2 === 0;

  return makeAdvancedLevel({
    id,
    size,
    difficulty: difficultyFor(id),
    segments,
    vertical
  });
});

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const levelList = document.getElementById('level-list');
const levelTitle = document.getElementById('level-title');
const levelSubtitle = document.getElementById('level-subtitle');
const statusMessage = document.getElementById('status-message');
const completionInfo = document.getElementById('completion-info');
const resetLevelBtn = document.getElementById('reset-level');
const clearBoardBtn = document.getElementById('clear-board');
const hintBtn = document.getElementById('hint-btn');
const nextLevelBtn = document.getElementById('next-level');
const progressFill = document.getElementById('progress-fill');
const progressTrack = document.querySelector('.progress-track');
const toast = document.getElementById('toast');
const timerValue = document.getElementById('timer-value');
const scoreValue = document.getElementById('score-value');

const state = {
  unlockedLevel: 1,
  completedLevelIds: new Set(),
  currentLevelIndex: 0,
  paths: {},
  occupied: new Map(),
  activeColorKey: null,
  activePath: [],
  isSolved: false,
  toastTimer: null,
  pulse: 0,
  hintMarker: null,
  levelStartedAt: 0,
  levelElapsedMs: 0,
  totalScore: 0
};

const getCurrentLevel = () => LEVELS[state.currentLevelIndex];

const gridPadding = 18;
let cellSize = 0;
let boardOffset = 0;

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.unlockedLevel = Math.max(1, Math.min(LEVELS.length, parsed.unlockedLevel ?? 1));
    state.completedLevelIds = new Set(parsed.completedLevelIds ?? []);
    state.totalScore = Math.max(0, parsed.totalScore ?? 0);
  } catch {
    state.unlockedLevel = 1;
    state.completedLevelIds = new Set();
    state.totalScore = 0;
  }
}

function saveProgress() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      unlockedLevel: state.unlockedLevel,
      completedLevelIds: [...state.completedLevelIds],
      totalScore: state.totalScore
    })
  );
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function cellKey([x, y]) {
  return `${x},${y}`;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function equalCell(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function clearPath(colorKey) {
  const existing = state.paths[colorKey] || [];
  for (const point of existing) {
    const key = cellKey(point);
    if (state.occupied.get(key) === colorKey && !isAnchorOfColor(colorKey, point)) {
      state.occupied.delete(key);
    }
  }
  state.paths[colorKey] = [];
}

function buildDirectPath(start, end) {
  const path = [[...start]];
  let [x, y] = start;
  const [targetX, targetY] = end;

  while (x !== targetX || y !== targetY) {
    if (x !== targetX) x += Math.sign(targetX - x);
    else y += Math.sign(targetY - y);
    path.push([x, y]);
  }

  return path;
}

function normalizePathDirection(path, start, end) {
  if (!path.length) return [];
  if (equalCell(path[0], start)) return [...path];
  if (equalCell(path[0], end)) return [...path].reverse();
  return [];
}

function isPrefixPath(path, fullPath) {
  if (path.length > fullPath.length) return false;
  return path.every((cell, idx) => equalCell(cell, fullPath[idx]));
}

function pickHintTargetByFill(level) {
  let bestTarget = null;

  for (const [colorKey, pair] of Object.entries(level.pairs)) {
    if (isPairConnected(colorKey)) continue;

    const solutionPath = pair.solutionPath ? [...pair.solutionPath] : buildDirectPath(pair.start, pair.end);
    const currentPath = normalizePathDirection(state.paths[colorKey] || [], pair.start, pair.end);
    const validPrefixLen = isPrefixPath(currentPath, solutionPath) ? currentPath.length : 0;
    const remainingCells = solutionPath.length - validPrefixLen;

    if (!bestTarget || remainingCells > bestTarget.remainingCells) {
      bestTarget = {
        colorKey,
        pair,
        solutionPath,
        currentPath,
        remainingCells
      };
    }
  }

  return bestTarget;
}

function applyHint() {
  if (state.isSolved) {
    showToast('Bu bölüm zaten tamamlandı.');
    return;
  }

  const level = getCurrentLevel();
  const target = pickHintTargetByFill(level);
  if (!target) {
    showToast('İpucu gerekmiyor, sadece boş hücreleri doldur.');
    return;
  }

  const { colorKey: unresolvedColor, pair, solutionPath, currentPath } = target;
  const totalCells = level.size * level.size;
  const emptyCellsBeforeHint = totalCells - state.occupied.size;
  const strategicStep = Math.max(1, Math.min(3, Math.ceil((emptyCellsBeforeHint / totalCells) * 3)));

  let nextPath;
  let hintCell = null;
  if (!currentPath.length || !isPrefixPath(currentPath, solutionPath)) {
    nextPath = solutionPath.slice(0, Math.min(1 + strategicStep, solutionPath.length));
    hintCell = nextPath[nextPath.length - 1];
  } else if (currentPath.length < solutionPath.length) {
    nextPath = solutionPath.slice(0, Math.min(currentPath.length + strategicStep, solutionPath.length));
    hintCell = nextPath[nextPath.length - 1];
  } else {
    showToast('Bu renk zaten tamamlandı.');
    return;
  }

  clearPath(unresolvedColor);
  nextPath.forEach((cell) => {
    const owner = state.occupied.get(cellKey(cell));
    if (owner && owner !== unresolvedColor) {
      clearPath(owner);
    }
  });

  state.paths[unresolvedColor] = nextPath;
  nextPath.forEach((cell) => {
    if (!isAnchorOfColor(unresolvedColor, cell)) {
      state.occupied.set(cellKey(cell), unresolvedColor);
    }
  });

  state.activeColorKey = null;
  state.activePath = [];
  state.hintMarker = {
    cell: hintCell,
    color: pair.color,
    expiresAt: performance.now() + 1600
  };
  checkSolved();
  draw();

  const previousCell = nextPath[nextPath.length - 2];
  const dx = hintCell[0] - previousCell[0];
  const dy = hintCell[1] - previousCell[1];
  let direction = 'ilerle';
  if (dx === 1) direction = 'sağa ilerle';
  else if (dx === -1) direction = 'sola ilerle';
  else if (dy === 1) direction = 'aşağı ilerle';
  else if (dy === -1) direction = 'yukarı ilerle';

  statusMessage.textContent = `${unresolvedColor} rengi için ipucu: ${direction}.`;
  const emptyCells = totalCells - state.occupied.size;
  showToast(`İpucu: ${unresolvedColor} için ${direction} • Kalan boşluk: ${emptyCells}`);
}

function isAnchorOfColor(colorKey, cell) {
  const pair = getCurrentLevel().pairs[colorKey];
  return equalCell(pair.start, cell) || equalCell(pair.end, cell);
}

function initializeLevel(levelIndex) {
  state.currentLevelIndex = levelIndex;
  state.activeColorKey = null;
  state.activePath = [];
  state.isSolved = false;
  state.hintMarker = null;
  state.levelStartedAt = performance.now();
  state.levelElapsedMs = 0;
  state.paths = {};
  state.occupied = new Map();

  const level = getCurrentLevel();
  for (const [key, pair] of Object.entries(level.pairs)) {
    state.paths[key] = [];
    state.occupied.set(cellKey(pair.start), key);
    state.occupied.set(cellKey(pair.end), key);
  }

  levelTitle.textContent = `Bölüm ${level.id}`;
  levelSubtitle.textContent = `${level.size}x${level.size} • ${level.difficulty}`;
  statusMessage.textContent = 'Bir renk noktasından sürükleyerek diğerine bağlan.';
  nextLevelBtn.disabled = true;
  updateProgressUI();
  renderLevelButtons();
  computeBoardMetrics();
  draw();
  updateHudStats();
}

function renderLevelButtons() {
  levelList.innerHTML = '';
  LEVELS.forEach((level, idx) => {
    const btn = document.createElement('button');
    btn.className = 'level-btn';
    const isUnlocked = level.id <= state.unlockedLevel;
    const isCompleted = state.completedLevelIds.has(level.id);
    if (idx === state.currentLevelIndex) btn.classList.add('active');
    if (!isUnlocked) btn.classList.add('locked');
    btn.disabled = !isUnlocked;
    btn.textContent = isCompleted ? `${level.id} ✓` : `${level.id}`;
    btn.addEventListener('click', () => initializeLevel(idx));
    levelList.appendChild(btn);
  });

  completionInfo.textContent = `${state.completedLevelIds.size}/${LEVELS.length} bölüm tamamlandı`;
}

function computeBoardMetrics() {
  const size = Math.min(canvas.clientWidth, 680);
  canvas.width = size;
  canvas.height = size;

  const level = getCurrentLevel();
  boardOffset = gridPadding;
  cellSize = (size - gridPadding * 2) / level.size;
}

function toCell(pos) {
  const level = getCurrentLevel();
  const x = Math.floor((pos.x - boardOffset) / cellSize);
  const y = Math.floor((pos.y - boardOffset) / cellSize);
  if (x < 0 || y < 0 || x >= level.size || y >= level.size) return null;
  return [x, y];
}

function fromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function adjacent(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
}

function getAnchorColor(cell) {
  const level = getCurrentLevel();
  for (const [colorKey, pair] of Object.entries(level.pairs)) {
    if (equalCell(pair.start, cell) || equalCell(pair.end, cell)) return colorKey;
  }
  return null;
}

function getPathColorAtCell(cell) {
  for (const [colorKey, path] of Object.entries(state.paths)) {
    if (path.some((point) => equalCell(point, cell))) return colorKey;
  }
  return null;
}

function beginPath(cell) {
  let colorKey = getAnchorColor(cell);
  if (!colorKey) {
    colorKey = getPathColorAtCell(cell);
  }
  if (!colorKey) return;

  const existingPath = state.paths[colorKey] || [];
  const editPointIndex = existingPath.findIndex((point) => equalCell(point, cell));

  if (editPointIndex !== -1) {
    const keptPath = existingPath.slice(0, editPointIndex + 1);
    const removedPath = existingPath.slice(editPointIndex + 1);

    removedPath.forEach((point) => {
      if (!isAnchorOfColor(colorKey, point)) {
        state.occupied.delete(cellKey(point));
      }
    });

    state.paths[colorKey] = keptPath;
    state.activePath = [...keptPath];
  } else {
    clearPath(colorKey);
    state.activePath = [cell];
  }

  state.activeColorKey = colorKey;
  draw();
}

function extendPathStep(cell) {
  const colorKey = state.activeColorKey;
  if (!colorKey || !cell) return;

  const path = state.activePath;
  const last = path[path.length - 1];
  const level = getCurrentLevel();
  const pair = level.pairs[colorKey];

  if (equalCell(last, cell)) return true;
  if (!adjacent(last, cell)) return false;

  // Bir uç noktaya ulaştıktan sonra ileri doğru devam etmeyi engelle.
  if (path.length > 1 && isAnchorOfColor(colorKey, last) && !equalCell(path[path.length - 2], cell)) {
    return false;
  }

  if (path.length > 1 && equalCell(path[path.length - 2], cell)) {
    const removed = path.pop();
    if (!isAnchorOfColor(colorKey, removed)) {
      state.occupied.delete(cellKey(removed));
    }
    return true;
  }

  const owner = state.occupied.get(cellKey(cell));
  if (owner && owner !== colorKey) return false;

  const isAnchorCell = isAnchorOfColor(colorKey, cell);
  if (isAnchorCell) {
    const anchorVisitedBefore = path.some((point, idx) => idx < path.length - 1 && equalCell(point, cell));
    if (anchorVisitedBefore) return false;

    const startAnchor = path[0];
    const oppositeAnchor = equalCell(startAnchor, pair.start) ? pair.end : pair.start;
    const isOppositeAnchor = equalCell(cell, oppositeAnchor);
    if (path.length > 1 && !isOppositeAnchor) return false;
  }

  if (owner === colorKey && !isAnchorOfColor(colorKey, cell)) {
    const index = path.findIndex((point) => equalCell(point, cell));
    if (index !== -1) {
      const tail = path.splice(index + 1);
      tail.forEach((point) => {
        if (!isAnchorOfColor(colorKey, point)) state.occupied.delete(cellKey(point));
      });
      return true;
    }
  }

  path.push(cell);
  if (!isAnchorOfColor(colorKey, cell)) {
    state.occupied.set(cellKey(cell), colorKey);
  }
  return true;
}

function getTraceCells(from, to) {
  const cells = [];
  let [x, y] = from;
  const [targetX, targetY] = to;

  while (x !== targetX || y !== targetY) {
    const dx = targetX - x;
    const dy = targetY - y;

    if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
      x += Math.sign(dx);
    } else if (dy !== 0) {
      y += Math.sign(dy);
    } else if (dx !== 0) {
      x += Math.sign(dx);
    }

    cells.push([x, y]);
  }

  return cells;
}

function extendPath(cell) {
  const colorKey = state.activeColorKey;
  if (!colorKey || !cell) return;

  const path = state.activePath;
  if (!path.length) return;
  const last = path[path.length - 1];

  const traceCells = getTraceCells(last, cell);
  for (const nextCell of traceCells) {
    const moved = extendPathStep(nextCell);
    if (!moved) break;
  }

  draw();
}

function endPath() {
  const colorKey = state.activeColorKey;
  if (!colorKey) return;

  state.paths[colorKey] = [...state.activePath];
  state.activeColorKey = null;
  state.activePath = [];
  checkSolved();
  draw();
}

function isPairConnected(colorKey) {
  const pair = getCurrentLevel().pairs[colorKey];
  const path = state.paths[colorKey];
  if (!path.length) return false;
  const head = path[0];
  const tail = path[path.length - 1];

  return (
    (equalCell(head, pair.start) && equalCell(tail, pair.end)) ||
    (equalCell(head, pair.end) && equalCell(tail, pair.start))
  );
}

function allCellsFilled() {
  const level = getCurrentLevel();
  return state.occupied.size === level.size * level.size;
}

function checkSolved() {
  const level = getCurrentLevel();
  const everyPairConnected = Object.keys(level.pairs).every((key) => isPairConnected(key));

  if (everyPairConnected && allCellsFilled()) {
    state.isSolved = true;
    state.levelElapsedMs = performance.now() - state.levelStartedAt;
    statusMessage.textContent = 'Harika! Bölüm temiz şekilde çözüldü.';
    const wasCompleted = state.completedLevelIds.has(level.id);
    state.completedLevelIds.add(level.id);
    const unlockedBefore = state.unlockedLevel;
    if (level.id < LEVELS.length) {
      state.unlockedLevel = Math.max(state.unlockedLevel, level.id + 1);
    }

    if (!wasCompleted) {
      const timePenalty = Math.floor(state.levelElapsedMs / 1000) * 6;
      const levelBase = level.size * 260;
      const bonus = Math.max(120, levelBase - timePenalty);
      state.totalScore += bonus;
    }

    saveProgress();
    updateProgressUI();
    renderLevelButtons();

    if (level.id === LEVELS.length) {
      statusMessage.textContent = `Tebrikler! 100 bölümün tamamını bitirdin. Toplam süren: ${formatDuration(state.levelElapsedMs)}.`;
      showToast('🎉 Tebrikler! Tüm bölümleri tamamladın.');
    } else if (state.unlockedLevel > unlockedBefore) {
      showToast(`Bölüm ${level.id + 1} açıldı!`);
    } else {
      showToast('Bölüm tekrar tamamlandı!');
    }

    nextLevelBtn.disabled = level.id >= LEVELS.length;
  } else {
    state.isSolved = false;
    nextLevelBtn.disabled = true;
    statusMessage.textContent = 'Akışları tamamla, tüm hücreleri doldur.';
  }
}

function updateProgressUI() {
  const level = getCurrentLevel();
  const fill = Math.round((state.occupied.size / (level.size * level.size)) * 100);
  progressFill.style.width = `${fill}%`;
  progressTrack.setAttribute('aria-valuenow', String(fill));
}

function updateHudStats() {
  const elapsed = state.isSolved ? state.levelElapsedMs : performance.now() - state.levelStartedAt;
  timerValue.textContent = formatDuration(Math.max(0, elapsed));
  scoreValue.textContent = String(state.totalScore);
}

function drawGrid(level) {
  ctx.strokeStyle = 'rgba(156, 181, 255, 0.2)';
  ctx.lineWidth = 1;

  for (let i = 0; i <= level.size; i += 1) {
    const pos = boardOffset + i * cellSize;
    ctx.beginPath();
    ctx.moveTo(boardOffset, pos);
    ctx.lineTo(boardOffset + level.size * cellSize, pos);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pos, boardOffset);
    ctx.lineTo(pos, boardOffset + level.size * cellSize);
    ctx.stroke();
  }
}

function drawPath(path, color, active = false) {
  if (path.length < 2) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = cellSize * 0.45;
  ctx.shadowBlur = active ? 22 : 14;
  ctx.shadowColor = color;

  ctx.beginPath();
  path.forEach(([x, y], idx) => {
    const px = boardOffset + x * cellSize + cellSize / 2;
    const py = boardOffset + y * cellSize + cellSize / 2;
    if (idx === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawAnchors(level) {
  state.pulse += 0.05;
  const pulse = (Math.sin(state.pulse) + 1) * 0.5;

  for (const pair of Object.values(level.pairs)) {
    [pair.start, pair.end].forEach(([x, y]) => {
      const cx = boardOffset + x * cellSize + cellSize / 2;
      const cy = boardOffset + y * cellSize + cellSize / 2;

      ctx.fillStyle = pair.color;
      ctx.beginPath();
      ctx.arc(cx, cy, cellSize * (0.23 + pulse * 0.025), 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, cellSize * 0.14, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
}

function drawHintMarker() {
  if (!state.hintMarker) return;
  if (performance.now() > state.hintMarker.expiresAt) {
    state.hintMarker = null;
    return;
  }

  const [x, y] = state.hintMarker.cell;
  const cx = boardOffset + x * cellSize + cellSize / 2;
  const cy = boardOffset + y * cellSize + cellSize / 2;
  const t = performance.now() / 220;
  const pulse = (Math.sin(t) + 1) * 0.5;

  ctx.strokeStyle = state.hintMarker.color;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.55 + pulse * 0.35;
  ctx.beginPath();
  ctx.arc(cx, cy, cellSize * (0.28 + pulse * 0.06), 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function draw() {
  const level = getCurrentLevel();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(11, 16, 35, 0.92)';
  ctx.fillRect(boardOffset, boardOffset, level.size * cellSize, level.size * cellSize);

  drawGrid(level);

  for (const [key, path] of Object.entries(state.paths)) {
    drawPath(path, level.pairs[key].color, false);
  }

  if (state.activeColorKey) {
    drawPath(state.activePath, level.pairs[state.activeColorKey].color, true);
  }

  drawAnchors(level);
  drawHintMarker();
  updateProgressUI();
  updateHudStats();
}

function handlePointerDown(event) {
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  const cell = toCell(fromEvent(event));
  if (!cell) return;
  beginPath(cell);
}

function handlePointerMove(event) {
  if (!state.activeColorKey) return;
  const cell = toCell(fromEvent(event));
  extendPath(cell);
}

function handlePointerCancel(event) {
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  endPath();
}

function clearBoard() {
  const level = getCurrentLevel();
  state.paths = {};
  state.occupied = new Map();
  for (const [key, pair] of Object.entries(level.pairs)) {
    state.paths[key] = [];
    state.occupied.set(cellKey(pair.start), key);
    state.occupied.set(cellKey(pair.end), key);
  }
  state.activeColorKey = null;
  state.activePath = [];
  state.isSolved = false;
  state.hintMarker = null;
  statusMessage.textContent = 'Tahta temizlendi. Yeni akışları kur.';
  nextLevelBtn.disabled = true;
  draw();
}

function bindEvents() {
  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerCancel);
  canvas.addEventListener('pointercancel', handlePointerCancel);

  resetLevelBtn.addEventListener('click', () => initializeLevel(state.currentLevelIndex));
  clearBoardBtn.addEventListener('click', clearBoard);
  hintBtn.addEventListener('click', applyHint);

  nextLevelBtn.addEventListener('click', () => {
    const nextIndex = state.currentLevelIndex + 1;
    if (nextIndex < LEVELS.length && LEVELS[nextIndex].id <= state.unlockedLevel) {
      initializeLevel(nextIndex);
    }
  });

  window.addEventListener('resize', () => {
    computeBoardMetrics();
    draw();
  });
}

function animate() {
  draw();
  requestAnimationFrame(animate);
}

function init() {
  loadProgress();
  renderLevelButtons();
  bindEvents();
  initializeLevel(0);
  animate();
}

init();
