import { loadAssets } from './assets.js';
import { createRenderer, createCamera, buildWorld } from './scene.js';
import { Game } from './game.js';
import { readCommands } from './input.js';
import { createHostSession, createGuestSession, normalizeRoomCode, MAX_GUESTS } from './online.js';
import { initDebugPanel, updatePhysicsOverlay } from './debug.js';
import { TEAM } from './constants.js';

initDebugPanel();

const PLAYER_SPAWN_Z = 7.8;
const MAX_ONLINE_PLAYERS = MAX_GUESTS + 1;
const NICKNAME_MAX_LENGTH = 16;
const INPUT_RATE = 30;
const SNAPSHOT_RATE = 45;
const EMPTY_COMMANDS = Object.freeze({ moveX: 0, moveZ: 0, shoot: false, power: false });
const HERO_LABELS = Object.freeze({ sam: 'Sam', tesla: 'Tesla' });
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

const nicknameInput = document.getElementById('nickname-input');
const heroPick = document.getElementById('hero-pick');
const startBtn = document.getElementById('start-btn');
const hostBtn = document.getElementById('host-btn');
const joinBtn = document.getElementById('join-btn');
const localPanel = document.getElementById('local-panel');
const localStatus = document.getElementById('local-status');
const startLocalBtn = document.getElementById('start-local-btn');
const cancelLocalBtn = document.getElementById('cancel-local-btn');
const localRedRoster = document.getElementById('local-red-roster');
const localBlueRoster = document.getElementById('local-blue-roster');
const onlinePanel = document.getElementById('online-panel');
const onlineTitle = document.getElementById('online-title');
const onlineStatus = document.getElementById('online-status');
const primaryCode = document.getElementById('primary-code');
const primaryCodeLabel = document.getElementById('primary-code-label');
const copyPrimaryBtn = document.getElementById('copy-primary-btn');
const startOnlineBtn = document.getElementById('start-online-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const cancelOnlineBtn = document.getElementById('cancel-online-btn');
const lobbyRoster = document.getElementById('lobby-roster');

const hud = {
  powerFill: document.getElementById('power-fill'),
  banner: document.getElementById('banner'),
};

const defaultNickname = generateDefaultNickname();
nicknameInput.value = defaultNickname;
nicknameInput.addEventListener('input', () => {
  if (isLocalPanelOpen()) renderLocalRoster();
  if (onlineState?.role === 'host' && !onlineState.started) {
    syncHostPlayerInfo();
    renderHostLobbyRoster();
    broadcastLobbyState();
  }
});
nicknameInput.addEventListener('blur', () => {
  nicknameInput.value = currentNickname();
  if (isLocalPanelOpen()) renderLocalRoster();
  syncLocalLobbyInfo();
});

let selectedHero = 'sam';
const localHeroSelections = ['sam', 'tesla', 'tesla', 'sam'];
for (const btn of document.querySelectorAll('.hero-btn')) {
  btn.addEventListener('click', () => {
    document.querySelector('.hero-btn.selected')?.classList.remove('selected');
    btn.classList.add('selected');
    selectedHero = normalizeHero(btn.dataset.hero);
    localHeroSelections[0] = selectedHero;
    if (isLocalPanelOpen()) renderLocalRoster();
    syncLocalLobbyInfo();
  });
}

let selectedLocalTeamSize = 1;
for (const btn of document.querySelectorAll('.match-size-btn')) {
  btn.addEventListener('click', () => {
    const previous = document.querySelector('.match-size-btn.selected');
    previous?.classList.remove('selected');
    previous?.setAttribute('aria-pressed', 'false');
    btn.classList.add('selected');
    btn.setAttribute('aria-pressed', 'true');
    selectedLocalTeamSize = normalizeLocalTeamSize(btn.dataset.localSize);
    if (isLocalPanelOpen()) renderLocalRoster();
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

startBtn.addEventListener('click', showLocalPanel);
startLocalBtn.addEventListener('click', startLocalMatch);
cancelLocalBtn.addEventListener('click', closeLocalPanel);
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
  localHeroSelections[0] = normalizeHero(selectedHero);
  localPanel.classList.remove('hidden');
  heroPick.classList.add('hidden');
  renderLocalRoster();
}

function closeLocalPanel() {
  localPanel.classList.add('hidden');
  heroPick.classList.remove('hidden');
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
    loading.textContent = 'Failed to load assets - serve this folder over HTTP.';
    console.error(err);
    return;
  }

  enterGameView();
  game?.dispose();
  game = new Game({
    scene,
    camera,
    assets,
    hud,
    scoreboard,
    playerSpecs: buildLocalPlayers(selectedLocalTeamSize),
    localPlayerIndex: 0,
  });
  game.onMatchEnd = returnToMenu;
}

async function startHostFlow() {
  closeLocalPanel();
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
    startGuestMatch(message.players, message.localPlayerIndex).catch((err) =>
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
  } else if (message.type === 'matchEnded') {
    returnToMenu();
  }
}

async function startHostedMatch() {
  if (!onlineState || onlineState.role !== 'host' || onlineState.started) return;

  syncHostPlayerInfo();
  const guests = onlineState.guests.slice(0, MAX_GUESTS);
  const roster = currentHostRoster();
  if (guests.length < 1 || !hasBothTeams(roster)) {
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

  await startOnlineGame('host', players, 0);
  guests.forEach((guest, index) => {
    onlineSession?.sendTo(guest.connectionId, {
      type: 'start',
      players,
      localPlayerIndex: index + 1,
    });
  });
}

async function startGuestMatch(players, localPlayerIndex = 1) {
  if (!onlineState || onlineState.started) return;
  const sanitizedPlayers = sanitizePlayers(players);
  await startOnlineGame('guest', sanitizedPlayers, localPlayerIndex);
}

async function startOnlineGame(role, players, localPlayerIndex = role === 'host' ? 0 : 1) {
  try {
    await ensureAssets();
  } catch (err) {
    loading.textContent = 'Failed to load assets - serve this folder over HTTP.';
    throw err;
  }

  enterGameView();
  game?.dispose();

  const safeLocalPlayerIndex = clampPlayerIndex(localPlayerIndex, players.length);
  game = new Game({
    scene,
    camera,
    assets,
    hud,
    scoreboard,
    playerSpecs: players.map((player, index) => ({
      ...player,
      control: index === safeLocalPlayerIndex ? 'local' : 'remote',
    })),
    localPlayerIndex: safeLocalPlayerIndex,
    authoritative: role === 'host',
    inputProvider: (_player, index) =>
      onlineState?.remoteCommands.get(index) ?? EMPTY_COMMANDS,
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
  closeLocalPanel();
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
    remoteCommands: new Map(),
    connectionPlayerIndexes: new Map(),
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
  syncHostPlayerInfo();
  onlinePanel.classList.remove('hidden');
  onlineTitle.textContent = 'Host Online';
  primaryCodeLabel.textContent = 'Room Code';
  primaryCode.value = '';
  primaryCode.readOnly = true;
  copyPrimaryBtn.classList.remove('hidden');
  startOnlineBtn.classList.remove('hidden');
  startOnlineBtn.disabled = true;
  startOnlineBtn.textContent = 'Start Match';
  joinRoomBtn.classList.add('hidden');
  lobbyRoster.classList.remove('hidden');
  renderHostLobbyRoster();
}

function configureJoinPanel() {
  onlinePanel.classList.remove('hidden');
  onlineTitle.textContent = 'Join Online';
  primaryCodeLabel.textContent = 'Room Code';
  primaryCode.value = '';
  primaryCode.readOnly = false;
  copyPrimaryBtn.classList.add('hidden');
  startOnlineBtn.classList.add('hidden');
  startOnlineBtn.disabled = true;
  joinRoomBtn.classList.remove('hidden');
  lobbyRoster.classList.remove('hidden');
  lobbyRoster.replaceChildren();
  setOnlineStatus('Enter room code');
  primaryCode.focus();
}

function resetOnlinePanel() {
  onlinePanel.classList.add('hidden');
  primaryCode.value = '';
  startOnlineBtn.classList.add('hidden');
  startOnlineBtn.disabled = true;
  lobbyRoster.classList.add('hidden');
  lobbyRoster.replaceChildren();
  setOnlineStatus('Idle');
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
  renderHostLobbyRoster();

  const guestCount = onlineState.guests.length;
  const playerCount = guestCount + 1;
  const teamsReady = hasBothTeams(currentHostRoster());
  const canStart = guestCount > 0 && teamsReady && !onlineState.started;

  startOnlineBtn.disabled = !canStart;
  startOnlineBtn.textContent = playerCount > 2 ? `Start ${playerCount} Players` : 'Start Match';

  if (guestCount === 0) {
    setOnlineStatus(`Waiting for players (0/${MAX_GUESTS})`);
  } else if (!teamsReady) {
    setOnlineStatus('Pick red and blue teams');
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

  onlineSession.send({
    type: 'lobby',
    players: publicLobbyPlayers(currentHostRoster()),
    canStart: !startOnlineBtn.disabled,
    status: onlineStatus.textContent,
  });
}

function updateGuestLobby(message) {
  if (!onlineState || onlineState.role !== 'guest' || onlineState.started) return;

  onlineState.lobbyPlayers = sanitizeLobbyPlayers(message.players);
  renderLobbyRoster(onlineState.lobbyPlayers, false);
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

    const details = document.createElement('div');
    details.className = 'local-player-main';

    const name = document.createElement('div');
    name.className = 'local-player-name';
    name.textContent = slot.name;

    const meta = document.createElement('div');
    meta.className = 'local-player-role';
    meta.textContent = slot.meta;

    details.appendChild(name);
    details.appendChild(meta);

    const heroes = document.createElement('div');
    heroes.className = 'hero-toggle';
    heroes.appendChild(createLocalHeroButton(slot.selectionIndex, 'sam'));
    heroes.appendChild(createLocalHeroButton(slot.selectionIndex, 'tesla'));

    row.appendChild(details);
    row.appendChild(heroes);
    const roster = slot.team === TEAM.BLUE ? localBlueRoster : localRedRoster;
    roster.appendChild(row);
  }

  updateLocalStatus();
}

function createLocalHeroButton(selectionIndex, heroKind) {
  const normalizedHero = normalizeHero(heroKind);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hero-choice';
  button.classList.toggle('active', localHeroSelections[selectionIndex] === normalizedHero);
  button.setAttribute('aria-pressed', localHeroSelections[selectionIndex] === normalizedHero ? 'true' : 'false');
  button.textContent = heroName(normalizedHero);
  button.addEventListener('click', () => {
    localHeroSelections[selectionIndex] = normalizedHero;
    if (selectionIndex === 0) {
      selectedHero = normalizedHero;
      syncHeroPickerSelection();
    }
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
      meta: 'You',
      team: TEAM.RED,
      teamSlot: 0,
      control: 'local',
    },
    {
      selectionIndex: 2,
      name: 'AI Opponent',
      meta: 'AI',
      team: TEAM.BLUE,
      teamSlot: 0,
      control: 'ai',
    },
  ];

  if (playersPerTeam === 2) {
    slots.splice(1, 0, {
      selectionIndex: 1,
      name: 'AI Teammate',
      meta: 'AI',
      team: TEAM.RED,
      teamSlot: 1,
      control: 'ai',
    });
    slots.push({
      selectionIndex: 3,
      name: 'AI Opponent 2',
      meta: 'AI',
      team: TEAM.BLUE,
      teamSlot: 1,
      control: 'ai',
    });
  }

  return slots;
}

function updateLocalStatus() {
  const playersPerTeam = normalizeLocalTeamSize(selectedLocalTeamSize);
  localStatus.textContent = `${playersPerTeam}x${playersPerTeam} ready`;
}

function renderHostLobbyRoster() {
  if (!onlineState || onlineState.role !== 'host') return;

  renderLobbyRoster(currentHostRoster(), true);
}

function renderLobbyRoster(players, editable) {
  lobbyRoster.replaceChildren();
  lobbyRoster.classList.remove('hidden');

  for (const player of players) {
    const row = document.createElement('div');
    row.className = 'lobby-row';

    const details = document.createElement('div');
    details.className = 'lobby-player';

    const name = document.createElement('div');
    name.className = 'lobby-name';
    name.textContent = player.nickname;

    const meta = document.createElement('div');
    meta.className = 'lobby-meta';
    meta.textContent = `${heroName(player.heroKind)}${player.isHost || player.connectionId === 'host' ? ' - Host' : ''}`;

    details.appendChild(name);
    details.appendChild(meta);

    const teams = document.createElement('div');
    teams.className = 'team-toggle';
    teams.appendChild(createTeamButton(player, TEAM.RED, editable));
    teams.appendChild(createTeamButton(player, TEAM.BLUE, editable));

    row.appendChild(details);
    row.appendChild(teams);
    lobbyRoster.appendChild(row);
  }
}

function createTeamButton(player, team, editable) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `team-choice ${teamClass(team)}`;
  button.classList.toggle('active', player.team === team);
  button.textContent = teamName(team);
  button.disabled = !editable;
  if (editable) {
    button.addEventListener('click', () => {
      player.team = team;
      updateHostLobbyStatus();
    });
  }
  return button;
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

function syncHeroPickerSelection() {
  for (const btn of document.querySelectorAll('.hero-btn')) {
    btn.classList.toggle('selected', normalizeHero(btn.dataset.hero) === selectedHero);
  }
}

function normalizeLocalTeamSize(teamSize) {
  return Number(teamSize) === 2 ? 2 : 1;
}

function buildLocalPlayers(teamSize) {
  return localRosterSlots(teamSize).map((slot) =>
    localPlayerSpec(
      slot.team,
      slot.teamSlot,
      localHeroSelections[slot.selectionIndex],
      slot.control
    )
  );
}

function localPlayerSpec(team, slot, heroKind, control) {
  const spawn = TEAM_SPAWNS[team][slot] ?? TEAM_SPAWNS[team][0];
  return {
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

function normalizeTeam(team, fallback = TEAM.RED) {
  const parsed = Number(team);
  return parsed === TEAM.BLUE ? TEAM.BLUE : parsed === TEAM.RED ? TEAM.RED : fallback;
}

function defaultTeamForPlayerIndex(index) {
  return index % 2 === 0 ? TEAM.RED : TEAM.BLUE;
}

function teamName(team) {
  return team === TEAM.BLUE ? 'Blue' : 'Red';
}

function teamClass(team) {
  return team === TEAM.BLUE ? 'blue' : 'red';
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

  if (!hasBothTeams(normalizedRoster)) {
    throw new Error('Pick red and blue teams');
  }

  return assignPlayerSpawns(normalizedRoster);
}

function assignPlayerSpawns(players) {
  const teamSlots = { [TEAM.RED]: 0, [TEAM.BLUE]: 0 };
  return players.map((player, index) => {
    const team = normalizeTeam(player.team, defaultTeamForPlayerIndex(index));
    const slot = teamSlots[team]++;
    const spawn = TEAM_SPAWNS[team][slot] ?? TEAM_SPAWNS[team][TEAM_SPAWNS[team].length - 1];
    return {
      nickname: normalizeNickname(player.nickname, `Player ${index + 1}`),
      heroKind: normalizeHero(player.heroKind),
      team,
      spawnX: spawn.x,
      spawnZ: spawn.z,
    };
  });
}

function hasBothTeams(players) {
  return players.some((player) => player.team === TEAM.RED) &&
    players.some((player) => player.team === TEAM.BLUE);
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
  if (scene) renderer.render(scene, camera);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
