import * as THREE from 'three';
import { TUNING } from './tuning.js';
const CANVAS_W = 640;
const CANVAS_H = 240;

const GLYPHS = {
  '0': [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  '1': [
    [0, 0, 1, 0, 0],
    [0, 1, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 1, 1, 1, 0],
  ],
  '2': [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [0, 0, 0, 0, 1],
    [0, 0, 1, 1, 0],
    [0, 1, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
  ],
  '3': [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [0, 0, 0, 0, 1],
    [0, 0, 1, 1, 0],
    [0, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  '4': [
    [0, 0, 0, 1, 0],
    [0, 0, 1, 1, 0],
    [0, 1, 0, 1, 0],
    [1, 0, 0, 1, 0],
    [1, 1, 1, 1, 1],
    [0, 0, 0, 1, 0],
    [0, 0, 0, 1, 0],
  ],
  '5': [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 0],
    [0, 0, 0, 0, 1],
    [0, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  '6': [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  '7': [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 1],
    [0, 0, 0, 1, 0],
    [0, 0, 1, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 1, 0, 0, 0],
  ],
  '8': [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  '9': [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 1],
    [0, 0, 0, 0, 1],
    [0, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  ':': [
    [0],
    [1],
    [0],
    [0],
    [0],
    [1],
    [0],
  ],
};

function drawGlyph(ctx, glyph, x, y, dotR, colW, rowH, color) {
  ctx.fillStyle = color;
  for (let row = 0; row < glyph.length; row++) {
    for (let col = 0; col < glyph[row].length; col++) {
      if (!glyph[row][col]) continue;
      ctx.beginPath();
      ctx.arc(x + col * colW + colW / 2, y + row * rowH + rowH / 2, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function glyphWidth(ch, colW) {
  return ch === ':' ? colW : 5 * colW;
}

function advanceWidth(ch, nextCh, colW, charGap) {
  const colonPad = 10;
  if (ch === ':') return colW + colonPad + (nextCh ? charGap + colonPad : 0);
  return 5 * colW + (nextCh ? (nextCh === ':' ? charGap + 6 : charGap) : 0);
}

function drawString(ctx, text, centerX, y, color) {
  const dotR = 4.2;
  const colW = 11;
  const rowH = 11;
  const charGap = 7;

  let totalW = 0;
  for (let i = 0; i < text.length; i++) {
    totalW += advanceWidth(text[i], text[i + 1], colW, charGap);
  }

  let x = centerX - totalW / 2;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    drawGlyph(ctx, glyph, x, y, dotR, colW, rowH, color);
    x += advanceWidth(ch, text[i + 1], colW, charGap);
  }
}

function formatTime(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function createScoreboard() {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const boardW = 8;
  const boardH = 2.1;
  const group = new THREE.Group();

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(boardW + 0.14, boardH + 0.14, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.85, metalness: 0.1 })
  );
  frame.position.z = -0.05;
  frame.castShadow = true;
  group.add(frame);

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(boardW, boardH),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
  );
  group.add(face);

  group.position.set(TUNING.scoreboard.x, TUNING.scoreboard.y, TUNING.scoreboard.z);
  group.rotation.y = Math.PI / 2;

  let lastKey = '';

  function draw(red, blue, timeLeft, goldenGoal) {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, CANVAS_W - 8, CANVAS_H - 8);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('RED', CANVAS_W * 0.17, 28);
    ctx.fillText('TIME', CANVAS_W * 0.5, 28);
    ctx.fillText('BLUE', CANVAS_W * 0.83, 28);

    const scoreY = 88;
    drawString(ctx, String(red).padStart(2, '0'), CANVAS_W * 0.17, scoreY, '#e83838');
    drawString(ctx, String(blue).padStart(2, '0'), CANVAS_W * 0.83, scoreY, '#e83838');

    const timeText = goldenGoal ? '00:00' : formatTime(timeLeft);
    drawString(ctx, timeText, CANVAS_W * 0.5, scoreY, '#38d858');

    texture.needsUpdate = true;
  }

  draw(0, 0, 0, false);

  return {
    group,
    syncPosition() {
      const p = TUNING.scoreboard;
      group.position.set(p.x, p.y, p.z);
    },
    update(red, blue, timeLeft, goldenGoal) {
      const key = `${red}|${blue}|${Math.ceil(timeLeft)}|${goldenGoal}`;
      if (key === lastKey) return;
      lastKey = key;
      draw(red, blue, timeLeft, goldenGoal);
    },
  };
}
