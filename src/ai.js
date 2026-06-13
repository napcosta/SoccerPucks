import { PITCH } from './constants.js';

export function computeAICommands(player, ball, defendZSign) {
  const body = player.body;

  const ballHeadingToOurGoal = Math.sign(ball.vz) === defendZSign && Math.abs(ball.vz) > 0.5;

  const attackZSign = -defendZSign;
  const goalZ = PITCH.halfLength * attackZSign;

  const toGoalX = 0 - ball.x;
  const toGoalZ = goalZ - ball.z;
  const toGoalLen = Math.hypot(toGoalX, toGoalZ) || 1;

  const standoff = body.radius + ball.radius + 0.15;
  let targetX = ball.x - (toGoalX / toGoalLen) * standoff;
  let targetZ = ball.z - (toGoalZ / toGoalLen) * standoff;

  if (ballHeadingToOurGoal && Math.abs(ball.z) > PITCH.halfLength * 0.3) {
    targetX = ball.x;
    targetZ = ball.z + defendZSign * standoff;
  }

  let dx = targetX - body.x;
  let dz = targetZ - body.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.05) {
    dx /= dist;
    dz /= dist;
  } else {
    dx = 0;
    dz = 0;
  }

  const ballDist = Math.hypot(ball.x - body.x, ball.z - body.z);
  const touching = ballDist <= body.radius + ball.radius + 0.3;

  const dotToGoal =
    ((ball.x - body.x) * toGoalX + (ball.z - body.z) * toGoalZ) / (toGoalLen || 1);
  const shoot = touching && dotToGoal > 0;

  return {
    moveX: dx,
    moveZ: dz,
    shoot,
    power: shoot && dist < 2 && Math.random() < 0.02,
  };
}
