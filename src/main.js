import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { loadAssets } from './assets.js';
import { createRenderer, createCamera, buildWorld } from './scene.js';
import { Game } from './game.js';
import { readCommands, setInputLocked } from './input.js';
import { createHostSession, createGuestSession, normalizeRoomCode, MAX_GUESTS } from './online.js';
import { initDebugPanel, updatePhysicsOverlay, setIntentOverlay } from './debug.js';
import { MATCH, TEAM } from './constants.js';
import { gameAudio } from './audio.js';

initDebugPanel();

const PLAYER_SPAWN_Z = 7.8;
const MAX_ONLINE_PLAYERS = MAX_GUESTS + 1;
const NICKNAME_MAX_LENGTH = 16;
const INPUT_RATE = 30;
const SNAPSHOT_RATE = 45;
const EMPTY_COMMANDS = Object.freeze({ moveX: 0, moveZ: 0, shoot: false, power: false });
const HERO_LABELS = Object.freeze({ sam: 'Sam', tesla: 'Tesla' });
const HERO_POWERS = Object.freeze({ sam: 'Power: Dash', tesla: 'Power: Magnet' });
const MIN_TIME_LIMIT_SECONDS = 30;
const MAX_TIME_LIMIT_SECONDS = 15 * 60;
const MAX_SCORE_LIMIT = 15;
const TEAM_SPAWNS = Object.freeze({
  [TEAM.RED]: Object.freeze([
    Object.freeze({ x: 0, z: PLAYER_SPAWN_Z }),
    Object.freeze({ x: 2.25, z: PLAYER_SPAWN_Z - 1.4 }),
    Object.freeze({ x: -2.25, z: PLAYER_SPAWN_Z - 1.4 }),
    Object.freeze({ x: 0, z: PLAYER_SPAWN_Z - 2.8 }),
  ]),
  [TEAM.BLUE]: Object.freeze([
    Object.freeze({ x: 0, z: -PLAYER_SPAWN_Z }),
    Object.freeze({ x: -2.25, z: -PLAYER_SPAWN_Z + 1.4 }),
    Object.freeze({ x: 2.25, z: -PLAYER_SPAWN_Z + 1.4 }),
    Object.freeze({ x: 0, z: -PLAYER_SPAWN_Z + 2.8 }),
  ]),
});

const canvas = document.getElementById('game-canvas');
const menu = document.getElementById('menu');
const hudRoot = document.getElementById('hud');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const matchHint = document.getElementById('match-hint');
const soundControls = document.getElementById('sound-controls');
const soundToggle = document.getElementById('sound-toggle');
const soundVolume = document.getElementById('sound-volume');

const nicknameInput = document.getElementById('nickname-input');
const startBtn = document.getElementById('start-btn');
const hostBtn = document.getElementById('host-btn');
const joinBtn = document.getElementById('join-btn');
const localPanel = document.getElementById('local-panel');
const startLocalBtn = document.getElementById('start-local-btn');
const cancelLocalBtn = document.getElementById('cancel-local-btn');
const localRedRoster = document.getElementById('local-red-roster');
const localBlueRoster = document.getElementById('local-blue-roster');
const onlinePanel = document.getElementById('online-panel');
const onlineStatus = document.getElementById('online-status');
const primaryCode = document.getElementById('primary-code');
const primaryCodeLabel = document.getElementById('primary-code-label');
const copyPrimaryBtn = document.getElementById('copy-primary-btn');
const startOnlineBtn = document.getElementById('start-online-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const cancelOnlineBtn = document.getElementById('cancel-online-btn');
const onlineRedRoster = document.getElementById('online-red-roster');
const onlineBlueRoster = document.getElementById('online-blue-roster');
const aiTestBtn = document.getElementById('ai-test-btn');
const aiTestPanel = document.getElementById('ai-test-panel');
const aiTestStatus = document.getElementById('ai-test-status');
const aiTestOutput = document.getElementById('ai-test-output');
const aiTestScenarios = document.getElementById('ai-test-scenarios');
const runAiTestsBtn = document.getElementById('run-ai-tests-btn');
const closeAiTestsBtn = document.getElementById('close-ai-tests-btn');
const hostPanel = document.getElementById('host-panel');
const hostPanelKicker = hostPanel.querySelector('.host-panel-kicker');
const hostPanelTitle = document.getElementById('host-panel-title');
const hostPanelClose = document.getElementById('host-panel-close');
const hostPanelStatus = document.getElementById('host-panel-status');
const hostRedRoster = document.getElementById('host-red-roster');
const hostSpectatorRoster = document.getElementById('host-spectator-roster');
const hostBlueRoster = document.getElementById('host-blue-roster');
const hostTimeLimit = document.getElementById('host-time-limit');
const hostScoreLimit = document.getElementById('host-score-limit');
const hostRestartBtn = document.getElementById('host-restart-btn');
const hostLeaveBtn = document.getElementById('host-leave-btn');

const hud = {
  powerFill: document.getElementById('power-fill'),
  powerWrap: document.getElementById('power-wrap'),
  banner: document.getElementById('banner'),
};

gameAudio.installUnlock(document);
gameAudio.bindControls(soundToggle, soundVolume);
soundControls?.addEventListener('keydown', (event) => event.stopPropagation());
soundControls?.addEventListener('keyup', (event) => event.stopPropagation());
document.addEventListener('click', (event) => {
  const target = event.target;
  const button = target instanceof Element ? target.closest('button') : null;
  if (button && !button.disabled) gameAudio.play('ui');
});

const defaultNickname = generateDefaultNickname();
nicknameInput.value = defaultNickname;
nicknameInput.addEventListener('input', () => {
  if (isLocalPanelOpen()) renderLocalRoster();
  if (onlineState?.role === 'host' && !onlineState.started) {
    syncHostPlayerInfo();
    renderOnlineLobby();
    broadcastLobbyState();
  } else if (onlineState?.role === 'guest' && !onlineState.started && !onlineState.lobbyPlayers.length) {
    renderOnlineLobby();
  }
});
nicknameInput.addEventListener('blur', () => {
  nicknameInput.value = currentNickname();
  if (isLocalPanelOpen()) renderLocalRoster();
  syncLocalLobbyInfo();
});

let selectedHero = 'sam';
const localHeroSelections = ['sam', 'tesla', 'tesla', 'sam'];

function setSelectedHero(heroKind) {
  selectedHero = normalizeHero(heroKind);
  localHeroSelections[0] = selectedHero;
}

function setActiveMode(activeBtn) {
  for (const btn of [startBtn, hostBtn, joinBtn]) {
    btn.classList.toggle('selected', btn === activeBtn);
  }
}

let selectedLocalTeamSize = 1;
for (const btn of document.querySelectorAll('#local-size-pick .match-size-btn')) {
  btn.addEventListener('click', () => {
    const previous = document.querySelector('#local-size-pick .match-size-btn.selected');
    previous?.classList.remove('selected');
    previous?.setAttribute('aria-pressed', 'false');
    btn.classList.add('selected');
    btn.setAttribute('aria-pressed', 'true');
    selectedLocalTeamSize = normalizeLocalTeamSize(btn.dataset.localSize);
    if (isLocalPanelOpen()) renderLocalRoster();
  });
}

let selectedLocalDifficulty = 'medium';
for (const btn of document.querySelectorAll('#local-difficulty-pick .difficulty-btn')) {
  btn.addEventListener('click', () => {
    const previous = document.querySelector('#local-difficulty-pick .difficulty-btn.selected');
    previous?.classList.remove('selected');
    previous?.setAttribute('aria-pressed', 'false');
    btn.classList.add('selected');
    btn.setAttribute('aria-pressed', 'true');
    selectedLocalDifficulty = normalizeLocalDifficulty(btn.dataset.difficulty);
  });
}

const renderer = createRenderer(canvas);
const outlineEffect = new OutlineEffect(renderer, {
  defaultThickness: 0.0028,
  defaultColor: [0.04, 0.045, 0.07],
});
const camera = createCamera();

let scene = null;
let scoreboard = null;
let game = null;
let assets = null;
let lastTime = performance.now();
let localMatchState = null;
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
  loadingText.textContent = 'Loading stadium...';
  assets = await loadAssets();
  ({ scene, scoreboard } = buildWorld(assets, outlineEffect));
  loading.classList.add('hidden');
}

