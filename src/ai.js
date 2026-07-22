import { PITCH } from './constants.js';
import { TUNING } from './tuning.js';

const ROLE = Object.freeze({
  STRIKER: 'striker',
  SUPPORT: 'support',
  DEFENDER: 'defender',
  MARKER: 'marker',
});

const INTENT_FOR_ROLE = Object.freeze({
  [ROLE.STRIKER]: 'attackBall',
  [ROLE.SUPPORT]: 'supportAttack',
  [ROLE.DEFENDER]: 'guardGoal',
  [ROLE.MARKER]: 'guardGoal',
});

const AI = Object.freeze({
  interceptHorizon: 2.6,
  interceptIterations: 6,
  cruiseFactor: 0.92,
  strikerHysteresis: 0.35,
  aiTieBreak: 0.1,
  wrongSidePenalty: 0.45,
  possessionRange: 0.26,
  orbitRadius: 1.35,
  attackStandoff: 0.16,
  dribbleLead: 1.2,
  carryVeerRange: 4,
  carryVeerMax: 0.7,
  alignMin: 0.05,
  contestedAlign: -0.2,
  contestedRange: 1.35,
  shotMaxRange: 10.0,
  shotCloseRange: 6.0,
  shotLaneClear: 0.7,
  shotMinScore: 0.52,
  shotCloseMinScore: 0.15,
  shotScrappyScore: 0.05,
  passMinScore: 0.42,
  passGreatScore: 0.62,
  passMinDistance: 2.1,
  passMaxDistance: 10.5,
  passLaneRadius: 1.0,
  passPlanExtra: 0.4,
  pressureDist: 2.0,
  defensiveClearThreatRange: 3.4,
  maxHoldTime: 2.4,
  backOffTime: 5.0,
  defensiveThird: 0.4,
  supportMinBallDist: 3.2,
  supportSwitchBonus: 0.09,
  guardMinDist: 2.0,
  guardMaxDist: 6.2,
  markGoalSide: 1.25,
  stepUpMargin: 0.18,
  dangerDefend: 0.52,
  dashMinSpeed: 2.1,
  dashHeadingMin: 0.72,
  magnetGrabRange: 2.6,
  magnetContestRange: 3.0,
  humanReclaimTime: 1.2,
  humanEngagedBias: 0.25,
  humanIdlePenalty: 1.5,
  yieldContestRange: 2.2,
  keeperFallbackMargin: 0.25,
  keeperDanger: 0.75,
  roleStickiness: 0.8,
});

export const AI_DIFFICULTY = Object.freeze({
  easy: Object.freeze({
    key: 'easy',
    speedScale: 0.98,
    reactionTicks: 0,
    aimJitter: 0.04,
    shotBias: 0,
    passBias: 0,
    interceptHorizon: 2.2,
    powerChance: 1,
  }),
  medium: Object.freeze({
    key: 'medium',
    speedScale: 1,
    reactionTicks: 0,
    aimJitter: 0,
    shotBias: 0,
    passBias: 0,
    interceptHorizon: AI.interceptHorizon,
    powerChance: 1,
  }),
  hard: Object.freeze({
    key: 'hard',
    speedScale: 1,
    reactionTicks: 0,
    aimJitter: 0,
    shotBias: 0,
    passBias: 0,
    interceptHorizon: 3.4,
    powerChance: 1,
  }),
});

export function createTeamAIState() {
  return {
    tick: -1,
    time: 0,
    roles: new Map(),
    passPlan: null,
    carrier: null,
    interceptor: null,
    stallRef: null,
    ballStalled: false,
    ballStalledLong: false,
    teamHasBall: false,
    oppHasBall: false,
    humanEngaged: false,
    lastPossessionTime: 0,
    danger: 0,
  };
}

export function resetTeamAIState(state) {
  if (!state) return;
  state.roles = new Map();
  state.passPlan = null;
  state.carrier = null;
  state.interceptor = null;
  state.stallRef = null;
  state.ballStalled = false;
  state.ballStalledLong = false;
  state.teamHasBall = false;
  state.oppHasBall = false;
  state.humanEngaged = false;
  state.lastPossessionTime = 0;
  state.danger = 0;
}

