import { PLAYER, BALL } from './constants.js';

function defaults() {
  return {
    player: {
      accel: PLAYER.accel,
      maxSpeed: PLAYER.maxSpeed,
      damping: PLAYER.damping,
      mass: PLAYER.mass,
      shootVelocity: PLAYER.shootVelocity,
      shootRange: PLAYER.shootRange,
    },
    ball: {
      damping: BALL.damping,
      maxSpeed: BALL.maxSpeed,
      mass: BALL.mass,
      playerRestitution: BALL.playerRestitution,
      wallRestitution: BALL.wallRestitution,
    },
  };
}

export const TUNING = defaults();

export function resetTuning() {
  Object.assign(TUNING, defaults());
}

export const TUNING_SLIDERS = [
  { group: 'player', label: 'Player', key: 'accel', name: 'Accel', min: 1, max: 30, step: 0.5 },
  { group: 'player', key: 'maxSpeed', name: 'Max speed', min: 2, max: 12, step: 0.1 },
  { group: 'player', key: 'damping', name: 'Damping', min: 0.5, max: 10, step: 0.1 },
  { group: 'player', key: 'mass', name: 'Mass', min: 1, max: 15, step: 0.5 },
  { group: 'player', key: 'shootVelocity', name: 'Shoot force', min: 3, max: 15, step: 0.5 },
  { group: 'player', key: 'shootRange', name: 'Shoot range', min: 0.1, max: 1, step: 0.05 },
  { group: 'ball', key: 'damping', name: 'Damping', min: 0.1, max: 2, step: 0.05 },
  { group: 'ball', key: 'maxSpeed', name: 'Max speed', min: 4, max: 25, step: 0.5 },
  { group: 'ball', key: 'mass', name: 'Mass', min: 0.5, max: 5, step: 0.1 },
  { group: 'ball', key: 'playerRestitution', name: 'Hero bounce', min: 0, max: 1, step: 0.05 },
  { group: 'ball', key: 'wallRestitution', name: 'Wall bounce', min: 0, max: 1, step: 0.05 },
];
