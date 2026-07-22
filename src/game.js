import * as THREE from 'three';
import { PITCH, PLAYER, BALL, MATCH, TEAM, TEAM_COLORS, NO_REFLECT_LAYER } from './constants.js';
import {
  createBody,
  integrate,
  clampSpeed,
  collideWalls,
  collidePlayerBounds,
  collideGoalPosts,
  collideCircles,
  isTouching,
  goalScored,
} from './physics.js';
import { readCommands } from './input.js?v=ui-focused-9';
import { computeAICommands, createTeamAIState, resetTeamAIState, AI_DIFFICULTY } from './ai.js';
import {
  computeScenarioScriptCommands,
  createScenarioTracker,
  projectedGoalTeam,
  SCENARIO_DT,
} from './ai-scenario-runtime.js';
import { createHero } from './heroes.js';
import { cloneHeroScene, tintHero, footLift } from './assets.js';
import { spawnDashSmoke, createMagnetFieldFX, spawnForceFieldFX } from './effects.js';
import { disableOutline } from './toon.js';
import { DEBUG } from './debug.js';
import { TUNING } from './tuning.js';

const SPAWN_Z = 7.8;
// Ball-into-wall speed below which no force field shows (rolling along the
// wall shouldn't strobe), and the speed at which the effect reaches full size.
const WALL_FX_MIN_IMPACT = 2;
const WALL_FX_MAX_IMPACT = 10;
const EMPTY_SCREEN_COMMANDS = Object.freeze({ moveX: 0, moveZ: 0, shoot: false, power: false });
const REMOTE_HERO_VISUAL = Object.freeze({
  lead: 0.05,
  response: 30,
  snapDistance: 2.5,
});
const REMOTE_BALL_VISUAL = Object.freeze({
  lead: 0.075,
  response: 45,
  snapDistance: 1.6,
});
// FIFA-style overhead marker: one color per player slot, stable across teams.
const INDICATOR_COLORS = ['#ff2e5e', '#35b1ff', '#ffd23f', '#b06bff'];
// Match the HUD power bar (css/style.css): orange while charging, green when ready.
const INDICATOR_READY_COLOR = '#2ee66b';
const INDICATOR_CHARGING_COLOR = '#ff9b2f';
const SOUND_KINDS = new Set([
  'kick',
  'wall',
  'dash',
  'magnet_on',
  'magnet_capture',
  'magnet_off',
  'kickoff',
  'goal',
  'match_end',
]);
const POWER_SOUND_KIND = Object.freeze({
  shoot: 'kick',
  dash: 'dash',
  magnet_on: 'magnet_on',
  magnet_capture: 'magnet_capture',
  magnet_off: 'magnet_off',
});
let nextAudioScopeId = 1;

