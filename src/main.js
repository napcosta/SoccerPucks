import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { loadAssets } from './assets.js';
import { createRenderer, createCamera, buildWorld } from './scene.js';
import { Game } from './game.js?v=ai-eval-1';
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
import {
  loadEvaluationRuns,
  saveEvaluationRun,
  clearEvaluationRuns,
  aggregateEvaluationRuns,
  downloadEvaluationResults,
} from './ai-evaluation-store.js';

initDebugPanel();

const PLAYER_SPAWN_Z = 7.8;
const MAX_ONLINE_PLAYERS = MAX_GUESTS + 1;
const NICKNAME_MAX_LENGTH = 16;
const INPUT_RATE = 30;
const SNAPSHOT_RATE = 45;
const EMPTY_COMMANDS = Object.freeze({ moveX: 0, moveZ: 0, shoot: false, power: false });
const HERO_LABELS = Object.freeze({ sam: 'Sam', tesla: 'Tesla', shaggy: 'Shaggy Slider' });
const HERO_POWERS = Object.freeze({
  sam: 'Power: Dash',
  tesla: 'Power: Magnet',
  shaggy: 'Power: Slide',
});
const MIN_TIME_LIMIT_SECONDS = 30;
const MAX_TIME_LIMIT_SECONDS = 15 * 60;
const MAX_SCORE_LIMIT = 15;
const NICKNAME_STORAGE_KEY = 'soccer-pucks-nickname';
const AI_REVISION_STORAGE_KEY = 'soccer-pucks-ai-revision';
const DEFAULT_AI_RATING_CRITERIA = Object.freeze([
  Object.freeze({ id: 'decision', label: 'Decision quality', description: 'Did the AI choose the right behaviour for the situation?', weight: 1 }),
  Object.freeze({ id: 'positioning', label: 'Positioning', description: 'Did it create or protect useful space?', weight: 1 }),
  Object.freeze({ id: 'timing', label: 'Timing', description: 'Was the action taken at the right moment?', weight: 1 }),
  Object.freeze({ id: 'execution', label: 'Execution', description: 'How accurate and controlled was the outcome?', weight: 1 }),
  Object.freeze({ id: 'challenge', label: 'Credibility', description: 'Would this behaviour feel credible and challenging in a match?', weight: 1 }),
]);
const AI_KEY_EVENT_TYPES = new Set([
  'power-used',
  'hero-effect',
  'ball-capture',
  'kick',
  'save',
  'goal',
  'possession-change',
]);
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
const aiTestOverview = document.getElementById('ai-test-overview');
const runAiTestsBtn = document.getElementById('run-ai-tests-btn');
const closeAiTestsBtn = document.getElementById('close-ai-tests-btn');
const aiScenariosTab = document.getElementById('ai-scenarios-tab');
const aiResultsTab = document.getElementById('ai-results-tab');
const aiScenariosView = document.getElementById('ai-scenarios-view');
const aiResultsView = document.getElementById('ai-results-view');
const aiTestDifficulty = document.getElementById('ai-test-difficulty');
const aiTestRevision = document.getElementById('ai-test-revision');
const aiResultsFilter = document.getElementById('ai-results-filter');
const aiResultsCount = document.getElementById('ai-results-count');
const aiResultsSummary = document.getElementById('ai-results-summary');
const aiResultsHistory = document.getElementById('ai-results-history');
const aiResultsExportBtn = document.getElementById('ai-results-export-btn');
const aiResultsClearBtn = document.getElementById('ai-results-clear-btn');
const aiScenarioHud = document.getElementById('ai-scenario-hud');
const aiScenarioHudTitle = document.getElementById('ai-scenario-hud-title');
const aiScenarioHudPhase = document.getElementById('ai-scenario-hud-phase');
const aiScenarioHudObjective = document.getElementById('ai-scenario-hud-objective');
const aiScenarioHudTime = document.getElementById('ai-scenario-hud-time');
const aiScenarioStopBtn = document.getElementById('ai-scenario-stop-btn');
const aiReviewPanel = document.getElementById('ai-review-panel');
const aiReviewTitle = document.getElementById('ai-review-title');
const aiReviewDescription = document.getElementById('ai-review-description');
const aiReviewStatus = document.getElementById('ai-review-status');
const aiReviewOutcome = document.getElementById('ai-review-outcome');
const aiReviewOutcomeTitle = document.getElementById('ai-review-outcome-title');
const aiReviewOutcomeReason = document.getElementById('ai-review-outcome-reason');
const aiReviewTime = document.getElementById('ai-review-time');
const aiReviewEvents = document.getElementById('ai-review-events');
const aiReviewDiagnostics = document.getElementById('ai-review-diagnostics');
const aiReviewForm = document.getElementById('ai-review-form');
const aiReviewCriteria = document.getElementById('ai-review-criteria');
const aiReviewNotes = document.getElementById('ai-review-notes');
const aiReviewError = document.getElementById('ai-review-error');
const aiReviewDiscardBtn = document.getElementById('ai-review-discard-btn');
const aiReviewRetryBtn = document.getElementById('ai-review-retry-btn');
const aiReviewSaveBtn = document.getElementById('ai-review-save-btn');
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
let aiScenarioCatalog = [];
let activeAiScenario = null;
let pendingAiReview = null;
let aiTestActiveTab = 'scenarios';
let aiReviewOpenTimer = 0;

aiTestRevision.value = loadAiRevision();

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
aiScenariosTab.addEventListener('click', () => showAiTestTab('scenarios'));
aiResultsTab.addEventListener('click', () => showAiTestTab('results'));
aiScenariosTab.addEventListener('keydown', handleAiTestTabKeydown);
aiResultsTab.addEventListener('keydown', handleAiTestTabKeydown);
aiResultsFilter.addEventListener('change', renderAiResults);
aiResultsExportBtn.addEventListener('click', exportAiResults);
aiResultsClearBtn.addEventListener('click', clearAiResults);
aiScenarioStopBtn.addEventListener('click', stopAiScenario);
aiReviewForm.addEventListener('submit', saveAiReview);
aiReviewRetryBtn.addEventListener('click', retryAiScenario);
aiReviewDiscardBtn.addEventListener('click', discardAiReview);
aiTestDifficulty.addEventListener('change', refreshAiEvaluationCohort);
aiTestRevision.addEventListener('change', refreshAiEvaluationCohort);
aiTestRevision.addEventListener('blur', refreshAiEvaluationCohort);
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

  try {
    if (!aiScenarioCatalog.length) {
      aiTestStatus.textContent = 'Loading scenarios...';
      const { SCENARIOS } = await loadAiSimModule();
      aiScenarioCatalog = Array.isArray(SCENARIOS) ? SCENARIOS : [];
      populateAiResultsFilter();
    }
    renderAiScenarioList();
    renderAiResults();
    showAiTestTab(aiTestActiveTab);
    aiTestStatus.textContent = `${aiScenarioCatalog.length} staged tactical scenarios`;
  } catch (err) {
    aiTestStatus.textContent = 'Failed to load scenarios';
    console.error(err);
  }
}

