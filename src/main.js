import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { loadAssets } from './assets.js';
import { createRenderer, createCamera, buildWorld } from './scene.js';
import { Game } from './game.js?v=ui-focused-9';
import { readCommands, setGameplayActive, setInputLocked } from './input.js?v=ui-focused-9';
import {
  createHostSession,
  createGuestSession,
  normalizeRoomCode,
  MAX_GUESTS,
  ROOM_CODE_LENGTH,
} from './online.js?v=ui-focused-9';
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
const NICKNAME_STORAGE_KEY = 'soccer-pucks-nickname';
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
const loadingErrorActions = document.getElementById('loading-error-actions');
const loadingRetryBtn = document.getElementById('loading-retry-btn');
const loadingBackBtn = document.getElementById('loading-back-btn');
const matchHint = document.getElementById('match-hint');
const soundControls = document.getElementById('sound-controls');
const soundToggle = document.getElementById('sound-toggle');
const soundVolume = document.getElementById('sound-volume');
const uiToast = document.getElementById('ui-toast');

const nicknameInput = document.getElementById('nickname-input');
const nicknameField = document.getElementById('nickname-field');
const menuSubtitle = document.getElementById('menu-subtitle');
const homeActions = document.getElementById('home-actions');
const startBtn = document.getElementById('start-btn');
const onlineBtn = document.getElementById('online-btn');
const onlineChoice = document.getElementById('online-choice');
const onlineChoiceTitle = document.getElementById('online-choice-title');
const cancelOnlineChoiceBtn = document.getElementById('cancel-online-choice-btn');
const hostBtn = document.getElementById('host-btn');
const joinBtn = document.getElementById('join-btn');
const localPanel = document.getElementById('local-panel');
const localPanelTitle = document.getElementById('local-panel-title');
const startLocalBtn = document.getElementById('start-local-btn');
const cancelLocalBtn = document.getElementById('cancel-local-btn');
const localRedRoster = document.getElementById('local-red-roster');
const localBlueRoster = document.getElementById('local-blue-roster');
const onlinePanel = document.getElementById('online-panel');
const onlinePanelTitle = document.getElementById('online-panel-title');
const onlinePanelDescription = document.getElementById('online-panel-description');
const onlineLobby = document.getElementById('online-lobby');
const onlineStatus = document.getElementById('online-status');
const primaryCode = document.getElementById('primary-code');
const primaryCodeLabel = document.getElementById('primary-code-label');
const onlineCodeHelp = document.getElementById('online-code-help');
const copyPrimaryBtn = document.getElementById('copy-primary-btn');
const startOnlineBtn = document.getElementById('start-online-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const cancelOnlineBtn = document.getElementById('cancel-online-btn');
const onlineRedRoster = document.getElementById('online-red-roster');
const onlineSpectatorRoster = document.getElementById('online-spectator-roster');
const onlineBlueRoster = document.getElementById('online-blue-roster');
const aiTestBtn = document.getElementById('ai-test-btn');
const aiTestPanel = document.getElementById('ai-test-panel');
const aiTestTitle = document.getElementById('ai-test-title');
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
const hostPanelAdvanced = document.getElementById('host-panel-advanced');
const hostAdvancedToggle = document.getElementById('host-advanced-toggle');
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
  powerBar: document.getElementById('power-bar'),
  matchStatus: document.getElementById('match-status'),
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
nicknameInput.value = loadSavedNickname() || defaultNickname;
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
  saveNickname(nicknameInput.value);
  if (isLocalPanelOpen()) renderLocalRoster();
  syncLocalLobbyInfo();
});

let selectedHero = 'sam';
const localHeroSelections = ['sam', 'tesla', 'tesla', 'sam'];

function setSelectedHero(heroKind) {
  selectedHero = normalizeHero(heroKind);
  localHeroSelections[0] = selectedHero;
}

let currentMenuScreen = 'home';

function showMenuScreen(screen, { focus = true } = {}) {
  currentMenuScreen = screen;
  menu.dataset.view = screen;
  menu.scrollTop = 0;

  homeActions.classList.toggle('hidden', screen !== 'home');
  localPanel.classList.toggle('hidden', screen !== 'solo');
  onlineChoice.classList.toggle('hidden', screen !== 'online-choice');
  onlinePanel.classList.toggle('hidden', screen !== 'online-room');
  aiTestPanel.classList.toggle('hidden', screen !== 'ai-tests');
  nicknameField.classList.toggle('hidden', !['solo', 'online-choice', 'online-room'].includes(screen));

  const subtitle = {
    home: 'Fast 1v1 and 2v2 arcade soccer',
    solo: 'Solo match setup',
    'online-choice': 'Play with friends',
    'online-room': 'Online room',
    'ai-tests': 'AI simulation tools',
  }[screen];
  if (subtitle) menuSubtitle.textContent = subtitle;

  if (!focus) return;
  const focusTarget = {
    home: startBtn,
    solo: localPanelTitle,
    'online-choice': onlineChoiceTitle,
    'online-room': onlinePanelTitle,
    'ai-tests': aiTestTitle,
  }[screen];
  queueMicrotask(() => focusTarget?.focus?.());
}

function showHomeScreen({ focus = true } = {}) {
  showMenuScreen('home', { focus });
}

function showOnlineChoiceScreen({ focus = true } = {}) {
  closeOnlineSession();
  resetOnlinePanel();
  showMenuScreen('online-choice', { focus });
}

let selectedLocalTeamSize = 1;
let selectedLocalTeam = TEAM.RED;
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

