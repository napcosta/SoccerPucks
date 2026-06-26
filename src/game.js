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
        { heroKind: playerHero, team: TEAM.RED, spawnX: 0, spawnZ: SPAWN_Z, control: 'local' },
        {
          heroKind: playerHero === 'sam' ? 'tesla' : 'sam',
          team: TEAM.BLUE,
          spawnX: 0,
          spawnZ: -SPAWN_Z,
          control: 'ai',
        },
      ];
    this.players = specs.map((spec) =>
      this.createPlayer(spec.heroKind, spec.team, spec.spawnX ?? 0, spec.spawnZ, spec.control)
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

  createPlayer(heroKind, team, spawnX, spawnZ, control = 'ai') {
    const gltfSource = heroGltfSource(this.assets, heroKind);
    const mesh = cloneHeroScene(gltfSource);
    const meshScale = (PLAYER.radius * 2) / 2.96;
    mesh.scale.setScalar(meshScale);
    tintHero(mesh, TEAM_COLORS[team]);
    const surfaceY = footLift(mesh) + PITCH.surfaceY;
    this.scene.add(mesh);
    const intentLabel = createIntentLabel();
    this.scene.add(intentLabel.sprite);

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
      visualX: spawnX,
      visualZ: spawnZ,
      surfaceY,
    };
    player.onPowerFX = (type) => this.spawnPowerFX(player, type);
    player.hero = createHero(heroKind, player);
    if (heroKind === 'tesla') player.antennaFX = createTeslaAntennaFX(mesh);
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
      p.body.x = p.spawnX;
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

    for (const p of this.players) {
      p.mixer.update(dt);
      if (p.antennaFX) updateTeslaAntennaFX(p.antennaFX, dt, Boolean(p.hero?.active));
    }
    this.ball.mixer.update(dt);
    this.syncVisuals(dt);
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.updateHud();
  }

  commandsForPlayer(p, index, ballBody, dt) {
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
    return computeAICommands(p, ballBody, {
      players: this.players,
      playerIndex: index,
      dt,
      defendZSign: Math.sign(p.spawnZ),
    });
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

      const raw = this.commandsForPlayer(p, i, ballBody, dt);

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
        const dx = Number.isFinite(raw.kickX) ? raw.kickX : ballBody.x - body.x;
        const dz = Number.isFinite(raw.kickZ) ? raw.kickZ : ballBody.z - body.z;
        const len = Math.hypot(dx, dz) || 1;
        const kickMultiplier = Number.isFinite(raw.kickMultiplier) ? raw.kickMultiplier : 1;
        const kickVelocity = player.shootVelocity * kickMultiplier;
        ballBody.vx += (dx / len) * kickVelocity;
        ballBody.vz += (dz / len) * kickVelocity;
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
    for (let i = 0; i < this.players.length; i++) {
      for (let j = i + 1; j < this.players.length; j++) {
        collideCircles(this.players[i].body, this.players[j].body, 0.3);
      }
    }

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
      updateIntentLabel(p, pos);
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
    for (const p of this.players) {
      if (p.antennaFX) disposeTeslaAntennaFX(p.antennaFX);
      disposeIntentLabel(p.intentLabel, this.scene);
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
    new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  group.add(core);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.34 * localScale, 28, 16),
    new THREE.MeshBasicMaterial({
      color: 0x65ddff,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  group.add(halo);

  const rings = [0, 1, 2].map((i) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry((0.15 + i * 0.045) * localScale, (0.165 + i * 0.045) * localScale, 56),
      new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
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
