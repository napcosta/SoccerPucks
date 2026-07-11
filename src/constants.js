const GOAL_SCALE = 2 / 3;

export const PITCH = {
  halfWidth: 9,
  halfLength: 13,
  goalHalfWidth: 3.4 * GOAL_SCALE,
  goalDepth: 1.6 * GOAL_SCALE,
  wallHeight: 1.0,
  surfaceY: 0.015,
};

// Inner footprint of the stadium bowl (stadium.glb at 0.78 scale), measured at
// ice level: straight walls at ±innerHalfWidth / ±innerHalfLength joined by
// rounded corner arcs. The ice floor fills this shape and players collide with
// it; only the ball is confined to the pitch walls.
export const STADIUM = {
  innerHalfWidth: 12.75,
  innerHalfLength: 15.0,
  cornerRadius: 3.66,
};

export const GOAL = {
  scale: GOAL_SCALE,
  postRadius: 0.24 * GOAL_SCALE,
  lineZ: PITCH.halfLength + 0.1,
};

export const PLAYER = {
  radius: 0.55,
  mass: 6,
  accel: 11,
  maxSpeed: 6,
  damping: 1.9,
  shootVelocity: 9,
  shootRange: 0.35,
};

export const BALL = {
  radius: 0.45,
  mass: 1.2,
  damping: 0.55,
  wallRestitution: 0.8,
  playerRestitution: 0.35,
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
  shaggy: {
    name: 'Shaggy Slider',
    powerCooldown: 8,
    slideBurst: 7.5,
  },
};

export const MATCH = {
  duration: 180,
  scoreLimit: 3,
  kickoffDelay: 2.2,
  celebrationTime: 2.5,
};

export const TEAM = { SPECTATOR: 0, RED: 1, BLUE: 2 };

// Layer for overlay visuals (player indicators) the main camera renders but the
// ice Reflector must not: its internal virtual camera only has layer 0 enabled,
// so anything on this layer never shows up in the reflection.
export const NO_REFLECT_LAYER = 1;

export const TEAM_COLORS = {
  [TEAM.SPECTATOR]: 0x8a94aa,
  [TEAM.RED]: 0xd94f43,
  [TEAM.BLUE]: 0x4a7ee0,
};