startBtn.addEventListener('click', showLocalPanel);
startLocalBtn.addEventListener('click', startLocalMatch);
cancelLocalBtn.addEventListener('click', closeLocalPanel);
aiTestBtn.addEventListener('click', showAiTestPanel);
runAiTestsBtn.addEventListener('click', runAiTests);
closeAiTestsBtn.addEventListener('click', closeAiTestPanel);
hostBtn.addEventListener('click', startHostFlow);
joinBtn.addEventListener('click', showJoinPanel);
copyPrimaryBtn.addEventListener('click', () => copyCode(primaryCode, 'Room copied'));
startOnlineBtn.addEventListener('click', () => {
  startHostedMatch().catch((err) => setOnlineStatus(err.message || 'Could not start match'));
});
joinRoomBtn.addEventListener('click', joinRoom);
cancelOnlineBtn.addEventListener('click', () => {
  closeOnlineSession();
  resetOnlinePanel();
});
hostPanelClose.addEventListener('click', () => closeHostPanel());
hostRestartBtn.addEventListener('click', restartCurrentMatch);
hostLeaveBtn.addEventListener('click', leaveCurrentGame);
hostTimeLimit.addEventListener('change', applyHostMatchSettings);
hostScoreLimit.addEventListener('change', applyHostMatchSettings);
window.addEventListener('keydown', handleHostPanelShortcut, true);
installHostRosterDropTarget(hostRedRoster, TEAM.RED);
installHostRosterDropTarget(hostSpectatorRoster, TEAM.SPECTATOR);
installHostRosterDropTarget(hostBlueRoster, TEAM.BLUE);
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

function showLocalPanel() {
  closeOnlineSession();
  resetOnlinePanel();
  closeAiTestPanel();
  setActiveMode(startBtn);
  localHeroSelections[0] = normalizeHero(selectedHero);
  localPanel.classList.remove('hidden');
  renderLocalRoster();
}

let aiSimModule = null;
async function loadAiSimModule() {
  if (!aiSimModule) aiSimModule = await import('../ai-sim-test.mjs');
  return aiSimModule;
}

async function showAiTestPanel() {
  closeLocalPanel();
  closeOnlineSession();
  resetOnlinePanel();
  aiTestPanel.classList.remove('hidden');
  aiTestPanel.scrollIntoView({ block: 'nearest' });

  if (!aiTestScenarios.childElementCount) {
    try {
      const { SCENARIOS } = await loadAiSimModule();
      renderAiScenarioList(SCENARIOS);
    } catch (err) {
      aiTestStatus.textContent = 'Failed to load scenarios';
      console.error(err);
    }
  }
}

function closeAiTestPanel() {
  aiTestPanel.classList.add('hidden');
}

function renderAiScenarioList(scenarios) {
  aiTestScenarios.replaceChildren();
  for (const scenario of scenarios) {
    const row = document.createElement('div');
    row.className = 'ai-scenario-row';

    const name = document.createElement('span');
    name.className = 'ai-scenario-name';
    name.textContent = scenario.label;

    const watch = document.createElement('button');
    watch.type = 'button';
    watch.className = 'tiny-btn';
    watch.textContent = 'Watch';
    watch.addEventListener('click', () => {
      watchAiScenario(scenario).catch((err) => {
        aiTestStatus.textContent = 'Failed to start match';
        console.error(err);
      });
    });

    row.appendChild(name);
    row.appendChild(watch);
    aiTestScenarios.appendChild(row);
  }
}

async function watchAiScenario(scenario) {
  closeOnlineSession();
  resetOnlinePanel();

  try {
    await ensureAssets();
  } catch (err) {
    loadingText.textContent = 'Failed to load assets - serve this folder over HTTP.';
    console.error(err);
    return;
  }

  const heroCounts = {};
  const players = scenario.specs.map((spec) => {
    const hero = normalizeHero(spec.heroKind);
    const count = (heroCounts[hero] = (heroCounts[hero] ?? 0) + 1);
    return {
      nickname: `AI ${heroName(hero)}${count > 1 ? ` ${count}` : ''}`,
      heroKind: hero,
      team: normalizeTeam(spec.team),
      spawnX: spec.x,
      spawnZ: spec.z,
      control: 'ai',
    };
  });

  const matchSettings = defaultMatchSettings();
  localMatchState = { started: true, players, matchSettings };

  setIntentOverlay(true);
  closeAiTestPanel();
  enterGameView();
  game?.dispose();
  game = new Game({
    scene,
    camera,
    assets,
    hud,
    scoreboard,
    audio: gameAudio,
    playerSpecs: players,
    localPlayerIndex: 0,
    timeLimitSeconds: matchSettings.timeLimitSeconds,
    scoreLimit: matchSettings.scoreLimit,
  });
  installEditableMatchEndHandler();
}

