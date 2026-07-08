import { PLAYER, BALL, PITCH } from './src/constants.js';
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
} from './src/physics.js';
import {
  computeAICommands,
  createTeamAIState,
  resetTeamAIState,
  AI_DIFFICULTY,
} from './src/ai.js';
import { createHero } from './src/heroes.js';
import { TUNING } from './src/tuning.js';

function makePlayer(spec) {
  const player = {
    heroKind: spec.heroKind,
    team: spec.team,
    control: spec.control ?? 'ai',
    difficulty: spec.difficulty ?? null,
    spawnX: spec.x,
    spawnZ: spec.z,
    body: createBody(spec.x, spec.z, PLAYER.radius, PLAYER.mass),
    facingX: 0,
    facingZ: -Math.sign(spec.z),
    shootHeld: false,
    powerHeld: false,
    ai: {},
  };
  player.hero = createHero(spec.heroKind, player);
  return player;
}

// Scripted stand-ins for a human on the pad: 'idle' never moves (an AFK teammate),
// 'chaser' naively runs at the ball and hoofs it straight at the opposing goal.
function scriptedCommands(p, ball) {
  if (p.control !== 'chaser') {
    return { moveX: 0, moveZ: 0, shoot: false, kickX: 0, kickZ: 0, kickMultiplier: 1, power: false };
  }
  const dx = ball.x - p.body.x;
  const dz = ball.z - p.body.z;
  const dist = Math.hypot(dx, dz) || 1;
  const goalZ = -Math.sign(p.spawnZ) * PITCH.halfLength;
  return {
    moveX: (dx / dist) * 0.8,
    moveZ: (dz / dist) * 0.8,
    shoot: isTouching(p.body, ball, TUNING.player.shootRange),
    kickX: -ball.x,
    kickZ: goalZ - ball.z,
    kickMultiplier: 1,
    power: false,
  };
}

function resetKickoff(ball, players, teamStates) {
  ball.x = 0;
  ball.z = 0;
  ball.vx = 0;
  ball.vz = 0;
  for (const p of players) {
    p.body.x = p.spawnX;
    p.body.z = p.spawnZ;
    p.body.vx = 0;
    p.body.vz = 0;
    p.shootHeld = false;
    p.powerHeld = false;
    if (p.hero.active) p.hero.release?.(ball);
  }
  for (const state of teamStates.values()) resetTeamAIState(state);
}

