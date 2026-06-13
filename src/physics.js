import { PITCH, PLAYER, BALL } from './constants.js';

export function createBody(x, z, radius) {
  return { x, z, vx: 0, vz: 0, radius };
}

export function integrate(body, dt, damping) {
  body.vx -= body.vx * damping * dt;
  body.vz -= body.vz * damping * dt;
  body.x += body.vx * dt;
  body.z += body.vz * dt;
}

export function clampSpeed(body, maxSpeed) {
  const speed = Math.hypot(body.vx, body.vz);
  if (speed > maxSpeed) {
    const s = maxSpeed / speed;
    body.vx *= s;
    body.vz *= s;
  }
}

function inGoalMouth(x) {
  return Math.abs(x) < PITCH.goalHalfWidth;
}

export function collideWalls(body, restitution) {
  const maxX = PITCH.halfWidth - body.radius;
  if (body.x > maxX) {
    body.x = maxX;
    if (body.vx > 0) body.vx = -body.vx * restitution;
  } else if (body.x < -maxX) {
    body.x = -maxX;
    if (body.vx < 0) body.vx = -body.vx * restitution;
  }

  const maxZ = PITCH.halfLength - body.radius;
  const inMouth = inGoalMouth(body.x);
  const limitZ = inMouth ? PITCH.halfLength + PITCH.goalDepth - body.radius : maxZ;

  if (body.z > limitZ) {
    body.z = limitZ;
    if (body.vz > 0) body.vz = -body.vz * restitution;
  } else if (body.z < -limitZ) {
    body.z = -limitZ;
    if (body.vz < 0) body.vz = -body.vz * restitution;
  }

  if (inMouth && Math.abs(body.z) > maxZ) {
    const sideMax = PITCH.goalHalfWidth - body.radius;
    if (body.x > sideMax) {
      body.x = sideMax;
      if (body.vx > 0) body.vx = -body.vx * restitution;
    } else if (body.x < -sideMax) {
      body.x = -sideMax;
      if (body.vx < 0) body.vx = -body.vx * restitution;
    }
  }
}

export function collideCircles(a, b, restitution, massRatioA = 0.5) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  const minDist = a.radius + b.radius;
  if (dist >= minDist || dist === 0) return false;

  const nx = dx / dist;
  const nz = dz / dist;
  const overlap = minDist - dist;

  a.x -= nx * overlap * massRatioA;
  a.z -= nz * overlap * massRatioA;
  b.x += nx * overlap * (1 - massRatioA);
  b.z += nz * overlap * (1 - massRatioA);

  const rvx = b.vx - a.vx;
  const rvz = b.vz - a.vz;
  const velAlongNormal = rvx * nx + rvz * nz;
  if (velAlongNormal > 0) return true;

  const impulse = -(1 + restitution) * velAlongNormal;
  a.vx -= nx * impulse * massRatioA;
  a.vz -= nz * impulse * massRatioA;
  b.vx += nx * impulse * (1 - massRatioA);
  b.vz += nz * impulse * (1 - massRatioA);
  return true;
}

export function isTouching(a, b, margin = 0) {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  return dist <= a.radius + b.radius + margin;
}

export function goalScored(ball) {
  if (Math.abs(ball.x) >= PITCH.goalHalfWidth) return 0;
  if (ball.z < -(PITCH.halfLength + ball.radius * 0.5)) return 1;
  if (ball.z > PITCH.halfLength + ball.radius * 0.5) return 2;
  return 0;
}
