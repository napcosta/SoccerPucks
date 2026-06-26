import { PITCH } from './constants.js';

const INTENT = Object.freeze({
  ATTACK: 'attackBall',
  SUPPORT: 'supportAttack',
  GUARD: 'guardGoal',
});

const AI = Object.freeze({
  ballLeadTime: 0.22,
  switchMargin: 0.14,
  minIntentAge: 0.4,
  attackStandoff: 0.18,
  supportWidth: 3.2,
  supportDepth: 2.6,
  guardHomeDepth: 3.2,
  guardDangerLeadTime: 0.34,
  guardLaneWidth: PITCH.goalHalfWidth + 1.2,
  possessionRange: 0.24,
  passMinScore: 0.54,
  passMaxDistance: 8.5,
  passLaneRadius: 1.05,
  passAheadDepth: 3.2,
  carryLead: 2.2,
});

export function computeAICommands(player, ball, contextOrDefendZSign = {}) {
  const context =
    typeof contextOrDefendZSign === 'number'
      ? { defendZSign: contextOrDefendZSign }
      : contextOrDefendZSign;
  const defendZSign = nonZeroSign(context.defendZSign ?? player.spawnZ);
  const attackZSign = -defendZSign;
  const players = Array.isArray(context.players) ? context.players : [player];
  const dt = Number(context.dt) || 1 / 60;

  const beliefs = buildBeliefs(player, ball, players, defendZSign, attackZSign);
  const scores = scoreIntentions(beliefs);
  const intent = chooseIntent(player, scores, dt);
  const shot = shotOpportunity(player, ball, beliefs);
  const action = choosePossessionAction(player, shot, beliefs, intent);
  const target = targetForIntent(intent, player, ball, beliefs, action);
  const move = steerToward(player.body, target);

  player.ai.targetX = target.x;
  player.ai.targetZ = target.z;
  player.ai.action = action.name;

  return {
    moveX: move.x,
    moveZ: move.z,
    shoot: action.shoot,
    kickX: action.kickX,
    kickZ: action.kickZ,
    kickMultiplier: action.kickMultiplier,
    power: shouldUsePower(player, intent, shot, beliefs, action),
  };
}

function buildBeliefs(player, ball, players, defendZSign, attackZSign) {
  const predictedBall = predictBall(ball, AI.ballLeadTime);
  const teammates = players.filter((p) => p.team === player.team);
  const opponents = players.filter((p) => p.team !== player.team);
  const teammateRankings = teammates
    .map((p) => ({ player: p, cost: attackClaimCost(p, predictedBall, attackZSign) }))
    .sort((a, b) => a.cost - b.cost);
  const bestAttacker = teammateRankings[0]?.player ?? player;
  const playerHasBall = hasPossession(player, ball);
  const teamCarrier = teammates.find((p) => hasPossession(p, ball)) ?? null;
  const bestPass = bestPassOption(player, ball, teammates, opponents, attackZSign);

  const ownGoalZ = PITCH.halfLength * defendZSign;
  const opponentGoalZ = PITCH.halfLength * attackZSign;
  const ballHeadingToOwnGoal =
    Math.sign(ball.vz) === defendZSign && Math.abs(ball.vz) > 0.45;
  const ownHalfDepth = clamp((ball.z * defendZSign) / (PITCH.halfLength * 0.85), 0, 1);
  const dangerLane = clamp(1 - Math.abs(ball.x) / AI.guardLaneWidth, 0, 1);
  const dangerSpeed = ballHeadingToOwnGoal ? clamp(Math.abs(ball.vz) / 10, 0, 1) : 0;
  const danger = clamp(ownHalfDepth * 0.62 + dangerLane * 0.18 + dangerSpeed * 0.35, 0, 1);

  const ballDist = Math.hypot(ball.x - player.body.x, ball.z - player.body.z);
  const attackingHalf = clamp((ball.z * attackZSign) / PITCH.halfLength, 0, 1);
  const isBestAttacker = bestAttacker === player;
  const hasTeammate = teammates.length > 1;

  return {
    player,
    ball,
    predictedBall,
    teammates,
    opponents,
    bestAttacker,
    teamCarrier,
    bestPass,
    isBestAttacker,
    hasTeammate,
    playerHasBall,
    defendZSign,
    attackZSign,
    ownGoalZ,
    opponentGoalZ,
    ballHeadingToOwnGoal,
    danger,
    ballDist,
    attackingHalf,
  };
}

