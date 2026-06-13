import { loadAssets } from './assets.js';
import { createRenderer, createCamera, buildWorld } from './scene.js';
import { Game } from './game.js';
import { initDebugPanel } from './debug.js';

initDebugPanel();

const canvas = document.getElementById('game-canvas');
const menu = document.getElementById('menu');
const hudRoot = document.getElementById('hud');
const loading = document.getElementById('loading');

const hud = {
  score: document.getElementById('score'),
  timer: document.getElementById('timer'),
  powerFill: document.getElementById('power-fill'),
  banner: document.getElementById('banner'),
};

let selectedHero = 'sam';
for (const btn of document.querySelectorAll('.hero-btn')) {
  btn.addEventListener('click', () => {
    document.querySelector('.hero-btn.selected')?.classList.remove('selected');
    btn.classList.add('selected');
    selectedHero = btn.dataset.hero;
  });
}

const renderer = createRenderer(canvas);
const camera = createCamera();

let scene = null;
let game = null;
let assets = null;
let lastTime = performance.now();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function ensureAssets() {
  if (assets) return;
  loading.classList.remove('hidden');
  assets = await loadAssets();
  scene = buildWorld(assets);
  loading.classList.add('hidden');
}

document.getElementById('start-btn').addEventListener('click', async () => {
  try {
    await ensureAssets();
  } catch (err) {
    loading.textContent = 'Failed to load assets — serve this folder over HTTP.';
    console.error(err);
    return;
  }

  menu.classList.add('hidden');
  hudRoot.classList.remove('hidden');

  game?.dispose();
  game = new Game({ scene, camera, assets, hud, playerHero: selectedHero });
  game.onMatchEnd = () => {
    game.dispose();
    game = null;
    hudRoot.classList.add('hidden');
    menu.classList.remove('hidden');
  };
});

function frame(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (game) game.update(dt);
  if (scene) renderer.render(scene, camera);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