function closeAiTestPanel() {
  persistAiRevision();
  if (currentMenuScreen === 'ai-tests') showHomeScreen();
  else aiTestPanel.classList.add('hidden');
}

function showAiTestTab(tab) {
  aiTestActiveTab = tab === 'results' ? 'results' : 'scenarios';
  const showingResults = aiTestActiveTab === 'results';
  aiScenariosTab.classList.toggle('selected', !showingResults);
  aiResultsTab.classList.toggle('selected', showingResults);
  aiScenariosTab.setAttribute('aria-selected', String(!showingResults));
  aiResultsTab.setAttribute('aria-selected', String(showingResults));
  aiScenariosTab.tabIndex = showingResults ? -1 : 0;
  aiResultsTab.tabIndex = showingResults ? 0 : -1;
  aiScenariosView.classList.toggle('hidden', showingResults);
  aiResultsView.classList.toggle('hidden', !showingResults);
  if (showingResults) renderAiResults();
}

function handleAiTestTabKeydown(event) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const showResults = event.key === 'ArrowRight' || event.key === 'End';
  showAiTestTab(showResults ? 'results' : 'scenarios');
  (showResults ? aiResultsTab : aiScenariosTab).focus();
}

function renderAiScenarioList() {
  const runs = filterAiEvaluationCohort(loadEvaluationRuns());
  aiTestScenarios.replaceChildren();
  for (const scenario of aiScenarioCatalog) {
    const currentVersionRuns = runs.filter(
      (run) => run.scenario?.id === scenario.id && run.scenario?.version === (scenario.version ?? 1)
    );
    const summary = aggregateEvaluationRuns(currentVersionRuns, scenario.id)[0];
    const card = document.createElement('article');
    card.className = 'ai-scenario-card';
    card.dataset.scenarioId = scenario.id;

    const header = document.createElement('div');
    header.className = 'ai-scenario-card-header';
    const category = document.createElement('span');
    category.className = 'ai-scenario-category';
    category.textContent = humanizeId(scenario.category || 'behaviour');
    const duration = document.createElement('span');
    duration.className = 'ai-scenario-duration';
    duration.textContent = `${formatScenarioSeconds(scenario.maxSeconds)} max`;
    header.append(category, duration);

    const title = document.createElement('h3');
    title.textContent = scenarioTitle(scenario);
    const objective = document.createElement('p');
    objective.textContent = scenario.objective || 'Observe whether the AI completes the intended behaviour.';
    const journey = createAiScenarioJourney(scenario);

    const footer = document.createElement('div');
    footer.className = 'ai-scenario-card-footer';
    const score = document.createElement('span');
    score.className = 'ai-scenario-score';
    renderAiScenarioScore(score, summary);

    const watch = document.createElement('button');
    watch.type = 'button';
    watch.className = 'tiny-btn';
    watch.textContent = 'Run in stadium';
    watch.setAttribute('aria-label', `Run ${scenarioTitle(scenario)} in stadium`);
    watch.addEventListener('click', () => {
      watchAiScenario(scenario).catch((err) => {
        aiTestStatus.textContent = 'Failed to start scenario';
        console.error(err);
      });
    });
    footer.append(score, watch);
    card.append(header, title, objective, journey, footer);
    aiTestScenarios.appendChild(card);
  }
  renderAiOverview(filterCurrentScenarioVersions(runs));
}

function createAiScenarioJourney(scenario) {
  const phases = scenarioTacticalPhases(scenario);
  const journey = document.createElement('ol');
  journey.className = 'ai-scenario-journey';
  journey.setAttribute('aria-label', 'Tactical stage journey');
  for (let index = 0; index < phases.length; index++) {
    const phase = phases[index];
    const item = document.createElement('li');
    const number = document.createElement('span');
    number.className = 'ai-scenario-stage-number';
    number.textContent = String(index + 1);
    number.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = tacticalPhaseLabel(phase);
    const detail = document.createElement('span');
    detail.textContent = phase.objective || scenario.objective || 'Observe the AI response.';
    copy.append(heading, detail);
    if (Number.isFinite(Number(phase.maxSeconds))) {
      const limit = document.createElement('small');
      limit.textContent = `${formatScenarioSeconds(phase.maxSeconds)} window`;
      copy.appendChild(limit);
    }
    item.append(number, copy);
    journey.appendChild(item);
  }
  return journey;
}

function scenarioTacticalPhases(scenario) {
  const phases = Array.isArray(scenario?.phases) ? scenario.phases : [];
  if (phases.length) return phases;
  return [
    {
      id: 'focused-objective',
      label: 'Focused objective',
      objective: scenario?.objective,
      maxSeconds: scenario?.maxSeconds,
    },
  ];
}

function tacticalPhaseLabel(phase) {
  return String(phase?.label || humanizeId(phase?.id) || 'Tactical stage');
}

function renderAiScenarioScore(score, summary) {
  score.replaceChildren();
  score.append(
    summary
      ? `${summary.attempts} run${summary.attempts === 1 ? '' : 's'} · `
      : 'Not scored yet · '
  );
  if (summary?.overallAverage != null) {
    const strong = document.createElement('strong');
    strong.textContent = `${summary.overallAverage.toFixed(1)}/5`;
    score.appendChild(strong);
  } else {
    score.append('—');
  }
}