export function computeAICommands(player, ball, contextOrDefendZSign = {}) {
  const context =
    typeof contextOrDefendZSign === 'number'
      ? { defendZSign: contextOrDefendZSign }
      : contextOrDefendZSign;
  const defendZSign = nonZeroSign(context.defendZSign ?? player.spawnZ);
  const attackZSign = -defendZSign;
  const players =
    Array.isArray(context.players) && context.players.length > 0 ? context.players : [player];
  const dt = Number(context.dt) || 1 / 60;

  if (!player.ai) player.ai = {};

  const teamState = context.teamState ?? fallbackTeamState(player);
  const tick = Number.isFinite(context.tick) ? context.tick : teamState.tick + 1;
  const profile = context.profile ?? AI_DIFFICULTY.medium;
  const playerIndex = Number.isFinite(context.playerIndex)
    ? context.playerIndex
    : players.indexOf(player);

  const teammates = players.filter((p) => p.team === player.team);
  const opponents = players.filter((p) => p.team !== player.team);

  if (teamState.tick !== tick) {
    teamState.tick = tick;
    updateTeamState(teamState, teammates, opponents, ball, defendZSign, attackZSign, dt);
  }

  const world = buildWorld(
    player,
    ball,
    teammates,
    opponents,
    teamState,
    defendZSign,
    attackZSign,
    profile
  );
  let decision = decide(player, world);

  if (profile.reactionTicks > 0) {
    const held = player.ai.heldDecision;
    if (held && tick < held.untilTick && held.target) {
      decision = { name: held.name, target: held.target };
    } else {
      player.ai.heldDecision = {
        name: decision.name,
        target: decision.target ? { x: decision.target.x, z: decision.target.z } : null,
        untilTick: tick + profile.reactionTicks,
      };
    }
  }

  player.ai.intent = INTENT_FOR_ROLE[world.role] ?? 'attackBall';
  player.ai.action = decision.name;
  player.ai.targetX = decision.target?.x ?? player.body.x;
  player.ai.targetZ = decision.target?.z ?? player.body.z;

  const move = decision.move ?? steerToward(player.body, decision.target ?? player.body);

  player.ai.shootCooldown = Math.max(0, (player.ai.shootCooldown ?? 0) - dt);
  player.ai.pokeCooldown = Math.max(0, (player.ai.pokeCooldown ?? 0) - dt);
  let shoot = Boolean(decision.shoot);
  if (shoot) {
    if (player.ai.shootCooldown > 0) shoot = false;
    else player.ai.shootCooldown = 0.22;
  }

  let kickX = decision.kickX ?? 0;
  let kickZ = decision.kickZ ?? 0;
  if (
    shoot &&
    decision.name !== 'passBall' &&
    profile.aimJitter > 0 &&
    (kickX !== 0 || kickZ !== 0)
  ) {
    const angle = (noise01(tick, playerIndex) * 2 - 1) * profile.aimJitter;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotatedX = kickX * cos - kickZ * sin;
    kickZ = kickX * sin + kickZ * cos;
    kickX = rotatedX;
  }

  let power = shouldUsePower(player, world, decision);
  if (power && profile.powerChance < 1) {
    power = noise01(tick, playerIndex + 13) < profile.powerChance;
  }

  return {
    moveX: move.x * profile.speedScale,
    moveZ: move.z * profile.speedScale,
    shoot,
    kickX,
    kickZ,
    kickMultiplier: decision.kickMultiplier ?? 1,
    power,
  };
}

function updateTeamState(state, teammates, opponents, ball, defendZSign, attackZSign, dt) {
  state.time += dt;

  if (state.passPlan) {
    const plan = state.passPlan;
    const receiverGone = !teammates.includes(plan.receiver);
    const arrived = !receiverGone && hasPossession(plan.receiver, ball);
    const stolen = opponents.some((opponent) => hasPossession(opponent, ball));
    if (receiverGone || arrived || stolen || state.time > plan.expires) state.passPlan = null;
  }

  const carrier = findCarrier(teammates, opponents, ball);
  const oppHasBall = Boolean(carrier && opponents.includes(carrier));
  const teamHasBall = Boolean(carrier && !oppHasBall);
  const danger = computeDanger(ball, defendZSign);

  if (carrier) state.lastPossessionTime = state.time;
  state.humanEngaged = false;
  for (const teammate of teammates) {
    if (teammate.control === 'ai') continue;
    const body = teammate.body;
    const dx = ball.x - body.x;
    const dz = ball.z - body.z;
    const dist = Math.hypot(dx, dz) || 1;
    const closing = (body.vx * dx + body.vz * dz) / dist;
    if (closing > 0.6 || (dist < 1.1 && Math.hypot(body.vx, body.vz) > 0.8)) {
      state.humanEngaged = true;
      break;
    }
  }

  const ref = state.stallRef;
  if (!ref || Math.hypot(ball.x - ref.x, ball.z - ref.z) > 1.4) {
    state.stallRef = { x: ball.x, z: ball.z, since: state.time };
    state.ballStalled = false;
    state.ballStalledLong = false;
  } else if (!carrier) {
    ref.since = state.time;
    state.ballStalled = false;
    state.ballStalledLong = false;
  } else {
    const elapsed = state.time - ref.since;
    state.ballStalled = elapsed > AI.maxHoldTime;
    state.ballStalledLong = elapsed > AI.backOffTime;
  }

  let striker = null;
  if (state.passPlan && teammates.includes(state.passPlan.receiver)) {
    striker = state.passPlan.receiver;
  } else {
    let bestCost = Infinity;
    for (const teammate of teammates) {
      const intercept = interceptBall(teammate.body, ball);
      let cost = intercept.time;
      if ((ball.z - teammate.body.z) * attackZSign < -0.2) cost += AI.wrongSidePenalty;
      if (teammate.control === 'ai') {
        cost += AI.aiTieBreak;
      } else if (state.humanEngaged) {
        cost -= AI.humanEngagedBias;
      } else if (
        oppHasBall ||
        (!carrier && state.time - state.lastPossessionTime > AI.humanReclaimTime)
      ) {
        cost += AI.humanIdlePenalty;
      }
      if (state.roles.get(teammate)?.role === ROLE.STRIKER) cost -= AI.strikerHysteresis;
      if (cost < bestCost) {
        bestCost = cost;
        striker = teammate;
      }
    }
  }

  const ownGoalZ = PITCH.halfLength * defendZSign;
  const prevRoles = state.roles;
  const goalDistance = (teammate) =>
    distanceTo(teammate.body, 0, ownGoalZ) -
    (prevRoles.get(teammate)?.role === ROLE.DEFENDER ? AI.roleStickiness : 0);
  const others = teammates
    .filter((teammate) => teammate !== striker)
    .sort((a, b) => goalDistance(a) - goalDistance(b));

  const defending =
    oppHasBall || danger > AI.dangerDefend || (!teamHasBall && ball.z * defendZSign > 0.5);

  const humanStriker = Boolean(
    striker && (striker.control === 'local' || striker.control === 'remote')
  );
  const roles = new Map();
  if (striker) roles.set(striker, { role: ROLE.STRIKER });
  others.forEach((teammate, index) => {
    let role = ROLE.SUPPORT;
    if (defending) role = index === 0 ? ROLE.DEFENDER : ROLE.MARKER;
    else if (others.length >= 2 && index === 0) role = ROLE.DEFENDER;
    else if (
      humanStriker &&
      index === 0 &&
      ball.z * attackZSign > 0 &&
      ball.z * attackZSign < PITCH.halfLength * 0.55
    ) {
      // Human striker pushing through midfield: cover the back instead of doubling
      // up on the ball. Once play is deep in the attacking third, join as support.
      role = ROLE.DEFENDER;
    }
    roles.set(teammate, { role });
  });

  let interceptor = null;
  if (shotThreat(ball, defendZSign, ownGoalZ)) {
    let bestTime = Infinity;
    for (const teammate of teammates) {
      if (teammate.control !== 'ai') continue;
      const time = interceptBall(teammate.body, ball).time;
      if (time < bestTime) {
        bestTime = time;
        interceptor = teammate;
      }
    }
  }
  state.interceptor = interceptor;

  state.roles = roles;
  state.carrier = carrier;
  state.teamHasBall = teamHasBall;
  state.oppHasBall = oppHasBall;
  state.danger = danger;
}