export class Game {
  constructor({
    scene,
    camera,
    assets,
    hud,
    scoreboard,
    audio = null,
    playerHero,
    playerSpecs,
    localPlayerIndex = 0,
    authoritative = true,
    inputProvider = null,
    timeLimitSeconds = MATCH.duration,
    scoreLimit = MATCH.scoreLimit,
    aiDifficulty = 'medium',
    scenario = null,
    onScenarioComplete = null,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.assets = assets;
    this.hud = hud;
    this.scoreboard = scoreboard;
    this.audio = audio;
    this.audioScopeId = nextAudioScopeId++;
    this.localPlayerIndex = localPlayerIndex;
    this.authoritative = authoritative;
    this.inputProvider = inputProvider;
    this.aiDifficulty = AI_DIFFICULTY[aiDifficulty] ? aiDifficulty : 'medium';
    this.scenario = scenario;
    this.onScenarioComplete = typeof onScenarioComplete === 'function' ? onScenarioComplete : null;
    this.scenarioMode = Boolean(scenario);
    this.scenarioAuthoritative = this.scenarioMode && authoritative;
    this.scenarioTracker = null;
    this.scenarioAccumulator = 0;
    this.scenarioElapsed = 0;
    this.scenarioMaxSeconds = scenarioMaxSeconds(scenario);
    this.scenarioReadySeconds = scenarioReadySeconds(scenario);
    this.scenarioReadyRemaining = this.scenarioReadySeconds;
    this.scenarioFinished = false;
    this.scenarioResult = null;
    this.scenarioCallbackSent = false;
    this.scenarioGoalRecorded = false;

    this.state = 'kickoff';
    this.stateTimer = MATCH.kickoffDelay;
    this.matchDuration = normalizeTimeLimitSeconds(timeLimitSeconds);
    this.timeLeft = this.matchDuration;
    this.scoreLimit = normalizeScoreLimit(scoreLimit);
    this.score = { [TEAM.RED]: 0, [TEAM.BLUE]: 0 };
    this.goldenGoal = false;
    this.onMatchEnd = null;

    this.pitchGoalHalfWidth = PITCH.goalHalfWidth;
    this.pitchGoalDepth = PITCH.goalDepth;

    this.effects = [];
    this.activeBanner = { visible: false, text: '', color: '#ffffff' };
    this.lastSnapshotSeq = 0;
    this.soundEventSeq = 0;
    this.lastNetworkSoundEventId = 0;
    this.onFxEvent = null;
    this.onWallFxEvent = null;
    this.onSoundEvent = null;

    this.ball = this.createBall();
    const scenarioSpecs = this.scenarioMode ? scenarioPlayerSpecs(scenario) : [];
    const specs =
      playerSpecs ??
      (scenarioSpecs.length > 0
        ? scenarioSpecs
        : [
            { heroKind: playerHero, team: TEAM.RED, spawnX: 0, spawnZ: SPAWN_Z, control: 'local' },
            {
              heroKind: playerHero === 'sam' ? 'tesla' : 'sam',
              team: TEAM.BLUE,
              spawnX: 0,
              spawnZ: -SPAWN_Z,
              control: 'ai',
            },
          ]);
    this.players = specs.map((spec, index) =>
      this.createPlayer(
        spec.heroKind,
        spec.team,
        spec.spawnX ?? 0,
        spec.spawnZ,
        spec.control ?? spec.controller,
        spec.nickname ?? `Player ${index + 1}`,
        index,
        spec
      )
    );

    this.aiTick = 0;
    this.aiTeamStates = new Map();

    if (this.scenarioAuthoritative) this.resetScenarioState();
    else this.resetPositions();
    this.updateHud();
    if (this.authoritative && !this.scenarioMode) {
      this.showBanner('KICK OFF', MATCH.kickoffDelay * 0.8);
    }
  }

  createBall() {
    const mesh = cloneHeroScene(this.assets.ball);
    mesh.scale.setScalar(BALL.radius / 1.0);
    const surfaceY = footLift(mesh) + PITCH.surfaceY;
    this.scene.add(mesh);

    const mixer = new THREE.AnimationMixer(mesh);
    const clips = this.assets.ball.animations;
    const idle = THREE.AnimationClip.findByName(clips, 'Default');
    if (idle) mixer.clipAction(idle).play();
    const blink = THREE.AnimationClip.findByName(clips, 'Blink');
    if (blink) {
      const a = mixer.clipAction(blink);
      a.loop = THREE.LoopRepeat;
      a.timeScale = 0.25;
      a.play();
    }

    return {
      body: createBody(0, 0, BALL.radius, BALL.mass),
      mesh,
      mixer,
      heading: 0,
      visualX: 0,
      visualZ: 0,
      surfaceY,
    };
  }

  createPlayer(
    heroKind,
    team,
    spawnX,
    spawnZ,
    control = 'ai',
    nickname = 'Player',
    index = 0,
    spec = {}
  ) {
    const gltfSource = heroGltfSource(this.assets, heroKind);
    const mesh = cloneHeroScene(gltfSource);
    const meshScale = (PLAYER.radius * 2) / 2.96;
    mesh.scale.setScalar(meshScale);
    tintHero(mesh, TEAM_COLORS[team]);
    const surfaceY = footLift(mesh) + PITCH.surfaceY;
    this.scene.add(mesh);
    const intentLabel = createIntentLabel();
    this.scene.add(intentLabel.sprite);
    const indicator = createPlayerIndicator(INDICATOR_COLORS[index % INDICATOR_COLORS.length]);
    this.scene.add(indicator.sprite);

    const mixer = new THREE.AnimationMixer(mesh);
    const actions = {};
    for (const name of ['Idle', 'Celebrate', 'Sad']) {
      const clip = THREE.AnimationClip.findByName(gltfSource.animations, name);
      if (clip) actions[name] = mixer.clipAction(clip);
    }
    actions.Idle?.play();

    const player = {
      id: normalizePlayerId(spec.id ?? spec.scenarioActorId, index),
      scenarioActorId: normalizePlayerId(spec.scenarioActorId ?? spec.id, index),
      heroKind,
      nickname,
      team,
      control,
      difficulty: normalizeAIDifficulty(spec.difficulty),
      defendZSign: normalizeDefendZSign(spec.defendZSign, spawnZ),
      explicitDefendZSign: Number(spec.defendZSign) === -1 || Number(spec.defendZSign) === 1,
      isHuman: control === 'local',
      isRemote: control === 'remote',
      spawnX,
      spawnZ,
      body: createBody(spawnX, spawnZ, PLAYER.radius, PLAYER.mass),
      mesh,
      mixer,
      actions,
      currentAction: 'Idle',
      facingX: 0,
      facingZ: -Math.sign(spawnZ),
      shootHeld: false,
      powerHeld: false,
      ai: { intent: 'attackBall', intentAge: 0, intentScore: 0 },
      intentLabel,
      indicator,
      audioId: `${this.audioScopeId}:player:${index}`,
      headTop: meshTopY(mesh),
      visualX: spawnX,
      visualZ: spawnZ,
      surfaceY,
    };
    player.onPowerFX = (type) => this.handlePlayerPowerFX(player, type);
    player.hero = createHero(heroKind, player);
    if (heroKind === 'tesla') {
      player.antennaFX = createTeslaAntennaFX(mesh);
      player.magnetFX = createMagnetFieldFX(this.scene);
    }
    mesh.visible = isPlayerActive(player);
    return player;
  }

  playAction(player, name) {
    if (player.currentAction === name || !player.actions[name]) return;
    const prev = player.actions[player.currentAction];
    const next = player.actions[name];
    prev?.fadeOut(0.2);
    next.reset().fadeIn(0.2).play();
    player.currentAction = name;
  }

  resetPositions() {
    for (const state of this.aiTeamStates.values()) resetTeamAIState(state);
    this.ball.body.x = 0;
    this.ball.body.z = 0;
    this.ball.body.vx = 0;
    this.ball.body.vz = 0;
    resetVisualPosition(this.ball);
    for (const p of this.players) {
      const active = isPlayerActive(p);
      p.body.x = p.spawnX;
      p.body.z = p.spawnZ;
      p.body.vx = 0;
      p.body.vz = 0;
      p.shootHeld = false;
      p.powerHeld = false;
      p.mesh.visible = active;
      if (!active) {
        p.intentLabel.sprite.visible = false;
        p.indicator.sprite.visible = false;
      }
      resetVisualPosition(p);
      updateFacingTowardBall(p, this.ball.body);
      if (p.hero.active) p.hero.release?.(this.ball.body);
      this.playAction(p, 'Idle');
    }
  }

  resetScenarioState() {
    if (!this.scenarioAuthoritative) return;

    clearTimeout(this.bannerTimeout);
    this.aiTick = 0;
    this.aiTeamStates.clear();
    this.scenarioAccumulator = 0;
    this.scenarioElapsed = 0;
    this.scenarioReadyRemaining = this.scenarioReadySeconds;
    this.scenarioFinished = false;
    this.scenarioResult = null;
    this.scenarioCallbackSent = false;
    this.scenarioGoalRecorded = false;
    this.score[TEAM.RED] = 0;
    this.score[TEAM.BLUE] = 0;
    this.goldenGoal = false;
    this.timeLeft = this.scenarioMaxSeconds;

    for (const p of this.players) resetHeroState(p.hero);
    this.resetPositions();

    const actors = scenarioActors(this.scenario);
    for (let index = 0; index < this.players.length; index++) {
      const p = this.players[index];
      p.ai = { intent: 'attackBall', intentAge: 0, intentScore: 0 };
      const actor = findScenarioActor(actors, p.id, index);
      if (!actor) continue;

      p.scenarioActorId = normalizePlayerId(actor.id, index);
      p.scenarioActor = actor;

      const x = scenarioCoordinate(actor, 'x', p.spawnX);
      const z = scenarioCoordinate(actor, 'z', p.spawnZ);
      p.body.x = x;
      p.body.z = z;
      p.body.vx = scenarioVelocity(actor, 'x', 0);
      p.body.vz = scenarioVelocity(actor, 'z', 0);

      const defendZSign = scenarioDefendZSign(this.scenario, actor, p.team);
      if (defendZSign === -1 || defendZSign === 1) {
        p.defendZSign = defendZSign;
        p.explicitDefendZSign = true;
      }

      const difficulty = normalizeAIDifficulty(actor.difficulty);
      if (difficulty && !p.difficulty) p.difficulty = difficulty;
      const controller = actor.controller ?? actor.control;
      if (['local', 'remote', 'ai', 'idle', 'chaser', 'scripted'].includes(controller)) {
        p.control = controller;
      }

      const facing = scenarioFacing(actor);
      if (facing) {
        p.facingX = facing.x;
        p.facingZ = facing.z;
      } else {
        updateFacingTowardBall(p, this.ball.body);
      }
      applyScenarioHeroState(p.hero, actor.heroState ?? actor.initialHeroState);
      resetVisualPosition(p);
    }

    applyScenarioBody(this.ball.body, scenarioBall(this.scenario));
    resetVisualPosition(this.ball);
    for (let index = 0; index < this.players.length; index++) {
      const actor = findScenarioActor(actors, this.players[index].id, index);
      if (!scenarioFacing(actor)) updateFacingTowardBall(this.players[index], this.ball.body);
    }

    const world = this.scenarioWorld();
    if (this.scenarioTracker) this.scenarioTracker.reset(world);
    else this.scenarioTracker = createScenarioTracker(this.scenario, { world });

    this.state = this.scenarioReadyRemaining > 0 ? 'scenario_ready' : 'playing';
    this.stateTimer = 0;
    if (this.scenarioReadyRemaining > 0) {
      this.setBannerState({ visible: true, text: 'GET READY', color: '#ffd84a' });
    } else {
      this.hideBanner();
    }
    this.updateHud();
  }

  scenarioWorld() {
    return {
      scenario: this.scenario,
      ball: this.ball.body,
      players: this.players,
      tick: this.aiTick,
      teamStates: this.aiTeamStates,
    };
  }

  restartMatch() {
    if (this.scenarioAuthoritative) {
      this.resetScenarioState();
      return;
    }

    clearTimeout(this.bannerTimeout);
    this.score[TEAM.RED] = 0;
    this.score[TEAM.BLUE] = 0;
    this.timeLeft = this.matchDuration;
    this.goldenGoal = false;
    this.state = 'kickoff';
    this.stateTimer = MATCH.kickoffDelay;

    for (const p of this.players) {
      resetHeroState(p.hero);
    }

    this.resetPositions();
    this.showBanner('KICK OFF', MATCH.kickoffDelay * 0.8);
    this.updateHud();
  }

  setMatchSettings({ timeLimitSeconds, scoreLimit } = {}) {
    if (timeLimitSeconds != null) this.setTimeLimitSeconds(timeLimitSeconds);
    if (scoreLimit != null) this.setScoreLimit(scoreLimit);
    this.updateHud();
  }

  getMatchSettings() {
    return {
      timeLimitSeconds: this.matchDuration,
      scoreLimit: this.scoreLimit,
    };
  }

  setTimeLimitSeconds(value) {
    const nextDuration = normalizeTimeLimitSeconds(value, this.matchDuration);
    const elapsed = Math.max(0, this.matchDuration - this.timeLeft);
    this.matchDuration = nextDuration;
    this.timeLeft = clamp(nextDuration - elapsed, 0, nextDuration);
    if (this.timeLeft > 0 && this.goldenGoal) {
      this.goldenGoal = false;
      this.hideBanner();
    }
    this.enforceTimeLimit();
  }

  setScoreLimit(value) {
    this.scoreLimit = normalizeScoreLimit(value, this.scoreLimit);
    if (this.hasScoreLimitWinner()) this.endMatch();
  }

  setPlayerLayout(playerSpecs) {
    if (!Array.isArray(playerSpecs)) return;

    let changed = false;
    for (let i = 0; i < this.players.length; i++) {
      const spec = playerSpecs[i];
      if (!spec) continue;
      changed = this.applyPlayerSpec(this.players[i], spec) || changed;
    }

    if (!changed) return;
    if (this.scenarioAuthoritative) {
      this.resetScenarioState();
      return;
    }
    this.resetPositions();
    if (this.state === 'over') {
      this.updateHud();
      return;
    }
    this.state = 'kickoff';
    this.stateTimer = MATCH.kickoffDelay;
    this.showBanner('ROSTER UPDATED', 1.4, '#ffd84a');
  }

  applyPlayerSpec(player, spec) {
    if (!player || !spec) return false;

    let changed = false;
    const heroKind = normalizeHeroKind(spec.heroKind, player.heroKind);
    if (player.heroKind !== heroKind) {
      this.setPlayerHero(player, heroKind);
      changed = true;
    }

    const team = normalizeTeamValue(spec.team, player.team);
    if (player.team !== team) {
      player.team = team;
      tintHero(player.mesh, TEAM_COLORS[team]);
      player.mesh.visible = isPlayerActive(player);
      changed = true;
    }

    const spawnX = finiteOr(spec.spawnX, player.spawnX);
    const spawnZ = finiteOr(spec.spawnZ, player.spawnZ);
    const spawnChanged = player.spawnX !== spawnX || player.spawnZ !== spawnZ;
    if (spawnChanged) {
      player.spawnX = spawnX;
      player.spawnZ = spawnZ;
      changed = true;
    }

    const requestedControl = spec.controller ?? spec.control;
    if (
      ['local', 'remote', 'ai', 'idle', 'chaser', 'scripted'].includes(requestedControl) &&
      player.control !== requestedControl
    ) {
      player.control = requestedControl;
      changed = true;
    }

    const explicitDefendZSign = Number(spec.defendZSign);
    if (explicitDefendZSign === -1 || explicitDefendZSign === 1) {
      if (player.defendZSign !== explicitDefendZSign || !player.explicitDefendZSign) changed = true;
      player.defendZSign = explicitDefendZSign;
      player.explicitDefendZSign = true;
    } else if (!player.explicitDefendZSign && spawnChanged) {
      player.defendZSign = normalizeDefendZSign(null, spawnZ);
    }

    const difficulty = normalizeAIDifficulty(spec.difficulty);
    if (difficulty && player.difficulty !== difficulty) {
      player.difficulty = difficulty;
      changed = true;
    }

    if (typeof spec.nickname === 'string') player.nickname = spec.nickname;
    return changed;
  }

  setPlayerHero(player, heroKind) {
    if (!player || player.heroKind === heroKind) return;

    if (player.hero?.active) player.hero.release?.(this.ball.body);
    player.shootHeld = false;
    player.powerHeld = false;

    if (player.antennaFX) {
      disposeTeslaAntennaFX(player.antennaFX);
      player.antennaFX = null;
    }

    if (player.magnetFX) {
      this.audio?.stopMagnetField(player.audioId);
      player.magnetFX.dispose(this.scene);
      player.magnetFX = null;
    }

    this.scene.remove(player.mesh);

    const gltfSource = heroGltfSource(this.assets, heroKind);
    const mesh = cloneHeroScene(gltfSource);
    const meshScale = (PLAYER.radius * 2) / 2.96;
    mesh.scale.setScalar(meshScale);
    tintHero(mesh, TEAM_COLORS[player.team]);
    mesh.visible = isPlayerActive(player);
    const surfaceY = footLift(mesh) + PITCH.surfaceY;
    this.scene.add(mesh);

    const mixer = new THREE.AnimationMixer(mesh);
    const actions = {};
    for (const name of ['Idle', 'Celebrate', 'Sad']) {
      const clip = THREE.AnimationClip.findByName(gltfSource.animations, name);
      if (clip) actions[name] = mixer.clipAction(clip);
    }
    actions.Idle?.play();

    player.heroKind = heroKind;
    player.mesh = mesh;
    player.mixer = mixer;
    player.actions = actions;
    player.currentAction = 'Idle';
    player.surfaceY = surfaceY;
    player.headTop = meshTopY(mesh);
    player.hero = createHero(heroKind, player);
    player.onPowerFX = (type) => this.handlePlayerPowerFX(player, type);
    if (heroKind === 'tesla') {
      player.antennaFX = createTeslaAntennaFX(mesh);
      player.magnetFX = createMagnetFieldFX(this.scene);
    }
  }

  screenToWorld(commands) {
    // Camera sits on +X looking at the pitch: screen-up is world -X, screen-right is world -Z
    return {
      moveX: commands.moveZ,
      moveZ: -commands.moveX,
      shoot: commands.shoot,
      power: commands.power,
    };
  }

  update(dt) {
    dt = Math.min(dt, 1 / 30);
    if (DEBUG.slowMotion) dt *= 0.25;

    if (this.authoritative) {
      if (this.scenarioMode) {
        this.updateScenarioSimulation(dt);
      } else {
        this.stateTimer -= dt;

        if (this.state === 'kickoff' && this.stateTimer <= 0) {
          this.state = 'playing';
          this.hideBanner();
          this.emitSound('kickoff');
        } else if (this.state === 'goal' && this.stateTimer <= 0) {
          this.resetPositions();
          this.state = 'kickoff';
          this.stateTimer = MATCH.kickoffDelay;
          this.showBanner('KICK OFF', MATCH.kickoffDelay * 0.8);
        } else if (this.state === 'over' && this.stateTimer <= 0) {
          this.onMatchEnd?.();
          return;
        }

        if (this.state === 'playing') {
          if (!DEBUG.freezeTimer) this.timeLeft -= dt;
          this.enforceTimeLimit();
          this.simulate(dt);
        }
      }
    } else if (this.state === 'playing' && !this.scenarioMode) {
      this.predictLocalPlayer(dt);
    }

    for (const p of this.players) {
      p.mixer.update(dt);
      if (p.antennaFX) updateTeslaAntennaFX(p.antennaFX, dt, Boolean(p.hero?.active));
    }
    this.ball.mixer.update(dt);
    this.syncVisuals(dt);
    this.updateMagnetFields(dt);
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.updateHud();
  }

  updateScenarioSimulation(dt) {
    if (!this.scenarioAuthoritative || this.scenarioFinished) return;

    if (this.scenarioReadyRemaining > 0) {
      this.scenarioReadyRemaining -= dt;
      if (this.scenarioReadyRemaining > 0) return;
      dt = Math.max(0, -this.scenarioReadyRemaining);
      this.scenarioReadyRemaining = 0;
      this.state = 'playing';
      this.hideBanner();
      if (dt <= 0) return;
    }
    if (this.state !== 'playing') return;

    const fixedDt = SCENARIO_DT;
    this.scenarioAccumulator += dt;
    while (this.scenarioAccumulator + 1e-9 >= fixedDt && !this.scenarioFinished) {
      this.scenarioAccumulator -= fixedDt;
      this.simulate(fixedDt);
      const terminal = this.scenarioTracker?.step(fixedDt, this.scenarioWorld()) ?? null;
      const progress = this.scenarioTracker?.getProgress?.();
      this.scenarioElapsed = finiteOr(
        progress?.elapsed ?? progress?.elapsedSeconds,
        this.scenarioElapsed + fixedDt
      );
      this.timeLeft = Math.max(0, this.scenarioMaxSeconds - this.scenarioElapsed);
      if (terminal) this.finishScenario(this.scenarioTracker?.getResult?.() ?? terminal);
    }
  }

  getScenarioProgress() {
    if (!this.scenarioMode) return null;
    const trackerProgress = this.scenarioTracker?.getProgress?.() ?? {};
    return Object.freeze({
      ...trackerProgress,
      elapsed: finiteOr(trackerProgress.elapsed ?? trackerProgress.elapsedSeconds, this.scenarioElapsed),
      maxSeconds: finiteOr(trackerProgress.maxSeconds, this.scenarioMaxSeconds),
      phase:
        trackerProgress.phase ??
        (this.scenarioFinished ? 'complete' : this.state === 'playing' ? 'running' : 'ready'),
      outcome:
        trackerProgress.outcome ??
        trackerProgress.terminal?.outcome ??
        this.scenarioResult?.outcome ??
        null,
    });
  }

  abortScenario(reason = 'aborted') {
    if (!this.scenarioAuthoritative || this.scenarioFinished) return false;
    const terminal = this.scenarioTracker?.abort(String(reason || 'aborted'));
    this.finishScenario(
      this.scenarioTracker?.getResult?.() ??
        terminal ?? {
          outcome: 'aborted',
          reason: String(reason || 'aborted'),
          elapsed: this.scenarioElapsed,
        }
    );
    return true;
  }

  finishScenario(result) {
    if (!this.scenarioAuthoritative || this.scenarioFinished) return;
    this.scenarioFinished = true;
    this.scenarioResult = result ?? { outcome: 'failed', reason: 'Scenario ended' };
    this.state = 'scenario_complete';
    this.stateTimer = 0;
    this.scenarioAccumulator = 0;
    const outcome = this.scenarioResult?.outcome;
    const succeeded = outcome === 'success';
    const text = succeeded
      ? 'SCENARIO PASSED'
      : outcome === 'aborted'
        ? 'SCENARIO STOPPED'
        : 'SCENARIO FAILED';
    this.showBanner(text, 1.4, succeeded ? '#2ee66b' : outcome === 'aborted' ? '#ffd84a' : '#ff6a5e');

    if (this.scenarioCallbackSent) return;
    this.scenarioCallbackSent = true;
    try {
      this.onScenarioComplete?.(this.scenarioResult);
    } catch (error) {
      console.error('Scenario completion callback failed', error);
    }
  }

  commandsForPlayer(p, index, ballBody, dt) {
    if (!isPlayerActive(p)) return { moveX: 0, moveZ: 0, shoot: false, power: false };

    if (p.control === 'scripted') {
      const commands = computeScenarioScriptCommands(
        p,
        this.scenarioWorld(),
        this.scenarioTracker?.getProgress?.() ?? {}
      );
      this.recordScenarioDecision(p, p.ai.action, commands);
      return commands;
    }

    if (p.control === 'idle') {
      p.ai.intent = 'idle';
      p.ai.action = 'idle';
      p.ai.targetX = p.body.x;
      p.ai.targetZ = p.body.z;
      this.recordScenarioDecision(p, 'idle', EMPTY_SCREEN_COMMANDS);
      return EMPTY_SCREEN_COMMANDS;
    }

    if (p.control === 'chaser') {
      const commands = chaserCommands(p, ballBody);
      p.ai.intent = 'attackBall';
      p.ai.action = 'chaser';
      p.ai.targetX = ballBody.x;
      p.ai.targetZ = ballBody.z;
      this.recordScenarioDecision(p, 'chaser', commands);
      return commands;
    }

    if (p.control === 'local') {
      const commands = this.screenToWorld(readCommands());
      this.recordScenarioDecision(p, 'local', commands);
      return commands;
    }

    if (p.control === 'remote') {
      const commands = this.inputProvider?.(p, index) ?? EMPTY_SCREEN_COMMANDS;
      const worldCommands = this.screenToWorld({
        moveX: commands.moveX || 0,
        moveZ: commands.moveZ || 0,
        shoot: Boolean(commands.shoot),
        power: Boolean(commands.power),
      });
      this.recordScenarioDecision(p, 'remote', worldCommands);
      return worldCommands;
    }

    if (DEBUG.disableAI) {
      p.ai.intent = 'disabled';
      p.ai.action = 'disabled';
      this.recordScenarioDecision(p, 'disabled', EMPTY_SCREEN_COMMANDS);
      return EMPTY_SCREEN_COMMANDS;
    }
    const activePlayers = this.players.filter(isPlayerActive);
    const commands = computeAICommands(p, ballBody, {
      players: activePlayers,
      playerIndex: activePlayers.indexOf(p),
      dt,
      defendZSign: p.defendZSign,
      teamState: this.teamAIState(p.team),
      tick: this.aiTick,
      profile: this.aiProfileFor(p),
    });
    this.recordScenarioDecision(p, p.ai.action, commands);
    return commands;
  }

  recordScenarioDecision(player, action, commands = EMPTY_SCREEN_COMMANDS) {
    const targetX = finiteOr(player.ai?.targetX, player.body.x);
    const targetZ = finiteOr(player.ai?.targetZ, player.body.z);
    this.recordScenarioEvent({
      type: 'decision',
      actorId: actorIdForPlayer(player),
      team: player.team,
      action: action ?? player.ai?.action ?? 'unknown',
      intent: player.ai?.intent ?? null,
      targetX,
      targetZ,
      target: { x: targetX, z: targetZ },
      moveX: finiteOr(commands.moveX, 0),
      moveZ: finiteOr(commands.moveZ, 0),
      shoot: Boolean(commands.shoot),
      power: Boolean(commands.power),
    });
  }

  recordScenarioEvent(event) {
    if (!this.scenarioAuthoritative || this.scenarioFinished || !this.scenarioTracker) return;
    this.scenarioTracker.record(event);
  }

  projectedScenarioGoalTeam(ball) {
    if (!this.scenarioAuthoritative) return null;
    return projectedGoalTeam(ball, this.scenario?.teams);
  }

  recordScenarioSaveIfPrevented(player, scoringTeamBefore, method, velocityBefore, ball) {
    if (!scoringTeamBefore || Number(scoringTeamBefore) === Number(player.team)) return;
    const scoringTeamAfter = this.projectedScenarioGoalTeam(ball);
    if (Number(scoringTeamAfter) === Number(scoringTeamBefore)) return;
    this.recordScenarioEvent({
      type: 'save',
      actorId: actorIdForPlayer(player),
      team: player.team,
      method,
      preventedScoringTeam: scoringTeamBefore,
      againstTeam: scoringTeamBefore,
      action: player.ai?.action ?? player.control,
      velocityBefore,
      velocityAfter: { vx: ball.vx, vz: ball.vz },
      ballVelocityBefore: velocityBefore,
      ballVelocityAfter: { vx: ball.vx, vz: ball.vz },
    });
  }

  // AI on the human's team never drops below medium — an easy teammate is
  // frustration for the human, not challenge.
  aiProfileFor(p) {
    const selected = AI_DIFFICULTY[p.difficulty] ?? AI_DIFFICULTY[this.aiDifficulty];
    if (this.scenario && p.difficulty) return selected;
    const hasHumanTeammate = this.players.some(
      (other) => other.team === p.team && other.control !== 'ai' && isPlayerActive(other)
    );
    if (hasHumanTeammate && selected.key === 'easy') return AI_DIFFICULTY.medium;
    return selected;
  }

  teamAIState(team) {
    let state = this.aiTeamStates.get(team);
    if (!state) {
      state = createTeamAIState();
      this.aiTeamStates.set(team, state);
    }
    return state;
  }

  predictLocalPlayer(dt) {
    const p = this.players[this.localPlayerIndex];
    if (!p || p.control !== 'local' || !isPlayerActive(p)) return;

    const player = TUNING.player;
    const raw = this.screenToWorld(readCommands());
    const body = p.body;

    body.vx += raw.moveX * player.accel * dt;
    body.vz += raw.moveZ * player.accel * dt;
    integrate(body, dt, player.damping);
    collidePlayerBounds(body, 0.2);
    collideGoalPosts(body, 0.2);
  }

  simulate(dt) {
    this.aiTick += 1;
    const ballBody = this.ball.body;
    const player = TUNING.player;
    const ball = TUNING.ball;
    const kickersThisStep = new Set();

    ballBody.mass = ball.mass;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!isPlayerActive(p)) continue;
      p.body.mass = player.mass;

      const raw = this.commandsForPlayer(p, i, ballBody, dt);

      const body = p.body;
      body.vx += raw.moveX * player.accel * dt;
      body.vz += raw.moveZ * player.accel * dt;

      const goalTeamBeforePower = this.projectedScenarioGoalTeam(ballBody);
      const ballVelocityBeforePower = { vx: ballBody.vx, vz: ballBody.vz };
      const wasCaptured = Boolean(p.hero.captured);
      const powerPressed = raw.power && !p.powerHeld;
      p.powerHeld = raw.power;
      p.hero.update(dt, { ...raw, powerPressed }, ballBody);
      if (wasCaptured && !p.hero.captured) {
        this.recordScenarioEvent({
          type: 'ball-release',
          actorId: actorIdForPlayer(p),
          team: p.team,
          heroKind: p.heroKind,
        });
      }
      this.recordScenarioSaveIfPrevented(
        p,
        goalTeamBeforePower,
        'power',
        ballVelocityBeforePower,
        ballBody
      );

      integrate(body, dt, player.damping);
      collidePlayerBounds(body, 0.2);
      collideGoalPosts(body, 0.2);

      updateFacingTowardBall(p, ballBody);

      const shootPressed = raw.shoot && !p.shootHeld;
      p.shootHeld = raw.shoot;
      if (shootPressed && isTouching(body, ballBody, player.shootRange)) {
        const goalTeamBeforeKick = this.projectedScenarioGoalTeam(ballBody);
        const velocityBefore = { vx: ballBody.vx, vz: ballBody.vz };
        const position = { x: ballBody.x, z: ballBody.z };
        const dx = Number.isFinite(raw.kickX) ? raw.kickX : ballBody.x - body.x;
        const dz = Number.isFinite(raw.kickZ) ? raw.kickZ : ballBody.z - body.z;
        const len = Math.hypot(dx, dz) || 1;
        const kickMultiplier = Number.isFinite(raw.kickMultiplier) ? raw.kickMultiplier : 1;
        const kickVelocity = player.shootVelocity * kickMultiplier;
        const passPlan = this.aiTeamStates.get(p.team)?.passPlan;
        const intendedReceiver = p.ai?.action === 'passBall' ? passPlan?.receiver : null;
        const intendedReceiverId =
          raw.intendedReceiverId ??
          raw.receiverId ??
          raw.targetPlayerId ??
          (intendedReceiver ? actorIdForPlayer(intendedReceiver) : null);
        if (p.hero.captured) p.hero.release(ballBody);
        for (const other of this.players) {
          if (other !== p && isPlayerActive(other)) other.hero.breakHold(ballBody);
        }
        ballBody.vx += (dx / len) * kickVelocity;
        ballBody.vz += (dz / len) * kickVelocity;
        kickersThisStep.add(p);
        this.recordScenarioEvent({
          type: 'kick',
          actorId: actorIdForPlayer(p),
          team: p.team,
          action: p.ai?.action ?? 'kick',
          intendedReceiverId,
          position,
          direction: { x: dx / len, z: dz / len },
          directionX: dx / len,
          directionZ: dz / len,
          multiplier: kickMultiplier,
          kickMultiplier,
          kickVelocity,
          velocityBefore,
          velocityAfter: { vx: ballBody.vx, vz: ballBody.vz },
          ballVelocityAfter: { vx: ballBody.vx, vz: ballBody.vz },
        });
        this.recordScenarioSaveIfPrevented(
          p,
          goalTeamBeforeKick,
          'kick',
          velocityBefore,
          ballBody
        );
        this.spawnPowerFX(p, 'shoot');
      }
    }