let aiTestsRunning = false;
async function runAiTests() {
  if (aiTestsRunning) return;
  aiTestsRunning = true;
  runAiTestsBtn.disabled = true;
  aiTestOutput.textContent = '';
  aiTestStatus.textContent = 'Loading...';

  try {
    const { runAllScenarios } = await loadAiSimModule();
    const started = performance.now();
    const report = await runAllScenarios(async (done, total, label) => {
      aiTestStatus.textContent = label ? `Running ${done + 1}/${total}: ${label}` : 'Finishing...';
      await new Promise((resolve) => setTimeout(resolve));
    });
    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    aiTestOutput.textContent = report;
    aiTestStatus.textContent = `Done in ${elapsed}s`;
  } catch (err) {
    aiTestOutput.textContent = String(err?.stack || err);
    aiTestStatus.textContent = 'Failed';
    console.error(err);
  } finally {
    aiTestsRunning = false;
    runAiTestsBtn.disabled = false;
  }
}

function closeLocalPanel() {
  localPanel.classList.add('hidden');
  if (startBtn.classList.contains('selected')) setActiveMode(null);
}

function isLocalPanelOpen() {
  return !localPanel.classList.contains('hidden');
}

async function startLocalMatch() {
  closeOnlineSession();
  resetOnlinePanel();

  try {
    await ensureAssets();
  } catch (err) {
    loadingText.textContent = 'Failed to load assets - serve this folder over HTTP.';
    console.error(err);
    return;
  }

  const players = buildLocalPlayers(selectedLocalTeamSize);
  const matchSettings = defaultMatchSettings();
  localMatchState = {
    started: true,
    players,
    matchSettings,
    aiDifficulty: selectedLocalDifficulty,
  };

  enterGameView();
  game?.dispose();
  game = new Game({
    scene,
    camera,
    assets,
    hud,
    scoreboard,
    audio: gameAudio,
    playerSpecs: players,
    localPlayerIndex: 0,
    timeLimitSeconds: matchSettings.timeLimitSeconds,
    scoreLimit: matchSettings.scoreLimit,
    aiDifficulty: selectedLocalDifficulty,
  });
  installEditableMatchEndHandler();
}

async function startHostFlow() {
  closeLocalPanel();
  closeAiTestPanel();
  setActiveMode(hostBtn);
  if (!ensureWebRtcAvailable()) return;

  closeOnlineSession();
  onlineState = createOnlineState('host');
  configureHostPanel();

  try {
    setOnlineStatus('Creating room...');
    onlineSession = await createHostSession(createOnlineHandlers('host'));
    primaryCode.value = onlineSession.roomCode;
    updateHostLobbyStatus();
  } catch (err) {
    setOnlineStatus(err.message || 'Could not create room');
    closeOnlineSession();
  }
}

function showJoinPanel() {
  closeLocalPanel();
  closeAiTestPanel();
  setActiveMode(joinBtn);
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
    shouldAcceptConnection: () => !(role === 'host' && onlineState?.started),
    onStatus: setOnlineStatus,
    onRoomCode: (roomCode) => {
      primaryCode.value = roomCode;
    },
    onOpen: (_session, _connection, connectionId) => {
      if (role === 'guest') {
        sendGuestHello();
        setOnlineStatus('Connected - waiting for host');
      } else {
        setOnlineStatus('Player connecting...');
      }
    },
    onMessage: (message, _session, _connection, connectionId) =>
      handleOnlineMessage(role, message, connectionId),
    onConnectionClose: (_session, _connection, connectionId) =>
      handleOnlineConnectionClose(role, connectionId),
    onClose: () => handleOnlineClose(),
  };
}

function handleOnlineMessage(role, message, connectionId) {
  if (!message || !onlineState || role !== onlineState.role) return;

  if (role === 'host') {
    if (message.type === 'hello') {
      registerGuest(connectionId, message);
    } else if (message.type === 'input') {
      const playerIndex = onlineState.connectionPlayerIndexes.get(connectionId);
      if (playerIndex != null) {
        onlineState.remoteCommands.set(playerIndex, normalizeCommands(message.commands));
      }
    }
    return;
  }

  if (message.type === 'start') {
    startGuestMatch(message.players, message.localPlayerIndex, message.settings).catch((err) =>
      setOnlineStatus(err.message || 'Could not start match')
    );
  } else if (message.type === 'roomFull') {
    setOnlineStatus('Room is full');
    closeOnlineSession(false);
  } else if (message.type === 'lobby') {
    updateGuestLobby(message);
  } else if (message.type === 'snapshot') {
    if (game) game.applySnapshot(message);
    else onlineState.pendingSnapshot = message;
  } else if (message.type === 'fx' && game) {
    const player = game.players[message.playerIndex];
    if (player) game.spawnPowerFX(player, message.fxType, true);
  } else if (message.type === 'wallFx' && game) {
    if (message.hit) game.spawnWallImpactFX(message.hit, true);
  } else if (message.type === 'sound') {
    if (game) game.playSoundEvent(message.event, true);
    else if (message.event) onlineState.pendingSoundEvents.push(message.event);
  } else if (message.type === 'matchEnded') {
    returnToMenu();
  }
}

async function startHostedMatch() {
  if (!onlineState || onlineState.role !== 'host' || onlineState.started) return;

  syncHostPlayerInfo();
  const guests = onlineState.guests.slice(0, MAX_GUESTS);
  const roster = currentHostRoster();
  if (guests.length < 1) {
    updateHostLobbyStatus();
    return;
  }

  const players = buildOnlinePlayers(roster);

  onlineState.connectionPlayerIndexes.clear();
  onlineState.remoteCommands.clear();
  guests.forEach((guest, index) => {
    const playerIndex = index + 1;
    onlineState.connectionPlayerIndexes.set(guest.connectionId, playerIndex);
    onlineState.remoteCommands.set(playerIndex, { ...EMPTY_COMMANDS });
  });

  const settings = normalizeMatchSettings(onlineState.matchSettings);

  await startOnlineGame('host', players, 0, settings);
  guests.forEach((guest, index) => {
    onlineSession?.sendTo(guest.connectionId, {
      type: 'start',
      players,
      localPlayerIndex: index + 1,
      settings,
    });
  });
}