function scoreIntentions(beliefs) {
  const closeToBall = clamp(1 - beliefs.ballDist / 6, 0, 1);
  const attack = clamp(
    (beliefs.isBestAttacker ? 0.72 : 0.16) +
      closeToBall * 0.28 +
      (!beliefs.hasTeammate ? 0.2 : 0) -
      beliefs.danger * (beliefs.hasTeammate ? 0.18 : 0.08),
    0,
    1
  );
  const support = clamp(
    (beliefs.hasTeammate && !beliefs.isBestAttacker ? 0.58 : 0.06) +
      beliefs.attackingHalf * 0.16 -
      beliefs.danger * 0.42,
    0,
    1
  );
  const guard = clamp(
    beliefs.danger * 0.86 +
      (beliefs.hasTeammate && !beliefs.isBestAttacker ? 0.22 : 0) -
      closeToBall * 0.08,
    0,
    1
  );

  return {
    [INTENT.ATTACK]: attack,
    [INTENT.SUPPORT]: support,
    [INTENT.GUARD]: guard,
  };
}

function chooseIntent(player, scores, dt) {
  if (!player.ai) {
    player.ai = { intent: INTENT.ATTACK, intentAge: 0, intentScore: 0 };
  }

  player.ai.intentAge = (player.ai.intentAge ?? 0) + dt;

  const current = player.ai.intent ?? INTENT.ATTACK;
  const currentScore = scores[current] ?? 0;
  const [bestIntent, bestScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const canSwitch =
    bestIntent !== current &&
    (player.ai.intentAge >= AI.minIntentAge || currentScore < 0.08) &&
    bestScore > currentScore + AI.switchMargin;

  if (canSwitch) {
    player.ai.intent = bestIntent;
    player.ai.intentAge = 0;
    player.ai.intentScore = bestScore;
  } else {
    player.ai.intent = current;
    player.ai.intentScore = currentScore;
  }

  return player.ai.intent;
}

function targetForIntent(intent, player, ball, beliefs, action = { name: intent }) {
  if (action.name === 'carryBall') return carryTarget(player, ball, beliefs);
  if (action.name === 'passBall' || action.name === 'shootGoal') {
    return attackTarget(player, ball, beliefs);
  }
  if (intent === INTENT.SUPPORT) return supportTarget(player, ball, beliefs);
  if (intent === INTENT.GUARD) return guardTarget(player, ball, beliefs);
  return attackTarget(player, ball, beliefs);
}

function attackTarget(player, ball, beliefs) {
  const predicted = beliefs.predictedBall;
  const goalVector = normalize(0 - predicted.x, beliefs.opponentGoalZ - predicted.z);
  const standoff = player.body.radius + ball.radius + AI.attackStandoff;
  return clampToPitch({
    x: predicted.x - goalVector.x * standoff,
    z: predicted.z - goalVector.z * standoff,
  });
}

function supportTarget(player, ball, beliefs) {
  if (beliefs.teamCarrier && beliefs.teamCarrier !== player) {
    return receiveTargetFor(player, beliefs.teamCarrier, ball, beliefs.attackZSign, beliefs.opponents);
  }

  const side = supportSide(player, beliefs);
  const targetX = ball.x + side * AI.supportWidth;
  const targetZ = ball.z + beliefs.attackZSign * AI.supportDepth;
  return clampToPitch({
    x: targetX,
    z: targetZ,
  });
}

function carryTarget(player, ball, beliefs) {
  return clampToPitch({
    x: ball.x * 0.62,
    z: ball.z + beliefs.attackZSign * AI.carryLead,
  });
}

function guardTarget(player, ball, beliefs) {
  if (beliefs.danger > 0.48 || beliefs.ballHeadingToOwnGoal) {
    const predicted = predictBall(ball, AI.guardDangerLeadTime);
    return clampToPitch({
      x: predicted.x,
      z: clampSignedZ(predicted.z + beliefs.defendZSign * 0.35, beliefs.defendZSign, 1.6, PITCH.halfLength - 1.15),
    });
  }

  return clampToPitch({
    x: ball.x * 0.55 + supportSide(player, beliefs) * 0.55,
    z: beliefs.defendZSign * (PITCH.halfLength - AI.guardHomeDepth),
  });
}

function shotOpportunity(player, ball, beliefs) {
  const toGoal = normalize(0 - ball.x, beliefs.opponentGoalZ - ball.z);
  const playerToBallX = ball.x - player.body.x;
  const playerToBallZ = ball.z - player.body.z;
  const playerToBallLen = Math.hypot(playerToBallX, playerToBallZ) || 1;
  const alignment = (playerToBallX * toGoal.x + playerToBallZ * toGoal.z) / playerToBallLen;
  const touching = playerToBallLen <= player.body.radius + ball.radius + 0.3;
  const centralLane = clamp(1 - Math.abs(ball.x) / (PITCH.goalHalfWidth + 2.0), 0, 1);
  const confidence = clamp(alignment * 0.72 + centralLane * 0.28, 0, 1);

  return {
    touching,
    alignment,
    confidence,
  };
}

function choosePossessionAction(player, shot, beliefs, intent) {
  if (!beliefs.playerHasBall) return passiveAction(intent);

  const canShoot =
    shot.touching &&
    (shot.confidence > 0.76 || (beliefs.attackingHalf > 0.48 && shot.confidence > 0.44));
  const pass = beliefs.bestPass;
  const canPass = pass && pass.score >= AI.passMinScore;

  if (canShoot && (!canPass || beliefs.attackingHalf > 0.62 || shot.confidence > pass.score + 0.16)) {
    return kickToward(ballTargetForGoal(beliefs), beliefs.ball, 1.05, 'shootGoal');
  }

  if (canPass) {
    return kickToward(pass.target, beliefs.ball, 0.72, 'passBall');
  }

  if (canShoot && beliefs.attackingHalf > 0.34) {
    return kickToward(ballTargetForGoal(beliefs), beliefs.ball, 0.95, 'shootGoal');
  }

  return passiveAction('carryBall');
}

function passiveAction(name) {
  return {
    name,
    shoot: false,
    kickX: 0,
    kickZ: 0,
    kickMultiplier: 1,
  };
}

function kickToward(target, ball, kickMultiplier, name) {
  return {
    name,
    shoot: true,
    kickX: target.x - ball.x,
    kickZ: target.z - ball.z,
    kickMultiplier,
  };
}

function ballTargetForGoal(beliefs) {
  return {
    x: clamp(beliefs.ball.x * 0.18, -PITCH.goalHalfWidth * 0.72, PITCH.goalHalfWidth * 0.72),
    z: beliefs.opponentGoalZ + beliefs.attackZSign * 0.4,
  };
}

function shouldUsePower(player, intent, shot, beliefs, action) {
  const hero = player.hero;
  if (!hero || hero.cooldownRemaining > 0) return false;
  if (action?.name === 'passBall' || action?.name === 'shootGoal') return false;

  if (player.heroKind === 'tesla') {
    return !hero.active && beliefs.ballDist < 2.75 && intent !== INTENT.SUPPORT;
  }

  return shot.touching && shot.confidence > 0.48 && intent !== INTENT.SUPPORT;
}

function hasPossession(player, ball) {
  const dx = ball.x - player.body.x;
  const dz = ball.z - player.body.z;
  const touchRange = player.body.radius + ball.radius + AI.possessionRange;
  return player.hero?.captured || dx * dx + dz * dz <= touchRange * touchRange;
}

function bestPassOption(player, ball, teammates, opponents, attackZSign) {
  let best = null;

  for (const receiver of teammates) {
    if (receiver === player) continue;

    const target = receiveTargetFor(receiver, player, ball, attackZSign, opponents);
    const distance = Math.hypot(target.x - ball.x, target.z - ball.z);
    if (distance < 1.4 || distance > AI.passMaxDistance) continue;

    const laneClearance = passLaneClearance(ball, target, opponents);
    const receiverSpace = nearestOpponentDistance(target, opponents);
    const forwardGain = (target.z - ball.z) * attackZSign;
    const laneScore = clearanceScore(laneClearance);
    const spaceScore = clamp((receiverSpace - 0.9) / 3.8, 0, 1);
    const forwardScore = clamp((forwardGain + 0.8) / 5.2, 0, 1);
    const distanceScore = clamp(1 - Math.abs(distance - 4.2) / 4.6, 0, 1);
    const score = clamp(
      laneScore * 0.36 + spaceScore * 0.3 + forwardScore * 0.22 + distanceScore * 0.12,
      0,
      1
    );

    if (!best || score > best.score) {
      best = { receiver, target, score };
    }
  }

  return best;
}

function receiveTargetFor(receiver, carrier, ball, attackZSign, opponents = []) {
  const preferredSide = preferredReceiveSide(receiver, carrier);
  const carrierZ = carrier?.body?.z ?? ball.z;
  const forwardZ = furtherAhead(
    ball.z + attackZSign * AI.passAheadDepth,
    carrierZ + attackZSign * (AI.supportDepth * 0.72),
    attackZSign
  );

  const candidates = [preferredSide, -preferredSide].map((side, index) => {
    const point = clampToPitch({
      x: ball.x * 0.28 + side * AI.supportWidth,
      z: forwardZ,
    });
    const lane = clearanceScore(passLaneClearance(ball, point, opponents));
    const space = clamp((nearestOpponentDistance(point, opponents) - 0.9) / 3.8, 0, 1);
    const preference = index === 0 ? 0.08 : 0;
    return {
      point,
      score: lane * 0.44 + space * 0.48 + preference,
    };
  });

  return candidates.sort((a, b) => b.score - a.score)[0].point;
}

function preferredReceiveSide(receiver, carrier) {
  if (Math.abs(receiver.spawnX) > 0.1) return Math.sign(receiver.spawnX);

  const carrierX = carrier?.body?.x ?? 0;
  const dx = receiver.body.x - carrierX;
  if (Math.abs(dx) > 0.2) return Math.sign(dx);
  if (Math.abs(receiver.body.x) > 0.1) return Math.sign(receiver.body.x);
  return 1;
}

function passLaneClearance(start, end, opponents) {
  if (opponents.length === 0) return 99;

  let clearance = 99;
  for (const opponent of opponents) {
    clearance = Math.min(clearance, distancePointToSegment(opponent.body, start, end));
  }
  return clearance;
}

function nearestOpponentDistance(point, opponents) {
  if (opponents.length === 0) return 99;

  let distance = 99;
  for (const opponent of opponents) {
    distance = Math.min(distance, Math.hypot(point.x - opponent.body.x, point.z - opponent.body.z));
  }
  return distance;
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
  return clamp((clearance - AI.passLaneRadius) / 3.2, 0, 1);
}

function furtherAhead(a, b, attackZSign) {
  return attackZSign > 0 ? Math.max(a, b) : Math.min(a, b);
}

function attackClaimCost(player, target, attackZSign) {
  const dx = target.x - player.body.x;
  const dz = target.z - player.body.z;
  const dist = Math.hypot(dx, dz);
  const behindBall = (target.z - player.body.z) * attackZSign > -0.1;
  const behindPenalty = behindBall ? 0 : 0.85;
  const aiTieBreakPenalty = player.control === 'ai' ? 0.08 : 0;
  return dist + behindPenalty + aiTieBreakPenalty;
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

function supportSide(player, beliefs) {
  if (Math.abs(player.spawnX) > 0.1) return Math.sign(player.spawnX);
  if (Math.abs(player.body.x) > 0.1) return Math.sign(player.body.x);
  const teamIndex = beliefs.teammates.indexOf(player);
  return teamIndex % 2 === 0 ? -1 : 1;
}

function predictBall(ball, leadTime) {
  return {
    x: ball.x + ball.vx * leadTime,
    z: ball.z + ball.vz * leadTime,
  };
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

function clampSignedZ(z, sign, minAbs, maxAbs) {
  return sign * clamp(z * sign, minAbs, maxAbs);
}

function nonZeroSign(value) {
  return Math.sign(value) || 1;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