    integrate(ballBody, dt, ball.damping);
    clampSpeed(ballBody, ball.maxSpeed);
    // Only the ball raises the force field — players use collidePlayerBounds.
    const wallHit = collideWalls(ballBody, ball.wallRestitution);
    if (wallHit) {
      this.recordScenarioEvent({
        type: 'wall-contact',
        x: wallHit.x,
        z: wallHit.z,
        normalX: wallHit.nx,
        normalZ: wallHit.nz,
        impact: wallHit.impact,
      });
      if (wallHit.impact >= WALL_FX_MIN_IMPACT) this.spawnWallImpactFX(wallHit);
    }
    collideGoalPosts(ballBody, ball.wallRestitution);

    for (const p of this.players) {
      if (!isPlayerActive(p)) continue;
      // Applying both the kick impulse and a same-frame overlap collision
      // double-counts the kicker's contact and can bend an aimed shot.
      if (kickersThisStep.has(p)) continue;
      const goalTeamBeforeContact = this.projectedScenarioGoalTeam(ballBody);
      const velocityBefore = { vx: ballBody.vx, vz: ballBody.vz };
      const contacted = collideCircles(p.body, ballBody, ball.playerRestitution);
      if (contacted) {
        this.recordScenarioEvent({
          type: 'player-ball-contact',
          actorId: actorIdForPlayer(p),
          team: p.team,
          action: p.ai?.action ?? p.control,
          position: { x: ballBody.x, z: ballBody.z },
          velocityBefore,
          velocityAfter: { vx: ballBody.vx, vz: ballBody.vz },
          ballVelocityBefore: velocityBefore,
          ballVelocityAfter: { vx: ballBody.vx, vz: ballBody.vz },
          projectedGoalTeamBefore: goalTeamBeforeContact,
          projectedGoalTeamAfter: this.projectedScenarioGoalTeam(ballBody),
        });
        this.recordScenarioSaveIfPrevented(
          p,
          goalTeamBeforeContact,
          'contact',
          velocityBefore,
          ballBody
        );
      }
    }
    for (let i = 0; i < this.players.length; i++) {
      if (!isPlayerActive(this.players[i])) continue;
      for (let j = i + 1; j < this.players.length; j++) {
        if (!isPlayerActive(this.players[j])) continue;
        if (collideCircles(this.players[i].body, this.players[j].body, 0.3)) {
          this.recordScenarioEvent({
            type: 'player-contact',
            actorId: actorIdForPlayer(this.players[i]),
            otherActorId: actorIdForPlayer(this.players[j]),
          });
        }
      }
    }