function buildWorld(
  player,
  ball,
  teammates,
  opponents,
  teamState,
  defendZSign,
  attackZSign,
  profile
) {
  const myIntercept = interceptBall(player.body, ball, profile.interceptHorizon);
  let oppInterceptTime = Infinity;
  let nearestOppToBall = Infinity;
  let pressure = Infinity;
  for (const opponent of opponents) {
    oppInterceptTime = Math.min(oppInterceptTime, interceptBall(opponent.body, ball).time);
    nearestOppToBall = Math.min(nearestOppToBall, distanceTo(opponent.body, ball.x, ball.z));
    pressure = Math.min(pressure, distanceTo(opponent.body, player.body.x, player.body.z));
  }

  return {
    player,
    ball,
    teammates,
    opponents,
    teamState,
    profile,
    defendZSign,
    attackZSign,
    ownGoalZ: PITCH.halfLength * defendZSign,
    opponentGoalZ: PITCH.halfLength * attackZSign,
    role: teamState.roles.get(player)?.role ?? ROLE.STRIKER,
    hasBall: hasPossession(player, ball),
    carrier: teamState.carrier ?? null,
    stalled: Boolean(teamState.ballStalled),
    stalledLong: Boolean(teamState.ballStalledLong),
    teamHasBall: Boolean(teamState.teamHasBall),
    oppHasBall: Boolean(teamState.oppHasBall),
    danger: teamState.danger ?? 0,
    myIntercept,
    oppInterceptTime,
    nearestOppToBall,
    pressure,
    ballDist: distanceTo(player.body, ball.x, ball.z),
    attackingHalf: clamp((ball.z * attackZSign) / PITCH.halfLength, 0, 1),
  };
}

function decide(player, world) {
  const stolen =
    world.carrier && world.carrier !== player && Boolean(world.carrier.hero?.captured);
  const teammateOnBall =
    world.carrier && world.carrier !== player && world.teammates.includes(world.carrier);
  if (world.hasBall && !stolen && !teammateOnBall) return possessionDecision(player, world);
  if (world.role === ROLE.STRIKER) {
    if (shouldYieldToHuman(player, world)) return supportDecision(player, world);
    return strikerDecision(player, world);
  }
  if (world.role === ROLE.SUPPORT) return supportDecision(player, world);
  if (world.role === ROLE.MARKER) return markerDecision(player, world);
  return defenderDecision(player, world);
}

function shouldYieldToHuman(player, world) {
  const carrier = world.carrier;
  if (!carrier || carrier === player || carrier.control === 'ai') return false;
  if (!world.teammates.includes(carrier)) return false;
  if (world.stalledLong) return false;
  return world.nearestOppToBall > AI.yieldContestRange;
}

function strikerDecision(player, world) {
  const emergency = emergencyDecision(player, world);
  if (emergency) return emergency;

  if (
    !world.teamHasBall &&
    !world.oppHasBall &&
    world.danger > AI.dangerDefend &&
    world.myIntercept.time > world.oppInterceptTime + AI.keeperFallbackMargin
  ) {
    return defenderDecision(player, world);
  }

  if (world.teamState.passPlan?.receiver === player) {
    const point = clampToPitch(world.myIntercept);
    return { name: 'receivePass', target: point, move: steerToward(player.body, point) };
  }

  const ballSpeed = Math.hypot(world.ball.vx, world.ball.vz);
  if (!world.oppHasBall && world.ballDist < 1.9 && ballSpeed < 3) {
    return possessionDecision(player, world);
  }

  return chaseDecision(player, world, world.oppHasBall ? 'pressBall' : 'chaseBall');
}

function chaseDecision(player, world, name) {
  if (world.oppHasBall && world.carrier) {
    const carrier = world.carrier.body;
    const toGoal = normalize(0 - carrier.x, world.ownGoalZ - carrier.z);
    const lead = clamp(distanceTo(player.body, carrier.x, carrier.z) * 0.5, 0.9, 2.4);
    const block = clampToPitch({
      x: carrier.x + toGoal.x * lead,
      z: carrier.z + toGoal.z * lead,
    });
    return { name, target: block, move: steerToward(player.body, block) };
  }

  const intercept = world.myIntercept;
  const goalDir = normalize(0 - intercept.x, world.opponentGoalZ - intercept.z);
  const standoff = player.body.radius + world.ball.radius + AI.attackStandoff;
  const target = clampToPitch({
    x: intercept.x - goalDir.x * standoff,
    z: intercept.z - goalDir.z * standoff,
  });
  return { name, target, move: approachAroundBall(player, world.ball, target) };
}

