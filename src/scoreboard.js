import * as THREE from 'three';
import { TUNING } from './tuning.js';
const CANVAS_W = 960;
const CANVAS_H = 180;
const BOARD_W = 9.8;
const BOARD_H = 1.65;

const LAYOUT = {
  redX: CANVAS_W * 0.17,
  timeX: CANVAS_W * 0.5,
  blueX: CANVAS_W * 0.83,
  labelY: 20,
  scoreY: 74,
};

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

function drawString(
  ctx,
  text,
  centerX,
  y,
  color,
  { dotR = 5.3, colW = 12, rowH = 12, charGap = 16, colonGap = 30 } = {}
) {
  const gapAfter = (ch, nextCh) => (ch === ':' || nextCh === ':' ? colonGap : charGap);

  let totalW = 0;
  for (let i = 0; i < text.length; i++) {
    totalW += glyphWidth(text[i], colW);
    if (i < text.length - 1) totalW += gapAfter(text[i], text[i + 1]);
  }

  let x = centerX - totalW / 2;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    drawGlyph(ctx, glyph, x, y, dotR, colW, rowH, color);
    x += glyphWidth(ch, colW) + (i < text.length - 1 ? gapAfter(ch, text[i + 1]) : 0);
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

  const group = new THREE.Group();

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD_W + 0.14, BOARD_H + 0.14, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.85, metalness: 0.1 })
  );
  frame.position.z = -0.05;
  frame.castShadow = true;
  group.add(frame);

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD_W, BOARD_H),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
  );
  face.position.z = 0.02;
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
    ctx.font = '700 34px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('RED', LAYOUT.redX, LAYOUT.labelY);
    ctx.fillText('TIME', LAYOUT.timeX, LAYOUT.labelY);
    ctx.fillText('BLUE', LAYOUT.blueX, LAYOUT.labelY);

    drawString(ctx, String(red).padStart(2, '0'), LAYOUT.redX, LAYOUT.scoreY, '#e83838', {
      charGap: 22,
    });
    drawString(ctx, String(blue).padStart(2, '0'), LAYOUT.blueX, LAYOUT.scoreY, '#e83838', {
      charGap: 22,
    });

    const timeText = goldenGoal ? '00:00' : formatTime(timeLeft);
    drawString(ctx, timeText, LAYOUT.timeX, LAYOUT.scoreY, '#38d858', {
      charGap: 22,
      colonGap: 18,
    });

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