async function startGuestMatch(players, localPlayerIndex = 1, settings = null) {
  if (!onlineState || onlineState.started) return;
  const sanitizedPlayers = sanitizePlayers(players);
  await startOnlineGame('guest', sanitizedPlayers, localPlayerIndex, settings);
}

async function startOnlineGame(role, players, localPlayerIndex = role === 'host' ? 0 : 1, settings = null) {
  try {
    await ensureAssets();
  } catch (err) {
    loadingText.textContent = 'Failed to load assets - serve this folder over HTTP.';
    throw err;
  }

  enterGameView();
  game?.dispose();
  localMatchState = null;

  const safeLocalPlayerIndex = clampPlayerIndex(localPlayerIndex, players.length);
  const matchSettings = normalizeMatchSettings(settings ?? onlineState?.matchSettings);
  game = new Game({
    scene,
    camera,
    assets,
    hud,
    scoreboard,
    audio: gameAudio,
    playerSpecs: players.map((player, index) => ({
      ...player,
      control: index === safeLocalPlayerIndex ? 'local' : 'remote',
    })),
    localPlayerIndex: safeLocalPlayerIndex,
    authoritative: role === 'host',
    inputProvider: (_player, index) =>
      onlineState?.remoteCommands.get(index) ?? EMPTY_COMMANDS,
    timeLimitSeconds: matchSettings.timeLimitSeconds,
    scoreLimit: matchSettings.scoreLimit,
  });

  if (role === 'host') {
    game.onFxEvent = (playerIndex, fxType) => {
      onlineSession?.send({ type: 'fx', playerIndex, fxType });
    };
    game.onWallFxEvent = (hit) => {
      onlineSession?.send({ type: 'wallFx', hit });
    };
    game.onSoundEvent = (event) => {
      onlineSession?.send({ type: 'sound', event });
    };
    installEditableMatchEndHandler();
  }

  onlineState.players = players;
  onlineState.matchSettings = normalizeMatchSettings(game.getMatchSettings());
  onlineState.started = true;
  setOnlineStatus(role === 'host' ? 'Match started' : 'Playing online');

  if (onlineState.pendingSnapshot) {
    game.applySnapshot(onlineState.pendingSnapshot);
    onlineState.pendingSnapshot = null;
  }
  for (const event of onlineState.pendingSoundEvents.splice(0)) {
    game.playSoundEvent(event, true);
  }
}

function enterGameView() {
  closeHostPanel({ focusCanvas: false });
  menu.classList.add('hidden');
  matchHint.classList.add('hidden');
  hudRoot.classList.remove('hidden');
  document.activeElement?.blur?.();
  canvas.focus?.();
}

function returnToMenu() {
  closeHostPanel({ focusCanvas: false });
  game?.dispose();
  game = null;
  localMatchState = null;
  hudRoot.classList.add('hidden');
  menu.classList.remove('hidden');
  closeLocalPanel();
  closeOnlineSession();
  resetOnlinePanel();
}

function handleHostPanelShortcut(event) {
  if (event.code !== 'Escape') return;

  if (isHostPanelOpen()) {
    event.preventDefault();
    event.stopPropagation();
    closeHostPanel();
    return;
  }

  if (!canOpenHostPanel()) return;
  event.preventDefault();
  event.stopPropagation();
  openHostPanel();
}

function canOpenHostPanel() {
  return Boolean(game && currentEditableMatchState());
}

function openHostPanel() {
  if (!canOpenHostPanel()) return;
  syncHostPanelHeading();
  syncHostPanelInputs();
  renderHostPanel();
  setHostPanelStatus('Ready');
  hostPanel.classList.remove('hidden');
  hostPanel.setAttribute('aria-hidden', 'false');
  setInputLocked(true);
  hostPanelClose.focus();
}

function closeHostPanel({ focusCanvas = true } = {}) {
  const wasOpen = isHostPanelOpen();
  hostPanel.classList.add('hidden');
  hostPanel.setAttribute('aria-hidden', 'true');
  setInputLocked(false);
  if (wasOpen && focusCanvas) canvas.focus?.();
}

function isHostPanelOpen() {
  return !hostPanel.classList.contains('hidden');
}

function renderHostPanel() {
  const matchState = currentEditableMatchState();
  if (!matchState?.players) return;

  hostRedRoster.replaceChildren();
  hostSpectatorRoster.replaceChildren();
  hostBlueRoster.replaceChildren();

  matchState.players.forEach((player, index) => {
    const normalized = normalizeStartedPlayer(player, index);
    const target = hostRosterForTeam(normalized.team);
    target.appendChild(createHostPlayerRow(normalized, index));
  });

  if (!hostRedRoster.childElementCount) hostRedRoster.appendChild(createHostEmpty('No red players'));
  if (!hostSpectatorRoster.childElementCount) {
    hostSpectatorRoster.appendChild(createHostEmpty('No spectators'));
  }
  if (!hostBlueRoster.childElementCount) hostBlueRoster.appendChild(createHostEmpty('No blue players'));
}

function createHostPlayerRow(player, index) {
  const row = document.createElement('div');
  row.className = 'host-player-row';
  row.draggable = true;
  row.dataset.playerIndex = String(index);
  row.addEventListener('dragstart', handleHostRosterDragStart);
  row.addEventListener('dragend', handleHostRosterDragEnd);

  const details = document.createElement('div');
  details.className = 'host-player-main';

  const name = document.createElement('div');
  name.className = 'host-player-name';
  name.textContent = player.nickname;

  const meta = document.createElement('div');
  meta.className = 'host-player-meta';
  const role = matchPanelRoleLabel(player, index);
  meta.textContent = `${heroName(player.heroKind)}${role ? ` - ${role}` : ''}`;

  details.appendChild(name);
  details.appendChild(meta);

  const controls = document.createElement('div');
  controls.className = 'host-player-controls';

  const heroes = document.createElement('div');
  heroes.className = 'host-hero-actions';
  heroes.appendChild(createHostHeroButton(index, player.heroKind, 'sam'));
  heroes.appendChild(createHostHeroButton(index, player.heroKind, 'tesla'));

  controls.appendChild(heroes);

  row.appendChild(details);
  row.appendChild(controls);
  return row;
}

function createHostHeroButton(playerIndex, currentHero, heroKind) {
  const normalizedHero = normalizeHero(heroKind);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hero-choice';
  button.classList.toggle('active', normalizeHero(currentHero) === normalizedHero);
  button.textContent = heroName(normalizedHero);
  button.disabled = normalizeHero(currentHero) === normalizedHero;
  button.addEventListener('click', () => setHostPlayerHero(playerIndex, normalizedHero));
  return button;
}