function possessionDecision(player, world) {
  const inDefensiveThird = world.ball.z * world.defendZSign > PITCH.halfLength * AI.defensiveThird;

  if (world.stalledLong && !player.hero?.captured && !inDefensiveThird) {
    const spot = clampToPitch({
      x: world.ball.x * 0.4,
      z: world.ball.z + world.defendZSign * 3.2,
    });
    return { name: 'backOff', target: spot, move: steerToward(player.body, spot) };
  }

  const shot = bestShot(world);
  const pass = bestPassOption(player, world);
  const pressured = world.pressure < AI.pressureDist;
  const stalled = world.stalled;

  const { shotBias, passBias } = world.profile;
  const shotReady =
    shot &&
    (shot.score > AI.shotMinScore + shotBias ||
      (shot.distToGoal < AI.shotCloseRange && shot.score > AI.shotCloseMinScore + shotBias) ||
      (stalled && world.attackingHalf > 0.5 && shot.score > AI.shotScrappyScore + shotBias));
  const passReady = pass && pass.score >= AI.passMinScore + passBias;

  if (shotReady && (!passReady || shot.score > pass.score - 0.15 || world.attackingHalf > 0.55)) {
    return kickAction(player, world, shot.target, 1.05, 'shootGoal');
  }

  if (
    passReady &&
    (pressured || stalled || pass.score > AI.passGreatScore || world.attackingHalf < 0.4)
  ) {
    const action = kickAction(player, world, pass.target, pass.power, 'passBall');
    if (action.name === 'passBall' && action.shoot && world.hasBall) {
      world.teamState.passPlan = {
        receiver: pass.receiver,
        target: pass.target,
        expires: world.teamState.time + pass.flightTime + AI.passPlanExtra,
      };
    }
    return action;
  }

  const defensiveClearThreat =
    inDefensiveThird && world.nearestOppToBall < AI.defensiveClearThreatRange;
  if (inDefensiveThird && (pressured || stalled || defensiveClearThreat)) {
    return kickAction(player, world, clearanceTarget(world), 1.0, 'clearBall');
  }

  if (stalled && shot) {
    return kickAction(player, world, shot.target, 1.05, 'shootGoal');
  }

  return carryDecision(player, world);
}

function kickAction(player, world, target, power, name) {
  const { ball } = world;
  const dx = target.x - ball.x;
  const dz = target.z - ball.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return carryDecision(player, world);
  const kickDir = { x: dx / len, z: dz / len };

  if (kickEndangersOwnGoal(ball, kickDir, world.defendZSign)) {
    return carryDecision(player, world);
  }

  if (!player.hero?.captured) {
    const contested = world.nearestOppToBall < AI.contestedRange || world.stalled;
    const alignNeeded = contested ? AI.contestedAlign : AI.alignMin;
    const toBall = normalize(ball.x - player.body.x, ball.z - player.body.z);
    const align = toBall.x * kickDir.x + toBall.z * kickDir.z;
    if (align < alignNeeded) {
      if (contested && name !== 'passBall') {
        if (player.ai.pokeCooldown > 0) {
          return { name: 'contest', target: ball, move: steerToward(player.body, ball) };
        }
        const poke = pokeAction(player, world, kickDir);
        if (poke) return poke;
      }
      const standoff = player.body.radius + ball.radius + AI.attackStandoff;
      const spot = clampToPitch({
        x: ball.x - kickDir.x * standoff,
        z: ball.z - kickDir.z * standoff,
      });
      return { name: 'lineUp', target: spot, move: approachAroundBall(player, ball, spot) };
    }
  }

  const kickDirWithMomentum = compensateForBallMomentum(
    ball,
    kickDir,
    TUNING.player.shootVelocity * power
  );

  return {
    name,
    shoot: true,
    kickX: kickDirWithMomentum.x,
    kickZ: kickDirWithMomentum.z,
    kickMultiplier: power,
    target,
    move: steerToward(player.body, ball),
  };
}

function compensateForBallMomentum(ball, desiredDir, kickSpeed) {
  const vx = Number.isFinite(ball.vx) ? ball.vx : 0;
  const vz = Number.isFinite(ball.vz) ? ball.vz : 0;
  const along = vx * desiredDir.x + vz * desiredDir.z;
  const velocitySq = vx * vx + vz * vz;
  const lateralSq = Math.max(0, velocitySq - along * along);
  const remainingSq = kickSpeed * kickSpeed - lateralSq;

  // A kick can only cancel so much sideways momentum. In the rare impossible
  // case, retain the direct target rather than reversing the intended play.
  if (remainingSq <= 0) return desiredDir;

  const resultingSpeed = along + Math.sqrt(remainingSq);
  if (resultingSpeed <= 0.001) return desiredDir;

  return normalize(
    desiredDir.x * resultingSpeed - vx,
    desiredDir.z * resultingSpeed - vz
  );
}