    const scorer = goalScored(ballBody);
    if (this.scenarioAuthoritative) {
      if (scorer !== 0 && !this.scenarioGoalRecorded) {
        this.scenarioGoalRecorded = true;
        const scoringTeam = this.projectedScenarioGoalTeam(ballBody) ?? scorer;
        if (scoringTeam === TEAM.RED || scoringTeam === TEAM.BLUE) this.score[scoringTeam] += 1;
        this.recordScenarioEvent({
          type: 'goal',
          scoringTeam,
          goalZSign: Math.sign(ballBody.z),
          position: { x: ballBody.x, z: ballBody.z },
          velocity: { vx: ballBody.vx, vz: ballBody.vz },
        });
        this.emitSound('goal', { team: scoringTeam });
      } else if (scorer === 0) {
        this.scenarioGoalRecorded = false;
      }
    } else if (scorer !== 0) {
      this.handleGoal(scorer);
    }
  }

  handleGoal(team) {
    this.score[team] += 1;
    this.state = 'goal';
    this.stateTimer = MATCH.celebrationTime;
    const color = team === TEAM.RED ? '#ff6a5e' : '#6ea8ff';
    this.showBanner('GOAL!', MATCH.celebrationTime, color);
    this.emitSound('goal', { team });

    for (const p of this.players) {
      if (!isPlayerActive(p)) continue;
      this.playAction(p, p.team === team ? 'Celebrate' : 'Sad');
    }

    if (this.goldenGoal) {
      this.endMatch();
      return;
    }
    if (this.hasScoreLimitWinner()) {
      this.endMatch();
      return;
    }
    if (this.timeLeft <= 0) this.endMatch();
  }

  enforceTimeLimit() {
    if (this.timeLeft > 0 || this.state === 'over') return;

    this.timeLeft = 0;
    this.endMatch();
  }

  hasScoreLimitWinner() {
    if (this.scoreLimit <= 0) return false;
    const red = this.score[TEAM.RED];
    const blue = this.score[TEAM.BLUE];
    return red !== blue && (red >= this.scoreLimit || blue >= this.scoreLimit);
  }

  endMatch() {
    const alreadyOver = this.state === 'over';
    const endedFromGoal = this.state === 'goal';
    this.state = 'over';
    this.stateTimer = 4;
    const red = this.score[TEAM.RED];
    const blue = this.score[TEAM.BLUE];
    let text = 'DRAW';
    let color = '#ffffff';
    if (red > blue) {
      text = 'RED WINS!';
      color = '#ff6a5e';
    } else if (blue > red) {
      text = 'BLUE WINS!';
      color = '#6ea8ff';
    }
    this.showBanner(text, 4, color);
    if (!alreadyOver) {
      const winnerTeam = red === blue ? 0 : red > blue ? TEAM.RED : TEAM.BLUE;
      this.emitSound('match_end', { winnerTeam, delay: endedFromGoal ? 0.65 : 0 });
    }
    for (const p of this.players) {
      if (!isPlayerActive(p)) continue;
      const won =
        (p.team === TEAM.RED && red > blue) || (p.team === TEAM.BLUE && blue > red);
      this.playAction(p, won ? 'Celebrate' : 'Sad');
    }
  }

  syncVisuals(dt) {
    const ballBody = this.ball.body;
    for (const p of this.players) {
      if (!isPlayerActive(p)) {
        p.mesh.visible = false;
        p.intentLabel.sprite.visible = false;
        p.indicator.sprite.visible = false;
        continue;
      }
      p.mesh.visible = true;
      const smoothRemote = !this.authoritative && this.state === 'playing' && p.control === 'remote';
      const pos = syncVisualPosition(p, dt, smoothRemote, REMOTE_HERO_VISUAL);
      p.mesh.position.set(pos.x, p.surfaceY, pos.z);
      updateIntentLabel(p, pos);
      updatePlayerIndicator(p, pos);
      if (this.state !== 'playing') updateFacingTowardBall(p, ballBody);
      const targetRot = Math.atan2(p.facingX, p.facingZ);
      p.mesh.rotation.y = dampAngle(p.mesh.rotation.y, targetRot, 12, dt);
    }

    const b = this.ball;
    const smoothBall = !this.authoritative && this.state === 'playing';
    const ballPos = syncVisualPosition(b, dt, smoothBall, REMOTE_BALL_VISUAL);
    b.mesh.position.set(ballPos.x, b.surfaceY, ballPos.z);
    const speed = Math.hypot(b.body.vx, b.body.vz);
    if (speed > 0.4) {
      const target = Math.atan2(b.body.vx, b.body.vz);
      b.heading = dampAngle(b.heading, target, 6, dt);
    }
    b.mesh.rotation.y = b.heading;
  }

  updateCamera(dt) {
    const t = 1 - Math.exp(-3 * dt);
    const bx = this.ball.body.x;
    const bz = this.ball.body.z;
    const targetPos = new THREE.Vector3(17 + bx * 0.12, 14, bz * 0.28);
    this.camera.position.lerp(targetPos, t);
    this.camera.lookAt(bx * 0.25, 0, bz * 0.45);
  }

  updateMagnetFields(dt) {
    const ballMesh = this.ball.mesh;
    for (const p of this.players) {
      if (!p.magnetFX) continue;
      const active = Boolean(p.hero?.active) && isPlayerActive(p);
      const captured = Boolean(p.hero?.captured);
      const range = p.hero?.def?.magnetRange ?? 3;
      const distance = Math.hypot(
        p.mesh.position.x - ballMesh.position.x,
        p.mesh.position.z - ballMesh.position.z
      );
      const strength = active ? clamp(1 - distance / range, 0, 1) : 0;
      this.audio?.updateMagnetField(p.audioId, {
        active,
        pulling: active && !captured && distance < range,
        captured,
        strength,
        pan: this.soundPanForZ(p.mesh.position.z),
      });
      p.magnetFX.update(dt, {
        active,
        captured,
        playerX: p.mesh.position.x,
        playerZ: p.mesh.position.z,
        ballX: ballMesh.position.x,
        ballY: ballMesh.position.y,
        ballZ: ballMesh.position.z,
        ballRadius: BALL.radius,
        range,
      });
    }
  }

  // Host detects the hit in simulate(); guests replay it from the 'wallFx'
  // network message — they never run ball physics themselves.
  spawnWallImpactFX(hit, fromNetwork = false) {
    if (!fromNetwork) this.onWallFxEvent?.(hit);
    const strength = Math.min(
      1,
      Math.max(0, (hit.impact - WALL_FX_MIN_IMPACT) / (WALL_FX_MAX_IMPACT - WALL_FX_MIN_IMPACT))
    );
    if (!fromNetwork) this.emitSound('wall', { strength, pan: this.soundPanForZ(hit.z) });

    // Clamp the shield panel to the wall segment that was hit, sliding its
    // center away from corners so it never extends past the wall's ends.
    const [a, b] = wallSegmentEndpoints(hit);
    const dirX = hit.nz;
    const dirZ = -hit.nx;
    const alongA = a.x * dirX + a.z * dirZ;
    const alongB = b.x * dirX + b.z * dirZ;
    const min = Math.min(alongA, alongB);
    const max = Math.max(alongA, alongB);
    const along = hit.x * dirX + hit.z * dirZ;
    const halfWidth = Math.min(2.6, (max - min) / 2);
    const center = clamp(along, min + halfWidth, max - halfWidth);

    this.effects.push(
      spawnForceFieldFX(this.scene, {
        x: hit.x + dirX * (center - along),
        z: hit.z + dirZ * (center - along),
        nx: hit.nx,
        nz: hit.nz,
        width: halfWidth * 2,
        height: PITCH.wallHeight,
        impactU: along - center,
        impactY: BALL.radius,
        strength,
      })
    );
  }

  handlePlayerPowerFX(player, type) {
    const baseEvent = {
      actorId: actorIdForPlayer(player),
      team: player.team,
      heroKind: player.heroKind,
      position: { x: player.body.x, z: player.body.z },
    };
    if (type === 'dash' || type === 'magnet_on') {
      this.recordScenarioEvent({
        type: 'power-used',
        power: type,
        action: player.ai?.action ?? player.control,
        ready: true,
        ...baseEvent,
      });
    }
    this.recordScenarioEvent({ type: 'hero-effect', effect: type, ...baseEvent });
    if (type === 'magnet_capture') {
      this.recordScenarioEvent({ type: 'ball-capture', method: 'magnet', ...baseEvent });
    }
    this.spawnPowerFX(player, type);
  }

  spawnPowerFX(player, type, fromNetwork = false) {
    const soundKind = POWER_SOUND_KIND[type];
    if (!fromNetwork && soundKind) {
      this.emitSound(soundKind, { pan: this.soundPanForZ(player.body.z) });
    }

    // Tesla's magnet has a persistent field FX driven by hero state (see
    // updateMagnetFields), synced to guests via snapshots — no one-shot burst.
    if (type.startsWith('magnet')) return;
    if (!fromNetwork) this.onFxEvent?.(this.players.indexOf(player), type);

    if (type === 'dash') {
      const speed = Math.hypot(player.body.vx, player.body.vz);
      let dirX = player.facingX;
      let dirZ = player.facingZ;
      if (speed > 0.1) {
        dirX = player.body.vx / speed;
        dirZ = player.body.vz / speed;
      }
      this.effects.push(
        spawnDashSmoke(
          this.scene,
          this.assets.smokeTexture,
          player.body.x,
          player.body.z,
          dirX,
          dirZ
        )
      );
      return;
    }

    const color = type === 'shoot' ? 0xffffff : 0xffd84a;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.55, 32),
      disableOutline(
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
      )
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(player.body.x, 0.05, player.body.z);
    this.scene.add(ring);
    this.effects.push({ mesh: ring, life: 0.45, maxLife: 0.45 });
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      if (fx.update) {
        if (!fx.update(dt)) {
          fx.dispose(this.scene);
          this.effects.splice(i, 1);
        }
        continue;
      }

      fx.life -= dt;
      const k = 1 - fx.life / fx.maxLife;
      fx.mesh.scale.setScalar(1 + k * 3.5);
      fx.mesh.material.opacity = 0.9 * (1 - k);
      if (fx.life <= 0) {
        this.scene.remove(fx.mesh);
        fx.mesh.geometry.dispose();
        fx.mesh.material.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  updateHud() {
    this.scoreboard?.update(
      this.score[TEAM.RED],
      this.score[TEAM.BLUE],
      this.timeLeft,
      this.goldenGoal
    );
    const local = this.players[this.localPlayerIndex] ?? this.players[0];
    const powerFraction = local && isPlayerActive(local) ? local.hero.cooldownFraction : 0;
    this.hud.powerFill.style.width = `${powerFraction * 100}%`;
    this.hud.powerWrap?.classList.toggle('ready', powerFraction >= 1);

    const powerValue = String(Math.round(powerFraction * 100));
    if (this.hud.powerBar?.getAttribute('aria-valuenow') !== powerValue) {
      this.hud.powerBar?.setAttribute('aria-valuenow', powerValue);
    }

    if (this.hud.matchStatus) {
      const totalSeconds = Math.max(0, Math.ceil(this.timeLeft));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = String(totalSeconds % 60).padStart(2, '0');
      const clockStatus = this.goldenGoal ? 'Golden goal.' : `Time ${minutes}:${seconds}.`;
      const matchStatus =
        `Red ${this.score[TEAM.RED]}, Blue ${this.score[TEAM.BLUE]}. ${clockStatus}`;
      if (this.hud.matchStatus.textContent !== matchStatus) {
        this.hud.matchStatus.textContent = matchStatus;
      }
    }
  }

  showBanner(text, duration, color = '#ffffff') {
    this.setBannerState({ visible: true, text, color });
    clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => this.hideBanner(), duration * 1000);
  }

  hideBanner() {
    this.setBannerState({ visible: false, text: this.activeBanner.text, color: this.activeBanner.color });
  }

  setBannerState({ visible, text = '', color = '#ffffff' }) {
    this.activeBanner = { visible: Boolean(visible), text, color };
    this.hud.banner.textContent = text;
    this.hud.banner.style.color = color;
    this.hud.banner.classList.toggle('hidden', !visible);
  }

  emitSound(kind, details = {}) {
    if (!SOUND_KINDS.has(kind)) return;
    const event = { id: ++this.soundEventSeq, kind, ...details };
    this.playSoundEvent(event, false);
    this.onSoundEvent?.(event);
  }

  playSoundEvent(event, fromNetwork = true) {
    if (!event || !SOUND_KINDS.has(event.kind)) return;
    if (fromNetwork) {
      const id = Math.floor(Number(event.id));
      if (!Number.isFinite(id) || id <= this.lastNetworkSoundEventId) return;
      this.lastNetworkSoundEventId = id;
    }

    const options = {
      pan: clamp(finiteOr(event.pan, 0), -1, 1),
      strength: clamp(finiteOr(event.strength, 0.5), 0, 1),
      delay: clamp(finiteOr(event.delay, 0), 0, 2),
    };
    const localPlayer = this.players[this.localPlayerIndex];
    const localTeam = localPlayer && isPlayerActive(localPlayer) ? localPlayer.team : 0;

    if (event.kind === 'goal') {
      const scoringTeam = normalizeTeamValue(event.team, 0);
      options.positive = localTeam === 0 || localTeam === scoringTeam;
    } else if (event.kind === 'match_end') {
      const winnerTeam = normalizeTeamValue(event.winnerTeam, 0);
      options.outcome =
        winnerTeam === 0 || localTeam === 0
          ? 'draw'
          : winnerTeam === localTeam
            ? 'victory'
            : 'defeat';
    }

    this.audio?.play(event.kind, options);
  }

  soundPanForZ(z) {
    const reach = PITCH.halfLength + PITCH.goalDepth;
    return clamp(-finiteOr(z, 0) / reach, -0.8, 0.8);
  }

  serializeSnapshot(seq) {
    return {
      type: 'snapshot',
      seq,
      state: this.state,
      stateTimer: this.stateTimer,
      matchDuration: this.matchDuration,
      timeLeft: this.timeLeft,
      scoreLimit: this.scoreLimit,
      score: { red: this.score[TEAM.RED], blue: this.score[TEAM.BLUE] },
      goldenGoal: this.goldenGoal,
      scenarioProgress: this.scenarioMode ? this.getScenarioProgress() : null,
      banner: this.activeBanner,
      ball: {
        body: serializeBody(this.ball.body),
        heading: this.ball.heading,
      },
      players: this.players.map((p) => ({
        id: p.id,
        scenarioActorId: p.scenarioActorId,
        nickname: p.nickname,
        heroKind: p.heroKind,
        team: p.team,
        control: this.scenarioMode ? p.control : undefined,
        difficulty: this.scenarioMode ? p.difficulty : undefined,
        defendZSign: this.scenarioMode ? p.defendZSign : undefined,
        spawnX: p.spawnX,
        spawnZ: p.spawnZ,
        body: serializeBody(p.body),
        facingX: p.facingX,
        facingZ: p.facingZ,
        currentAction: p.currentAction,
        shootHeld: p.shootHeld,
        powerHeld: p.powerHeld,
        hero: serializeHero(p.hero),
      })),
    };
  }

  applySnapshot(snapshot) {
    if (snapshot.seq && snapshot.seq <= this.lastSnapshotSeq) return;
    this.lastSnapshotSeq = snapshot.seq || this.lastSnapshotSeq;

    this.state = snapshot.state;
    this.stateTimer = snapshot.stateTimer;
    this.matchDuration = normalizeTimeLimitSeconds(snapshot.matchDuration, this.matchDuration);
    this.timeLeft = snapshot.timeLeft;
    this.scoreLimit = normalizeScoreLimit(snapshot.scoreLimit, this.scoreLimit);
    this.score[TEAM.RED] = snapshot.score.red;
    this.score[TEAM.BLUE] = snapshot.score.blue;
    this.goldenGoal = snapshot.goldenGoal;
    if (this.scenarioMode && snapshot.scenarioProgress) {
      this.scenarioElapsed = finiteOr(snapshot.scenarioProgress.elapsed, this.scenarioElapsed);
      this.scenarioMaxSeconds = finiteOr(
        snapshot.scenarioProgress.maxSeconds,
        this.scenarioMaxSeconds
      );
      this.scenarioResult = snapshot.scenarioProgress.outcome
        ? { outcome: snapshot.scenarioProgress.outcome }
        : null;
      this.scenarioFinished = snapshot.scenarioProgress.phase === 'complete';
    }

    applyBody(this.ball.body, snapshot.ball.body);
    this.ball.heading = snapshot.ball.heading;

    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const sp = snapshot.players[i];
      if (!sp) continue;
      if (this.scenarioMode) {
        p.id = normalizePlayerId(sp.id, i);
        p.scenarioActorId = normalizePlayerId(sp.scenarioActorId ?? sp.id, i);
      }
      this.applyPlayerSpec(p, sp);
      applyBody(p.body, sp.body);
      p.facingX = sp.facingX;
      p.facingZ = sp.facingZ;
      p.shootHeld = sp.shootHeld;
      p.powerHeld = sp.powerHeld;
      applyHero(p.hero, sp.hero);
      this.playAction(p, sp.currentAction);
    }

    this.setBannerState(snapshot.banner);
    this.updateHud();
  }

  dispose() {
    clearTimeout(this.bannerTimeout);
    for (const p of this.players) {
      this.audio?.stopMagnetField(p.audioId, true);
      if (p.antennaFX) disposeTeslaAntennaFX(p.antennaFX);
      if (p.magnetFX) p.magnetFX.dispose(this.scene);
      disposeIntentLabel(p.intentLabel, this.scene);
      disposePlayerIndicator(p.indicator, this.scene);
      this.scene.remove(p.mesh);
    }
    this.scene.remove(this.ball.mesh);
    for (const fx of this.effects) {
      if (fx.dispose) fx.dispose(this.scene);
      else this.scene.remove(fx.mesh);
    }
    this.effects.length = 0;
  }
}