for (const btn of document.querySelectorAll('#local-team-pick .team-choice-btn')) {
  btn.addEventListener('click', () => {
    const previous = document.querySelector('#local-team-pick .team-choice-btn.selected');
    previous?.classList.remove('selected');
    previous?.setAttribute('aria-pressed', 'false');
    btn.classList.add('selected');
    btn.setAttribute('aria-pressed', 'true');
    selectedLocalTeam = btn.dataset.localTeam === 'blue' ? TEAM.BLUE : TEAM.RED;
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
let assetRetryAction = null;
let lastTime = performance.now();
let localMatchState = null;
let onlineSession = null;
let onlineState = null;
let onlineFlowId = 0;
let hostPanelFinished = false;
let hostPanelResultText = '';

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function ensureAssets(retryAction = null) {
  if (assets) {
    assetRetryAction = null;
    return;
  }
  if (retryAction) assetRetryAction = retryAction;
  setLoadingBackgroundInert(true);
  loading.classList.remove('error');
  loading.classList.remove('hidden');
  loading.setAttribute('aria-busy', 'true');
  loadingErrorActions.classList.add('hidden');
  loadingText.textContent = 'Loading stadium...';
  queueMicrotask(() => loadingText.focus());
  try {
    assets = await loadAssets();
    ({ scene, scoreboard } = buildWorld(assets, outlineEffect));
    assetRetryAction = null;
    loading.setAttribute('aria-busy', 'false');
    loading.classList.add('hidden');
    setLoadingBackgroundInert(false);
  } catch (err) {
    assets = null;
    loading.classList.add('error');
    loading.setAttribute('aria-busy', 'false');
    loadingText.textContent = 'Could not load the stadium. Check your connection and try again.';
    loadingErrorActions.classList.remove('hidden');
    queueMicrotask(() => loadingRetryBtn.focus());
    throw err;
  }
}

function setLoadingBackgroundInert(inert) {
  canvas.inert = inert;
  menu.inert = inert;
  hudRoot.inert = inert;
  soundControls.inert = inert;
}

function dismissLoadingOverlay() {
  loading.classList.add('hidden');
  loading.classList.remove('error');
  loading.setAttribute('aria-busy', 'false');
  loadingErrorActions.classList.add('hidden');
  setLoadingBackgroundInert(false);
  assetRetryAction = null;
}

startBtn.addEventListener('click', showLocalPanel);
onlineBtn.addEventListener('click', () => showOnlineChoiceScreen());
cancelOnlineChoiceBtn.addEventListener('click', () => showHomeScreen());
startLocalBtn.addEventListener('click', startLocalMatch);
cancelLocalBtn.addEventListener('click', closeLocalPanel);
aiTestBtn.addEventListener('click', showAiTestPanel);
runAiTestsBtn.addEventListener('click', runAiTests);
closeAiTestsBtn.addEventListener('click', closeAiTestPanel);
hostBtn.addEventListener('click', startHostFlow);
joinBtn.addEventListener('click', showJoinPanel);
copyPrimaryBtn.addEventListener('click', () => copyCode(primaryCode, 'Code copied'));
startOnlineBtn.addEventListener('click', () => {
  startHostedMatch().catch((err) => setOnlineStatus(err.message || 'Could not start match'));
});
joinRoomBtn.addEventListener('click', joinRoom);
cancelOnlineBtn.addEventListener('click', () => {
  closeOnlineSession();
  resetOnlinePanel();
  showMenuScreen('online-choice');
});
hostPanelClose.addEventListener('click', () => closeHostPanel());
matchHint.addEventListener('click', () => openHostPanel());
hostRestartBtn.addEventListener('click', restartCurrentMatch);
hostAdvancedToggle.addEventListener('click', toggleHostAdvanced);
hostLeaveBtn.addEventListener('click', leaveCurrentGame);
hostTimeLimit.addEventListener('change', stageHostMatchSettings);
hostScoreLimit.addEventListener('change', stageHostMatchSettings);
window.addEventListener('keydown', handleHostPanelShortcut, true);
loadingRetryBtn.addEventListener('click', async () => {
  try {
    const retryAction = assetRetryAction;
    if (retryAction) {
      const retried = await retryAction();
      if (retried === false && !loading.classList.contains('hidden')) {
        dismissLoadingOverlay();
        showMenuScreen(currentMenuScreen);
      }
    }
    else {
      await ensureAssets();
      showToast('Stadium ready - start the match when ready');
      showMenuScreen(currentMenuScreen);
    }
  } catch (err) {
    console.error(err);
  }
});
loadingBackBtn.addEventListener('click', () => {
  const leavePendingGuestStart = Boolean(
    assetRetryAction && onlineState?.role === 'guest' && !onlineState.started
  );
  dismissLoadingOverlay();
  if (leavePendingGuestStart) {
    closeOnlineSession();
    resetOnlinePanel();
    showMenuScreen('online-choice');
    showToast('Left the match after the loading error');
  } else {
    showMenuScreen(currentMenuScreen);
  }
});
primaryCode.addEventListener('input', () => {
  const normalized = normalizeRoomCode(primaryCode.value);
  if (primaryCode.value !== normalized) primaryCode.value = normalized;
  updateJoinCodeValidity();
});
primaryCode.addEventListener('keydown', (event) => {
  if (event.code === 'Enter' && !joinRoomBtn.classList.contains('hidden')) {
    event.preventDefault();
    if (joinRoomBtn.disabled) {
      if (!primaryCode.hasAttribute('aria-busy')) validateRoomCode();
      return;
    }
    joinRoom();
  }
});
showHomeScreen({ focus: false });
replayStartupAction();

function replayStartupAction() {
  const startup = window.__soccerPucksStartup;
  const action = typeof startup?.consume === 'function' ? startup.consume() : null;
  startBtn.removeAttribute('aria-busy');
  onlineBtn.removeAttribute('aria-busy');
  delete window.__soccerPucksStartup;

  if (action === 'solo') showLocalPanel();
  else if (action === 'online') showOnlineChoiceScreen();
}

function showLocalPanel() {
  closeOnlineSession();
  resetOnlinePanel();
  aiTestPanel.classList.add('hidden');
  localHeroSelections[0] = normalizeHero(selectedHero);
  renderLocalRoster();
  showMenuScreen('solo');
}

let aiSimModule = null;
async function loadAiSimModule() {
  if (!aiSimModule) aiSimModule = await import('../ai-sim-test.mjs');
  return aiSimModule;
}

async function showAiTestPanel() {
  closeOnlineSession();
  resetOnlinePanel();
  showMenuScreen('ai-tests');

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
  if (currentMenuScreen === 'ai-tests') showHomeScreen();
  else aiTestPanel.classList.add('hidden');
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
    await ensureAssets(() => watchAiScenario(scenario));
  } catch (err) {
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
  if (currentMenuScreen === 'solo') showHomeScreen();
  else localPanel.classList.add('hidden');
}

function isLocalPanelOpen() {
  return currentMenuScreen === 'solo' && !localPanel.classList.contains('hidden');
}

async function startLocalMatch() {
  closeOnlineSession();
  resetOnlinePanel();

  try {
    await ensureAssets(startLocalMatch);
  } catch (err) {
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
  if (!ensureWebRtcAvailable()) return;

  closeOnlineSession();
  const state = createOnlineState('host');
  onlineState = state;
  const flowId = onlineFlowId;
  configureHostPanel();

  try {
    setOnlineStatus('Creating room...');
    const session = await createHostSession(createOnlineHandlers('host', flowId, state));
    if (!isCurrentOnlineFlow(flowId, state)) {
      session.close();
      return;
    }
    onlineSession = session;
    primaryCode.value = session.roomCode;
    updateHostLobbyStatus();
  } catch (err) {
    if (!isCurrentOnlineFlow(flowId, state)) return;
    setOnlineStatus(err.message || 'Could not create room');
  }
}

function showJoinPanel() {
  if (!ensureWebRtcAvailable()) return;

  closeOnlineSession();
  onlineState = createOnlineState('guest');
  configureJoinPanel();
}

async function joinRoom() {
  if (!validateRoomCode()) {
    return;
  }

  closeOnlineSession(false);
  const teamChoice = onlineState?.guestTeam ?? null;
  const state = createOnlineState('guest');
  onlineState = state;
  state.guestTeam = teamChoice;
  const flowId = onlineFlowId;

  try {
    setOnlineStatus('Joining room...');
    joinRoomBtn.disabled = true;
    primaryCode.setAttribute('aria-busy', 'true');
    const session = await createGuestSession(primaryCode.value, createOnlineHandlers('guest', flowId, state));
    if (!isCurrentOnlineFlow(flowId, state)) {
      session.close();
      return;
    }
    onlineSession = session;
    primaryCode.value = session.roomCode;
  } catch (err) {
    if (!isCurrentOnlineFlow(flowId, state)) return;
    setOnlineStatus(err.message || 'Could not join room');
    onlineSession = null;
    primaryCode.setAttribute('aria-invalid', 'true');
    primaryCode.focus();
  } finally {
    if (!isCurrentOnlineFlow(flowId, state)) return;
    primaryCode.removeAttribute('aria-busy');
    updateJoinCodeValidity();
  }
}

function createOnlineHandlers(role, flowId, state) {
  const isCurrent = () => isCurrentOnlineFlow(flowId, state);
  return {
    shouldAcceptConnection: () =>
      isCurrent() && !(role === 'host' && (onlineState?.started || onlineState?.starting)),
    onStatus: (text) => {
      if (isCurrent()) setOnlineStatus(text);
    },
    onRoomCode: (roomCode) => {
      if (isCurrent()) primaryCode.value = roomCode;
    },
    onOpen: (_session, _connection, connectionId) => {
      if (!isCurrent()) return;
      if (role === 'guest') {
        sendGuestHello();
        setOnlineStatus('Connected - waiting for host');
      } else {
        setOnlineStatus('Player connecting...');
      }
    },
    onMessage: (message, _session, _connection, connectionId) => {
      if (isCurrent()) handleOnlineMessage(role, message, connectionId);
    },
    onConnectionClose: (_session, _connection, connectionId) => {
      if (isCurrent()) handleOnlineConnectionClose(role, connectionId);
    },
    onClose: () => {
      if (isCurrent()) handleOnlineClose();
    },
  };
}

function isCurrentOnlineFlow(flowId, state) {
  return flowId === onlineFlowId && onlineState === state;
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
  } else if (message.type === 'roomFull' || message.type === 'roomUnavailable') {
    closeOnlineSession(false);
    setOnlineStatus(message.type === 'roomFull' ? 'Room is full' : 'Room is already playing');
    primaryCode.readOnly = false;
    primaryCode.removeAttribute('aria-busy');
    joinRoomBtn.classList.remove('hidden');
    updateJoinCodeValidity();
    primaryCode.focus();
  } else if (message.type === 'lobby') {
    updateGuestLobby(message);
  } else if (message.type === 'snapshot') {
    if (game) {
      const wasShowingResult = hostPanelFinished && game.state === 'over';
      game.applySnapshot(message);
      if (wasShowingResult && game.state !== 'over') closeHostPanel();
    } else onlineState.pendingSnapshot = message;
  } else if (message.type === 'fx' && game) {
    const player = game.players[message.playerIndex];
    if (player) game.spawnPowerFX(player, message.fxType, true);
  } else if (message.type === 'wallFx' && game) {
    if (message.hit) game.spawnWallImpactFX(message.hit, true);
  } else if (message.type === 'sound') {
    if (game) game.playSoundEvent(message.event, true);
    else if (message.event) onlineState.pendingSoundEvents.push(message.event);
  } else if (message.type === 'matchFinished') {
    openHostPanel({ finished: true, resultText: String(message.resultText || 'Match finished') });
  } else if (message.type === 'matchEnded') {
    returnToMenu();
  }
}

async function startHostedMatch() {
  const state = onlineState;
  const session = onlineSession;
  const flowId = onlineFlowId;
  if (!state || state.role !== 'host' || state.started || state.starting || !session) return false;

  syncHostPlayerInfo();
  if (state.guests.length < 1 || !hasBothActiveTeams(currentHostRoster())) {
    updateHostLobbyStatus();
    return false;
  }

  state.starting = true;
  updateHostLobbyStatus();

  try {
    await ensureAssets(startHostedMatch);
    if (!isCurrentOnlineFlow(flowId, state) || onlineSession !== session) return false;

    // Finalize the roster only after loading, while new connections are rejected.
    syncHostPlayerInfo();
    const guests = state.guests.slice(0, MAX_GUESTS);
    const roster = currentHostRoster();
    if (guests.length < 1 || !hasBothActiveTeams(roster)) {
      state.starting = false;
      updateHostLobbyStatus();
      return false;
    }

    const players = buildOnlinePlayers(roster);
    state.connectionPlayerIndexes.clear();
    state.remoteCommands.clear();
    guests.forEach((guest, index) => {
      const playerIndex = index + 1;
      state.connectionPlayerIndexes.set(guest.connectionId, playerIndex);
      state.remoteCommands.set(playerIndex, { ...EMPTY_COMMANDS });
    });

    const settings = normalizeMatchSettings(state.matchSettings);
    const started = await startOnlineGame('host', players, 0, settings);
    if (!started || !isCurrentOnlineFlow(flowId, state) || onlineSession !== session) return false;

    guests.forEach((guest, index) => {
      session.sendTo(guest.connectionId, {
        type: 'start',
        players,
        localPlayerIndex: index + 1,
        settings,
      });
    });
    return true;
  } catch (err) {
    if (isCurrentOnlineFlow(flowId, state)) {
      state.starting = false;
      updateHostLobbyStatus();
      throw err;
    }
    return false;
  }
}

async function startGuestMatch(players, localPlayerIndex = 1, settings = null) {
  if (!onlineState || onlineState.started || onlineState.role !== 'guest' || !onlineSession) {
    dismissLoadingOverlay();
    return false;
  }
  const sanitizedPlayers = sanitizePlayers(players);
  return startOnlineGame('guest', sanitizedPlayers, localPlayerIndex, settings);
}

async function startOnlineGame(role, players, localPlayerIndex = role === 'host' ? 0 : 1, settings = null) {
  const state = onlineState;
  const session = onlineSession;
  const flowId = onlineFlowId;
  const retryAction =
    role === 'host'
      ? startHostedMatch
      : () => startGuestMatch(players, localPlayerIndex, settings);
  try {
    await ensureAssets(retryAction);
  } catch (err) {
    if (!isCurrentOnlineFlow(flowId, state) || onlineSession !== session) return false;
    throw err;
  }
  if (!isCurrentOnlineFlow(flowId, state) || onlineSession !== session || !state) return false;

  enterGameView();
  game?.dispose();
  localMatchState = null;

  const safeLocalPlayerIndex = clampPlayerIndex(localPlayerIndex, players.length);
  const matchSettings = normalizeMatchSettings(settings ?? state.matchSettings);
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
      state.remoteCommands.get(index) ?? EMPTY_COMMANDS,
    timeLimitSeconds: matchSettings.timeLimitSeconds,
    scoreLimit: matchSettings.scoreLimit,
  });

  if (role === 'host') {
    game.onFxEvent = (playerIndex, fxType) => {
      session.send({ type: 'fx', playerIndex, fxType });
    };
    game.onWallFxEvent = (hit) => {
      session.send({ type: 'wallFx', hit });
    };
    game.onSoundEvent = (event) => {
      session.send({ type: 'sound', event });
    };
    installEditableMatchEndHandler();
  }
  matchHint.classList.remove('hidden');

  state.players = players;
  state.matchSettings = normalizeMatchSettings(game.getMatchSettings());
  state.started = true;
  state.starting = false;
  setOnlineStatus(role === 'host' ? 'Match started' : 'Playing online');

  if (state.pendingSnapshot) {
    game.applySnapshot(state.pendingSnapshot);
    state.pendingSnapshot = null;
  }
  for (const event of state.pendingSoundEvents.splice(0)) {
    game.playSoundEvent(event, true);
  }
  return true;
}

function enterGameView() {
  closeHostPanel({ focusCanvas: false });
  menu.classList.add('hidden');
  matchHint.classList.add('hidden');
  hudRoot.classList.remove('hidden');
  setGameplayActive(true);
  document.activeElement?.blur?.();
  canvas.focus?.();
}

function returnToMenu() {
  closeHostPanel({ focusCanvas: false });
  setGameplayActive(false);
  game?.dispose();
  game = null;
  localMatchState = null;
  hudRoot.classList.add('hidden');
  menu.classList.remove('hidden');
  closeOnlineSession();
  resetOnlinePanel();
  showHomeScreen();
}

function handleHostPanelShortcut(event) {
  if (event.code === 'Tab' && isHostPanelOpen()) {
    trapHostPanelFocus(event);
    return;
  }
  if (event.code !== 'Escape') return;
  if (!loading.classList.contains('hidden')) return;
  if (event.repeat && (isHostPanelOpen() || canOpenHostPanel())) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (isHostPanelOpen()) {
    event.preventDefault();
    event.stopPropagation();
    if (!hostPanelFinished) closeHostPanel();
    return;
  }

  if (!canOpenHostPanel()) {
    if (!menu.classList.contains('hidden') && currentMenuScreen !== 'home') {
      event.preventDefault();
      event.stopPropagation();
      navigateBackFromCurrentMenu();
    }
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  openHostPanel();
}

function navigateBackFromCurrentMenu() {
  if (currentMenuScreen === 'online-room') {
    closeOnlineSession();
    resetOnlinePanel();
    showMenuScreen('online-choice');
    return;
  }
  if (currentMenuScreen === 'online-choice') {
    showHomeScreen();
    return;
  }
  if (currentMenuScreen === 'solo') {
    closeLocalPanel();
    return;
  }
  if (currentMenuScreen === 'ai-tests') closeAiTestPanel();
}

function canOpenHostPanel() {
  return Boolean(
    game && (currentEditableMatchState() || (onlineState?.role === 'guest' && onlineState.started))
  );
}

function openHostPanel({ finished = false, resultText = '', advanced = false } = {}) {
  if (!canOpenHostPanel()) return;
  hostPanelFinished = Boolean(finished);
  hostPanelResultText = resultText;
  const editable = Boolean(currentEditableMatchState());
  const showAdvanced = Boolean(advanced && editable);

  syncHostPanelHeading();
  hostPanelClose.classList.toggle('hidden', hostPanelFinished);
  hostRestartBtn.classList.toggle('hidden', !editable);
  hostAdvancedToggle.classList.toggle('hidden', !editable);
  hostRestartBtn.textContent = hostPanelFinished ? 'Rematch' : 'Restart Match';
  hostAdvancedToggle.textContent = hostPanelFinished ? 'Change setup' : 'Match setup';
  hostLeaveBtn.textContent = hostPanelFinished ? 'Main menu' : 'Leave Game';
  hostPanelAdvanced.classList.toggle('hidden', !showAdvanced);
  hostAdvancedToggle.setAttribute('aria-expanded', String(showAdvanced));

  if (editable) {
    syncHostPanelInputs();
    renderHostPanel();
  }
  setHostPanelStatus(hostPanelFinished ? hostPanelResultText || 'Match finished' : 'Ready');
  hostPanel.classList.remove('hidden');
  hostPanel.setAttribute('aria-hidden', 'false');
  canvas.inert = true;
  hudRoot.inert = true;
  soundControls.inert = true;
  setInputLocked(true);
  setGameplayActive(false);
  let focusTarget = hostPanelClose;
  if (hostPanelFinished) focusTarget = editable ? hostRestartBtn : hostLeaveBtn;
  else if (showAdvanced) focusTarget = hostTimeLimit;
  focusTarget.focus();
}

function closeHostPanel({ focusCanvas = true } = {}) {
  const wasOpen = isHostPanelOpen();
  hostPanel.classList.add('hidden');
  hostPanel.setAttribute('aria-hidden', 'true');
  canvas.inert = false;
  hudRoot.inert = false;
  soundControls.inert = false;
  setInputLocked(false);
  if (game) setGameplayActive(true);
  if (wasOpen && focusCanvas) canvas.focus?.();
  hostPanelFinished = false;
  hostPanelResultText = '';
}

function isHostPanelOpen() {
  return !hostPanel.classList.contains('hidden');
}

function toggleHostAdvanced() {
  const expanded = hostAdvancedToggle.getAttribute('aria-expanded') === 'true';
  hostAdvancedToggle.setAttribute('aria-expanded', String(!expanded));
  hostPanelAdvanced.classList.toggle('hidden', expanded);
  hostAdvancedToggle.textContent = !expanded
    ? 'Hide match setup'
    : hostPanelFinished
      ? 'Change setup'
      : 'Match setup';
}

function trapHostPanelFocus(event) {
  const focusable = Array.from(
    hostPanel.querySelectorAll('button:not([disabled]):not(.hidden), input:not([disabled]), select:not([disabled])')
  ).filter((element) => !element.closest('.hidden'));
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
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
  row.dataset.playerIndex = String(index);

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
  controls.appendChild(
    createTeamSelectControl(player, `host-team-${index}`, (team) => stageHostPlayerTeam(index, team))
  );

  row.appendChild(details);
  row.appendChild(controls);
  return row;
}

function createHostHeroButton(playerIndex, currentHero, heroKind) {
  const normalizedHero = normalizeHero(heroKind);
  const button = document.createElement('button');
  button.type = 'button';
  button.id = `host-hero-${playerIndex}-${normalizedHero}`;
  button.className = 'hero-choice';
  button.classList.toggle('active', normalizeHero(currentHero) === normalizedHero);
  button.setAttribute('aria-pressed', normalizeHero(currentHero) === normalizedHero ? 'true' : 'false');
  button.textContent = heroName(normalizedHero);
  button.addEventListener('click', () => setHostPlayerHero(playerIndex, normalizedHero, button.id));
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

function createTeamSelectControl(player, id, onChange) {
  const label = document.createElement('label');
  label.className = 'team-select-wrap';

  const labelText = document.createElement('span');
  labelText.className = 'team-select-label';
  labelText.textContent = 'Team';

  const select = document.createElement('select');
  select.id = id;
  select.className = 'team-select';
  select.setAttribute('aria-label', `Team for ${normalizeNickname(player?.nickname)}`);
  for (const [value, text] of [
    [TEAM.RED, 'Red'],
    [TEAM.BLUE, 'Blue'],
    [TEAM.SPECTATOR, 'Spectator'],
  ]) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = text;
    select.appendChild(option);
  }
  select.value = String(normalizeTeam(player?.team, TEAM.RED));
  select.addEventListener('change', () => onChange(normalizeTeam(select.value, TEAM.RED)));

  label.appendChild(labelText);
  label.appendChild(select);
  return label;
}

function focusElementById(id) {
  if (!id) return;
  queueMicrotask(() => document.getElementById(id)?.focus());
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
  focusElementById(`host-team-${playerIndex}`);
  setHostPanelStatus('Roster staged - restart to apply');
}

function setHostPlayerHero(playerIndex, heroKind, focusId = '') {
  const matchState = currentEditableMatchState();
  if (!game || !matchState?.players?.[playerIndex]) return;

  const roster = matchState.players.map((player, index) => ({
    ...normalizeStartedPlayer(player, index),
  }));
  roster[playerIndex].heroKind = normalizeHero(heroKind);

  const assigned = assignPlayerSpawns(roster);
  matchState.players = assigned;
  renderHostPanel();
  focusElementById(focusId);
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
  const settings = normalizeMatchSettings(matchState.matchSettings ?? game.getMatchSettings());
  matchState.matchSettings = settings;
  hostTimeLimit.value = formatTimeLimitMinutes(settings.timeLimitSeconds);
  hostScoreLimit.value = String(settings.scoreLimit);
}

function stageHostMatchSettings({ announce = true } = {}) {
  const matchState = currentEditableMatchState();
  if (!game || !matchState) return;

  const current = normalizeMatchSettings(game.getMatchSettings());
  const settings = normalizeMatchSettings({
    timeLimitSeconds: parseTimeLimitSeconds(hostTimeLimit.value, current.timeLimitSeconds),
    scoreLimit: parseScoreLimit(hostScoreLimit.value, current.scoreLimit),
  });
  matchState.matchSettings = settings;
  hostTimeLimit.value = formatTimeLimitMinutes(settings.timeLimitSeconds);
  hostScoreLimit.value = String(settings.scoreLimit);
  if (announce) setHostPanelStatus('Settings staged - restart to apply');
}

function restartCurrentMatch() {
  const matchState = currentEditableMatchState();
  if (!game || !matchState) return;

  if (isHostPanelOpen()) {
    stageHostMatchSettings({ announce: false });
  }

  const roster = assignPlayerSpawns(
    matchState.players.map((player, index) => ({
      ...normalizeStartedPlayer(player, index),
    }))
  );
  if (!hasBothActiveTeams(roster)) {
    setHostPanelStatus('Assign at least one player to Red and Blue');
    hostPanelAdvanced.classList.remove('hidden');
    hostAdvancedToggle.setAttribute('aria-expanded', 'true');
    hostAdvancedToggle.textContent = 'Hide match setup';
    return;
  }
  matchState.players = roster;
  if (currentMatchPanelMode() === 'online-host') syncStartedRosterToOnlineState(roster);
  game.setPlayerLayout(roster);

  game.setMatchSettings(matchState.matchSettings);
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
  const resultText = currentMatchResultText();
  if (onlineState?.role === 'host' && onlineState.started) {
    onlineSession?.send({ type: 'matchFinished', resultText });
  }
  openHostPanel({ finished: true, resultText });
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
  if (onlineState?.role === 'guest' && onlineState.started) return 'online-guest';
  return null;
}

function syncHostPanelHeading() {
  const mode = currentMatchPanelMode();
  hostPanelKicker.textContent =
    mode === 'local' ? 'Solo Match' : mode === 'online-host' ? 'Host Room' : 'Online Match';
  hostPanelTitle.textContent = hostPanelFinished ? 'Match Finished' : 'Game Menu';
}

function currentMatchResultText() {
  const red = Number(game?.score?.[TEAM.RED]) || 0;
  const blue = Number(game?.score?.[TEAM.BLUE]) || 0;
  if (red === blue) return `Draw, ${red}-${blue}`;
  return `${red > blue ? 'Red' : 'Blue'} wins, ${red}-${blue}`;
}

function matchPanelRoleLabel(player, index) {
  const mode = currentMatchPanelMode();
  if (mode === 'local') return player.control === 'local' ? 'You' : 'AI';
  if (mode === 'online-host') {
    if (player.control === 'ai') return 'AI substitute';
    return index === 0 ? 'Host' : 'Guest';
  }
  return '';
}

function handleOnlineClose() {
  const wasPlaying = onlineState?.started;
  const previousRole = onlineState?.role;
  const previousStatus = onlineStatus.textContent.trim();
  onlineFlowId += 1;
  closeHostPanel({ focusCanvas: false });
  onlineSession = null;
  onlineState = null;

  if (wasPlaying && game) {
    game.setBannerState({ visible: true, text: 'DISCONNECTED', color: '#ff6a5e' });
    setTimeout(() => {
      if (game) returnToMenu();
    }, 1400);
  } else if (previousRole === 'host') {
    const message = /unavailable|failed|could not/i.test(previousStatus) ? previousStatus : 'Room closed';
    resetOnlinePanel();
    showMenuScreen('online-choice');
    showToast(message);
  } else {
    const keepSpecificError = /not found|unavailable|full|failed|could not|invalid/i.test(previousStatus);
    setOnlineStatus(keepSpecificError ? previousStatus : 'Disconnected');
    onlineLobby.classList.add('hidden');
    primaryCode.readOnly = false;
    primaryCode.removeAttribute('aria-busy');
    joinRoomBtn.classList.remove('hidden');
    updateJoinCodeValidity();
    if (currentMenuScreen === 'online-room') primaryCode.focus();
  }
}

function handleOnlineConnectionClose(role, connectionId) {
  if (role !== 'host' || !onlineState) return;

  if (onlineState.started) {
    const playerIndex = onlineState.connectionPlayerIndexes.get(connectionId);
    onlineState.connectionPlayerIndexes.delete(connectionId);
    onlineState.remoteCommands.delete(playerIndex);
    if (playerIndex != null && onlineState.players?.[playerIndex] && game) {
      const roster = onlineState.players.map((player, index) => normalizeStartedPlayer(player, index));
      const departed = roster[playerIndex];
      departed.control = 'ai';
      departed.nickname = normalizeNickname(`${departed.nickname} AI`, `AI Player ${playerIndex}`);
      onlineState.players = assignPlayerSpawns(roster);
      if (onlineState.guests[playerIndex - 1]) {
        Object.assign(onlineState.guests[playerIndex - 1], departed, { disconnected: true });
      }
      game.setPlayerLayout(onlineState.players);
      game.showBanner('PLAYER LEFT - AI TAKES OVER', 1.8, '#ffd84a');
      if (isHostPanelOpen()) {
        renderHostPanel();
        setHostPanelStatus('A disconnected player was replaced by AI');
      }
    }
    return;
  }

  onlineState.guests = onlineState.guests.filter((guest) => guest.connectionId !== connectionId);
  updateHostLobbyStatus();
}

function createOnlineState(role) {
  return {
    role,
    started: false,
    starting: false,
    hostPlayer: {
      connectionId: 'host',
      nickname: currentNickname(),
      heroKind: normalizeHero(selectedHero),
      team: TEAM.RED,
    },
    guests: [],
    lobbyPlayers: [],
    guestYouIndex: null,
    guestTeam: null,
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
  onlineFlowId += 1;
  const session = onlineSession;
  onlineSession = null;
  if (clearState) onlineState = null;
  session?.close();
}

function configureHostPanel() {
  syncHostPlayerInfo();
  onlinePanelTitle.textContent = 'Create Room';
  onlinePanelDescription.textContent = 'Share the code, then arrange teams when friends join.';
  primaryCodeLabel.textContent = 'Room code';
  primaryCode.value = '';
  primaryCode.readOnly = true;
  onlineCodeHelp.textContent = 'Share this code with the players joining your room.';
  primaryCode.removeAttribute('aria-invalid');
  copyPrimaryBtn.classList.remove('hidden');
  startOnlineBtn.classList.remove('hidden');
  startOnlineBtn.disabled = true;
  startOnlineBtn.textContent = 'Start Match';
  joinRoomBtn.classList.add('hidden');
  onlineLobby.classList.remove('hidden');
  showMenuScreen('online-room');
  renderOnlineLobby();
}

function configureJoinPanel() {
  onlinePanelTitle.textContent = 'Join Room';
  onlinePanelDescription.textContent = 'Enter the six-character code from your host.';
  primaryCodeLabel.textContent = 'Room code';
  primaryCode.value = '';
  primaryCode.readOnly = false;
  onlineCodeHelp.textContent = 'Enter all six characters, for example ABC234.';
  primaryCode.removeAttribute('aria-invalid');
  copyPrimaryBtn.classList.add('hidden');
  startOnlineBtn.classList.add('hidden');
  startOnlineBtn.disabled = true;
  joinRoomBtn.classList.remove('hidden');
  joinRoomBtn.disabled = true;
  onlineLobby.classList.add('hidden');
  setOnlineStatus('Enter a six-character room code');
  showMenuScreen('online-room', { focus: false });
  updateJoinCodeValidity();
  queueMicrotask(() => primaryCode.focus());
}

function resetOnlinePanel() {
  onlinePanel.classList.add('hidden');
  onlineLobby.classList.add('hidden');
  primaryCode.value = '';
  primaryCode.readOnly = false;
  onlineCodeHelp.textContent = 'Enter all six characters, for example ABC234.';
  primaryCode.removeAttribute('aria-invalid');
  primaryCode.removeAttribute('aria-busy');
  startOnlineBtn.classList.add('hidden');
  startOnlineBtn.disabled = true;
  joinRoomBtn.classList.add('hidden');
  joinRoomBtn.disabled = true;
  onlineRedRoster.replaceChildren();
  onlineSpectatorRoster.replaceChildren();
  onlineBlueRoster.replaceChildren();
  setOnlineStatus('Idle');
}

function setOnlineStatus(text) {
  onlineStatus.textContent = text;
}

function updateJoinCodeValidity() {
  if (joinRoomBtn.classList.contains('hidden')) return;
  const valid = normalizeRoomCode(primaryCode.value).length === ROOM_CODE_LENGTH;
  joinRoomBtn.disabled = !valid || Boolean(onlineSession);
  if (valid) primaryCode.removeAttribute('aria-invalid');
}

function validateRoomCode() {
  const code = normalizeRoomCode(primaryCode.value);
  primaryCode.value = code;
  if (code.length === ROOM_CODE_LENGTH) {
    primaryCode.removeAttribute('aria-invalid');
    return true;
  }

  primaryCode.setAttribute('aria-invalid', 'true');
  setOnlineStatus(`Enter all ${ROOM_CODE_LENGTH} room-code characters`);
  primaryCode.focus();
  return false;
}

function registerGuest(connectionId, message) {
  if (!connectionId || !onlineState || onlineState.role !== 'host' || onlineState.started) return;
  const existingGuest = onlineState.guests.find((guest) => guest.connectionId === connectionId);
  if (onlineState.starting) {
    if (!existingGuest) onlineSession?.disconnect(connectionId, { type: 'roomUnavailable' });
    return;
  }

  const normalizedHero = normalizeHero(message?.heroKind);
  const nickname = normalizeNickname(message?.nickname, `Guest ${onlineState.guests.length + 1}`);
  const requestedTeam = message?.team == null ? null : normalizeTeam(message.team, null);
  if (existingGuest) {
    existingGuest.heroKind = normalizedHero;
    existingGuest.nickname = nickname;
    if (requestedTeam != null) existingGuest.team = requestedTeam;
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
    team: requestedTeam ?? defaultTeamForPlayerIndex(onlineState.guests.length + 1),
  });
  updateHostLobbyStatus();
}

function updateHostLobbyStatus() {
  if (!onlineState || onlineState.role !== 'host') return;

  syncHostPlayerInfo();
  renderOnlineLobby();

  const guestCount = onlineState.guests.length;
  const playerCount = guestCount + 1;
  const validTeams = hasBothActiveTeams(currentHostRoster());
  const canStart = guestCount > 0 && validTeams && !onlineState.started && !onlineState.starting;

  startOnlineBtn.disabled = !canStart;
  startOnlineBtn.textContent = playerCount > 2 ? `Start ${playerCount} Players` : 'Start Match';

  if (onlineState.starting) {
    setOnlineStatus('Preparing match...');
  } else if (guestCount === 0) {
    setOnlineStatus(`Waiting for players (0/${MAX_GUESTS})`);
  } else if (!validTeams) {
    setOnlineStatus('Assign at least one player to Red and Blue');
  } else {
    setOnlineStatus(`${guestCount}/${MAX_GUESTS} joined`);
  }

  broadcastLobbyState();
}

function hasBothActiveTeams(players) {
  const teams = new Set((players || []).map((player) => normalizeTeam(player?.team, TEAM.RED)));
  return teams.has(TEAM.RED) && teams.has(TEAM.BLUE);
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
  const hello = {
    type: 'hello',
    nickname: currentNickname(),
    heroKind: normalizeHero(selectedHero),
  };
  // Only claim a team once the guest picked one; otherwise the host assigns.
  if (onlineState.guestTeam != null) hello.team = onlineState.guestTeam;
  onlineSession.send(hello);
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
  // Follow the host's placement so later hellos (hero/nickname changes) don't fight it.
  const you = onlineState.guestYouIndex != null ? onlineState.lobbyPlayers[onlineState.guestYouIndex] : null;
  if (you) onlineState.guestTeam = you.team;
  joinRoomBtn.classList.add('hidden');
  primaryCode.readOnly = true;
  primaryCode.removeAttribute('aria-busy');
  primaryCode.removeAttribute('aria-invalid');
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

    const heroControl = document.createElement('div');
    heroControl.className = 'hero-toggle';
    heroControl.appendChild(createLocalHeroButton(slot.selectionIndex, 'sam'));
    heroControl.appendChild(createLocalHeroButton(slot.selectionIndex, 'tesla'));

    row.appendChild(name);
    row.appendChild(heroControl);
    const roster = slot.team === TEAM.BLUE ? localBlueRoster : localRedRoster;
    roster.appendChild(row);
  }
}

function createLocalHeroButton(selectionIndex, heroKind) {
  const normalizedHero = normalizeHero(heroKind);
  const button = document.createElement('button');
  button.type = 'button';
  button.id = `local-hero-${selectionIndex}-${normalizedHero}`;
  button.className = 'hero-choice';
  button.classList.toggle('active', localHeroSelections[selectionIndex] === normalizedHero);
  button.setAttribute('aria-pressed', localHeroSelections[selectionIndex] === normalizedHero ? 'true' : 'false');
  button.textContent = heroName(normalizedHero);
  button.title = HERO_POWERS[normalizedHero];
  button.addEventListener('click', () => {
    localHeroSelections[selectionIndex] = normalizedHero;
    if (selectionIndex === 0) setSelectedHero(normalizedHero);
    renderLocalRoster();
    focusElementById(button.id);
  });
  return button;
}

function localRosterSlots(teamSize) {
  const playersPerTeam = normalizeLocalTeamSize(teamSize);
  const playerTeam = selectedLocalTeam === TEAM.BLUE ? TEAM.BLUE : TEAM.RED;
  const opponentTeam = playerTeam === TEAM.BLUE ? TEAM.RED : TEAM.BLUE;
  const slots = [
    {
      selectionIndex: 0,
      name: currentNickname(),
      team: playerTeam,
      teamSlot: 0,
      control: 'local',
    },
    {
      selectionIndex: 2,
      name: 'AI Opponent',
      team: opponentTeam,
      teamSlot: 0,
      control: 'ai',
    },
  ];

  if (playersPerTeam === 2) {
    slots.splice(1, 0, {
      selectionIndex: 1,
      name: 'AI Teammate',
      team: playerTeam,
      teamSlot: 1,
      control: 'ai',
    });
    slots.push({
      selectionIndex: 3,
      name: 'AI Opponent 2',
      team: opponentTeam,
      teamSlot: 1,
      control: 'ai',
    });
  }

  return slots;
}

function renderOnlineLobby() {
  if (!onlineState || onlineState.started) return;

  if (onlineState.role === 'host') {
    onlineLobby.classList.remove('hidden');
    renderOnlineRoster(currentHostRoster(), { editable: true, youIndex: 0 });
  } else if (onlineState.lobbyPlayers.length) {
    onlineLobby.classList.remove('hidden');
    renderOnlineRoster(onlineState.lobbyPlayers, {
      editable: false,
      youIndex: onlineState.guestYouIndex,
    });
  } else {
    onlineLobby.classList.add('hidden');
    onlineRedRoster.replaceChildren();
    onlineSpectatorRoster.replaceChildren();
    onlineBlueRoster.replaceChildren();
  }
}

function renderOnlineRoster(players, { editable, youIndex }) {
  onlineRedRoster.replaceChildren();
  onlineSpectatorRoster.replaceChildren();
  onlineBlueRoster.replaceChildren();

  players.forEach((player, index) => {
    const team = normalizeTeam(player.team, TEAM.RED);
    const row = document.createElement('div');
    row.className = 'local-player';

    const top = document.createElement('div');
    top.className = 'local-player-top';

    const name = document.createElement('div');
    name.className = 'local-player-name';
    name.textContent = normalizeNickname(player.nickname, `Player ${index + 1}`);
    if (index === youIndex) name.appendChild(createRowTag('You'));
    if (player.isHost || player.connectionId === 'host') name.appendChild(createRowTag('Host', 'host'));
    top.appendChild(name);

    // The host can assign anyone; a guest can choose only their own team.
    let teamControl = null;
    if (editable || index === youIndex) {
      const teamControlId = `lobby-team-${index}`;
      teamControl = createTeamSelectControl(player, teamControlId, (targetTeam) => {
        if (editable) {
          player.team = targetTeam;
          updateHostLobbyStatus();
          focusElementById(teamControlId);
        } else {
          setGuestTeam(targetTeam, teamControlId);
        }
      });
    }

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

    row.appendChild(top);
    row.appendChild(controls);
    if (teamControl) row.appendChild(teamControl);
    const roster =
      team === TEAM.BLUE ? onlineBlueRoster : team === TEAM.SPECTATOR ? onlineSpectatorRoster : onlineRedRoster;
    roster.appendChild(row);
  });

  appendRosterPlaceholder(onlineRedRoster, 'Waiting for players...');
  appendRosterPlaceholder(onlineSpectatorRoster, 'No spectators');
  appendRosterPlaceholder(onlineBlueRoster, 'Waiting for players...');
}

function setGuestTeam(team, focusId = '') {
  if (!onlineState || onlineState.role !== 'guest' || onlineState.started) return;
  onlineState.guestTeam = normalizeTeam(team, TEAM.RED);
  const you = onlineState.lobbyPlayers[onlineState.guestYouIndex];
  if (you) you.team = onlineState.guestTeam;
  renderOnlineLobby();
  focusElementById(focusId);
  sendGuestHello();
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
  button.id = `online-hero-${normalizedHero}`;
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
      focusElementById(button.id);
    }
    syncLocalLobbyInfo();
  });
  return button;
}

