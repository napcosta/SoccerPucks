import * as THREE from 'three';
import { PITCH, PLAYER, BALL, MATCH, TEAM, TEAM_COLORS } from './constants.js';
import {
  createBody,
  integrate,
  clampSpeed,
  collideWalls,
  collideCircles,
  isTouching,
  goalScored,
} from './physics.js';
import { readCommands } from './input.js';
import { computeAICommands } from './ai.js';
import { createHero } from './heroes.js';
import { cloneHeroScene, tintHero } from './assets.js';

const SPAWN_Z = 7.8;

export class Game {
  constructor({ scene, camera, assets, hud, playerHero }) {
    this.scene = scene;
    this.camera = camera;
    this.assets = assets;
    this.hud = hud;

    this.state = 'kickoff';
    this.stateTimer = MATCH.kickoffDelay;
    this.timeLeft = MATCH.duration;
    this.score = { [TEAM.RED]: 0, [TEAM.BLUE]: 0 };
    this.goldenGoal = false;
    this.onMatchEnd = null;

    this.effects = [];

    this.ball = this.createBall();
    const aiHero = playerHero === 'sam' ? 'tesla' : 'sam';
    this.players = [
      this.createPlayer(playerHero, TEAM.RED, SPAWN_Z, true),
      this.createPlayer(aiHero, TEAM.BLUE, -SPAWN_Z, false),
    ];

    this.resetPositions();
    this.updateHud();
    this.showBanner('KICK OFF', MATCH.kickoffDelay * 0.8);
  }

  createBall() {
    const mesh = cloneHeroScene(this.assets.ball);
    mesh.scale.setScalar(BALL.radius / 1.0);
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
      body: createBody(0, 0, BALL.radius),
      mesh,
      mixer,
      heading: 0,
    };
  }

  createPlayer(heroKind, team, spawnZ, isHuman) {
    const gltfSource = heroKind === 'tesla' ? this.assets.tesla : this.assets.sam;
    const mesh = cloneHeroScene(gltfSource);
    const meshScale = (PLAYER.radius * 2) / 2.96;
    mesh.scale.setScalar(meshScale);
    tintHero(mesh, TEAM_COLORS[team]);
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
      isHuman,
      spawnZ,
      body: createBody(0, spawnZ, PLAYER.radius),
      mesh,
      mixer,
      actions,
      currentAction: 'Idle',
      facingX: 0,
      facingZ: -Math.sign(spawnZ),
      shootHeld: false,
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
    for (const p of this.players) {
      p.body.x = 0;
      p.body.z = p.spawnZ;
      p.body.vx = 0;
      p.body.vz = 0;
      p.facingX = 0;
      p.facingZ = -Math.sign(p.spawnZ);
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
      this.timeLeft -= dt;
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

    for (const p of this.players) p.mixer.update(dt);
    this.ball.mixer.update(dt);
    this.syncVisuals(dt);
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.updateHud();
  }

  simulate(dt) {
    const ballBody = this.ball.body;

    for (const p of this.players) {
      const raw = p.isHuman
        ? this.screenToWorld(readCommands())
        : computeAICommands(p, ballBody, Math.sign(p.spawnZ));

      const body = p.body;
      body.vx += raw.moveX * PLAYER.accel * dt;
      body.vz += raw.moveZ * PLAYER.accel * dt;
      const justDashed =
        p.heroKind === 'sam' &&
        p.hero.cooldownRemaining > p.hero.def.powerCooldown - 0.6;
      clampSpeed(body, PLAYER.maxSpeed * (justDashed ? 1.9 : 1));
      integrate(body, dt, PLAYER.damping);
      collideWalls(body, 0.2);

      if (raw.moveX !== 0 || raw.moveZ !== 0) {
        p.facingX = raw.moveX;
        p.facingZ = raw.moveZ;
      }

      p.hero.update(dt, raw, ballBody);

      const shootPressed = raw.shoot && !p.shootHeld;
      p.shootHeld = raw.shoot;
      if (shootPressed && isTouching(body, ballBody, PLAYER.shootRange)) {
        const dx = ballBody.x - body.x;
        const dz = ballBody.z - body.z;
        const len = Math.hypot(dx, dz) || 1;
        ballBody.vx += (dx / len) * PLAYER.shootVelocity;
        ballBody.vz += (dz / len) * PLAYER.shootVelocity;
        if (p.hero.captured) p.hero.release(ballBody);
        this.spawnPowerFX(p, 'shoot');
      }
    }

    integrate(ballBody, dt, BALL.damping);
    clampSpeed(ballBody, BALL.maxSpeed);
    collideWalls(ballBody, BALL.wallRestitution);

    for (const p of this.players) {
      collideCircles(p.body, ballBody, BALL.playerRestitution, 0.15);
    }
    collideCircles(this.players[0].body, this.players[1].body, 0.3, 0.5);

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
    for (const p of this.players) {
      p.mesh.position.set(p.body.x, 0, p.body.z);
      const targetRot = Math.atan2(p.facingX, p.facingZ);
      p.mesh.rotation.y = dampAngle(p.mesh.rotation.y, targetRot, 12, dt);
    }

    const b = this.ball;
    b.mesh.position.set(b.body.x, 0.02, b.body.z);
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

  spawnPowerFX(player, type) {
    const color =
      type === 'shoot' ? 0xffffff : type.startsWith('magnet') ? 0x6ea8ff : 0xffd84a;
    if (type === 'magnet_off') return;

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
    this.hud.score.textContent = `${this.score[TEAM.RED]} — ${this.score[TEAM.BLUE]}`;
    this.hud.timer.textContent = this.goldenGoal
      ? 'GOLDEN GOAL'
      : `${Math.ceil(this.timeLeft)}`;
    const human = this.players[0];
    this.hud.powerFill.style.width = `${human.hero.cooldownFraction * 100}%`;
  }

  showBanner(text, duration, color = '#ffffff') {
    this.hud.banner.textContent = text;
    this.hud.banner.style.color = color;
    this.hud.banner.classList.remove('hidden');
    clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => this.hideBanner(), duration * 1000);
  }

  hideBanner() {
    this.hud.banner.classList.add('hidden');
  }

  dispose() {
    clearTimeout(this.bannerTimeout);
    for (const p of this.players) this.scene.remove(p.mesh);
    this.scene.remove(this.ball.mesh);
    for (const fx of this.effects) this.scene.remove(fx.mesh);
    this.effects.length = 0;
  }
}

function dampAngle(current, target, lambda, dt) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}