function heroGltfSource(assets, heroKind) {
  if (heroKind === 'tesla') return assets.tesla;
  return assets.sam;
}

function createIntentLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 1);
  sprite.scale.set(2.15, 0.54, 1);
  sprite.renderOrder = 20;
  return { canvas, context, texture, sprite, text: '', accent: '' };
}

function updateIntentLabel(player, pos) {
  const label = player.intentLabel;
  if (!label) return;

  if (player.control !== 'ai' || !DEBUG.intentOverlay) {
    label.sprite.visible = false;
    return;
  }

  const text = labelTextForPlayer(player);
  const accent = player.team === TEAM.BLUE ? '#6ea8ff' : '#ff6a5e';
  if (label.text !== text || label.accent !== accent) {
    drawIntentLabel(label, text, accent);
  }

  label.sprite.position.set(pos.x + 1.0, PITCH.surfaceY + 0.05, pos.z);
  label.sprite.visible = true;
}

function labelTextForPlayer(player) {
  return player.ai?.action ?? player.ai?.intent ?? 'ai';
}

function drawIntentLabel(label, text, accent) {
  const { canvas, context } = label;
  context.clearRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = 'rgba(5, 8, 18, 0.72)';
  context.strokeStyle = accent;
  context.lineWidth = 5;
  roundedRect(context, 24, 25, canvas.width - 48, canvas.height - 50, 22);
  context.fill();
  context.stroke();

  context.font = '800 40px "Segoe UI", Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#eef4ff';
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

  label.text = text;
  label.accent = accent;
  label.texture.needsUpdate = true;
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function disposeIntentLabel(label, scene) {
  if (!label) return;
  scene.remove(label.sprite);
  label.texture.dispose();
  label.sprite.material.dispose();
}

// Downward-pointing triangle above the head. The stroke around it is the
// power cooldown: gone right after the power fires, refills bottom-to-top
// in orange, and turns green once the power is ready again.
const INDICATOR_CANVAS = 256;
const INDICATOR_OUTER = [
  { x: 46, y: 50 },
  { x: 210, y: 50 },
  { x: 128, y: 216 },
];
const INDICATOR_INNER = [
  { x: 70, y: 66 },
  { x: 186, y: 66 },
  { x: 128, y: 188 },
];
const INDICATOR_STROKE = 19;
// Cooldown is quantized so the canvas only redraws when the visible amount changes.
const INDICATOR_STEPS = 64;
const INDICATOR_GAP_Y = 0.24;

function createPlayerIndicator(color) {
  const canvas = document.createElement('canvas');
  canvas.width = INDICATOR_CANVAS;
  canvas.height = INDICATOR_CANVAS;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // Constant on-screen size regardless of distance to the camera.
    sizeAttenuation: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  // Without size attenuation the scale is an angular size: on-screen height
  // fraction ≈ scale / (2 * tan(fov / 2)), ~6% of the viewport at fov 48.
  sprite.scale.set(0.054, 0.054, 1);
  sprite.renderOrder = 18;
  sprite.layers.set(NO_REFLECT_LAYER);
  const indicator = { canvas, context, texture, sprite, color, lastStep: -1 };
  drawPlayerIndicator(indicator, 1);
  return indicator;
}

function drawPlayerIndicator(indicator, fraction) {
  const step = Math.floor(clamp(fraction, 0, 1) * INDICATOR_STEPS);
  if (step === indicator.lastStep) return;
  indicator.lastStep = step;

  const { canvas, context } = indicator;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineJoin = 'round';
  context.lineCap = 'round';

  trianglePath(context, INDICATOR_INNER);
  context.fillStyle = indicator.color;
  context.fill();
  context.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  context.lineWidth = 5;
  context.stroke();

  if (step <= 0) {
    indicator.texture.needsUpdate = true;
    return;
  }

  const ready = step >= INDICATOR_STEPS;
  context.save();
  if (!ready) {
    const top = INDICATOR_OUTER[0].y - INDICATOR_STROKE;
    const bottom = INDICATOR_OUTER[2].y + INDICATOR_STROKE;
    const clipY = bottom - ((bottom - top) * step) / INDICATOR_STEPS;
    context.beginPath();
    context.rect(0, clipY, canvas.width, canvas.height - clipY);
    context.clip();
  }
  trianglePath(context, INDICATOR_OUTER);
  context.strokeStyle = ready ? INDICATOR_READY_COLOR : INDICATOR_CHARGING_COLOR;
  context.lineWidth = INDICATOR_STROKE;
  context.stroke();
  context.restore();

  indicator.texture.needsUpdate = true;
}

function trianglePath(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  context.lineTo(points[1].x, points[1].y);
  context.lineTo(points[2].x, points[2].y);
  context.closePath();
}

function updatePlayerIndicator(player, pos) {
  const indicator = player.indicator;
  if (!indicator) return;
  drawPlayerIndicator(indicator, player.hero.cooldownFraction);
  indicator.sprite.position.set(pos.x, player.surfaceY + player.headTop + INDICATOR_GAP_Y, pos.z);
  indicator.sprite.visible = true;
}

function disposePlayerIndicator(indicator, scene) {
  if (!indicator) return;
  scene.remove(indicator.sprite);
  indicator.texture.dispose();
  indicator.sprite.material.dispose();
}

function meshTopY(mesh) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  return box.isEmpty() ? 2 : box.max.y;
}