function pokeAction(player, world, desiredDir) {
  const { ball, opponents } = world;
  const toBall = normalize(ball.x - player.body.x, ball.z - player.body.z);
  const perp = { x: -toBall.z, z: toBall.x };
  const candidates = [];
  for (const blend of [
    { x: toBall.x, z: toBall.z },
    { x: toBall.x * 0.5 + perp.x * 0.87, z: toBall.z * 0.5 + perp.z * 0.87 },
    { x: toBall.x * 0.5 - perp.x * 0.87, z: toBall.z * 0.5 - perp.z * 0.87 },
  ]) {
    const dir = normalize(blend.x, blend.z);
    if (kickEndangersOwnGoal(ball, dir, world.defendZSign)) continue;
    const landing = { x: ball.x + dir.x * 4, z: ball.z + dir.z * 4 };
    const laneScore = clamp(passLaneClearance(ball, landing, opponents) / 3, 0, 1);
    const wallPenalty =
      Math.abs(landing.x) > PITCH.halfWidth - 0.6 || Math.abs(landing.z) > PITCH.halfLength - 0.6
        ? 0.8
        : 0;
    const desirability =
      dir.x * desiredDir.x +
      dir.z * desiredDir.z +
      dir.z * world.attackZSign * 0.6 +
      laneScore * 1.4 -
      wallPenalty;
    candidates.push({ dir, desirability });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.desirability - a.desirability);
  const dir = candidates[0].dir;
  player.ai.pokeCooldown = 0.9;
  return {
    name: 'pokeBall',
    shoot: true,
    kickX: dir.x,
    kickZ: dir.z,
    kickMultiplier: 1.0,
    target: clampToPitch({ x: ball.x + dir.x * 4, z: ball.z + dir.z * 4 }),
    move: steerToward(player.body, ball),
  };
}

function bestShot(world) {
  const { ball } = world;
  const distToGoal = Math.hypot(ball.x, world.opponentGoalZ - ball.z);
  if (distToGoal > AI.shotMaxRange) return null;

  let best = null;
  for (const fraction of [-0.62, 0, 0.62]) {
    const target = {
      x: fraction * PITCH.goalHalfWidth,
      z: world.opponentGoalZ + world.attackZSign * 0.4,
    };
    const lane = passLaneClearance(ball, target, world.opponents);
    const laneScore = clamp((lane - AI.shotLaneClear) / 2.2, 0, 1);
    const rangeScore = clamp(1 - distToGoal / AI.shotMaxRange, 0, 1);
    const score = laneScore * 0.7 + rangeScore * 0.3;
    if (!best || score > best.score) best = { target, score, distToGoal };
  }
  return best;
}

function bestPassOption(player, world) {
  let best = null;
  for (const receiver of world.teammates) {
    if (receiver === player) continue;
    const option = evaluatePass(receiver, world);
    if (option && (!best || option.score > best.score)) best = option;
  }
  return best;
}

function evaluatePass(receiver, world) {
  const { ball, opponents, attackZSign } = world;

  let target = { x: receiver.body.x, z: receiver.body.z };
  let power = 0.7;
  let flightTime = 0;
  for (let i = 0; i < 3; i++) {
    const reach = Math.hypot(target.x - ball.x, target.z - ball.z);
    if (reach < AI.passMinDistance || reach > AI.passMaxDistance) return null;
    power = clamp(0.45 + reach / 10, 0.55, 1);
    flightTime = passFlightTime(reach, TUNING.player.shootVelocity * power);
    if (!Number.isFinite(flightTime)) {
      power = 1;
      flightTime = passFlightTime(reach, TUNING.player.shootVelocity);
      if (!Number.isFinite(flightTime)) return null;
    }
    target = clampToPitch({
      x: receiver.body.x + receiver.body.vx * flightTime * 0.6,
      z:
        receiver.body.z +
        receiver.body.vz * flightTime * 0.6 +
        attackZSign * Math.min(1.6, flightTime * 2.2),
    });
  }

  const distance = Math.hypot(target.x - ball.x, target.z - ball.z);
  if (distance < AI.passMinDistance || distance > AI.passMaxDistance) return null;

  const laneScore = clearanceScore(passLaneClearance(ball, target, opponents));
  const spaceScore = clamp((nearestOpponentDistance(target, opponents) - 1) / 3.6, 0, 1);
  const forwardScore = clamp(((target.z - ball.z) * attackZSign + 1.2) / 6, 0, 1);
  const distanceScore = clamp(1 - Math.abs(distance - 4.5) / 5, 0, 1);
  const score = clamp(
    laneScore * 0.4 + spaceScore * 0.26 + forwardScore * 0.22 + distanceScore * 0.12,
    0,
    1
  );
  return { receiver, target, score, power, flightTime };
}

function clearanceTarget(world) {
  const { ball, opponents, attackZSign } = world;
  let best = null;
  let bestLane = -Infinity;
  for (const side of [-1, 1]) {
    const target = clampToPitch({
      x: side * (PITCH.halfWidth - 1.6),
      z: ball.z + attackZSign * PITCH.halfLength * 0.85,
    });
    const lane = passLaneClearance(ball, target, opponents);
    if (lane > bestLane) {
      bestLane = lane;
      best = target;
    }
  }
  return best;
}

function carryDecision(player, world) {
  const { ball } = world;
  const dir = carryDirection(world);
  const body = player.body;
  const target = clampToPitch({
    x: ball.x + dir.x * AI.dribbleLead,
    z: ball.z + dir.z * AI.dribbleLead,
  });

  const toTarget = normalize(target.x - body.x, target.z - body.z);
  const toBall = normalize(ball.x - body.x, ball.z - body.z);
  const aligned = toTarget.x * toBall.x + toTarget.z * toBall.z;
  if (aligned < 0.1) {
    const spot = clampToPitch({
      x: ball.x - dir.x * (body.radius + ball.radius + AI.attackStandoff),
      z: ball.z - dir.z * (body.radius + ball.radius + AI.attackStandoff),
    });
    return { name: 'carryBall', target: spot, move: approachAroundBall(player, ball, spot) };
  }
  return { name: 'carryBall', target, move: steerToward(body, target) };
}