function refreshAiScenarioScores() {
  const runs = filterAiEvaluationCohort(loadEvaluationRuns());
  const cards = [...aiTestScenarios.children];
  for (const scenario of aiScenarioCatalog) {
    const card = cards.find((candidate) => candidate.dataset.scenarioId === scenario.id);
    const score = card?.querySelector('.ai-scenario-score');
    if (!score) continue;
    const currentVersionRuns = runs.filter(
      (run) => run.scenario?.id === scenario.id && run.scenario?.version === (scenario.version ?? 1)
    );
    renderAiScenarioScore(score, aggregateEvaluationRuns(currentVersionRuns, scenario.id)[0]);
  }
  renderAiOverview(filterCurrentScenarioVersions(runs));
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

  const actors = scenarioActors(scenario);
  if (!actors.length) throw new Error(`Scenario ${scenario.id || scenarioTitle(scenario)} has no actors.`);

  const selectedDifficulty = normalizeAiDifficulty(aiTestDifficulty.value);
  const revision = normalizedAiRevision();
  const heroCounts = {};
  const players = actors.map((spec, index) => {
    const hero = normalizeHero(spec.heroKind);
    const count = (heroCounts[hero] = (heroCounts[hero] ?? 0) + 1);
    const position = spec.position ?? spec;
    const velocity = spec.velocity ?? spec;
    const team = normalizeTeam(spec.team);
    const control = normalizeScenarioControl(spec.control ?? spec.controller ?? spec.brain);
    const defendZSign = finiteNonZero(
      spec.defendZSign ?? scenario.teams?.[team]?.defendZSign,
      team === TEAM.BLUE ? -1 : 1
    );
    return {
      id: spec.id || `actor-${index + 1}`,
      nickname: spec.name || spec.nickname || `AI ${heroName(hero)}${count > 1 ? ` ${count}` : ''}`,
      heroKind: hero,
      team,
      spawnX: finiteNumber(position.x, 0),
      spawnZ: finiteNumber(position.z, defendZSign * PLAYER_SPAWN_Z),
      velocityX: finiteNumber(velocity.vx ?? velocity.x, 0),
      velocityZ: finiteNumber(velocity.vz ?? velocity.z, 0),
      facingX: finiteNumber(spec.facing?.x ?? spec.facingX, 0),
      facingZ: finiteNumber(spec.facing?.z ?? spec.facingZ, -defendZSign),
      defendZSign,
      control,
      difficulty: control === 'ai' ? selectedDifficulty : spec.difficulty,
    };
  });

  persistAiRevision();
  localMatchState = null;
  activeAiScenario = {
    scenario,
    players,
    difficulty: selectedDifficulty,
    revision,
    startedAt: new Date().toISOString(),
  };
  pendingAiReview = null;
  setIntentOverlay(true);
  closeAiTestPanel();
  enterGameView();
  showAiScenarioHud(scenario);
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
    aiDifficulty: selectedDifficulty,
    scenario,
    onScenarioComplete: handleAiScenarioComplete,
  });
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
    const difficulty = normalizeAiDifficulty(aiTestDifficulty.value);
    const report = await runAllScenarios(
      async (done, total, label) => {
        aiTestStatus.textContent = label
          ? `Running ${done + 1}/${total} on ${difficulty}: ${label}`
          : 'Finishing...';
        await new Promise((resolve) => setTimeout(resolve));
      },
      { difficulty }
    );
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

function scenarioActors(scenario) {
  if (Array.isArray(scenario?.actors)) return scenario.actors;
  if (Array.isArray(scenario?.initial?.players)) return scenario.initial.players;
  if (Array.isArray(scenario?.players)) return scenario.players;
  if (Array.isArray(scenario?.specs)) return scenario.specs;
  return [];
}

function scenarioTitle(scenario) {
  return scenario?.title || scenario?.label || scenario?.id || 'Untitled scenario';
}

function scenarioRatingCriteria(scenario) {
  const criteria = Array.isArray(scenario?.ratingCriteria)
    ? scenario.ratingCriteria
    : Array.isArray(scenario?.ratingRubric)
      ? scenario.ratingRubric
    : Array.isArray(scenario?.rubric)
        ? scenario.rubric
        : Array.isArray(scenario?.rubric?.criteria)
          ? scenario.rubric.criteria
          : DEFAULT_AI_RATING_CRITERIA;
  return criteria.length ? criteria : DEFAULT_AI_RATING_CRITERIA;
}

function normalizeScenarioControl(control) {
  if (control === 'idle' || control === 'static') return 'idle';
  if (control === 'scripted') return 'scripted';
  if (control === 'chaser') return 'chaser';
  return 'ai';
}

function normalizeAiDifficulty(value) {
  return ['easy', 'medium', 'hard'].includes(value) ? value : 'hard';
}