function serializeBody(body) {
  return { x: body.x, z: body.z, vx: body.vx, vz: body.vz };
}

function applyBody(body, snapshot) {
  body.x = snapshot.x;
  body.z = snapshot.z;
  body.vx = snapshot.vx;
  body.vz = snapshot.vz;
}

function resetVisualPosition(entity) {
  entity.visualX = entity.body.x;
  entity.visualZ = entity.body.z;
}

function syncVisualPosition(entity, dt, smooth, visual) {
  const body = entity.body;
  if (!smooth) {
    resetVisualPosition(entity);
    return body;
  }

  if (!Number.isFinite(entity.visualX) || !Number.isFinite(entity.visualZ)) {
    resetVisualPosition(entity);
  }

  const targetX = body.x + body.vx * visual.lead;
  const targetZ = body.z + body.vz * visual.lead;
  const dx = targetX - entity.visualX;
  const dz = targetZ - entity.visualZ;
  const snapDistanceSq = visual.snapDistance * visual.snapDistance;

  if (dx * dx + dz * dz > snapDistanceSq) {
    entity.visualX = body.x;
    entity.visualZ = body.z;
  } else {
    const t = 1 - Math.exp(-visual.response * dt);
    entity.visualX += dx * t;
    entity.visualZ += dz * t;
  }

  return { x: entity.visualX, z: entity.visualZ };
}

