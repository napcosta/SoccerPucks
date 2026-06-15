import * as THREE from 'three';
import { PITCH, PLAYER, BALL, MATCH, TEAM, TEAM_COLORS } from './constants.js';
import {
  createBody,
  integrate,
  clampSpeed,
  collideWalls,
  collideGoalPosts,
  collideCircles,
  isTouching,
  goalScored,
} from './physics.js';
import { readCommands } from './input.js';
import { computeAICommands } from './ai.js';
import { createHero } from './heroes.js';
import { cloneHeroScene, tintHero, footLift } from './assets.js';
import { spawnDashSmoke } from './effects.js';
import { DEBUG } from './debug.js';
import { TUNING } from './tuning.js';

const SPAWN_Z = 7.8;
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

export class Game {
  constructor({
    scene,
    camera,
    assets,
    hud,
    scoreboard,
    playerHero,
    playerSpecs,
    localPlayerIndex = 0,
    authoritative = true,
    inputProvider = null,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.assets = assets;
    this.hud = hud;
    this.scoreboard = scoreboard;
    this.localPlayerIndex = localPlayerIndex;
    this.authoritative = authoritative;
    this.inputProvider = inputProvider;

    this.state = 'kickoff';
    this.stateTimer = MATCH.kickoffDelay;
    this.timeLeft = MATCH.duration;
    this.score = { [TEAM.RED]: 0, [TEAM.BLUE]: 0 };
    this.goldenGoal = false;
    this.onMatchEnd = null;

    this.pitchGoalHalfWidth = PITCH.goalHalfWidth;
    this.pitchGoalDepth = PITCH.goalDepth;

    this.effects = [];
    this.activeBanner = { visible: false, text: '', color: '#ffffff' };
    this.lastSnapshotSeq = 0;
    this.onFxEvent = null;

    this.ball = this.createBall();
    const specs =
      playerSpecs ??
      [
        { heroKind: playerHero, team: TEAM.RED, spawnZ: SPAWN_Z, control: 'local' },
        {
          heroKind: playerHero === 'sam' ? 'tesla' : 'sam',
          team: TEAM.BLUE,
          spawnZ: -SPAWN_Z,
          control: 'ai',
        },
      ];
    this.players = specs.map((spec) =>
      this.createPlayer(spec.heroKind, spec.team, spec.spawnZ, spec.control)
    );

    this.resetPositions();
    this.updateHud();
    if (this.authoritative) this.showBanner('KICK OFF', MATCH.kickoffDelay * 0.8);
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

  createPlayer(heroKind, team, spawnZ, control = 'ai') {
    const gltfSource = heroKind === 'tesla' ? this.assets.tesla : this.assets.sam;
    const mesh = cloneHeroScene(gltfSource);
    const meshScale = (PLAYER.radius * 2) / 2.96;
    mesh.scale.setScalar(meshScale);
    tintHero(mesh, TEAM_COLORS[team]);
    const surfaceY = footLift(mesh) + PITCH.surfaceY;
    this.scene.add(mesh);

    const mixer = new THREE.AnimationMixer(mesh);
    const actions = {};
    for (const name of ['Idle', 'Celebrate', 'Sad']) {
      const clip = THREE.AnimationClip.findByName(gltfSource.animations, name);
      if (clip) actions[name] = mixer.clipAction(clip);
    }
    actions.Idle?.play();

    const player = {
      heroKind,
      team,
      control,
      isHuman: control === 'local',
      isRemote: control === 'remote',
      spawnZ,
      body: createBody(0, spawnZ, PLAYER.radius, PLAYER.mass),
      mesh,
      mixer,
      actions,
      currentAction: 'Idle',
      facingX: 0,
      facingZ: -Math.sign(spawnZ),
      shootHeld: false,
      powerHeld: false,
      visualX: 0,
      visualZ: spawnZ,
      surfaceY,
    };
    player.onPowerFX = (type) => this.spawnPowerFX(player, type);
    player.hero = createHero(heroKind, player);
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
    this.ball.body.x = 0;
    this.ball.body.z = 0;
    this.ball.body.vx = 0;
    this.ball.body.vz = 0;
    resetVisualPosition(this.ball);
    for (const p of this.players) {
      p.body.x = 0;
      p.body.z = p.spawnZ;
      p.body.vx = 0;
      p.body.vz = 0;
      resetVisualPosition(p);
      updateFacingTowardBall(p, this.ball.body);
      if (p.hero.active) p.hero.release?.(this.ball.body);
      this.playAction(p, 'Idle');
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
      this.stateTimer -= dt;

      if (this.state === 'kickoff' && this.stateTimer <= 0) {
        this.state = 'playing';
        this.hideBanner();
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
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          if (this.score[TEAM.RED] === this.score[TEAM.BLUE] && !this.goldenGoal) {
            this.goldenGoal = true;
            this.showBanner('GOLDEN GOAL', 2);
          } else if (!this.goldenGoal) {
            this.endMatch();
          }
        }
        this.simulate(dt);
      }
    } else if (this.state === 'playing') {
      this.predictLocalPlayer(dt);
    }

    for (const p of this.players) p.mixer.update(dt);
    this.ball.mixer.update(dt);
    this.syncVisuals(dt);
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.updateHud();
  }

  commandsForPlayer(p, index, ballBody) {
    if (p.control === 'local') return this.screenToWorld(readCommands());

    if (p.control === 'remote') {
      const commands = this.inputProvider?.(p, index) ?? EMPTY_SCREEN_COMMANDS;
      return this.screenToWorld({
        moveX: commands.moveX || 0,
        moveZ: commands.moveZ || 0,
        shoot: Boolean(commands.shoot),
        power: Boolean(commands.power),
      });
    }

    if (DEBUG.disableAI) return { moveX: 0, moveZ: 0, shoot: false, power: false };
    return computeAICommands(p, ballBody, Math.sign(p.spawnZ));
  }

  predictLocalPlayer(dt) {
    const p = this.players[this.localPlayerIndex];
    if (!p || p.control !== 'local') return;

    const player = TUNING.player;
    const raw = this.screenToWorld(readCommands());
    const body = p.body;

    body.vx += raw.moveX * player.accel * dt;
    body.vz += raw.moveZ * player.accel * dt;
    integrate(body, dt, player.damping);
    collideWalls(body, 0.2);
    collideGoalPosts(body, 0.2);
  }

  simulate(dt) {
    const ballBody = this.ball.body;
    const player = TUNING.player;
    const ball = TUNING.ball;

    ballBody.mass = ball.mass;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      p.body.mass = player.mass;

      const raw = this.commandsForPlayer(p, i, ballBody);

      const body = p.body;
      body.vx += raw.moveX * player.accel * dt;
      body.vz += raw.moveZ * player.accel * dt;

      const powerPressed = raw.power && !p.powerHeld;
      p.powerHeld = raw.power;
      p.hero.update(dt, { ...raw, powerPressed }, ballBody);

      integrate(body, dt, player.damping);
      collideWalls(body, 0.2);
      collideGoalPosts(body, 0.2);

      updateFacingTowardBall(p, ballBody);

      const shootPressed = raw.shoot && !p.shootHeld;
      p.shootHeld = raw.shoot;
      if (shootPressed && isTouching(body, ballBody, player.shootRange)) {
        const dx = ballBody.x - body.x;
        const dz = ballBody.z - body.z;
        const len = Math.hypot(dx, dz) || 1;
        ballBody.vx += (dx / len) * player.shootVelocity;
        ballBody.vz += (dz / len) * player.shootVelocity;
        if (p.hero.captured) p.hero.release(ballBody);
        this.spawnPowerFX(p, 'shoot');
      }
    }

    integrate(ballBody, dt, ball.damping);
    clampSpeed(ballBody, ball.maxSpeed);
    collideWalls(ballBody, ball.wallRestitution);
    collideGoalPosts(ballBody, ball.wallRestitution);

    for (const p of this.players) {
      collideCircles(p.body, ballBody, ball.playerRestitution);
    }
    collideCircles(this.players[0].body, this.players[1].body, 0.3);

    const scorer = goalScored(ballBody);
    if (scorer !== 0) this.handleGoal(scorer);
  }

