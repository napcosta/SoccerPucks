import { HEROES, BALL } from './constants.js';
import { isTouching } from './physics.js';
import { DEBUG } from './debug.js';

class HeroBase {
  constructor(player) {
    this.player = player;
    this.cooldownRemaining = 0;
  }

  get cooldownFraction() {
    if (DEBUG.noCooldowns) return 1;
    return 1 - this.cooldownRemaining / this.def.powerCooldown;
  }

  tickCooldown(dt) {
    if (DEBUG.noCooldowns) {
      this.cooldownRemaining = 0;
      return;
    }
    if (this.cooldownRemaining > 0) {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    }
  }
}

export class SamHero extends HeroBase {
  constructor(player) {
    super(player);
    this.def = HEROES.sam;
  }

  update(dt, commands, ball) {
    this.tickCooldown(dt);
    const body = this.player.body;
    const speed = Math.hypot(body.vx, body.vz);
    const moving = commands.moveX !== 0 || commands.moveZ !== 0;
    const canDash = moving || speed > 0.5;
    if (commands.powerPressed && this.cooldownRemaining <= 0 && canDash) {
      body.vx *= this.def.dashMultiplier;
      body.vz *= this.def.dashMultiplier;
      this.cooldownRemaining = this.def.powerCooldown;
      this.player.onPowerFX?.('dash');
    }
  }
}

export class TeslaHero extends HeroBase {
  constructor(player) {
    super(player);
    this.def = HEROES.tesla;
    this.active = false;
    this.holdRemaining = 0;
    this.captured = false;
  }

  update(dt, commands, ball) {
    this.tickCooldown(dt);

    if (commands.powerPressed) {
      if (!this.active && this.cooldownRemaining <= 0) {
        this.active = true;
        this.captured = false;
        this.holdRemaining = this.def.holdDuration;
        this.player.onPowerFX?.('magnet_on');
      } else if (this.active) {
        this.release(ball);
        return;
      }
    }

    if (!this.active) return;

    this.holdRemaining -= dt;
    if (this.holdRemaining <= 0) {
      this.release(ball);
      return;
    }

    const body = this.player.body;

    if (this.captured) {
      const hx = body.x + this.player.facingX * (body.radius + ball.radius + this.def.holdGap);
      const hz = body.z + this.player.facingZ * (body.radius + ball.radius + this.def.holdGap);
      ball.x = hx;
      ball.z = hz;
      ball.vx = body.vx;
      ball.vz = body.vz;
      return;
    }

    const dx = body.x - ball.x;
    const dz = body.z - ball.z;
    const dist = Math.hypot(dx, dz);
    if (dist < this.def.magnetRange && dist > 0.001) {
      const t = 1 - dist / this.def.magnetRange;
      const speed = this.def.magnetPullSpeed * (0.35 + 0.65 * t);
      ball.vx = (dx / dist) * speed + body.vx * 0.5;
      ball.vz = (dz / dist) * speed + body.vz * 0.5;
      if (isTouching(body, ball, 0.05)) {
        this.captured = true;
      }
    }
  }

  release(ball) {
    if (this.captured) {
      ball.vx = this.player.body.vx * 1.2;
      ball.vz = this.player.body.vz * 1.2;
    }
    this.active = false;
    this.captured = false;
    this.cooldownRemaining = this.def.powerCooldown;
    this.player.onPowerFX?.('magnet_off');
  }
}

export function createHero(kind, player) {
  return kind === 'tesla' ? new TeslaHero(player) : new SamHero(player);
}
