const GOAL_SCALE = 2 / 3;

export const PITCH = {
  halfWidth: 9,
  halfLength: 13,
  goalHalfWidth: 3.4 * GOAL_SCALE,
  goalDepth: 1.6 * GOAL_SCALE,
  wallHeight: 1.0,
  surfaceY: 0.015,
};

export const GOAL = {
  scale: GOAL_SCALE,
  postRadius: 0.24 * GOAL_SCALE,
  lineZ: PITCH.halfLength + 0.1,
};

export const PLAYER = {
  radius: 0.55,
  accel: 38,
  maxSpeed: 7.5,
  damping: 6.5,
  shootVelocity: 9,
  shootRange: 0.35,
};

export const BALL = {
  radius: 0.45,
  damping: 0.55,
  wallRestitution: 0.82,
  playerRestitution: 0.9,
  maxSpeed: 18,
};

export const HEROES = {
  sam: {
    name: 'Sam',
    powerCooldown: 12,
    dashMultiplier: 2.0,
  },
  tesla: {
    name: 'Tesla',
    powerCooldown: 5,
    magnetRange: 3.0,
    magnetPullSpeed: 14,
    holdDuration: 2.0,
    holdGap: 0.12,
  },
};

export const MATCH = {
  duration: 100,
  kickoffDelay: 2.2,
  celebrationTime: 2.5,
};

export const TEAM = { RED: 1, BLUE: 2 };

export const TEAM_COLORS = {
  [TEAM.RED]: 0xd94f43,
  [TEAM.BLUE]: 0x4a7ee0,
};