function formatScenarioSeconds(value) {
  const seconds = Math.max(0, finiteNumber(value, 0));
  return `${seconds.toFixed(seconds % 1 ? 1 : 0)}s`;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteNonZero(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? Math.sign(number) : fallback;
}

function renderAiOverview(runs) {
  const rated = runs.filter((run) => Number.isFinite(run.rubric?.overall));
  const average = rated.length
    ? rated.reduce((sum, run) => sum + run.rubric.overall, 0) / rated.length
    : null;
  const automated = runs.filter((run) => typeof run.outcome?.passed === 'boolean');
  const successes = automated.filter((run) => run.outcome.passed).length;
  aiTestOverview.replaceChildren();
  appendAiStat(aiTestOverview, 'Focused tests', String(aiScenarioCatalog.length), 'ai-overview-stat');
  appendAiStat(aiTestOverview, 'Reviewed runs', String(runs.length), 'ai-overview-stat');
  appendAiStat(
    aiTestOverview,
    'Average score',
    average == null ? 'Not rated' : `${average.toFixed(1)} / 5`,
    'ai-overview-stat'
  );
  if (automated.length) {
    aiTestStatus.textContent = `${successes}/${automated.length} reviewed runs passed automatically`;
  }
}

function populateAiResultsFilter() {
  const selected = aiResultsFilter.value || 'all';
  aiResultsFilter.replaceChildren();
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = 'All scenarios';
  aiResultsFilter.appendChild(all);
  for (const scenario of aiScenarioCatalog) {
    const option = document.createElement('option');
    option.value = scenario.id;
    option.textContent = `${scenarioTitle(scenario)} (v${scenario.version ?? 1})`;
    aiResultsFilter.appendChild(option);
  }
  aiResultsFilter.value = [...aiResultsFilter.options].some((option) => option.value === selected)
    ? selected
    : 'all';
}

function renderAiResults() {
  const allRuns = filterAiEvaluationCohort(loadEvaluationRuns());
  const scenarioId = aiResultsFilter.value || 'all';
  const currentScenario = aiScenarioCatalog.find((scenario) => scenario.id === scenarioId);
  const currentVersion = currentScenario?.version ?? null;
  const cohortRuns = scenarioId === 'all' ? filterCurrentScenarioVersions(allRuns) : allRuns;
  const runs = cohortRuns
    .filter(
      (run) =>
        scenarioId === 'all' ||
        (run.scenario?.id === scenarioId &&
          (currentVersion == null || run.scenario?.version === currentVersion))
    )
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  const rated = runs.filter((run) => Number.isFinite(run.rubric?.overall));
  const automated = runs.filter((run) => typeof run.outcome?.passed === 'boolean');
  const successes = automated.filter((run) => run.outcome.passed).length;
  const average = rated.length
    ? rated.reduce((sum, run) => sum + run.rubric.overall, 0) / rated.length
    : null;
  const aggregates = aggregateEvaluationRuns(runs, scenarioId);
  const trend =
    scenarioId !== 'all'
      ? aggregates[0]?.trend ?? null
      : null;

  const cohortLabel = `${normalizedAiRevision()} · ${normalizeAiDifficulty(aiTestDifficulty.value)}`;
  aiResultsCount.textContent = `${runs.length} scored run${runs.length === 1 ? '' : 's'}${currentVersion == null ? '' : ` · v${currentVersion}`} · ${cohortLabel}`;
  aiResultsSummary.replaceChildren();
  appendAiStat(aiResultsSummary, 'Reviewed runs', String(runs.length));
  appendAiStat(
    aiResultsSummary,
    'Automatic success',
    automated.length ? `${Math.round((successes / automated.length) * 100)}%` : 'No data'
  );
  appendAiStat(aiResultsSummary, 'Human average', average == null ? 'No data' : `${average.toFixed(1)} / 5`);
  appendAiStat(
    aiResultsSummary,
    'Latest trend',
    scenarioId === 'all'
      ? 'Filter scenario'
      : trend == null
        ? 'Needs 2 runs'
        : `${trend >= 0 ? '+' : ''}${trend.toFixed(1)}`
  );

  const criterionTotals = new Map();
  for (const run of runs) {
    const labels = new Map((run.rubric?.criteria ?? []).map((item) => [item.id, item.label]));
    for (const [id, value] of Object.entries(run.rubric?.values ?? {})) {
      if (!Number.isFinite(value)) continue;
      const total = criterionTotals.get(id) ?? { label: labels.get(id) || humanizeId(id), sum: 0, count: 0 };
      total.sum += value;
      total.count += 1;
      criterionTotals.set(id, total);
    }
  }
  for (const total of criterionTotals.values()) {
    appendAiStat(aiResultsSummary, total.label, `${(total.sum / total.count).toFixed(1)} / 5`);
  }

  aiResultsHistory.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement('p');
    empty.className = 'ai-results-empty';
    empty.textContent = 'No reviewed runs yet. Complete a stadium scenario and save its score to build an AI performance history.';
    aiResultsHistory.appendChild(empty);
    return;
  }

  for (const run of runs.slice(0, 60)) {
    const row = document.createElement('article');
    row.className = 'ai-history-row';
    const title = document.createElement('div');
    title.className = 'ai-history-title';
    const strong = document.createElement('strong');
    strong.textContent = run.scenario?.title || run.scenario?.id || 'Scenario';
    const detail = document.createElement('span');
    detail.textContent = `${formatEvaluationDate(run.completedAt)} · v${run.scenario?.version ?? 1} · ${run.ai?.revision || 'unknown'} · ${run.ai?.difficulty || 'medium'}`;
    title.append(strong, detail);

    const outcome = document.createElement('span');
    const status = normalizeOutcomeStatus(run.outcome?.status);
    outcome.className = `ai-outcome-pill ${status}`;
    outcome.textContent = status;
    outcome.title = run.outcome?.reason || '';

    const meta = document.createElement('span');
    meta.className = 'ai-history-meta';
    meta.textContent = `${finiteNumber(run.outcome?.simulatedSeconds, 0).toFixed(1)}s`;

    const score = document.createElement('span');
    score.className = 'ai-history-score';
    score.textContent = Number.isFinite(run.rubric?.overall) ? `${run.rubric.overall.toFixed(1)}/5` : '—';
    row.append(title, outcome, meta, score);
    aiResultsHistory.appendChild(row);
  }
}

function appendAiStat(container, label, value, className = 'ai-results-stat') {
  const card = document.createElement('div');
  card.className = className;
  const caption = document.createElement('span');
  caption.textContent = label;
  const number = document.createElement('strong');
  number.textContent = value;
  card.append(caption, number);
  container.appendChild(card);
}

function formatEvaluationDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function humanizeId(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function exportAiResults() {
  const runs = loadEvaluationRuns();
  if (!runs.length) {
    showToast('There are no AI scores to export');
    return;
  }
  if (downloadEvaluationResults(runs)) showToast(`Exported ${runs.length} AI score${runs.length === 1 ? '' : 's'}`);
  else showToast('This browser could not create the export');
}

function clearAiResults() {
  const runs = loadEvaluationRuns();
  if (!runs.length) {
    showToast('There are no AI scores to clear');
    return;
  }
  if (!window.confirm(`Clear all ${runs.length} saved AI evaluation scores from this browser?`)) return;
  clearEvaluationRuns();
  renderAiScenarioList();
  renderAiResults();
  showToast('AI evaluation history cleared');
}

function loadAiRevision() {
  try {
    return String(localStorage.getItem(AI_REVISION_STORAGE_KEY) || 'baseline').slice(0, 40);
  } catch {
    return 'baseline';
  }
}

function normalizedAiRevision() {
  return aiTestRevision.value.trim().replace(/\s+/g, ' ').slice(0, 40) || 'baseline';
}

function persistAiRevision() {
  aiTestRevision.value = normalizedAiRevision();
  try {
    localStorage.setItem(AI_REVISION_STORAGE_KEY, aiTestRevision.value);
  } catch {
    // Evaluation still works in memory when persistent browser storage is unavailable.
  }
}

function filterAiEvaluationCohort(runs) {
  const revision = normalizedAiRevision();
  const difficulty = normalizeAiDifficulty(aiTestDifficulty.value);
  return runs.filter(
    (run) => run.ai?.revision === revision && run.ai?.difficulty === difficulty
  );
}

function filterCurrentScenarioVersions(runs) {
  const currentVersions = new Map(
    aiScenarioCatalog.map((scenario) => [scenario.id, scenario.version ?? 1])
  );
  return runs.filter(
    (run) => currentVersions.get(run.scenario?.id) === (run.scenario?.version ?? 1)
  );
}

function refreshAiEvaluationCohort() {
  persistAiRevision();
  if (!aiScenarioCatalog.length || currentMenuScreen !== 'ai-tests') return;
  refreshAiScenarioScores();
  renderAiResults();
}

function showAiScenarioHud(scenario) {
  const firstPhase = scenarioTacticalPhases(scenario)[0];
  aiScenarioHudTitle.textContent = scenarioTitle(scenario);
  aiScenarioHudPhase.textContent = formatTacticalPhaseHeading(firstPhase, 0, scenario);
  aiScenarioHudObjective.textContent =
    firstPhase?.objective || scenario.objective || 'Observe the AI behaviour.';
  aiScenarioHudTime.textContent = `0.0 / ${finiteNumber(scenario.maxSeconds, 0).toFixed(1)}s`;
  aiScenarioHud.classList.remove('hidden');
}

function updateAiScenarioHud() {
  if (!activeAiScenario || !game || aiScenarioHud.classList.contains('hidden')) return;
  const progress = game.getScenarioProgress?.() ?? {};
  const elapsed = finiteNumber(progress.elapsed ?? progress.elapsedSeconds, 0);
  const maximum = finiteNumber(progress.maxSeconds, activeAiScenario.scenario.maxSeconds);
  const tacticalPhase = normalizeTacticalPhase(progress.tacticalPhase);
  if (tacticalPhase) {
    aiScenarioHudPhase.textContent = formatTacticalPhaseHeading(
      tacticalPhase,
      tacticalPhase.index,
      activeAiScenario.scenario
    );
    aiScenarioHudObjective.textContent =
      tacticalPhase.objective || activeAiScenario.scenario.objective || 'Observe the AI behaviour.';
  }
  aiScenarioHudTime.textContent = `${elapsed.toFixed(1)} / ${maximum.toFixed(1)}s`;
}

function formatTacticalPhaseHeading(phase, fallbackIndex, scenario) {
  const phases = scenarioTacticalPhases(scenario);
  const index = Math.max(0, Math.trunc(finiteNumber(phase?.index, fallbackIndex)));
  const total = Math.max(phases.length, index + 1);
  const label = tacticalPhaseLabel(phase ?? phases[index]);
  const elapsed = finiteNumber(phase?.elapsedSeconds, NaN);
  const maximum = finiteNumber(phase?.maxSeconds, NaN);
  const timing = Number.isFinite(elapsed)
    ? ` · ${elapsed.toFixed(1)}${Number.isFinite(maximum) ? `/${maximum.toFixed(1)}` : ''}s`
    : '';
  return `Stage ${index + 1}/${total} · ${label}${timing}`;
}

function normalizeTacticalPhase(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  return {
    id,
    index: Math.max(0, Math.trunc(finiteNumber(value.index, 0))),
    label: String(value.label || humanizeId(id) || 'Tactical stage'),
    objective: String(value.objective || ''),
    elapsedSeconds: Math.max(0, finiteNumber(value.elapsedSeconds, 0)),
    maxSeconds: Number.isFinite(Number(value.maxSeconds))
      ? Math.max(0, Number(value.maxSeconds))
      : null,
  };
}

function stopAiScenario() {
  if (!activeAiScenario || !game) return;
  aiScenarioStopBtn.disabled = true;
  if (typeof game.abortScenario === 'function') {
    game.abortScenario('Stopped by reviewer');
    return;
  }
  handleAiScenarioComplete({
    status: 'aborted',
    reason: 'Stopped by reviewer',
    elapsedSeconds: 0,
    metrics: {},
    events: [],
  });
}

function handleAiScenarioComplete(result) {
  if (!activeAiScenario || pendingAiReview) return;
  const outcome = normalizeScenarioOutcome(result);
  pendingAiReview = {
    active: activeAiScenario,
    rawResult: result,
    outcome,
    completedAt: new Date().toISOString(),
  };
  aiScenarioStopBtn.disabled = true;
  if (outcome.diagnostics.tacticalPhase) {
    aiScenarioHudPhase.textContent = formatTacticalPhaseHeading(
      outcome.diagnostics.tacticalPhase,
      outcome.diagnostics.tacticalPhase.index,
      activeAiScenario.scenario
    );
  }
  aiScenarioHudObjective.textContent = humanizeOutcomeReason(outcome.reason);
  aiScenarioHudTime.textContent = `${outcome.simulatedSeconds.toFixed(1)} / ${finiteNumber(activeAiScenario.scenario.maxSeconds, 0).toFixed(1)}s`;
  clearTimeout(aiReviewOpenTimer);
  aiReviewOpenTimer = window.setTimeout(openAiReviewPanel, outcome.status === 'aborted' ? 0 : 850);
}

function normalizeScenarioOutcome(result = {}) {
  const nested = result?.outcome && typeof result.outcome === 'object' ? result.outcome : {};
  const status = normalizeOutcomeStatus(
    nested.status ??
      (typeof result.outcome === 'string' ? result.outcome : null) ??
      result.status ??
      result.phase
  );
  const events = Array.isArray(result.events) ? result.events : [];
  const metrics = {
    ...(nested.metrics && typeof nested.metrics === 'object' ? nested.metrics : {}),
    ...(result.metrics && typeof result.metrics === 'object' ? result.metrics : {}),
  };
  if (result.tuning && typeof result.tuning === 'object') metrics.tuning = result.tuning;
  if (result.simulation && typeof result.simulation === 'object') {
    metrics.frames = finiteNumber(result.simulation.frames, metrics.frames);
    metrics.simulationHz = finiteNumber(result.simulation.hz, metrics.simulationHz);
  }
  if (!Number.isFinite(metrics.eventCount)) metrics.eventCount = events.length;
  metrics.keyEventCount = events.filter((event) => AI_KEY_EVENT_TYPES.has(event?.type)).length;
  const diagnostics = normalizeTacticalDiagnostics(result, events);
  metrics.tacticalDiagnostics = diagnostics;
  const passed = typeof nested.passed === 'boolean'
    ? nested.passed
    : typeof result.passed === 'boolean'
      ? result.passed
      : status === 'success'
        ? true
        : status === 'failure' || status === 'timeout'
          ? false
          : null;
  return {
    status,
    passed,
    reason: String(
      nested.reason ??
        result.reason ??
        (humanizeId(nested.conditionId ?? result.conditionId ?? result.criterionId) || 'Scenario ended')
    ),
    conditionId: String(nested.conditionId ?? result.conditionId ?? result.criterionId ?? ''),
    simulatedSeconds: Math.max(
      0,
      finiteNumber(
        nested.simulatedSeconds ??
          result.simulatedSeconds ??
          result.simulation?.elapsedSeconds ??
          result.elapsedSeconds ??
          result.elapsed,
        0
      )
    ),
    metrics,
    diagnostics,
  };
}

function normalizeOutcomeStatus(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'passed' || normalized === 'pass') return 'success';
  if (normalized === 'failed' || normalized === 'fail') return 'failure';
  if (normalized === 'timed_out' || normalized === 'timed-out') return 'timeout';
  if (normalized === 'stopped' || normalized === 'cancelled' || normalized === 'canceled') return 'aborted';
  return ['success', 'failure', 'timeout', 'aborted'].includes(normalized) ? normalized : 'failure';
}