function createHostEmpty(text) {
  const empty = document.createElement('div');
  empty.className = 'host-empty';
  empty.textContent = text;
  return empty;
}

function hostRosterForTeam(team) {
  if (team === TEAM.BLUE) return hostBlueRoster;
  if (team === TEAM.SPECTATOR) return hostSpectatorRoster;
  return hostRedRoster;
}

function installHostRosterDropTarget(target, team) {
  target.dataset.team = String(team);
  target.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    target.classList.add('drag-over');
  });
  target.addEventListener('dragleave', (event) => {
    if (!target.contains(event.relatedTarget)) target.classList.remove('drag-over');
  });
  target.addEventListener('drop', (event) => {
    event.preventDefault();
    target.classList.remove('drag-over');
    const rawPlayerIndex = event.dataTransfer?.getData('text/plain') ?? '';
    if (!rawPlayerIndex) return;
    const playerIndex = Number(rawPlayerIndex);
    if (Number.isInteger(playerIndex)) stageHostPlayerTeam(playerIndex, team);
  });
}

function handleHostRosterDragStart(event) {
  const row = event.currentTarget;
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', row.dataset.playerIndex || '');
  row.classList.add('dragging');
}

function handleHostRosterDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  hostRedRoster.classList.remove('drag-over');
  hostSpectatorRoster.classList.remove('drag-over');
  hostBlueRoster.classList.remove('drag-over');
}

function stageHostPlayerTeam(playerIndex, team) {
  const matchState = currentEditableMatchState();
  if (!game || !matchState?.players?.[playerIndex]) return;

  const roster = matchState.players.map((player, index) => ({
    ...normalizeStartedPlayer(player, index),
  }));
  roster[playerIndex].team = normalizeTeam(team, roster[playerIndex].team);

  const assigned = assignPlayerSpawns(roster);
  matchState.players = assigned;
  renderHostPanel();
  setHostPanelStatus('Roster staged - restart to apply');
}

function setHostPlayerHero(playerIndex, heroKind) {
  const matchState = currentEditableMatchState();
  if (!game || !matchState?.players?.[playerIndex]) return;

  const roster = matchState.players.map((player, index) => ({
    ...normalizeStartedPlayer(player, index),
  }));
  roster[playerIndex].heroKind = normalizeHero(heroKind);

  const assigned = assignPlayerSpawns(roster);
  matchState.players = assigned;
  renderHostPanel();
  setHostPanelStatus('Hero staged - restart to apply');
}

function syncStartedRosterToOnlineState(players) {
  if (!onlineState) return;
  if (onlineState.hostPlayer && players[0]) {
    Object.assign(onlineState.hostPlayer, players[0]);
  }
  for (let i = 0; i < onlineState.guests.length; i++) {
    if (players[i + 1]) Object.assign(onlineState.guests[i], players[i + 1]);
  }
}

function normalizeStartedPlayer(player, index) {
  return {
    nickname: normalizeNickname(player?.nickname, `Player ${index + 1}`),
    heroKind: normalizeHero(player?.heroKind),
    team: normalizeTeam(player?.team, defaultTeamForPlayerIndex(index)),
    control: normalizeControl(player?.control, index),
    spawnX: finiteOr(player?.spawnX, 0),
    spawnZ: finiteOr(player?.spawnZ, index === 0 ? PLAYER_SPAWN_Z : -PLAYER_SPAWN_Z),
  };
}

function syncHostPanelInputs() {
  const matchState = currentEditableMatchState();
  if (!game || !matchState) return;
  const settings = normalizeMatchSettings(game.getMatchSettings());
  matchState.matchSettings = settings;
  hostTimeLimit.value = formatTimeLimitMinutes(settings.timeLimitSeconds);
  hostScoreLimit.value = String(settings.scoreLimit);
}

function applyHostMatchSettings() {
  const matchState = currentEditableMatchState();
  if (!game || !matchState) return;

  const current = normalizeMatchSettings(game.getMatchSettings());
  const settings = normalizeMatchSettings({
    timeLimitSeconds: parseTimeLimitSeconds(hostTimeLimit.value, current.timeLimitSeconds),
    scoreLimit: parseScoreLimit(hostScoreLimit.value, current.scoreLimit),
  });
  matchState.matchSettings = settings;
  game.setMatchSettings(settings);
  syncHostPanelInputs();
  setHostPanelStatus('Settings updated');
}

function restartCurrentMatch() {
  const matchState = currentEditableMatchState();
  if (!game || !matchState) return;

  if (isHostPanelOpen()) {
    applyHostMatchSettings();
  }

  const roster = assignPlayerSpawns(
    matchState.players.map((player, index) => ({
      ...normalizeStartedPlayer(player, index),
    }))
  );
  matchState.players = roster;
  if (currentMatchPanelMode() === 'online-host') syncStartedRosterToOnlineState(roster);
  game.setPlayerLayout(roster);

  matchState.matchSettings = normalizeMatchSettings(game.getMatchSettings());
  game.restartMatch();
  installEditableMatchEndHandler();
  closeHostPanel();
}

function leaveCurrentGame() {
  if (onlineState?.role === 'host' && onlineState.started) {
    onlineSession?.send({ type: 'matchEnded' });
  }
  closeHostPanel({ focusCanvas: false });
  returnToMenu();
}

function setHostPanelStatus(text) {
  hostPanelStatus.textContent = text;
}

function installEditableMatchEndHandler() {
  if (!game) return;
  game.onMatchEnd = handleEditableMatchFinished;
  matchHint.classList.remove('hidden');
}

function handleEditableMatchFinished() {
  if (!game || !currentEditableMatchState()) return;
  game.onMatchEnd = null;
  openHostPanel();
  setHostPanelStatus('Match finished - restart when ready');
}

function currentEditableMatchState() {
  const mode = currentMatchPanelMode();
  if (mode === 'local') return localMatchState;
  if (mode === 'online-host') return onlineState;
  return null;
}

function currentMatchPanelMode() {
  if (!game) return null;
  if (localMatchState?.started) return 'local';
  if (onlineState?.role === 'host' && onlineState.started) return 'online-host';
  return null;
}

function syncHostPanelHeading() {
  const mode = currentMatchPanelMode();
  hostPanelKicker.textContent = mode === 'local' ? 'Local Match' : 'Host Room';
  hostPanelTitle.textContent = 'Match Controls';
}