function appendRosterPlaceholder(roster, text) {
  if (roster.childElementCount) return;
  const placeholder = document.createElement('div');
  placeholder.className = 'local-player placeholder';
  placeholder.textContent = text;
  roster.appendChild(placeholder);
}

async function copyCode(textarea, successText) {
  if (!textarea.value) return;

  try {
    await navigator.clipboard.writeText(textarea.value);
    showToast(successText);
  } catch {
    textarea.focus();
    textarea.select();
    setOnlineStatus('Select code to copy');
  }
}

let toastTimer = 0;
function showToast(text) {
  clearTimeout(toastTimer);
  uiToast.textContent = text;
  uiToast.classList.remove('hidden');
  toastTimer = window.setTimeout(() => uiToast.classList.add('hidden'), 1800);
}

function ensureWebRtcAvailable() {
  if ('RTCPeerConnection' in window) return true;
  showToast('Online play is unavailable in this browser');
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

function loadSavedNickname() {
  try {
    return normalizeNickname(localStorage.getItem(NICKNAME_STORAGE_KEY), '');
  } catch {
    return '';
  }
}

function saveNickname(nickname) {
  try {
    localStorage.setItem(NICKNAME_STORAGE_KEY, normalizeNickname(nickname, defaultNickname));
  } catch {
    // Storage can be unavailable in privacy-restricted browsing contexts.
  }
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

  const soloPaused = Boolean(localMatchState?.started && isHostPanelOpen());
  if (game && !soloPaused) game.update(dt);
  updateOnlineTransport(dt);
  scoreboard?.syncPosition();
  updatePhysicsOverlay(game, dt);
  if (scene) outlineEffect.render(scene, camera);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