  handleGoal(team) {
    this.score[team] += 1;
    this.state = 'goal';
    this.stateTimer = MATCH.celebrationTime;
    const color = team === TEAM.RED ? '#ff6a5e' : '#6ea8ff';
    this.showBanner('GOAL!', MATCH.celebrationTime, color);

    for (const p of this.players) {
      this.playAction(p, p.team === team ? 'Celebrate' : 'Sad');
    }

    if (this.goldenGoal) {
      this.endMatch();
      return;
    }
    if (this.timeLeft <= 0) this.endMatch();
  }

  endMatch() {
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
    for (const p of this.players) {
      const won =
        (p.team === TEAM.RED && red > blue) || (p.team === TEAM.BLUE && blue > red);
      this.playAction(p, won ? 'Celebrate' : 'Sad');
    }
  }

  syncVisuals(dt) {
    const ballBody = this.ball.body;
    for (const p of this.players) {
      const smoothRemote = !this.authoritative && this.state === 'playing' && p.control === 'remote';
      const pos = syncVisualPosition(p, dt, smoothRemote, REMOTE_HERO_VISUAL);
      p.mesh.position.set(pos.x, p.surfaceY, pos.z);
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

  spawnPowerFX(player, type, fromNetwork = false) {
    if (type === 'magnet_off') return;
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

    const color =
      type === 'shoot' ? 0xffffff : type.startsWith('magnet') ? 0x6ea8ff : 0xffd84a;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.55, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
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
    this.hud.powerFill.style.width = `${local.hero.cooldownFraction * 100}%`;
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

  serializeSnapshot(seq) {
    return {
      type: 'snapshot',
      seq,
      state: this.state,
      stateTimer: this.stateTimer,
      timeLeft: this.timeLeft,
      score: { red: this.score[TEAM.RED], blue: this.score[TEAM.BLUE] },
      goldenGoal: this.goldenGoal,
      banner: this.activeBanner,
      ball: {
        body: serializeBody(this.ball.body),
        heading: this.ball.heading,
      },
      players: this.players.map((p) => ({
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
    this.timeLeft = snapshot.timeLeft;
    this.score[TEAM.RED] = snapshot.score.red;
    this.score[TEAM.BLUE] = snapshot.score.blue;
    this.goldenGoal = snapshot.goldenGoal;

    applyBody(this.ball.body, snapshot.ball.body);
    this.ball.heading = snapshot.ball.heading;

    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const sp = snapshot.players[i];
      if (!sp) continue;
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
    for (const p of this.players) this.scene.remove(p.mesh);
    this.scene.remove(this.ball.mesh);
    for (const fx of this.effects) {
      if (fx.dispose) fx.dispose(this.scene);
      else this.scene.remove(fx.mesh);
    }
    this.effects.length = 0;
  }
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