function matchPanelRoleLabel(player, index) {
  const mode = currentMatchPanelMode();
  if (mode === 'local') return player.control === 'local' ? 'You' : 'AI';
  if (mode === 'online-host') return index === 0 ? 'Host' : 'Guest';
  return '';
}

function handleOnlineClose() {
  const wasPlaying = onlineState?.started;
  closeHostPanel({ focusCanvas: false });
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

function handleOnlineConnectionClose(role, connectionId) {
  if (role !== 'host' || !onlineState) return;

  if (onlineState.started) {
    onlineSession?.send({ type: 'matchEnded' });
    onlineSession?.close();
    handleOnlineClose();
    return;
  }

  onlineState.guests = onlineState.guests.filter((guest) => guest.connectionId !== connectionId);
  updateHostLobbyStatus();
}

function createOnlineState(role) {
  return {
    role,
    started: false,
    hostPlayer: {
      connectionId: 'host',
      nickname: currentNickname(),
      heroKind: normalizeHero(selectedHero),
      team: TEAM.RED,
    },
    guests: [],
    lobbyPlayers: [],
    guestYouIndex: null,
    remoteCommands: new Map(),
    connectionPlayerIndexes: new Map(),
    inputSeq: 0,
    inputAccumulator: 0,
    snapshotSeq: 0,
    snapshotAccumulator: 0,
    pendingSnapshot: null,
    pendingSoundEvents: [],
    players: null,
    matchSettings: defaultMatchSettings(),
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
  syncHostPlayerInfo();
  onlinePanel.classList.remove('hidden');
  primaryCodeLabel.textContent = 'Room Code';
  primaryCode.value = '';
  primaryCode.readOnly = true;
  copyPrimaryBtn.classList.remove('hidden');
  startOnlineBtn.classList.remove('hidden');
  startOnlineBtn.disabled = true;
  startOnlineBtn.textContent = 'Start Match';
  joinRoomBtn.classList.add('hidden');
  renderOnlineLobby();
}

function configureJoinPanel() {
  onlinePanel.classList.remove('hidden');
  primaryCodeLabel.textContent = 'Room Code';
  primaryCode.value = '';
  primaryCode.readOnly = false;
  copyPrimaryBtn.classList.add('hidden');
  startOnlineBtn.classList.add('hidden');
  startOnlineBtn.disabled = true;
  joinRoomBtn.classList.remove('hidden');
  renderOnlineLobby();
  setOnlineStatus('Enter room code');
  primaryCode.focus();
}

function resetOnlinePanel() {
  onlinePanel.classList.add('hidden');
  primaryCode.value = '';
  startOnlineBtn.classList.add('hidden');
  startOnlineBtn.disabled = true;
  onlineRedRoster.replaceChildren();
  onlineBlueRoster.replaceChildren();
  setOnlineStatus('Idle');
  if (!startBtn.classList.contains('selected')) setActiveMode(null);
}

function setOnlineStatus(text) {
  onlineStatus.textContent = text;
}

function registerGuest(connectionId, message) {
  if (!connectionId || !onlineState || onlineState.role !== 'host' || onlineState.started) return;

  const normalizedHero = normalizeHero(message?.heroKind);
  const nickname = normalizeNickname(message?.nickname, `Guest ${onlineState.guests.length + 1}`);
  const existingGuest = onlineState.guests.find((guest) => guest.connectionId === connectionId);
  if (existingGuest) {
    existingGuest.heroKind = normalizedHero;
    existingGuest.nickname = nickname;
    updateHostLobbyStatus();
    return;
  }

  if (onlineState.guests.length >= MAX_GUESTS) {
    onlineSession?.sendTo(connectionId, { type: 'roomFull' });
    return;
  }

  onlineState.guests.push({
    connectionId,
    nickname,
    heroKind: normalizedHero,
    team: defaultTeamForPlayerIndex(onlineState.guests.length + 1),
  });
  updateHostLobbyStatus();
}

function updateHostLobbyStatus() {
  if (!onlineState || onlineState.role !== 'host') return;

  syncHostPlayerInfo();
  renderOnlineLobby();

  const guestCount = onlineState.guests.length;
  const playerCount = guestCount + 1;
  const canStart = guestCount > 0 && !onlineState.started;

  startOnlineBtn.disabled = !canStart;
  startOnlineBtn.textContent = playerCount > 2 ? `Start ${playerCount} Players` : 'Start Match';

  if (guestCount === 0) {
    setOnlineStatus(`Waiting for players (0/${MAX_GUESTS})`);
  } else {
    setOnlineStatus(`${guestCount}/${MAX_GUESTS} joined`);
  }

  broadcastLobbyState();
}

function syncLocalLobbyInfo() {
  if (!onlineState || onlineState.started) return;

  if (onlineState.role === 'host') {
    syncHostPlayerInfo();
    updateHostLobbyStatus();
  } else if (onlineState.role === 'guest' && onlineSession) {
    sendGuestHello();
  }
}

function syncHostPlayerInfo() {
  if (!onlineState?.hostPlayer) return;
  onlineState.hostPlayer.nickname = currentNickname();
  onlineState.hostPlayer.heroKind = normalizeHero(selectedHero);
}

function sendGuestHello() {
  if (!onlineSession || onlineState?.role !== 'guest' || onlineState.started) return;
  onlineSession.send({
    type: 'hello',
    nickname: currentNickname(),
    heroKind: normalizeHero(selectedHero),
  });
}

function broadcastLobbyState() {
  if (!onlineSession || onlineState?.role !== 'host' || onlineState.started) return;

  const payload = {
    type: 'lobby',
    players: publicLobbyPlayers(currentHostRoster()),
    canStart: !startOnlineBtn.disabled,
    status: onlineStatus.textContent,
  };
  // Roster order is [host, ...guests]; tell each guest which row is theirs.
  onlineState.guests.forEach((guest, index) => {
    onlineSession?.sendTo(guest.connectionId, { ...payload, youIndex: index + 1 });
  });
}

function updateGuestLobby(message) {
  if (!onlineState || onlineState.role !== 'guest' || onlineState.started) return;

  onlineState.lobbyPlayers = sanitizeLobbyPlayers(message.players);
  const youIndex = Number(message.youIndex);
  onlineState.guestYouIndex =
    Number.isInteger(youIndex) && youIndex >= 0 && youIndex < onlineState.lobbyPlayers.length
      ? youIndex
      : null;
  joinRoomBtn.classList.add('hidden');
  primaryCode.readOnly = true;
  renderOnlineLobby();
  setOnlineStatus(message.status || 'Waiting for host');
}

function currentHostRoster() {
  if (!onlineState) return [];
  return [onlineState.hostPlayer, ...onlineState.guests].filter(Boolean);
}

function publicLobbyPlayers(players) {
  return players.map((player, index) => ({
    nickname: normalizeNickname(player?.nickname, `Player ${index + 1}`),
    heroKind: normalizeHero(player?.heroKind),
    team: normalizeTeam(player?.team, defaultTeamForPlayerIndex(index)),
    isHost: player?.connectionId === 'host' || Boolean(player?.isHost),
  }));
}

function sanitizeLobbyPlayers(players) {
  if (!Array.isArray(players)) return [];
  return players.slice(0, MAX_ONLINE_PLAYERS).map((player, index) => ({
    nickname: normalizeNickname(player?.nickname, `Player ${index + 1}`),
    heroKind: normalizeHero(player?.heroKind),
    team: normalizeTeam(player?.team, defaultTeamForPlayerIndex(index)),
    isHost: Boolean(player?.isHost),
  }));
}

function renderLocalRoster() {
  localRedRoster.replaceChildren();
  localBlueRoster.replaceChildren();

  for (const slot of localRosterSlots(selectedLocalTeamSize)) {
    const row = document.createElement('div');
    row.className = 'local-player';

    const name = document.createElement('div');
    name.className = 'local-player-name';
    name.textContent = slot.name;
    if (slot.control === 'local') name.appendChild(createRowTag('You'));

    const heroes = document.createElement('div');
    heroes.className = 'hero-toggle';
    heroes.appendChild(createLocalHeroButton(slot.selectionIndex, 'sam'));
    heroes.appendChild(createLocalHeroButton(slot.selectionIndex, 'tesla'));

    row.appendChild(name);
    row.appendChild(heroes);
    const roster = slot.team === TEAM.BLUE ? localBlueRoster : localRedRoster;
    roster.appendChild(row);
  }
}

function createLocalHeroButton(selectionIndex, heroKind) {
  const normalizedHero = normalizeHero(heroKind);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hero-choice';
  button.classList.toggle('active', localHeroSelections[selectionIndex] === normalizedHero);
  button.setAttribute('aria-pressed', localHeroSelections[selectionIndex] === normalizedHero ? 'true' : 'false');
  button.textContent = heroName(normalizedHero);
  button.title = HERO_POWERS[normalizedHero];
  button.addEventListener('click', () => {
    localHeroSelections[selectionIndex] = normalizedHero;
    if (selectionIndex === 0) setSelectedHero(normalizedHero);
    renderLocalRoster();
  });
  return button;
}

function localRosterSlots(teamSize) {
  const playersPerTeam = normalizeLocalTeamSize(teamSize);
  const slots = [
    {
      selectionIndex: 0,
      name: currentNickname(),
      team: TEAM.RED,
      teamSlot: 0,
      control: 'local',
    },
    {
      selectionIndex: 2,
      name: 'AI Opponent',
      team: TEAM.BLUE,
      teamSlot: 0,
      control: 'ai',
    },
  ];

  if (playersPerTeam === 2) {
    slots.splice(1, 0, {
      selectionIndex: 1,
      name: 'AI Teammate',
      team: TEAM.RED,
      teamSlot: 1,
      control: 'ai',
    });
    slots.push({
      selectionIndex: 3,
      name: 'AI Opponent 2',
      team: TEAM.BLUE,
      teamSlot: 1,
      control: 'ai',
    });
  }

  return slots;
}

function renderOnlineLobby() {
  if (!onlineState || onlineState.started) return;

  if (onlineState.role === 'host') {
    renderOnlineRoster(currentHostRoster(), { editable: true, youIndex: 0 });
  } else if (onlineState.lobbyPlayers.length) {
    renderOnlineRoster(onlineState.lobbyPlayers, {
      editable: false,
      youIndex: onlineState.guestYouIndex,
    });
  } else {
    // Not connected yet - show yourself so hero choice works before joining.
    renderOnlineRoster(
      [{ nickname: currentNickname(), heroKind: normalizeHero(selectedHero), team: TEAM.RED }],
      { editable: false, youIndex: 0 }
    );
  }
}

function renderOnlineRoster(players, { editable, youIndex }) {
  onlineRedRoster.replaceChildren();
  onlineBlueRoster.replaceChildren();

  players.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = 'local-player';

    const name = document.createElement('div');
    name.className = 'local-player-name';
    name.textContent = normalizeNickname(player.nickname, `Player ${index + 1}`);
    if (index === youIndex) name.appendChild(createRowTag('You'));
    if (player.isHost || player.connectionId === 'host') name.appendChild(createRowTag('Host', 'host'));

    const controls = document.createElement('div');
    controls.className = 'local-player-controls';
    if (index === youIndex) {
      const heroes = document.createElement('div');
      heroes.className = 'hero-toggle';
      heroes.appendChild(createOnlineHeroButton('sam'));
      heroes.appendChild(createOnlineHeroButton('tesla'));
      controls.appendChild(heroes);
    } else {
      const hero = document.createElement('span');
      hero.className = 'hero-chip';
      hero.textContent = heroName(player.heroKind);
      hero.title = HERO_POWERS[normalizeHero(player.heroKind)];
      controls.appendChild(hero);
    }
    if (editable) controls.appendChild(createTeamSwitchButton(player));

    row.appendChild(name);
    row.appendChild(controls);
    const roster = normalizeTeam(player.team, TEAM.RED) === TEAM.BLUE ? onlineBlueRoster : onlineRedRoster;
    roster.appendChild(row);
  });

  appendRosterPlaceholder(onlineRedRoster);
  appendRosterPlaceholder(onlineBlueRoster);
}