function normalizeTacticalDiagnostics(result, events = []) {
  const source = result?.diagnostics && typeof result.diagnostics === 'object' ? result.diagnostics : {};
  const metricSource = result?.metrics && typeof result.metrics === 'object' ? result.metrics : {};
  const phaseHistorySource = Array.isArray(result?.phaseHistory)
    ? result.phaseHistory
    : Array.isArray(source.phaseHistory)
      ? source.phaseHistory
      : Array.isArray(metricSource.phaseHistory)
        ? metricSource.phaseHistory
        : events.filter((event) => event?.type === 'phase-start' || event?.type === 'phase-complete');
  const phaseHistory = phaseHistorySource.map((entry) => ({
    type: entry?.type === 'phase-complete' ? 'phase-complete' : 'phase-start',
    phaseId: String(entry?.phaseId || entry?.tacticalPhaseId || ''),
    phaseIndex: Math.max(0, Math.trunc(finiteNumber(entry?.phaseIndex, 0))),
    time: Math.max(0, finiteNumber(entry?.time, 0)),
    reason: String(entry?.reason || ''),
  }));

  const opportunitySource =
    (result?.opportunities && typeof result.opportunities === 'object' && result.opportunities) ||
    (source.opportunities && typeof source.opportunities === 'object' && source.opportunities) ||
    (metricSource.opportunities && typeof metricSource.opportunities === 'object' &&
      metricSource.opportunities) ||
    {};
  const opportunities = {};
  for (const [key, value] of Object.entries(opportunitySource)) {
    if (!value || typeof value !== 'object') continue;
    const id = String(value.id || key);
    opportunities[id] = {
      id,
      label: String(value.label || humanizeId(id) || 'Opportunity'),
      open: Boolean(value.open),
      openedAt: finiteDiagnosticNumber(value.openedAt),
      windows: (Array.isArray(value.windows) ? value.windows : []).map((window) => ({
        openedAt: Math.max(0, finiteNumber(window?.openedAt, 0)),
        closedAt: finiteDiagnosticNumber(window?.closedAt),
        durationSeconds: Math.max(0, finiteNumber(window?.durationSeconds, 0)),
      })),
    };
  }

  const probeSource =
    (source.probes && typeof source.probes === 'object' && source.probes) ||
    (metricSource.probes && typeof metricSource.probes === 'object' && metricSource.probes) ||
    {};
  const probes = {};
  for (const [key, value] of Object.entries(probeSource)) {
    if (!value || typeof value !== 'object') continue;
    const id = String(value.id || key);
    probes[id] = {
      id,
      label: String(value.label || humanizeId(id) || 'Probe'),
      measure: String(value.measure || ''),
      samples: Math.max(0, Math.trunc(finiteNumber(value.samples, 0))),
      min: finiteDiagnosticNumber(value.min),
      minAt: finiteDiagnosticNumber(value.minAt),
      max: finiteDiagnosticNumber(value.max),
      maxAt: finiteDiagnosticNumber(value.maxAt),
      average: finiteDiagnosticNumber(value.average),
      last: finiteDiagnosticNumber(value.last),
      lastAt: finiteDiagnosticNumber(value.lastAt),
    };
  }

  const transitionSource =
    (source.actionTransitionsByActor &&
      typeof source.actionTransitionsByActor === 'object' &&
      source.actionTransitionsByActor) ||
    (metricSource.actionTransitionsByActor &&
      typeof metricSource.actionTransitionsByActor === 'object' &&
      metricSource.actionTransitionsByActor) ||
    deriveActionTransitions(events);
  const actionTransitionsByActor = {};
  for (const [actorId, transitions] of Object.entries(transitionSource)) {
    if (!Array.isArray(transitions)) continue;
    actionTransitionsByActor[actorId] = transitions.map((transition) => ({
      time: Math.max(0, finiteNumber(transition?.time, 0)),
      from: String(transition?.from || ''),
      to: String(transition?.to || ''),
      intent: String(transition?.intent || ''),
      tacticalPhaseId: String(transition?.tacticalPhaseId || ''),
      targetX: finiteDiagnosticNumber(transition?.targetX),
      targetZ: finiteDiagnosticNumber(transition?.targetZ),
    }));
  }

  return {
    tacticalPhase: normalizeTacticalPhase(result?.tacticalPhase),
    phaseHistory,
    opportunities,
    probes,
    actionTransitionsByActor,
  };
}

function deriveActionTransitions(events) {
  const transitions = {};
  const previousByActor = new Map();
  for (const event of events) {
    if (event?.type !== 'decision' || !event.actorId) continue;
    const actorId = String(event.actorId);
    const next = String(event.action || 'unknown');
    const previous = previousByActor.get(actorId);
    if (previous === next) continue;
    (transitions[actorId] ??= []).push({
      time: finiteNumber(event.time, 0),
      from: previous ?? '',
      to: next,
      intent: event.intent,
      tacticalPhaseId: event.tacticalPhaseId,
      targetX: event.targetX,
      targetZ: event.targetZ,
    });
    previousByActor.set(actorId, next);
  }
  return transitions;
}