export function runMatch(label, specs, seconds = 180) {
  const lines = [];
  const log = (text) => lines.push(text);
  const ball = createBody(0, 0, BALL.radius, BALL.mass);
  const players = specs.map((s) => makePlayer(s));
  const teamStates = new Map();
  const teamState = (team) => {
    if (!teamStates.has(team)) teamStates.set(team, createTeamAIState());
    return teamStates.get(team);
  };
  const score = { 1: 0, 2: 0 };
  const actionFrames = new Map();
  const kickEvents = new Map();
  const powerEvents = new Map();
  let tick = 0;
  let abandonedFrames = 0;
  let slowUnclaimedStreak = 0;
  const dt = 1 / 60;
  const steps = Math.round(seconds * 60);

  for (let step = 0; step < steps; step++) {
    tick++;
    for (let pi = 0; pi < players.length; pi++) {
      const p = players[pi];
      p.body.mass = TUNING.player.mass;
      let raw;
      if (p.control === 'ai') {
        raw = computeAICommands(p, ball, {
          players,
          playerIndex: pi,
          dt,
          defendZSign: Math.sign(p.spawnZ),
          teamState: teamState(p.team),
          tick,
          profile: p.difficulty ? AI_DIFFICULTY[p.difficulty] : undefined,
        });
      } else {
        raw = scriptedCommands(p, ball);
        p.ai.action = p.control;
      }

      const key = `${p.team}:${p.heroKind}#${pi}`;
      const counts = actionFrames.get(key) ?? {};
      counts[p.ai.action] = (counts[p.ai.action] ?? 0) + 1;
      actionFrames.set(key, counts);

      p.body.vx += raw.moveX * TUNING.player.accel * dt;
      p.body.vz += raw.moveZ * TUNING.player.accel * dt;

      const powerPressed = raw.power && !p.powerHeld;
      p.powerHeld = raw.power;
      if (powerPressed) powerEvents.set(key, (powerEvents.get(key) ?? 0) + 1);
      p.hero.update(dt, { ...raw, powerPressed }, ball);

      integrate(p.body, dt, TUNING.player.damping);
      collidePlayerBounds(p.body, 0.2);
      collideGoalPosts(p.body, 0.2);

      const fx = ball.x - p.body.x;
      const fz = ball.z - p.body.z;
      const fl = Math.hypot(fx, fz);
      if (fl > 0.001) {
        p.facingX = fx / fl;
        p.facingZ = fz / fl;
      }

      const shootPressed = raw.shoot && !p.shootHeld;
      p.shootHeld = raw.shoot;
      if (shootPressed && isTouching(p.body, ball, TUNING.player.shootRange)) {
        const dx = Number.isFinite(raw.kickX) ? raw.kickX : ball.x - p.body.x;
        const dz = Number.isFinite(raw.kickZ) ? raw.kickZ : ball.z - p.body.z;
        const len = Math.hypot(dx, dz) || 1;
        const mult = Number.isFinite(raw.kickMultiplier) ? raw.kickMultiplier : 1;
        const v = TUNING.player.shootVelocity * mult;
        if (p.hero.captured) p.hero.release(ball);
        ball.vx += (dx / len) * v;
        ball.vz += (dz / len) * v;
        const events = kickEvents.get(key) ?? {};
        events[p.ai.action] = (events[p.ai.action] ?? 0) + 1;
        kickEvents.set(key, events);
      }
    }

    integrate(ball, dt, TUNING.ball.damping);
    clampSpeed(ball, TUNING.ball.maxSpeed);
    collideWalls(ball, TUNING.ball.wallRestitution);
    collideGoalPosts(ball, TUNING.ball.wallRestitution);
    for (const p of players) collideCircles(p.body, ball, TUNING.ball.playerRestitution);
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        collideCircles(players[i].body, players[j].body, 0.3);
      }
    }

    // A ball is "abandoned" once it has sat slow and unclaimed for over 1.5s —
    // the failure mode where every AI thinks the loose ball is someone else's job.
    const ballSpeed = Math.hypot(ball.vx, ball.vz);
    const unclaimed = players.every((p) => Math.hypot(ball.x - p.body.x, ball.z - p.body.z) > 2.0);
    if (ballSpeed < 0.5 && unclaimed) slowUnclaimedStreak++;
    else slowUnclaimedStreak = 0;
    if (slowUnclaimedStreak > 90) abandonedFrames++;

    const scorer = goalScored(ball);
    if (scorer !== 0) {
      const goalSign = scorer === 1 ? -1 : 1;
      const conceding = players.find((p) => Math.sign(p.spawnZ) === goalSign)?.team;
      score[conceding === 1 ? 2 : 1]++;
      resetKickoff(ball, players, teamStates);
      slowUnclaimedStreak = 0;
    }
  }

  const finite =
    Number.isFinite(ball.x) &&
    Number.isFinite(ball.z) &&
    players.every((p) => Number.isFinite(p.body.x) && Number.isFinite(p.body.z));

  log(`=== ${label} (${seconds}s) ===`);
  log(`score red ${score[1]} - blue ${score[2]}   finite: ${finite}`);
  log(`abandoned-ball frames: ${abandonedFrames} (${((100 * abandonedFrames) / steps).toFixed(1)}%)`);
  for (const [key, counts] of actionFrames) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const summary = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, frames]) => `${name} ${(100 * frames / total).toFixed(0)}%`)
      .join('  ');
    log(`  ${key}: ${summary}`);
  }
  for (const [key, events] of kickEvents) {
    const summary = Object.entries(events)
      .map(([name, count]) => `${name} x${count}`)
      .join('  ');
    log(`  kicks ${key}: ${summary}   powers x${powerEvents.get(key) ?? 0}`);
  }
  log('');
  return lines.join('\n');
}