function createRowTag(label, variant = '') {
  const tag = document.createElement('span');
  tag.className = variant ? `local-player-tag ${variant}` : 'local-player-tag';
  tag.textContent = label;
  return tag;
}

function createOnlineHeroButton(heroKind) {
  const normalizedHero = normalizeHero(heroKind);
  const active = normalizeHero(selectedHero) === normalizedHero;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hero-choice';
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  button.textContent = heroName(normalizedHero);
  button.title = HERO_POWERS[normalizedHero];
  button.addEventListener('click', () => {
    setSelectedHero(normalizedHero);
    if (onlineState?.role === 'guest') {
      const you = onlineState.lobbyPlayers[onlineState.guestYouIndex];
      if (you) you.heroKind = normalizedHero;
      renderOnlineLobby();
    }
    syncLocalLobbyInfo();
  });
  return button;
}

function createTeamSwitchButton(player) {
  const targetTeam = normalizeTeam(player.team, TEAM.RED) === TEAM.BLUE ? TEAM.RED : TEAM.BLUE;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'team-move';
  button.textContent = '⇄';
  button.title = `Move to ${teamName(targetTeam)}`;
  button.setAttribute('aria-label', `Move ${player.nickname} to ${teamName(targetTeam)}`);
  button.addEventListener('click', () => {
    player.team = targetTeam;
    updateHostLobbyStatus();
  });
  return button;
}