function carryDirection(world) {
  const { ball, opponents, attackZSign } = world;
  const goalDir = normalize(0 - ball.x, world.opponentGoalZ - ball.z);
  const opponent = nearestOpponentTo(ball.x, ball.z, opponents);
  if (!opponent) return goalDir;

  const oppDist = distanceTo(opponent.body, ball.x, ball.z);
  const weight = clamp(1 - oppDist / AI.carryVeerRange, 0, 1) * AI.carryVeerMax;
  if (weight <= 0) return goalDir;

  const away = normalize(ball.x - opponent.body.x, ball.z - opponent.body.z);
  let dir = normalize(
    goalDir.x * (1 - weight) + away.x * weight,
    goalDir.z * (1 - weight) + away.z * weight
  );
  if (dir.z * attackZSign < -0.2) {
    const sideX = dir.x !== 0 ? Math.sign(dir.x) : ball.x >= 0 ? -1 : 1;
    dir = normalize(sideX, attackZSign * 0.35);
  }
  return dir;
}

function supportDecision(player, world) {
  const target = chooseSupportTarget(player, world);
  const teammateControlsBall =
    world.teamHasBall && world.carrier && world.carrier !== player;
  const move = teammateControlsBall
    ? approachAroundBall(player, world.ball, target)
    : steerToward(player.body, target);
  return { name: 'runForSpace', target, move };
}

function chooseSupportTarget(player, world) {
  const { ball, attackZSign } = world;
  const side = supportSide(player, world);
  const wideX = PITCH.halfWidth - 2;

  const candidates = [
    { x: wideX, z: ball.z + attackZSign * 3.4 },
    { x: -wideX, z: ball.z + attackZSign * 3.4 },
    { x: ball.x * 0.3, z: ball.z + attackZSign * 4.6 },
    {
      x: -Math.sign(ball.x || 1) * PITCH.goalHalfWidth * 1.9,
      z: world.opponentGoalZ - attackZSign * 2.4,
    },
    { x: ball.x * 0.4 + side * 2.6, z: ball.z - attackZSign * 2.4 },
    { x: side * 3.2, z: ball.z + attackZSign * 2.2 },
  ].map((point) => ({ point: clampToPitch(point), bonus: 0 }));

  const current = player.ai.supportTarget;
  if (current) candidates.push({ point: clampToPitch(current), bonus: AI.supportSwitchBonus });

  let best = null;
  for (const candidate of candidates) {
    const point = candidate.point;
    if (Math.hypot(point.x - ball.x, point.z - ball.z) < AI.supportMinBallDist) continue;
    const lane = clearanceScore(passLaneClearance(ball, point, world.opponents));
    const space = clamp((nearestOpponentDistance(point, world.opponents) - 1) / 3.6, 0, 1);
    const forward = clamp(((point.z - ball.z) * attackZSign + 2.5) / 7, 0, 1);
    let spacing = 1;
    for (const teammate of world.teammates) {
      if (teammate === player) continue;
      spacing = Math.min(spacing, clamp(distanceTo(teammate.body, point.x, point.z) / 4, 0, 1));
    }
    const near = clamp(1 - distanceTo(player.body, point.x, point.z) / 18, 0, 1);
    const score =
      lane * 0.34 + space * 0.24 + forward * 0.18 + spacing * 0.14 + near * 0.1 + candidate.bonus;
    if (!best || score > best.score) best = { point, score };
  }

  const chosen = best?.point ?? clampToPitch({ x: player.body.x, z: player.body.z });
  player.ai.supportTarget = { x: chosen.x, z: chosen.z };
  return chosen;
}

function defenderDecision(player, world) {
  const emergency = emergencyDecision(player, world);
  if (emergency) return emergency;

  if (!world.teamHasBall && world.myIntercept.time < world.oppInterceptTime - AI.stepUpMargin) {
    return chaseDecision(player, world, 'stepUp');
  }

  const { ball } = world;
  if (world.danger > AI.keeperDanger) {
    const goalward = Math.sign(ball.vz) === world.defendZSign && Math.abs(ball.vz) > 0.5;
    const t = goalward ? (world.ownGoalZ - ball.z) / ball.vz : -1;
    const crossX = t > 0 && t < 3.5 ? ball.x + ball.vx * t : ball.x;
    const target = clampToPitch({
      x: clamp(crossX, -PITCH.goalHalfWidth * 0.9, PITCH.goalHalfWidth * 0.9),
      z: world.ownGoalZ - world.defendZSign * AI.guardMinDist,
    });
    return { name: 'keepGoal', target, move: steerToward(player.body, target) };
  }

  const dx = ball.x;
  const dz = ball.z - world.ownGoalZ;
  const ballToGoalDist = Math.hypot(dx, dz) || 1;
  const toBall = { x: dx / ballToGoalDist, z: dz / ballToGoalDist };
  const depth = clamp(
    ballToGoalDist * (0.45 - world.danger * 0.18),
    AI.guardMinDist,
    AI.guardMaxDist
  );
  const target = clampToPitch({
    x: toBall.x * depth,
    z: world.ownGoalZ + toBall.z * depth,
  });
  return { name: 'coverGoal', target, move: steerToward(player.body, target) };
}