export const SCENARIOS = [
  {
    label: '1v1 sam vs tesla',
    specs: [
      { heroKind: 'sam', team: 1, x: 0, z: 7.8 },
      { heroKind: 'tesla', team: 2, x: 0, z: -7.8 },
    ],
  },
  {
    label: '1v1 sam vs tesla (order swapped)',
    specs: [
      { heroKind: 'tesla', team: 2, x: 0, z: -7.8 },
      { heroKind: 'sam', team: 1, x: 0, z: 7.8 },
    ],
  },
  {
    label: '1v1 sam vs sam',
    specs: [
      { heroKind: 'sam', team: 1, x: 0, z: 7.8 },
      { heroKind: 'sam', team: 2, x: 0, z: -7.8 },
    ],
  },
  {
    label: '1v1 sam vs sam (order swapped)',
    specs: [
      { heroKind: 'sam', team: 2, x: 0, z: -7.8 },
      { heroKind: 'sam', team: 1, x: 0, z: 7.8 },
    ],
  },
  {
    label: '1v1 tesla vs tesla',
    specs: [
      { heroKind: 'tesla', team: 1, x: 0, z: 7.8 },
      { heroKind: 'tesla', team: 2, x: 0, z: -7.8 },
    ],
  },
  {
    label: '1v1 sam vs sam (sides mirrored: red defends -z)',
    specs: [
      { heroKind: 'sam', team: 1, x: 0, z: -7.8 },
      { heroKind: 'sam', team: 2, x: 0, z: 7.8 },
    ],
  },
  {
    label: '1v1 tesla vs sam',
    specs: [
      { heroKind: 'tesla', team: 1, x: 0, z: 7.8 },
      { heroKind: 'sam', team: 2, x: 0, z: -7.8 },
    ],
  },
  {
    label: '2v2 mixed',
    specs: [
      { heroKind: 'sam', team: 1, x: 0, z: 7.8 },
      { heroKind: 'tesla', team: 1, x: 2.25, z: 6.4 },
      { heroKind: 'tesla', team: 2, x: 0, z: -7.8 },
      { heroKind: 'sam', team: 2, x: -2.25, z: -6.4 },
    ],
  },
  {
    label: '2v2 long',
    seconds: 600,
    specs: [
      { heroKind: 'sam', team: 1, x: 0, z: 7.8 },
      { heroKind: 'sam', team: 1, x: 2.25, z: 6.4 },
      { heroKind: 'tesla', team: 2, x: 0, z: -7.8 },
      { heroKind: 'tesla', team: 2, x: -2.25, z: -6.4 },
    ],
  },
  {
    label: '2v2 idle human teammate (red)',
    specs: [
      { heroKind: 'sam', team: 1, x: 0, z: 7.8, control: 'idle' },
      { heroKind: 'tesla', team: 1, x: 2.25, z: 6.4 },
      { heroKind: 'tesla', team: 2, x: 0, z: -7.8 },
      { heroKind: 'sam', team: 2, x: -2.25, z: -6.4 },
    ],
  },
  {
    label: '2v2 chaser human teammate (red)',
    specs: [
      { heroKind: 'sam', team: 1, x: 0, z: 7.8, control: 'chaser' },
      { heroKind: 'tesla', team: 1, x: 2.25, z: 6.4 },
      { heroKind: 'tesla', team: 2, x: 0, z: -7.8 },
      { heroKind: 'sam', team: 2, x: -2.25, z: -6.4 },
    ],
  },
  {
    label: '1v1 hard vs easy',
    specs: [
      { heroKind: 'sam', team: 1, x: 0, z: 7.8, difficulty: 'hard' },
      { heroKind: 'sam', team: 2, x: 0, z: -7.8, difficulty: 'easy' },
    ],
  },
  {
    label: '2v2 hard vs easy',
    seconds: 600,
    specs: [
      { heroKind: 'sam', team: 1, x: 0, z: 7.8, difficulty: 'hard' },
      { heroKind: 'tesla', team: 1, x: 2.25, z: 6.4, difficulty: 'hard' },
      { heroKind: 'tesla', team: 2, x: 0, z: -7.8, difficulty: 'easy' },
      { heroKind: 'sam', team: 2, x: -2.25, z: -6.4, difficulty: 'easy' },
    ],
  },
];

// Guard that the 'medium' profile is a behavioral no-op: a match with an explicit
// medium profile must replay identically to one with no profile passed at all.
function runIdentityCheck() {
  const specs = [
    { heroKind: 'sam', team: 1, x: 0, z: 7.8 },
    { heroKind: 'sam', team: 2, x: 0, z: -7.8 },
  ];
  const implicit = runMatch('medium identity', specs, 120);
  const explicit = runMatch(
    'medium identity',
    specs.map((spec) => ({ ...spec, difficulty: 'medium' })),
    120
  );
  return `=== medium identity check ===\nidentical: ${implicit === explicit}\n`;
}

export async function runAllScenarios(onProgress) {
  const reports = [];
  const total = SCENARIOS.length + 1;
  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    await onProgress?.(i, total, scenario.label);
    reports.push(runMatch(scenario.label, scenario.specs, scenario.seconds ?? 180));
  }
  await onProgress?.(SCENARIOS.length, total, 'medium identity check');
  reports.push(runIdentityCheck());
  await onProgress?.(total, total, null);
  return reports.join('\n');
}