function serializeHero(hero) {
  return {
    cooldownRemaining: hero.cooldownRemaining,
    active: hero.active ?? false,
    holdRemaining: hero.holdRemaining ?? 0,
    captured: hero.captured ?? false,
  };
}

function applyHero(hero, snapshot) {
  if (!snapshot) return;
  hero.cooldownRemaining = snapshot.cooldownRemaining;
  if ('active' in hero) hero.active = snapshot.active;
  if ('holdRemaining' in hero) hero.holdRemaining = snapshot.holdRemaining;
  if ('captured' in hero) hero.captured = snapshot.captured;
}

function resetHeroState(hero) {
  if (!hero) return;
  hero.cooldownRemaining = 0;
  if ('active' in hero) hero.active = false;
  if ('holdRemaining' in hero) hero.holdRemaining = 0;
  if ('captured' in hero) hero.captured = false;
}

function isPlayerActive(player) {
  return player?.team !== TEAM.SPECTATOR;
}

function normalizeHeroKind(heroKind, fallback = 'sam') {
  if (heroKind === 'tesla') return 'tesla';
  if (heroKind === 'shaggy') return 'shaggy';
  if (heroKind === 'sam') return 'sam';
  if (fallback === 'tesla' || fallback === 'shaggy') return fallback;
  return 'sam';
}

function normalizeTimeLimitSeconds(value, fallback = MATCH.duration) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return fallback;
  return clamp(seconds, 30, 15 * 60);
}

function normalizeScoreLimit(value, fallback = MATCH.scoreLimit) {
  const goals = Math.floor(Number(value));
  if (!Number.isFinite(goals)) return fallback;
  return clamp(goals, 0, 15);
}

function normalizeTeamValue(team, fallback = TEAM.RED) {
  const parsed = Number(team);
  if (parsed === TEAM.SPECTATOR) return TEAM.SPECTATOR;
  if (parsed === TEAM.BLUE) return TEAM.BLUE;
  if (parsed === TEAM.RED) return TEAM.RED;
  return fallback;
}

function normalizePlayerId(value, index) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Number.isFinite(Number(value))) return String(value);
  return `player-${index + 1}`;
}

function normalizeAIDifficulty(value) {
  return typeof value === 'string' && AI_DIFFICULTY[value] ? value : null;
}

function normalizeDefendZSign(value, spawnZ) {
  const explicit = Number(value);
  if (explicit === -1 || explicit === 1) return explicit;
  return Math.sign(Number(spawnZ)) || 1;
}

function actorIdForPlayer(player) {
  return player?.scenarioActorId ?? player?.id ?? null;
}

function scenarioDefendZSign(scenario, actor, team) {
  const actorSign = Number(actor?.defendZSign);
  if (actorSign === -1 || actorSign === 1) return actorSign;
  const teamSign = Number(scenario?.teams?.[team]?.defendZSign);
  if (teamSign === -1 || teamSign === 1) return teamSign;
  return null;
}

function chaserCommands(player, ball) {
  const dx = ball.x - player.body.x;
  const dz = ball.z - player.body.z;
  const distance = Math.hypot(dx, dz) || 1;
  const goalZ = -player.defendZSign * PITCH.halfLength;
  return {
    moveX: (dx / distance) * 0.8,
    moveZ: (dz / distance) * 0.8,
    shoot: isTouching(player.body, ball, TUNING.player.shootRange),
    kickX: -ball.x,
    kickZ: goalZ - ball.z,
    kickMultiplier: 1,
    power: false,
  };
}

function scenarioMaxSeconds(scenario) {
  if (!scenario) return 0;
  const value =
    scenario.maxSeconds ?? scenario.maxTimeSeconds ?? scenario.timeoutSeconds ?? scenario.durationSeconds;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 12;
  return clamp(seconds, 0.1, 10 * 60);
}

function scenarioReadySeconds(scenario) {
  if (!scenario) return 0;
  const seconds = Number(scenario.readySeconds ?? scenario.liveReadySeconds ?? 1);
  if (!Number.isFinite(seconds)) return 1;
  return clamp(seconds, 0, 5);
}

function scenarioActors(scenario) {
  if (!scenario) return [];
  const actors =
    scenario.actors ??
    scenario.players ??
    scenario.specs ??
    scenario.setup?.actors ??
    scenario.initial?.players;
  return Array.isArray(actors) ? actors : [];
}

function scenarioPlayerSpecs(scenario) {
  return scenarioActors(scenario).map((actor, index) => {
    const team = normalizeTeamValue(actor?.team, index % 2 === 0 ? TEAM.RED : TEAM.BLUE);
    return {
      ...actor,
      id: actor?.id,
      scenarioActorId: actor?.id,
      heroKind: actor?.heroKind,
      team,
      spawnX: scenarioCoordinate(actor, 'x', 0),
      spawnZ: scenarioCoordinate(actor, 'z', scenarioDefendZSign(scenario, actor, team) * SPAWN_Z),
      control: actor?.controller ?? actor?.control ?? 'ai',
      defendZSign: scenarioDefendZSign(scenario, actor, team),
    };
  });
}

function findScenarioActor(actors, playerId, index) {
  if (!Array.isArray(actors)) return null;
  const byId = actors.find((actor) => actor && actor.id != null && String(actor.id) === String(playerId));
  return byId ?? actors[index] ?? null;
}

function scenarioCoordinate(spec, axis, fallback) {
  if (!spec) return fallback;
  const arrayIndex = axis === 'x' ? 0 : 1;
  const value =
    spec.position?.[axis] ??
    spec.initialPosition?.[axis] ??
    (Array.isArray(spec.position) ? spec.position[arrayIndex] : undefined) ??
    spec.body?.[axis] ??
    spec[axis] ??
    spec[`spawn${axis.toUpperCase()}`];
  return finiteOr(value, fallback);
}