function markerDecision(player, world) {
  const emergency = emergencyDecision(player, world);
  if (emergency) return emergency;

  const threat = mostAdvancedFreeOpponent(world);
  if (!threat) return defenderDecision(player, world);

  const toGoal = normalize(0 - threat.body.x, world.ownGoalZ - threat.body.z);
  const target = clampToPitch({
    x: threat.body.x + toGoal.x * AI.markGoalSide,
    z: threat.body.z + toGoal.z * AI.markGoalSide,
  });
  return { name: 'markOpponent', target, move: steerToward(player.body, target) };
}

function emergencyDecision(player, world) {
  if (!shotThreat(world.ball, world.defendZSign, world.ownGoalZ)) return null;
  const interceptor = world.teamState.interceptor;
  if (interceptor && interceptor !== player) return null;

  const point = clampToPitch(world.myIntercept);
  return { name: 'interceptShot', target: point, move: steerToward(player.body, point) };
}

function shotThreat(ball, defendZSign, ownGoalZ) {
  if (Math.sign(ball.vz) !== defendZSign) return false;
  if (Math.hypot(ball.vx, ball.vz) < 3.0 || Math.abs(ball.vz) < 1.2) return false;

  const t = (ownGoalZ - ball.z) / ball.vz;
  if (t < 0 || t > 3.2) return false;
  const crossX = ball.x + ball.vx * t;
  return Math.abs(crossX) <= PITCH.goalHalfWidth + 1.2;
}

function mostAdvancedFreeOpponent(world) {
  let best = null;
  let bestDepth = -Infinity;
  for (const opponent of world.opponents) {
    if (opponent === world.carrier) continue;
    const depth = opponent.body.z * world.defendZSign;
    if (depth > bestDepth) {
      bestDepth = depth;
      best = opponent;
    }
  }
  return best;
}

function approachAroundBall(player, ball, target) {
  const body = player.body;
  const blockRadius = body.radius + ball.radius + 0.18;
  const ballDist = distanceTo(body, ball.x, ball.z);
  const clearance = distancePointToSegment(ball, body, target);
  if (clearance > blockRadius || ballDist < blockRadius + 0.3) {
    return steerToward(body, target);
  }

  const toBall = normalize(ball.x - body.x, ball.z - body.z);
  const perp = { x: -toBall.z, z: toBall.x };
  const toTarget = { x: target.x - ball.x, z: target.z - ball.z };
  const side = perp.x * toTarget.x + perp.z * toTarget.z >= 0 ? 1 : -1;
  const orbit = clampToPitch({
    x: ball.x + perp.x * side * AI.orbitRadius - toBall.x * AI.orbitRadius * 0.25,
    z: ball.z + perp.z * side * AI.orbitRadius - toBall.z * AI.orbitRadius * 0.25,
  });
  return steerToward(body, orbit);
}

function shouldUsePower(player, world, decision) {
  const hero = player.hero;
  if (!hero || hero.cooldownRemaining > 0) return false;

  if (player.heroKind === 'tesla') {
    if (hero.active) return false;
    const teammateControlsBall =
      world.teamHasBall &&
      world.carrier &&
      world.carrier !== player &&
      world.teammates.includes(world.carrier);
    if (teammateControlsBall) return false;
    const contested = world.nearestOppToBall < AI.magnetContestRange;
    const winnable = !world.oppHasBall || world.ballDist < 1.6;
    return winnable && contested && world.ballDist < AI.magnetGrabRange;
  }

  const body = player.body;
  const speed = Math.hypot(body.vx, body.vz);
  if (speed < AI.dashMinSpeed) return false;
  if (decision.target) {
    const toTarget = normalize(decision.target.x - body.x, decision.target.z - body.z);
    const heading = (body.vx * toTarget.x + body.vz * toTarget.z) / speed;
    if (heading < AI.dashHeadingMin) return false;
  }

  if (decision.name === 'interceptShot') return true;
  if (decision.name === 'carryBall') {
    return world.pressure < AI.pressureDist && world.attackingHalf > 0.25;
  }
  if (
    decision.name === 'chaseBall' ||
    decision.name === 'pressBall' ||
    decision.name === 'stepUp' ||
    decision.name === 'receivePass'
  ) {
    const contested = world.oppInterceptTime < world.myIntercept.time + 0.4;
    const winnable = world.myIntercept.time < world.oppInterceptTime + 0.6;
    return contested && winnable && world.ballDist > 1.4;
  }
  return false;
}

function kickEndangersOwnGoal(ball, kickDir, defendZSign) {
  if (kickDir.z * defendZSign <= 0.25) return false;
  const ownGoalZ = PITCH.halfLength * defendZSign;
  const t = (ownGoalZ - ball.z) / kickDir.z;
  if (t <= 0) return false;
  const crossX = ball.x + kickDir.x * t;
  return Math.abs(crossX) < PITCH.goalHalfWidth + 1.1;
}

function hasPossession(player, ball) {
  if (player.hero?.captured) return true;
  const reach = player.body.radius + ball.radius + AI.possessionRange;
  const dx = ball.x - player.body.x;
  const dz = ball.z - player.body.z;
  return dx * dx + dz * dz <= reach * reach;
}

function findCarrier(teammates, opponents, ball) {
  let best = null;
  let bestGap = AI.possessionRange;
  for (const player of [...teammates, ...opponents]) {
    if (player.hero?.captured) return player;
    const gap = distanceTo(player.body, ball.x, ball.z) - (player.body.radius + ball.radius);
    if (gap <= bestGap) {
      bestGap = gap;
      best = player;
    }
  }
  return best;
}

