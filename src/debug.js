import { TUNING, TUNING_SLIDERS, resetTuning } from './tuning.js';

export { TUNING, resetTuning } from './tuning.js';

export const DEBUG = {
  noCooldowns: false,
  freezeTimer: false,
  disableAI: false,
  slowMotion: false,
  physicsOverlay: false,
};

const TOGGLES = [
  { key: 'noCooldowns', label: 'No cooldowns' },
  { key: 'freezeTimer', label: 'Freeze timer' },
  { key: 'disableAI', label: 'Disable AI' },
  { key: 'slowMotion', label: 'Slow motion' },
  { key: 'physicsOverlay', label: 'Physics overlay' },
];

const sliderInputs = [];

function fmt(n, digits = 2) {
  return Number(n).toFixed(digits);
}

function sliderDigits(step) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function syncSliderInputs() {
  for (const { spec, input, valueSpan } of sliderInputs) {
    const v = TUNING[spec.group][spec.key];
    input.value = v;
    valueSpan.textContent = fmt(v, sliderDigits(spec.step));
  }
}

function buildTuningSliders(panel) {
  const section = document.createElement('div');
  section.id = 'debug-tuning';

  const heading = document.createElement('div');
  heading.className = 'debug-section-title';
  heading.textContent = 'Physics tuning';
  section.appendChild(heading);

  let currentGroup = '';
  for (const spec of TUNING_SLIDERS) {
    if (spec.group !== currentGroup) {
      currentGroup = spec.group;
      const groupLabel = document.createElement('div');
      groupLabel.className = 'debug-group-label';
      groupLabel.textContent = spec.label;
      section.appendChild(groupLabel);
    }

    const row = document.createElement('label');
    row.className = 'debug-slider-row';

    const name = document.createElement('span');
    name.className = 'debug-slider-name';
    name.textContent = spec.name;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = spec.min;
    input.max = spec.max;
    input.step = spec.step;
    input.value = TUNING[spec.group][spec.key];

    const valueSpan = document.createElement('span');
    valueSpan.className = 'debug-slider-value';
    valueSpan.textContent = fmt(input.value, sliderDigits(spec.step));

    input.addEventListener('input', () => {
      TUNING[spec.group][spec.key] = Number(input.value);
      valueSpan.textContent = fmt(input.value, sliderDigits(spec.step));
    });

    row.appendChild(name);
    row.appendChild(input);
    row.appendChild(valueSpan);
    section.appendChild(row);
    sliderInputs.push({ spec, input, valueSpan });
  }

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.id = 'debug-reset-tuning';
  resetBtn.textContent = 'Reset tuning';
  resetBtn.addEventListener('click', () => {
    resetTuning();
    syncSliderInputs();
  });
  section.appendChild(resetBtn);

  panel.appendChild(section);
}

export function initDebugPanel() {
  const panel = document.createElement('div');
  panel.id = 'debug-panel';
  panel.classList.add('hidden');

  const title = document.createElement('div');
  title.id = 'debug-title';
  title.textContent = 'Debug';
  panel.appendChild(title);

  for (const { key, label } of TOGGLES) {
    const row = document.createElement('label');
    row.className = 'debug-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = DEBUG[key];
    input.addEventListener('change', () => {
      DEBUG[key] = input.checked;
    });

    const text = document.createElement('span');
    text.textContent = label;

    row.appendChild(input);
    row.appendChild(text);
    panel.appendChild(row);
  }

  buildTuningSliders(panel);

  const hint = document.createElement('div');
  hint.id = 'debug-hint';
  hint.textContent = 'Toggle with ` or F8';
  panel.appendChild(hint);

  document.body.appendChild(panel);

  const overlay = document.createElement('pre');
  overlay.id = 'physics-overlay';
  overlay.classList.add('hidden');
  document.body.appendChild(overlay);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote' || e.code === 'F8') {
      panel.classList.toggle('hidden');
      e.preventDefault();
    }
  });

  return panel;
}

function bodySpeed(body) {
  return Math.hypot(body.vx, body.vz);
}

function formatBody(label, body) {
  return [
    `${label}  pos (${fmt(body.x)}, ${fmt(body.z)})  vel (${fmt(body.vx)}, ${fmt(body.vz)})`,
    `         speed ${fmt(bodySpeed(body))}  r ${fmt(body.radius, 2)}  mass ${fmt(body.mass, 1)}`,
  ].join('\n');
}

export function updatePhysicsOverlay(game, frameDt) {
  const overlay = document.getElementById('physics-overlay');
  if (!overlay) return;

  if (!DEBUG.physicsOverlay || !game) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');

  const ball = game.ball.body;
  const human = game.players.find((p) => p.isHuman) ?? game.players[0];
  const ai = game.players.find((p) => !p.isHuman) ?? game.players[1];
  const humanBallDist = Math.hypot(ball.x - human.body.x, ball.z - human.body.z);
  const touchingBall = humanBallDist <= human.body.radius + ball.radius;
  const inGoalMouth = Math.abs(ball.x) < game.pitchGoalHalfWidth;
  const t = TUNING;

  overlay.textContent = [
    `frame dt ${fmt(frameDt, 3)}s${DEBUG.slowMotion ? '  (slow-mo)' : ''}`,
    `state ${game.state}  timer ${fmt(game.timeLeft, 1)}s`,
    '',
    formatBody('ball', ball),
    `         in goal mouth ${inGoalMouth ? 'yes' : 'no'}`,
    '',
    formatBody(`${human.heroKind} (you)`, human.body),
    `         facing (${fmt(human.facingX, 2)}, ${fmt(human.facingZ, 2)})  power ${fmt(human.hero.cooldownFraction * 100, 0)}%`,
    `         ball dist ${fmt(humanBallDist, 2)}  touch ${touchingBall ? 'yes' : 'no'}`,
    '',
    formatBody(`${ai.heroKind} (ai)`, ai.body),
    '',
    'live tuning',
    `  player  accel ${t.player.accel}  damp ${t.player.damping}  max ${t.player.maxSpeed}  mass ${t.player.mass}`,
    `  ball    damp ${t.ball.damping}  max ${t.ball.maxSpeed}  mass ${t.ball.mass}  rest ${t.ball.playerRestitution}`,
  ].join('\n');
}