function scenarioVelocity(spec, axis, fallback) {
  if (!spec) return fallback;
  const arrayIndex = axis === 'x' ? 0 : 1;
  const value =
    spec.velocity?.[axis] ??
    spec.initialVelocity?.[axis] ??
    (Array.isArray(spec.velocity) ? spec.velocity[arrayIndex] : undefined) ??
    spec.body?.[`v${axis}`] ??
    spec[`v${axis}`];
  return finiteOr(value, fallback);
}

function scenarioFacing(spec) {
  if (!spec) return null;
  let x = spec.facing?.x ?? spec.initialFacing?.x ?? spec.facingX;
  let z = spec.facing?.z ?? spec.initialFacing?.z ?? spec.facingZ;
  if (Array.isArray(spec.facing)) {
    x = spec.facing[0];
    z = spec.facing[1];
  }
  x = Number(x);
  z = Number(z);
  const length = Math.hypot(x, z);
  if (!Number.isFinite(length) || length < 0.001) return null;
  return { x: x / length, z: z / length };
}

function scenarioBall(scenario) {
  return scenario?.ball ?? scenario?.initialBall ?? scenario?.setup?.ball ?? scenario?.initial?.ball ?? null;
}

function applyScenarioBody(body, spec) {
  if (!body || !spec) return;
  body.x = scenarioCoordinate(spec, 'x', body.x);
  body.z = scenarioCoordinate(spec, 'z', body.z);
  body.vx = scenarioVelocity(spec, 'x', body.vx);
  body.vz = scenarioVelocity(spec, 'z', body.vz);
}

function applyScenarioHeroState(hero, state) {
  if (!hero || !state || typeof state !== 'object') return;
  hero.cooldownRemaining = Math.max(
    0,
    finiteOr(state.cooldownRemaining ?? state.powerCooldownRemaining, hero.cooldownRemaining)
  );
  if ('active' in hero && typeof state.active === 'boolean') hero.active = state.active;
  if ('holdRemaining' in hero) {
    hero.holdRemaining = Math.max(0, finiteOr(state.holdRemaining, hero.holdRemaining));
  }
  if ('captured' in hero && typeof state.captured === 'boolean') hero.captured = state.captured;
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// The two endpoints of the wall run a ball-wall hit landed on, used to keep
// the force field panel from poking past corners or into the goal mouth.
function wallSegmentEndpoints(hit) {
  const { halfWidth, halfLength, goalHalfWidth, goalDepth } = PITCH;

  if (hit.nz !== 0) {
    // End wall (z = ±halfLength beside the goal) or the goal's back wall.
    if (Math.abs(hit.x) >= goalHalfWidth) {
      const side = Math.sign(hit.x);
      return [
        { x: side * goalHalfWidth, z: hit.z },
        { x: side * halfWidth, z: hit.z },
      ];
    }
    return [
      { x: -goalHalfWidth, z: hit.z },
      { x: goalHalfWidth, z: hit.z },
    ];
  }

  // Full-length side wall, or the short side wall inside the goal mouth.
  if (Math.abs(hit.x) >= halfWidth - 1e-6) {
    return [
      { x: hit.x, z: -halfLength },
      { x: hit.x, z: halfLength },
    ];
  }
  const side = Math.sign(hit.z);
  return [
    { x: hit.x, z: side * halfLength },
    { x: hit.x, z: side * (halfLength + goalDepth) },
  ];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dampAngle(current, target, lambda, dt) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function updateFacingTowardBall(player, ballBody) {
  const dx = ballBody.x - player.body.x;
  const dz = ballBody.z - player.body.z;
  const len = Math.hypot(dx, dz);
  if (len > 0.001) {
    player.facingX = dx / len;
    player.facingZ = dz / len;
  }
}

function createTeslaAntennaFX(mesh) {
  mesh.updateMatrixWorld(true);
  const bulb = mesh.getObjectByName('Bulb') || mesh.getObjectByName('bulb');
  if (bulb) tintTeslaAntennaBulb(bulb);
  const anchor = bulb || mesh;
  const group = new THREE.Group();
  group.name = 'TeslaAntennaFX';

  if (anchor === mesh) group.position.copy(findTeslaFallbackTip(mesh));
  anchor.add(group);
  anchor.updateMatrixWorld(true);

  const scale = new THREE.Vector3();
  anchor.getWorldScale(scale);
  const localScale = 1 / Math.max(scale.x, scale.y, scale.z, 0.001);
  const glowColor = 0x8ef6ff;
  const sparkColor = 0xc8fbff;

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.07 * localScale, 18, 12),
    disableOutline(
      new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
  );
  group.add(core);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.34 * localScale, 28, 16),
    disableOutline(
      new THREE.MeshBasicMaterial({
        color: 0x65ddff,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
  );
  group.add(halo);

  const rings = [0, 1, 2].map((i) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry((0.15 + i * 0.045) * localScale, (0.165 + i * 0.045) * localScale, 56),
      disableOutline(
        new THREE.MeshBasicMaterial({
          color: glowColor,
          transparent: true,
          opacity: 0.28,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      )
    );
    ring.rotation.set(i === 1 ? Math.PI / 2 : 0.45, i === 2 ? Math.PI / 2 : 0, i * 0.9);
    group.add(ring);
    return ring;
  });

  const light = new THREE.PointLight(glowColor, 0.8, 2.4);
  group.add(light);

  const sparks = Array.from({ length: 8 }, () => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(12);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: sparkColor,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    group.add(line);
    const spark = { line, geometry, positions, material, life: 0, maxLife: 0.1, baseOpacity: 0.7 };
    resetTeslaSpark(spark, localScale);
    return spark;
  });

  return {
    group,
    core,
    halo,
    rings,
    light,
    sparks,
    localScale,
    time: Math.random() * 10,
  };
}

function updateTeslaAntennaFX(fx, dt, active) {
  fx.time += dt;
  const power = active ? 1.35 : 1;
  const pulse = 0.5 + Math.sin(fx.time * 8.5) * 0.5;

  fx.core.scale.setScalar((0.85 + pulse * 0.28) * power);
  fx.core.material.opacity = Math.min(1, 0.68 + pulse * 0.28);
  fx.halo.scale.setScalar(0.85 + pulse * 0.22 + (active ? 0.18 : 0));
  fx.halo.material.opacity = (active ? 0.3 : 0.2) + pulse * 0.06;
  fx.light.intensity = (active ? 1.35 : 0.75) + pulse * 0.35;

  for (let i = 0; i < fx.rings.length; i++) {
    const ring = fx.rings[i];
    const k = (fx.time * (0.7 + i * 0.16) + i * 0.33) % 1;
    ring.scale.setScalar((0.55 + k * 1.75) * (active ? 1.08 : 1));
    ring.rotation.z += dt * (0.8 + i * 0.32);
    ring.material.opacity = (1 - k) * (active ? 0.48 : 0.3);
  }

  for (const spark of fx.sparks) {
    spark.life -= dt * (active ? 1.25 : 1);
    if (spark.life <= 0) resetTeslaSpark(spark, fx.localScale);
    const fade = Math.max(0, spark.life / spark.maxLife);
    spark.material.opacity = Math.min(1, spark.baseOpacity * fade * power);
    spark.line.scale.setScalar(0.75 + (1 - fade) * 0.35);
  }
}

function disposeTeslaAntennaFX(fx) {
  fx.group.parent?.remove(fx.group);
  fx.group.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (!node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) material.dispose();
  });
}

function tintTeslaAntennaBulb(bulb) {
  bulb.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material.color) material.color.set(0x7defff);
      if (material.emissive) {
        material.emissive.set(0x23cfff);
        material.emissiveIntensity = 0.55;
      }
      material.needsUpdate = true;
    }
  });
}

function resetTeslaSpark(spark, localScale) {
  const theta = Math.random() * Math.PI * 2;
  const y = THREE.MathUtils.randFloatSpread(0.8);
  const radial = Math.sqrt(Math.max(0.2, 1 - y * y));
  const dir = new THREE.Vector3(Math.cos(theta) * radial, y, Math.sin(theta) * radial).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const length = THREE.MathUtils.randFloat(0.2, 0.52) * localScale;
  const kink = THREE.MathUtils.randFloat(0.045, 0.13) * localScale;

  writeTeslaSparkPoint(spark.positions, 0, 0, 0, 0);
  writeTeslaSparkPoint(
    spark.positions,
    1,
    dir.x * length * 0.34 + side.x * kink,
    dir.y * length * 0.34 + side.y * kink,
    dir.z * length * 0.34 + side.z * kink
  );
  writeTeslaSparkPoint(
    spark.positions,
    2,
    dir.x * length * 0.68 - side.x * kink * 0.65,
    dir.y * length * 0.68 - side.y * kink * 0.65,
    dir.z * length * 0.68 - side.z * kink * 0.65
  );
  writeTeslaSparkPoint(spark.positions, 3, dir.x * length, dir.y * length, dir.z * length);

  spark.geometry.attributes.position.needsUpdate = true;
  spark.maxLife = THREE.MathUtils.randFloat(0.055, 0.14);
  spark.life = spark.maxLife;
  spark.baseOpacity = THREE.MathUtils.randFloat(0.55, 0.95);
}

function writeTeslaSparkPoint(positions, index, x, y, z) {
  const offset = index * 3;
  positions[offset] = x;
  positions[offset + 1] = y;
  positions[offset + 2] = z;
}

function findTeslaFallbackTip(mesh) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  const tip = new THREE.Vector3(
    center.x + size.x * 0.18,
    box.max.y - size.y * 0.08,
    center.z - size.z * 0.1
  );
  mesh.worldToLocal(tip);
  return tip;
}