function computeDanger(ball, defendZSign) {
  const ownHalfDepth = clamp((ball.z * defendZSign) / (PITCH.halfLength * 0.85), 0, 1);
  const lane = clamp(1 - Math.abs(ball.x) / (PITCH.goalHalfWidth + 1.6), 0, 1);
  const towardGoal = Math.sign(ball.vz) === defendZSign ? clamp(Math.abs(ball.vz) / 9, 0, 1) : 0;
  return clamp(ownHalfDepth * 0.6 + lane * 0.15 + towardGoal * 0.35, 0, 1);
}

function ballPositionAt(ball, t) {
  const k = Math.max(TUNING.ball.damping, 0.0001);
  const f = (1 - Math.exp(-k * t)) / k;
  return {
    x: clamp(ball.x + ball.vx * f, -PITCH.halfWidth + 0.5, PITCH.halfWidth - 0.5),
    z: clamp(ball.z + ball.vz * f, -PITCH.halfLength + 0.5, PITCH.halfLength - 0.5),
  };
}

function travelTime(body, x, z) {
  const dx = x - body.x;
  const dz = z - body.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.02) return 0;
  const cruise = Math.max(
    1,
    (TUNING.player.accel / Math.max(TUNING.player.damping, 0.1)) * AI.cruiseFactor
  );
  const along = (body.vx * dx + body.vz * dz) / dist;
  const rampUp = clamp((cruise - along) / Math.max(TUNING.player.accel, 0.1), 0, 0.8) * 0.5;
  return dist / cruise + rampUp;
}

function interceptBall(body, ball, horizon = AI.interceptHorizon) {
  let t = 0;
  let point = { x: ball.x, z: ball.z };
  for (let i = 0; i < AI.interceptIterations; i++) {
    point = ballPositionAt(ball, t);
    t = Math.min(horizon, travelTime(body, point.x, point.z));
  }
  return { time: t, x: point.x, z: point.z };
}

function passFlightTime(distance, speed) {
  const k = Math.max(TUNING.ball.damping, 0.05);
  const ratio = (distance * k) / Math.max(speed, 0.1);
  if (ratio >= 0.92) return Infinity;
  return -Math.log(1 - ratio) / k;
}

function passLaneClearance(start, end, opponents) {
  if (opponents.length === 0) return 99;

  const dirX = end.x - start.x;
  const dirZ = end.z - start.z;
  const len = Math.hypot(dirX, dirZ);
  if (len < 0.001) return nearestOpponentDistance(start, opponents);

  let clearance = 99;
  for (const opponent of opponents) {
    const relX = opponent.body.x - start.x;
    const relZ = opponent.body.z - start.z;
    const along = (relX * dirX + relZ * dirZ) / len;
    if (along < 0) continue;
    const t = Math.min(along, len);
    const px = start.x + (dirX / len) * t;
    const pz = start.z + (dirZ / len) * t;
    clearance = Math.min(clearance, Math.hypot(opponent.body.x - px, opponent.body.z - pz));
  }
  return clearance;
}

function nearestOpponentDistance(point, opponents) {
  let distance = 99;
  for (const opponent of opponents) {
    distance = Math.min(distance, distanceTo(opponent.body, point.x, point.z));
  }
  return distance;
}

function nearestOpponentTo(x, z, opponents) {
  let best = null;
  let bestDist = Infinity;
  for (const opponent of opponents) {
    const dist = distanceTo(opponent.body, x, z);
    if (dist < bestDist) {
      bestDist = dist;
      best = opponent;
    }
  }
  return best;
}

function distancePointToSegment(point, start, end) {
  const sx = start.x;
  const sz = start.z;
  const vx = end.x - sx;
  const vz = end.z - sz;
  const lenSq = vx * vx + vz * vz;
  if (lenSq <= 0.0001) return Math.hypot(point.x - sx, point.z - sz);

  const t = clamp(((point.x - sx) * vx + (point.z - sz) * vz) / lenSq, 0, 1);
  const x = sx + vx * t;
  const z = sz + vz * t;
  return Math.hypot(point.x - x, point.z - z);
}

function clearanceScore(clearance) {
  return clamp((clearance - AI.passLaneRadius) / 2.8, 0, 1);
}

function supportSide(player, world) {
  if (Math.abs(player.spawnX) > 0.1) return Math.sign(player.spawnX);
  if (Math.abs(player.body.x) > 0.1) return Math.sign(player.body.x);
  return world.teammates.indexOf(player) % 2 === 0 ? -1 : 1;
}

function steerToward(body, target) {
  let dx = target.x - body.x;
  let dz = target.z - body.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= 0.05) return { x: 0, z: 0 };

  dx /= dist;
  dz /= dist;
  const arrive = clamp(dist / 1.0, 0.25, 1);
  return {
    x: dx * arrive,
    z: dz * arrive,
  };
}

function fallbackTeamState(player) {
  if (!player.ai.teamStateFallback) player.ai.teamStateFallback = createTeamAIState();
  return player.ai.teamStateFallback;
}

function distanceTo(body, x, z) {
  return Math.hypot(x - body.x, z - body.z);
}

function normalize(x, z) {
  const len = Math.hypot(x, z) || 1;
  return { x: x / len, z: z / len };
}

function clampToPitch(point) {
  return {
    x: clamp(point.x, -PITCH.halfWidth + 0.8, PITCH.halfWidth - 0.8),
    z: clamp(point.z, -PITCH.halfLength + 0.9, PITCH.halfLength - 0.9),
  };
}

function nonZeroSign(value) {
  return Math.sign(value) || 1;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Deterministic hash noise in [0, 1) — keeps the sim harness reproducible (no Math.random).
function noise01(a, b) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2b591149) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