function appendRosterPlaceholder(roster) {
  if (roster.childElementCount) return;
  const placeholder = document.createElement('div');
  placeholder.className = 'local-player placeholder';
  placeholder.textContent = 'Waiting for players...';
  roster.appendChild(placeholder);
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
  if (heroKind === 'tesla') return 'tesla';
  return 'sam';
}

function heroName(heroKind) {
  return HERO_LABELS[normalizeHero(heroKind)];
}

function normalizeLocalTeamSize(teamSize) {
  return Number(teamSize) === 2 ? 2 : 1;
}

function normalizeLocalDifficulty(difficulty) {
  return difficulty === 'easy' || difficulty === 'hard' ? difficulty : 'medium';
}

function buildLocalPlayers(teamSize) {
  return localRosterSlots(teamSize).map((slot) =>
    localPlayerSpec(
      slot.team,
      slot.teamSlot,
      localHeroSelections[slot.selectionIndex],
      slot.control,
      slot.name
    )
  );
}

function localPlayerSpec(team, slot, heroKind, control, nickname) {
  const spawn = TEAM_SPAWNS[team][slot] ?? TEAM_SPAWNS[team][0];
  return {
    nickname,
    heroKind,
    team,
    spawnX: spawn.x,
    spawnZ: spawn.z,
    control,
  };
}

function generateDefaultNickname() {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return `Player ${100 + (bytes[0] % 900)}`;
}

function currentNickname() {
  return normalizeNickname(nicknameInput.value, defaultNickname);
}

function normalizeNickname(value, fallback = 'Player') {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, NICKNAME_MAX_LENGTH);
  return normalized || fallback;
}

function defaultMatchSettings() {
  return {
    timeLimitSeconds: MATCH.duration,
    scoreLimit: MATCH.scoreLimit,
  };
}

function normalizeMatchSettings(settings = defaultMatchSettings()) {
  return {
    timeLimitSeconds: normalizeTimeLimitSeconds(settings?.timeLimitSeconds, MATCH.duration),
    scoreLimit: normalizeScoreLimit(settings?.scoreLimit, MATCH.scoreLimit),
  };
}

function normalizeTimeLimitSeconds(value, fallback) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return fallback;
  return clamp(Math.round(seconds), MIN_TIME_LIMIT_SECONDS, MAX_TIME_LIMIT_SECONDS);
}

function normalizeScoreLimit(value, fallback) {
  const goals = Math.floor(Number(value));
  if (!Number.isFinite(goals)) return fallback;
  return clamp(goals, 0, MAX_SCORE_LIMIT);
}

function parseTimeLimitSeconds(value, fallback) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return fallback;
  return normalizeTimeLimitSeconds(minutes * 60, fallback);
}

function parseScoreLimit(value, fallback) {
  return normalizeScoreLimit(value, fallback);
}

function formatTimeLimitMinutes(seconds) {
  const minutes = normalizeTimeLimitSeconds(seconds, MATCH.duration) / 60;
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeControl(control, index = 0) {
  if (control === 'local' || control === 'remote' || control === 'ai') return control;
  if (currentMatchPanelMode() === 'online-host') return index === 0 ? 'local' : 'remote';
  return index === 0 ? 'local' : 'ai';
}

function normalizeTeam(team, fallback = TEAM.RED) {
  const parsed = Number(team);
  if (parsed === TEAM.SPECTATOR) return TEAM.SPECTATOR;
  return parsed === TEAM.BLUE ? TEAM.BLUE : parsed === TEAM.RED ? TEAM.RED : fallback;
}

function defaultTeamForPlayerIndex(index) {
  return index % 2 === 0 ? TEAM.RED : TEAM.BLUE;
}

function teamName(team) {
  if (team === TEAM.SPECTATOR) return 'Spec';
  return team === TEAM.BLUE ? 'Blue' : 'Red';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampPlayerIndex(index, playerCount) {
  const parsed = Number(index);
  if (!Number.isInteger(parsed)) return 0;
  return Math.max(0, Math.min(playerCount - 1, parsed));
}

function buildOnlinePlayers(roster) {
  if (!Array.isArray(roster) || roster.length < 2 || roster.length > MAX_ONLINE_PLAYERS) {
    throw new Error('Invalid match setup');
  }

  const normalizedRoster = roster.map((player, index) => ({
    nickname: normalizeNickname(player?.nickname, `Player ${index + 1}`),
    heroKind: normalizeHero(player?.heroKind),
    team: normalizeTeam(player?.team, defaultTeamForPlayerIndex(index)),
  }));

  return assignPlayerSpawns(normalizedRoster);
}

function assignPlayerSpawns(players) {
  const teamSlots = { [TEAM.RED]: 0, [TEAM.BLUE]: 0 };
  return players.map((player, index) => {
    const team = normalizeTeam(player.team, defaultTeamForPlayerIndex(index));
    if (team === TEAM.SPECTATOR) {
      return {
        ...player,
        nickname: normalizeNickname(player.nickname, `Player ${index + 1}`),
        heroKind: normalizeHero(player.heroKind),
        team,
        spawnX: 0,
        spawnZ: 0,
      };
    }

    const slot = teamSlots[team]++;
    const spawn = TEAM_SPAWNS[team][slot] ?? TEAM_SPAWNS[team][TEAM_SPAWNS[team].length - 1];
    return {
      ...player,
      nickname: normalizeNickname(player.nickname, `Player ${index + 1}`),
      heroKind: normalizeHero(player.heroKind),
      team,
      spawnX: spawn.x,
      spawnZ: spawn.z,
    };
  });
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
  if (!Array.isArray(players) || players.length < 2 || players.length > MAX_ONLINE_PLAYERS) {
    throw new Error('Invalid match setup');
  }

  return buildOnlinePlayers(players);
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
        playerIndex: game?.localPlayerIndex,
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
  if (scene) outlineEffect.render(scene, camera);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