function finiteDiagnosticNumber(value) {
  if (value == null || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function openAiReviewPanel() {
  if (!pendingAiReview) return;
  const { active, outcome } = pendingAiReview;
  const scenario = active.scenario;
  const criteria = scenarioRatingCriteria(scenario);
  aiReviewTitle.textContent = scenarioTitle(scenario);
  aiReviewDescription.textContent = scenario.objective || 'Score the behaviour you observed.';
  aiReviewStatus.textContent = `Automatic ${outcome.status}`;
  aiReviewOutcome.className = `ai-review-outcome ${outcome.status}`;
  aiReviewOutcomeTitle.textContent = {
    success: 'Objective achieved',
    failure: 'Objective failed',
    timeout: 'Scenario timed out',
    aborted: 'Scenario stopped',
  }[outcome.status];
  aiReviewOutcomeReason.textContent = humanizeOutcomeReason(outcome.reason);
  aiReviewTime.textContent = `${outcome.simulatedSeconds.toFixed(2)}s`;
  aiReviewEvents.textContent = String(finiteNumber(outcome.metrics.keyEventCount, 0));
  renderAiReviewDiagnostics(outcome.diagnostics, scenario);
  aiReviewCriteria.replaceChildren();
  aiReviewNotes.value = '';
  aiReviewError.textContent = '';
  aiReviewSaveBtn.disabled = false;

  criteria.forEach((criterion, index) => {
    const id = String(criterion.id || `criterion-${index + 1}`);
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'ai-rating-group';
    fieldset.dataset.criterionId = id;
    const legend = document.createElement('legend');
    legend.textContent = criterion.label || criterion.title || humanizeId(id);
    const help = document.createElement('p');
    help.className = 'ai-rating-help';
    help.textContent = criterion.description || criterion.help || 'Rate from weak (1) to excellent (5).';
    const options = document.createElement('div');
    options.className = 'ai-rating-options';
    for (let score = 1; score <= 5; score++) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `ai-rating-${index}`;
      input.value = String(score);
      input.required = true;
      const visible = document.createElement('span');
      visible.textContent = String(score);
      label.append(input, visible);
      options.appendChild(label);
    }
    fieldset.append(legend, help, options);
    aiReviewCriteria.appendChild(fieldset);
  });

  aiReviewPanel.classList.remove('hidden');
  aiReviewPanel.setAttribute('aria-hidden', 'false');
  canvas.inert = true;
  hudRoot.inert = true;
  soundControls.inert = true;
  setInputLocked(true);
  setGameplayActive(false);
  aiReviewCriteria.querySelector('input')?.focus();
}

function renderAiReviewDiagnostics(diagnostics, scenario) {
  aiReviewDiagnostics.replaceChildren();
  const history = diagnostics?.phaseHistory ?? [];
  const opportunities = Object.values(diagnostics?.opportunities ?? {});
  const probes = Object.values(diagnostics?.probes ?? {});
  const transitions = diagnostics?.actionTransitionsByActor ?? {};
  const transitionCount = Object.values(transitions).reduce(
    (total, actorTransitions) => total + actorTransitions.length,
    0
  );
  if (!history.length && !opportunities.length && !probes.length && !transitionCount) {
    aiReviewDiagnostics.classList.add('hidden');
    return;
  }

  const header = document.createElement('div');
  header.className = 'ai-review-diagnostics-header';
  const title = document.createElement('strong');
  title.textContent = 'Tactical trace';
  const summary = document.createElement('span');
  const completedPhases = history.filter((entry) => entry.type === 'phase-complete').length;
  summary.textContent = `${completedPhases} stage${completedPhases === 1 ? '' : 's'} completed`;
  header.append(title, summary);

  const journey = document.createElement('ol');
  journey.className = 'ai-review-phase-path';
  const phaseDefinitions = new Map(scenarioTacticalPhases(scenario).map((phase) => [phase.id, phase]));
  const starts = history.filter((entry) => entry.type === 'phase-start');
  for (const entry of starts) {
    const item = document.createElement('li');
    const definition = phaseDefinitions.get(entry.phaseId);
    const label = document.createElement('strong');
    label.textContent = tacticalPhaseLabel(definition ?? { id: entry.phaseId });
    const completion = history.find(
      (candidate) => candidate.type === 'phase-complete' && candidate.phaseId === entry.phaseId
    );
    const timing = document.createElement('span');
    timing.textContent = completion
      ? `${entry.time.toFixed(2)}–${completion.time.toFixed(2)}s`
      : `from ${entry.time.toFixed(2)}s`;
    item.classList.toggle('complete', Boolean(completion));
    item.append(label, timing);
    journey.appendChild(item);
  }

  const stats = document.createElement('dl');
  stats.className = 'ai-review-diagnostic-stats';
  appendReviewDiagnosticStat(stats, 'Opportunity windows', String(countOpportunityWindows(opportunities)));
  appendReviewDiagnosticStat(stats, 'Probes', String(probes.length));
  appendReviewDiagnosticStat(stats, 'Decision shifts', String(transitionCount));

  const details = document.createElement('div');
  details.className = 'ai-review-diagnostic-details';
  for (const opportunity of opportunities.slice(0, 2)) {
    const windowCount = opportunity.windows.length + (opportunity.open ? 1 : 0);
    appendReviewDiagnosticLine(
      details,
      opportunity.label,
      `${windowCount} window${windowCount === 1 ? '' : 's'}${opportunity.open ? ' · open at finish' : ''}`
    );
  }
  for (const probe of probes.slice(0, 2)) {
    const range = probe.min == null || probe.max == null ? 'no range' : `${formatProbeValue(probe.min)}–${formatProbeValue(probe.max)}`;
    const average = probe.average == null ? '' : ` · avg ${formatProbeValue(probe.average)}`;
    appendReviewDiagnosticLine(details, probe.label, `${range}${average}`);
  }
  for (const [actorId, actorTransitions] of Object.entries(transitions).slice(0, 2)) {
    const path = actorTransitions
      .slice(-4)
      .map((transition) => humanizeId(transition.to || transition.from || 'unknown'))
      .join(' → ');
    appendReviewDiagnosticLine(details, humanizeId(actorId), path || 'No decision shift');
  }

  aiReviewDiagnostics.append(header);
  if (journey.childElementCount) aiReviewDiagnostics.appendChild(journey);
  aiReviewDiagnostics.append(stats, details);
  aiReviewDiagnostics.classList.remove('hidden');
}

function appendReviewDiagnosticStat(list, label, value) {
  const item = document.createElement('div');
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  item.append(term, description);
  list.appendChild(item);
}

function appendReviewDiagnosticLine(container, label, value) {
  const row = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = label;
  const span = document.createElement('span');
  span.textContent = value;
  row.append(strong, span);
  container.appendChild(row);
}

function countOpportunityWindows(opportunities) {
  return opportunities.reduce(
    (total, opportunity) => total + opportunity.windows.length + (opportunity.open ? 1 : 0),
    0
  );
}

function formatProbeValue(value) {
  const absolute = Math.abs(value);
  return absolute >= 100 ? value.toFixed(0) : absolute >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function humanizeOutcomeReason(reason) {
  const text = String(reason || 'Scenario ended').trim();
  if (!text) return 'Scenario ended';
  if (/^[a-z0-9_-]+$/i.test(text)) return humanizeId(text);
  return text;
}

function saveAiReview(event) {
  event.preventDefault();
  if (!pendingAiReview) return;
  const criteria = scenarioRatingCriteria(pendingAiReview.active.scenario);
  const values = {};
  const fieldsets = [...aiReviewCriteria.querySelectorAll('.ai-rating-group')];
  for (const fieldset of fieldsets) {
    const selected = fieldset.querySelector('input:checked');
    if (!selected) {
      aiReviewError.textContent = 'Rate every parameter before saving this run.';
      fieldset.querySelector('input')?.focus();
      return;
    }
    values[fieldset.dataset.criterionId] = Number(selected.value);
  }

  aiReviewSaveBtn.disabled = true;
  const { active, outcome, completedAt } = pendingAiReview;
  try {
    const savedRun = saveEvaluationRun({
      scenario: {
        id: active.scenario.id,
        version: active.scenario.version ?? 1,
        title: scenarioTitle(active.scenario),
        category: active.scenario.category || 'behaviour',
      },
      setup: scenarioSetupSnapshot(active),
      ai: { revision: active.revision, difficulty: active.difficulty },
      outcome,
      rubric: {
        criteria: criteria.map((criterion, index) => ({
          id: criterion.id || `criterion-${index + 1}`,
          label: criterion.label || criterion.title || humanizeId(criterion.id),
          weight: finiteNumber(criterion.weight, 1),
        })),
        values,
        notes: aiReviewNotes.value,
      },
      startedAt: active.startedAt,
      completedAt,
    });
    if (savedRun.persistence === 'memory') {
      showToast('Score kept for this session only; browser storage is unavailable');
    } else {
      showToast('AI evaluation score saved');
    }
  } catch (error) {
    aiReviewSaveBtn.disabled = false;
    aiReviewError.textContent = error?.message || 'Could not save this evaluation.';
    return;
  }
  returnToAiEvaluationLab('results');
}

function scenarioSetupSnapshot(active) {
  const scenario = active.scenario;
  const ball = scenario.initial?.ball ?? scenario.ball ?? { x: 0, z: 0, vx: 0, vz: 0 };
  return {
    ball: {
      x: finiteNumber(ball.x, 0),
      z: finiteNumber(ball.z, 0),
      vx: finiteNumber(ball.vx, 0),
      vz: finiteNumber(ball.vz, 0),
    },
    players: active.players.map((player) => ({
      id: player.id,
      heroKind: player.heroKind,
      team: player.team,
      control: player.control,
      difficulty: player.difficulty,
      x: player.spawnX,
      z: player.spawnZ,
      vx: player.velocityX,
      vz: player.velocityZ,
      defendZSign: player.defendZSign,
    })),
  };
}

function retryAiScenario() {
  const active = pendingAiReview?.active;
  if (!active) return;
  const scenario = active.scenario;
  aiTestDifficulty.value = active.difficulty;
  aiTestRevision.value = active.revision;
  closeAiReviewPanel();
  disposeAiScenario();
  watchAiScenario(scenario).catch((error) => {
    console.error(error);
    returnToAiEvaluationLab('scenarios');
  });
}

function discardAiReview() {
  returnToAiEvaluationLab('scenarios');
}

function returnToAiEvaluationLab(tab = 'scenarios') {
  closeAiReviewPanel();
  disposeAiScenario();
  hudRoot.classList.add('hidden');
  menu.classList.remove('hidden');
  aiTestActiveTab = tab;
  showAiTestPanel().catch((error) => console.error(error));
}

function disposeAiScenario() {
  clearTimeout(aiReviewOpenTimer);
  aiReviewOpenTimer = 0;
  setGameplayActive(false);
  game?.dispose();
  game = null;
  localMatchState = null;
  activeAiScenario = null;
  pendingAiReview = null;
  aiScenarioHud.classList.add('hidden');
  aiScenarioStopBtn.disabled = false;
  setIntentOverlay(false);
}

function closeAiReviewPanel() {
  aiReviewPanel.classList.add('hidden');
  aiReviewPanel.setAttribute('aria-hidden', 'true');
  canvas.inert = false;
  hudRoot.inert = false;
  soundControls.inert = false;
  setInputLocked(false);
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
  if (isAiReviewPanelOpen()) {
    if (event.code === 'Tab') {
      trapAiReviewFocus(event);
      return;
    }
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      aiReviewDiscardBtn.focus();
    }
    return;
  }
  if (activeAiScenario && event.code === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) stopAiScenario();
    return;
  }
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

function isAiReviewPanelOpen() {
  return !aiReviewPanel.classList.contains('hidden');
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

function trapAiReviewFocus(event) {
  const focusable = Array.from(
    aiReviewPanel.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
    )
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
  if (heroKind === 'shaggy') return 'shaggy';
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
  updateAiScenarioHud();
  updateOnlineTransport(dt);
  scoreboard?.syncPosition();
  updatePhysicsOverlay(game, dt);
  if (scene) outlineEffect.render(scene, camera);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
