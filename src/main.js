import { loadAssets } from './assets.js';
import { createRenderer, createCamera, buildWorld } from './scene.js';
import { Game } from './game.js';
import { readCommands } from './input.js';
import { createHostSession, createGuestSession, normalizeRoomCode } from './online.js';
import { initDebugPanel, updatePhysicsOverlay } from './debug.js';
import { TEAM } from './constants.js';

initDebugPanel();

const PLAYER_SPAWN_Z = 7.8;
const INPUT_RATE = 30;
const SNAPSHOT_RATE = 20;
const EMPTY_COMMANDS = Object.freeze({ moveX: 0, moveZ: 0, shoot: false, power: false });

const canvas = document.getElementById('game-canvas');
const menu = document.getElementById('menu');
const hudRoot = document.getElementById('hud');
const loading = document.getElementById('loading');

const startBtn = document.getElementById('start-btn');
const hostBtn = document.getElementById('host-btn');
const joinBtn = document.getElementById('join-btn');
const onlinePanel = document.getElementById('online-panel');
const onlineTitle = document.getElementById('online-title');
const onlineStatus = document.getElementById('online-status');
const primaryCode = document.getElementById('primary-code');
const primaryCodeLabel = document.getElementById('primary-code-label');
const copyPrimaryBtn = document.getElementById('copy-primary-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const cancelOnlineBtn = document.getElementById('cancel-online-btn');

const hud = {
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
let scoreboard = null;
let game = null;
let assets = null;
let lastTime = performance.now();
let onlineSession = null;
let onlineState = null;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function ensureAssets() {
  if (assets) return;
  loading.classList.remove('hidden');
  loading.textContent = 'Loading stadium...';
  assets = await loadAssets();
  ({ scene, scoreboard } = buildWorld(assets));
  loading.classList.add('hidden');
}

startBtn.addEventListener('click', startLocalMatch);
hostBtn.addEventListener('click', startHostFlow);
joinBtn.addEventListener('click', showJoinPanel);
copyPrimaryBtn.addEventListener('click', () => copyCode(primaryCode, 'Room copied'));
joinRoomBtn.addEventListener('click', joinRoom);
cancelOnlineBtn.addEventListener('click', () => {
  closeOnlineSession();
  resetOnlinePanel();
});
primaryCode.addEventListener('input', () => {
  const normalized = normalizeRoomCode(primaryCode.value);
  if (primaryCode.value !== normalized) primaryCode.value = normalized;
});
primaryCode.addEventListener('keydown', (event) => {
  if (event.code === 'Enter' && !joinRoomBtn.classList.contains('hidden')) {
    event.preventDefault();
    joinRoom();
  }
});

async function startLocalMatch() {
  closeOnlineSession();
  resetOnlinePanel();

  try {
    await ensureAssets();
  } catch (err) {
    loading.textContent = 'Failed to load assets - serve this folder over HTTP.';
    console.error(err);
    return;
  }

  enterGameView();
  game?.dispose();
  game = new Game({ scene, camera, assets, hud, scoreboard, playerHero: selectedHero });
  game.onMatchEnd = returnToMenu;
}

async function startHostFlow() {
  if (!ensureWebRtcAvailable()) return;

  closeOnlineSession();
  onlineState = createOnlineState('host');
  configureHostPanel();

  try {
    setOnlineStatus('Creating room...');
    onlineSession = await createHostSession(createOnlineHandlers('host'));
    primaryCode.value = onlineSession.roomCode;
    setOnlineStatus('Waiting for player');
  } catch (err) {
    setOnlineStatus(err.message || 'Could not create room');
    closeOnlineSession();
  }
}

function showJoinPanel() {
  if (!ensureWebRtcAvailable()) return;
  closeOnlineSession();
  onlineState = createOnlineState('guest');
  configureJoinPanel();
}

async function joinRoom() {
  if (!primaryCode.value.trim()) {
    setOnlineStatus('Enter a room code');
    return;
  }

  closeOnlineSession(false);
  onlineState = createOnlineState('guest');

  try {
    setOnlineStatus('Joining room...');
    onlineSession = await createGuestSession(primaryCode.value, createOnlineHandlers('guest'));
    primaryCode.value = onlineSession.roomCode;
  } catch (err) {
    setOnlineStatus(err.message || 'Could not join room');
    onlineSession = null;
  }
}

function createOnlineHandlers(role) {
  return {
    onStatus: setOnlineStatus,
    onRoomCode: (roomCode) => {
      primaryCode.value = roomCode;
    },
    onOpen: () => {
      if (role === 'guest') {
        onlineSession?.send({ type: 'hello', heroKind: selectedHero });
      }
      setOnlineStatus(role === 'host' ? 'Player connected' : 'Connected');
    },
    onMessage: (message) => handleOnlineMessage(role, message),
    onClose: () => handleOnlineClose(),
  };
}

function handleOnlineMessage(role, message) {
  if (!message || !onlineState || role !== onlineState.role) return;

  if (role === 'host') {
    if (message.type === 'hello') {
      onlineState.remoteHero = normalizeHero(message.heroKind);
      startHostedMatch().catch((err) => setOnlineStatus(err.message || 'Could not start match'));
    } else if (message.type === 'input') {
      onlineState.remoteCommands = normalizeCommands(message.commands);
    }
    return;
  }

  if (message.type === 'start') {
    startGuestMatch(message.players).catch((err) => setOnlineStatus(err.message || 'Could not start match'));
  } else if (message.type === 'roomFull') {
    setOnlineStatus('Room is full');
    closeOnlineSession(false);
  } else if (message.type === 'snapshot') {
    if (game) game.applySnapshot(message);
    else onlineState.pendingSnapshot = message;
  } else if (message.type === 'fx' && game) {
    const player = game.players[message.playerIndex];
    if (player) game.spawnPowerFX(player, message.fxType, true);
  } else if (message.type === 'matchEnded') {
    returnToMenu();
  }
}

async function startHostedMatch() {
  if (!onlineState || onlineState.started) return;

  const players = [
    { heroKind: normalizeHero(selectedHero), team: TEAM.RED, spawnZ: PLAYER_SPAWN_Z },
    { heroKind: normalizeHero(onlineState.remoteHero), team: TEAM.BLUE, spawnZ: -PLAYER_SPAWN_Z },
  ];

  await startOnlineGame('host', players);
  onlineSession?.send({ type: 'start', players });
}

async function startGuestMatch(players) {
  if (!onlineState || onlineState.started) return;
  await startOnlineGame('guest', sanitizePlayers(players));
}

async function startOnlineGame(role, players) {
  try {
    await ensureAssets();
  } catch (err) {
    loading.textContent = 'Failed to load assets - serve this folder over HTTP.';
    throw err;
  }

  enterGameView();
  game?.dispose();

  const localPlayerIndex = role === 'host' ? 0 : 1;
  game = new Game({
    scene,
    camera,
    assets,
    hud,
    scoreboard,
    playerSpecs: players.map((player, index) => ({
      ...player,
      control: index === localPlayerIndex ? 'local' : 'remote',
    })),
    localPlayerIndex,
    authoritative: role === 'host',
    inputProvider: () => onlineState?.remoteCommands ?? EMPTY_COMMANDS,
  });

  if (role === 'host') {
    game.onFxEvent = (playerIndex, fxType) => {
      onlineSession?.send({ type: 'fx', playerIndex, fxType });
    };
    game.onMatchEnd = () => {
      const session = onlineSession;
      game.onMatchEnd = null;
      session?.send({ type: 'matchEnded' });
      setTimeout(returnToMenu, 250);
    };
  }

  onlineState.players = players;
  onlineState.started = true;
  setOnlineStatus(role === 'host' ? 'Match started' : 'Playing online');

  if (onlineState.pendingSnapshot) {
    game.applySnapshot(onlineState.pendingSnapshot);
    onlineState.pendingSnapshot = null;
  }
}

function enterGameView() {
  menu.classList.add('hidden');
  hudRoot.classList.remove('hidden');
  document.activeElement?.blur?.();
  canvas.focus?.();
}

function returnToMenu() {
  game?.dispose();
  game = null;
  hudRoot.classList.add('hidden');
  menu.classList.remove('hidden');
  closeOnlineSession();
  resetOnlinePanel();
}

function handleOnlineClose() {
  const wasPlaying = onlineState?.started;
  onlineSession = null;
  onlineState = null;

  if (wasPlaying && game) {
    game.setBannerState({ visible: true, text: 'DISCONNECTED', color: '#ff6a5e' });
    setTimeout(() => {
      if (game) returnToMenu();
    }, 1400);
  } else {
    setOnlineStatus('Disconnected');
  }
}

function createOnlineState(role) {
  return {
    role,
    started: false,
    remoteHero: 'tesla',
    remoteCommands: { ...EMPTY_COMMANDS },
    inputSeq: 0,
    inputAccumulator: 0,
    snapshotSeq: 0,
    snapshotAccumulator: 0,
    pendingSnapshot: null,
    players: null,
  };
}

function closeOnlineSession(clearState = true) {
  if (onlineSession) {
    const session = onlineSession;
    onlineSession = null;
    session.close();
  }
  if (clearState) onlineState = null;
}

function configureHostPanel() {
  onlinePanel.classList.remove('hidden');
  onlineTitle.textContent = 'Host Online';
  primaryCodeLabel.textContent = 'Room Code';
  primaryCode.value = '';
  primaryCode.readOnly = true;
  copyPrimaryBtn.classList.remove('hidden');
  joinRoomBtn.classList.add('hidden');
}

function configureJoinPanel() {
  onlinePanel.classList.remove('hidden');
  onlineTitle.textContent = 'Join Online';
  primaryCodeLabel.textContent = 'Room Code';
  primaryCode.value = '';
  primaryCode.readOnly = false;
  copyPrimaryBtn.classList.add('hidden');
  joinRoomBtn.classList.remove('hidden');
  setOnlineStatus('Enter room code');
  primaryCode.focus();
}

function resetOnlinePanel() {
  onlinePanel.classList.add('hidden');
  primaryCode.value = '';
  setOnlineStatus('Idle');
}

function setOnlineStatus(text) {
  onlineStatus.textContent = text;
}

async function copyCode(textarea, successText) {
  if (!textarea.value) return;

  try {
    await navigator.clipboard.writeText(textarea.value);
    setOnlineStatus(successText);
  } catch {
    textarea.focus();
    textarea.select();
    setOnlineStatus('Select code to copy');
  }
}

function ensureWebRtcAvailable() {
  if ('RTCPeerConnection' in window) return true;
  onlinePanel.classList.remove('hidden');
  setOnlineStatus('WebRTC is unavailable');
  return false;
}

function normalizeHero(heroKind) {
  return heroKind === 'tesla' ? 'tesla' : 'sam';
}

function normalizeCommands(commands = EMPTY_COMMANDS) {
  let moveX = Number(commands.moveX) || 0;
  let moveZ = Number(commands.moveZ) || 0;
  const len = Math.hypot(moveX, moveZ);
  if (len > 1) {
    moveX /= len;
    moveZ /= len;
  }
  return {
    moveX,
    moveZ,
    shoot: Boolean(commands.shoot),
    power: Boolean(commands.power),
  };
}

function sanitizePlayers(players) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw new Error('Invalid match setup');
  }

  return players.map((player, index) => ({
    heroKind: normalizeHero(player.heroKind),
    team: index === 0 ? TEAM.RED : TEAM.BLUE,
    spawnZ: index === 0 ? PLAYER_SPAWN_Z : -PLAYER_SPAWN_Z,
  }));
}

function updateOnlineTransport(dt) {
  if (!onlineState || !onlineSession) return;

  if (onlineState.role === 'guest' && onlineState.started) {
    onlineState.inputAccumulator += dt;
    const inputInterval = 1 / INPUT_RATE;
    if (onlineState.inputAccumulator >= inputInterval) {
      onlineState.inputAccumulator %= inputInterval;
      onlineSession.send({
        type: 'input',
        seq: ++onlineState.inputSeq,
        commands: normalizeCommands(readCommands()),
      });
    }
  }

  if (onlineState.role === 'host' && onlineState.started && game) {
    onlineState.snapshotAccumulator += dt;
    const snapshotInterval = 1 / SNAPSHOT_RATE;
    if (onlineState.snapshotAccumulator >= snapshotInterval) {
      onlineState.snapshotAccumulator %= snapshotInterval;
      onlineSession.send(game.serializeSnapshot(++onlineState.snapshotSeq));
    }
  }
}

function frame(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (game) game.update(dt);
  updateOnlineTransport(dt);
  scoreboard?.syncPosition();
  updatePhysicsOverlay(game, dt);
  if (scene) renderer.render(scene, camera);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
