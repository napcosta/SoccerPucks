import { TEAM } from './constants.js';

export const SCENARIO_SCHEMA_VERSION = 2;

const STANDARD_TEAMS = {
  [TEAM.RED]: { defendZSign: 1 },
  [TEAM.BLUE]: { defendZSign: -1 },
};

function rubric(entries) {
  return entries.map(([id, label, description]) => ({
    id,
    label,
    description,
    min: 1,
    max: 5,
  }));
}

function actor({
  id,
  heroKind,
  team,
  x,
  z,
  vx = 0,
  vz = 0,
  facingX = 0,
  facingZ,
  controller = 'ai',
  difficulty = 'medium',
  heroState,
  script,
}) {
  const defendZSign = STANDARD_TEAMS[team]?.defendZSign ?? 1;
  return {
    id,
    heroKind,
    team,
    controller,
    difficulty,
    position: { x, z },
    velocity: { x: vx, z: vz },
    facing: { x: facingX, z: facingZ ?? -defendZSign },
    ...(heroState ? { heroState } : {}),
    ...(script ? { script } : {}),
  };
}

function defineScenario(definition) {
  const scenario = {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    version: 2,
    teams: STANDARD_TEAMS,
    ...definition,
  };

  // Compatibility projection for the existing scenario list/watch UI. New code
  // should use actors, whose position and defend direction are independent.
  scenario.label = scenario.title;
  scenario.specs = scenario.actors.map((entry) => ({
    id: entry.id,
    heroKind: entry.heroKind,
    team: entry.team,
    x: entry.position.x,
    z: entry.position.z,
    control: entry.controller,
    difficulty: entry.difficulty,
  }));

  return deepFreeze(scenario);
}

const POWER_TIMING_RUBRIC = rubric([
  [
    'opportunity_read',
    'Opportunity read',
    'Did Tesla distinguish the developing contest from the moment when the ball was actually winnable?',
  ],
  [
    'activation_timing',
    'Activation timing',
    'Was the magnet committed promptly after the useful window opened, without firing early?',
  ],
  [
    'capture_execution',
    'Capture execution',
    'Did Tesla turn the activation into clean control before the challenger arrived?',
  ],
  [
    'follow_through',
    'Follow-through',
    'After winning the contest, did Tesla protect the ball and move play to safety?',
  ],
  [
    'credibility',
    'Credibility',
    'Did the complete approach, commitment, and recovery look like believable match play?',
  ],
]);

const PASSING_RUBRIC = rubric([
  [
    'build_up',
    'Build-up judgment',
    'Did the carrier keep control and draw the defense instead of forcing an opening-frame pass?',
  ],
  [
    'pass_timing',
    'Pass timing',
    'Was the ball released after the lane developed and before the defenders could close it again?',
  ],
  [
    'pass_direction',
    'Direction and weight',
    'Was the pass led into the runner\'s path with useful direction, pace, and distance?',
  ],
  [
    'receiver_movement',
    'Support movement',
    'Did the support run create a credible target and help the carrier rather than crowding the ball?',
  ],
  [
    'defensive_judgment',
    'Defensive judgment',
    'Did the defenders credibly balance pressure on the carrier, cover of the runner, and the passing lane?',
  ],
  [
    'credibility',
    'Credibility',
    'Did the full 2v2 sequence resemble a challenging tactical exchange rather than a rehearsed kick?',
  ],
]);

const FINISHING_RUBRIC = rubric([
  [
    'lane_read',
    'Lane recognition',
    'Did the shooter recognize that the initial route was screened and wait for a genuine opening?',
  ],
  [
    'shot_timing',
    'Shot timing',
    'Was the shot taken quickly enough once the moving screen exposed the target?',
  ],
  [
    'target_selection',
    'Target selection',
    'Did the shooter choose the useful side of goal rather than firing back into traffic?',
  ],
  [
    'shot_execution',
    'Shot execution',
    'Was the attempt controlled, goal-bound, and difficult for the goalkeeper?',
  ],
  [
    'credibility',
    'Credibility',
    'Did the carry, scan, and finish look composed under a changing defensive picture?',
  ],
]);

const DEFENDING_RUBRIC = rubric([
  [
    'shot_read',
    'Shot read',
    'Did the defender identify the angled goal-bound strike and choose the correct interception path?',
  ],
  [
    'positioning',
    'Positioning',
    'Did the defender stay between the ball and goal without overcommitting before the shot?',
  ],
  [
    'interception_timing',
    'Interception timing',
    'Was the response early and decisive enough to meet the shot before the goal line?',
  ],
  [
    'rebound_control',
    'Rebound control',
    'Did the defender direct or secure the rebound away from the following attacker?',
  ],
  [
    'credibility',
    'Credibility',
    'Did the save and second action look like alert, challenging defensive play?',
  ],
]);

const RESTRAINT_RUBRIC = rubric([
  [
    'false_cue_read',
    'False-cue recognition',
    'Did Tesla avoid reacting to a nearby ball that was already protected by a teammate?',
  ],
  [
    'resource_judgment',
    'Cooldown judgment',
    'Was the magnet preserved so that it remained available when possession genuinely broke down?',
  ],
  [
    'recovery_timing',
    'Recovery timing',
    'Did Tesla activate quickly once the loose-ball race became real and winnable?',
  ],
  [
    'recovery_execution',
    'Recovery execution',
    'Did Tesla beat the presser, capture the loose ball, and retain it?',
  ],
  [
    'credibility',
    'Credibility',
    'Did the restraint followed by commitment look intentional and tactically credible?',
  ],
]);

export const SCENARIOS = Object.freeze([
  defineScenario({
    id: 'tesla-advantageous-power',
    title: 'Time the magnet in a developing contest',
    category: 'power-judgment',
    objective:
      'Tesla should close on a loose ball, wait until the race is genuinely winnable, activate the magnet, and turn the capture into safe progress.',
    maxSeconds: 5,
    ball: { x: -0.2, z: 1.5, vx: -0.3, vz: -1.2 },
    actors: [
      actor({
        id: 'tesla',
        heroKind: 'tesla',
        team: TEAM.RED,
        x: -2.8,
        z: 3.4,
        vx: 1.2,
        vz: -0.6,
        facingX: 0.82,
        facingZ: -0.57,
      }),
      actor({
        id: 'challenger',
        heroKind: 'sam',
        team: TEAM.BLUE,
        x: 2.1,
        z: 0.1,
        vx: -0.6,
        vz: 0.25,
        controller: 'scripted',
        script: {
          phases: {
            approach: { behavior: 'chaseBall', intensity: 0.62 },
            contest: { behavior: 'chaseBall', intensity: 0.86 },
            secure: { behavior: 'chaseBall', intensity: 0.84 },
            exploit: { behavior: 'chaseBall', intensity: 0.78 },
          },
          default: { behavior: 'hold' },
        },
      }),
    ],
    phases: [
      {
        id: 'approach',
        label: 'Approach',
        objective: 'Close the gap without spending the magnet before the contest is winnable.',
        maxSeconds: 2.2,
        advanceWhen: { opportunity: 'magnet-window' },
        timeout: { outcome: 'failure', reason: 'Tesla never reached a credible magnet window.' },
      },
      {
        id: 'contest',
        label: 'Commit',
        objective: 'Activate while the challenger is close and the ball can still be won.',
        maxSeconds: 0.65,
        advanceWhen: { phaseEvent: { type: 'power-used', actorId: 'tesla' } },
        timeout: { outcome: 'failure', reason: 'Tesla hesitated until the magnet window closed.' },
      },
      {
        id: 'secure',
        label: 'Secure',
        objective: 'Convert the activation into possession before the challenger arrives.',
        maxSeconds: 0.9,
        advanceWhen: { phaseEvent: { type: 'ball-capture', actorId: 'tesla' } },
        timeout: { outcome: 'failure', reason: 'The magnet activation did not secure the ball.' },
      },
      {
        id: 'exploit',
        label: 'Exploit',
        objective: 'Retain the ball and carry it at least one metre toward the attacking goal.',
        maxSeconds: 1.25,
        timeout: { outcome: 'failure', reason: 'Tesla won the ball but did not make it safe.' },
      },
    ],
    opportunities: [
      {
        id: 'magnet-window',
        label: 'Contested and winnable magnet range',
        when: {
          all: [
            { distance: { from: 'tesla', to: 'ball', value: { $lte: 2.6 } } },
            { distance: { from: 'challenger', to: 'ball', value: { $lte: 3 } } },
            { state: { path: 'possession.actorId', equals: null } },
          ],
        },
      },
    ],
    diagnostics: {
      probes: [
        { id: 'tesla_ball_distance', label: 'Tesla to ball', measure: 'distance', from: 'tesla', to: 'ball' },
        {
          id: 'challenger_ball_distance',
          label: 'Challenger to ball',
          measure: 'distance',
          from: 'challenger',
          to: 'ball',
        },
      ],
    },
    completion: {
      rules: [
        {
          id: 'opening-power-waste',
          outcome: 'failure',
          reason: 'Tesla fired before the loose-ball contest had developed.',
          when: {
            all: [
              { phase: 'approach' },
              { phaseEvent: { type: 'power-used', actorId: 'tesla' } },
            ],
          },
        },
        {
          id: 'challenger-wins-ball',
          outcome: 'failure',
          reason: 'The challenger secured the ball before Tesla completed the recovery.',
          when: { event: { type: 'possession-change', toActorId: 'challenger' } },
        },
        {
          id: 'magnet-secures-and-advances',
          outcome: 'success',
          reason: 'Tesla timed the magnet, secured the contest, and carried the ball to safety.',
          when: {
            all: [
              { phase: 'exploit' },
              { phaseElapsed: { $gte: 0.3 } },
              { state: { path: 'possession.actorId', equals: 'tesla' } },
              { state: { path: 'ball.z', value: { $lte: 0.9 } } },
              {
                sequence: [
                  {
                    event: {
                      type: 'power-used',
                      actorId: 'tesla',
                      tacticalPhaseId: 'contest',
                    },
                  },
                  {
                    event: {
                      type: 'ball-capture',
                      actorId: 'tesla',
                      tacticalPhaseId: 'secure',
                    },
                    withinSeconds: 0.8,
                  },
                ],
              },
            ],
          },
        },
      ],
      timeout: { reason: 'Tesla did not complete the full approach, capture, and recovery sequence.' },
    },
    ratingRubric: POWER_TIMING_RUBRIC,
  }),

  defineScenario({
    id: 'open-teammate-pass',
    title: 'Draw the defense and release the runner',
    category: 'team-play',
    objective:
      'In a live 2v2, the carrier should build the play, read whether the defenders press or cover, and lead the supporting runner through the opening at the right moment.',
    maxSeconds: 7,
    ball: { x: 3, z: 4, vx: 0, vz: 0 },
    actors: [
      actor({ id: 'passer', heroKind: 'sam', team: TEAM.RED, x: 3, z: 5 }),
      actor({
        id: 'receiver',
        heroKind: 'tesla',
        team: TEAM.RED,
        x: -3,
        z: 2.5,
        controller: 'scripted',
        script: {
          phases: {
            'build-up': {
              behavior: 'moveTo',
              target: { x: -2.4, z: 1.7 },
              intensity: 0.5,
              arriveRadius: 0.3,
            },
            decision: {
              behavior: 'moveTo',
              target: { x: -0.8, z: 0.2 },
              intensity: 0.78,
              arriveRadius: 0.3,
            },
            release: {
              behavior: 'moveTo',
              target: { x: -0.8, z: -2 },
              intensity: 1,
              arriveRadius: 0.2,
            },
            receive: {
              behavior: 'moveTo',
              target: { x: -0.8, z: -2 },
              intensity: 1,
              arriveRadius: 0.2,
            },
          },
          default: { behavior: 'hold' },
        },
      }),
      actor({ id: 'pressurer', heroKind: 'sam', team: TEAM.BLUE, x: 0.8, z: 3.2 }),
      actor({ id: 'cover', heroKind: 'shaggy', team: TEAM.BLUE, x: -2.2, z: 1.3 }),
    ],
    phases: [
      {
        id: 'build-up',
        label: 'Build the play',
        objective: 'Keep control long enough for the runner and defenders to establish their intentions.',
        maxSeconds: 1.3,
        advanceWhen: { phaseElapsed: { $gte: 0.65 } },
        timeout: { outcome: 'failure', reason: 'The carrier did not establish controlled build-up play.' },
      },
      {
        id: 'decision',
        label: 'Read the defense',
        objective: 'Carry while the lane is protected; release only after pressure creates a passing window.',
        maxSeconds: 2.4,
        advanceWhen: { opportunity: 'pass-window' },
        timeout: { outcome: 'failure', reason: 'The attack never created or recognized a viable lane.' },
      },
      {
        id: 'release',
        label: 'Release the runner',
        objective: 'Lead the runner before the active defenders can recover into the lane.',
        maxSeconds: 0.75,
        advanceWhen: {
          phaseEvent: { type: 'kick', actorId: 'passer', action: 'passBall' },
        },
        timeout: { outcome: 'failure', reason: 'The carrier missed the passing window.' },
      },
      {
        id: 'receive',
        label: 'Complete the pass',
        objective: 'Deliver a ball the runner can reach and control under active defensive pressure.',
        maxSeconds: 1.7,
        timeout: { outcome: 'failure', reason: 'The pass did not reach a controllable receiver.' },
      },
    ],
    opportunities: [
      {
        id: 'pass-window',
        label: 'Runner clear of both defenders',
        when: {
          all: [
            { phase: { $in: ['decision', 'release', 'receive'] } },
            { distance: { from: 'ball', to: 'receiver', value: { $gte: 3, $lte: 9.8 } } },
            {
              clearance: {
                from: 'ball',
                to: 'receiver',
                actors: ['pressurer', 'cover'],
                value: { $gte: 1.05 },
              },
            },
          ],
        },
      },
    ],
    diagnostics: {
      probes: [
        {
          id: 'passing_lane_clearance',
          label: 'Passing-lane clearance',
          measure: 'clearance',
          from: 'ball',
          to: 'receiver',
          actors: ['pressurer', 'cover'],
        },
        {
          id: 'pressurer_to_carrier',
          label: 'Presser to carrier',
          measure: 'distance',
          from: 'pressurer',
          to: 'passer',
        },
        {
          id: 'cover_to_runner',
          label: 'Cover to runner',
          measure: 'distance',
          from: 'cover',
          to: 'receiver',
        },
        {
          id: 'pass_distance',
          label: 'Ball to runner',
          measure: 'distance',
          from: 'ball',
          to: 'receiver',
        },
      ],
    },
    completion: {
      rules: [
        {
          id: 'opening-frame-pass',
          outcome: 'failure',
          reason: 'The carrier forced an opening pass before the 2v2 picture developed.',
          when: {
            all: [
              { elapsed: { $lte: 0.35 } },
              { event: { type: 'kick', actorId: 'passer', action: 'passBall' } },
            ],
          },
        },
        {
          id: 'premature-pass',
          outcome: 'failure',
          reason: 'The carrier passed while the defenders still controlled the lane.',
          when: {
            all: [
              { phase: { $in: ['build-up', 'decision'] } },
              { phaseEvent: { type: 'kick', actorId: 'passer', action: 'passBall' } },
            ],
          },
        },
        {
          id: 'wrong-kick-choice',
          outcome: 'failure',
          reason: 'The carrier surrendered the attack with a kick that did not release the runner.',
          when: {
            event: { type: 'kick', actorId: 'passer', action: { $ne: 'passBall' } },
          },
        },
        {
          id: 'pass-intercepted',
          outcome: 'failure',
          reason: 'An active defender read and intercepted the attempted release.',
          when: {
            sequence: [
              { event: { type: 'kick', actorId: 'passer', action: 'passBall' } },
              {
                event: { type: 'possession-change', toTeam: TEAM.BLUE },
                withinSeconds: 1.5,
              },
            ],
          },
        },
        {
          id: 'receiver-controls-pass',
          outcome: 'success',
          reason: 'The carrier drew the defense and led the runner through the resulting lane.',
          when: {
            all: [
              { phase: 'receive' },
              {
                sequence: [
                  {
                    event: {
                      type: 'kick',
                      actorId: 'passer',
                      action: 'passBall',
                      intendedReceiverId: 'receiver',
                    },
                  },
                  {
                    event: { type: 'player-ball-contact', actorId: 'receiver' },
                    withinSeconds: 1.5,
                  },
                ],
              },
              { state: { path: 'possession.actorId', equals: 'receiver' } },
            ],
          },
        },
      ],
      timeout: { reason: 'The attack did not complete a credible build-up and release.' },
    },
    ratingRubric: PASSING_RUBRIC,
  }),

  defineScenario({
    id: 'clear-lane-shot',
    title: 'Wait for the shooting lane to develop',
    category: 'finishing',
    objective:
      'The attacker should carry while moving screens close the goal, then recognize the opening and produce a goal-bound attempt before it disappears.',
    maxSeconds: 5,
    ball: { x: -4.2, z: -4.1, vx: 0, vz: 0 },
    actors: [
      actor({ id: 'shooter', heroKind: 'sam', team: TEAM.RED, x: -4.2, z: -3.05 }),
      actor({
        id: 'screen-left',
        heroKind: 'shaggy',
        team: TEAM.BLUE,
        x: -3.1,
        z: -7,
        controller: 'scripted',
        script: {
          phases: {
            'lane-closed': {
              behavior: 'moveTo',
              target: { x: 1.5, z: -6.5 },
              intensity: 0.55,
              arriveRadius: 0.2,
            },
            'lane-open': { behavior: 'hold' },
            flight: { behavior: 'hold' },
          },
          default: { behavior: 'hold' },
        },
      }),
      actor({
        id: 'screen-right',
        heroKind: 'sam',
        team: TEAM.BLUE,
        x: -0.8,
        z: -8,
        controller: 'scripted',
        script: {
          phases: {
            'lane-closed': {
              behavior: 'moveTo',
              target: { x: 4, z: -8 },
              intensity: 0.5,
              arriveRadius: 0.2,
            },
            'lane-open': { behavior: 'hold' },
            flight: { behavior: 'hold' },
          },
          default: { behavior: 'hold' },
        },
      }),
      actor({
        id: 'keeper',
        heroKind: 'tesla',
        team: TEAM.BLUE,
        x: 0,
        z: -11.4,
        controller: 'scripted',
        script: { default: { behavior: 'hold' } },
      }),
    ],
    phases: [
      {
        id: 'lane-closed',
        label: 'Screened lane',
        objective: 'Protect the ball and wait while both direct shooting routes are screened.',
        maxSeconds: 1.7,
        advanceWhen: { opportunity: 'shot-window' },
        timeout: { outcome: 'failure', reason: 'The attacker never found the developing lane.' },
      },
      {
        id: 'lane-open',
        label: 'Shooting window',
        objective: 'Shoot promptly through the gap opened by the moving screen.',
        maxSeconds: 0.9,
        advanceWhen: {
          phaseEvent: { type: 'kick', actorId: 'shooter', action: 'shootGoal' },
        },
        timeout: { outcome: 'failure', reason: 'The attacker allowed the shooting window to expire.' },
      },
      {
        id: 'flight',
        label: 'Goal-bound attempt',
        objective: 'Make the goalkeeper save the shot or put it over the goal line.',
        maxSeconds: 2.2,
        timeout: { outcome: 'failure', reason: 'The shot never produced a decisive goal-bound outcome.' },
      },
    ],
    opportunities: [
      {
        id: 'shot-window',
        label: 'Screen clears the far-post route',
        when: {
          all: [
            { phase: { $in: ['lane-closed', 'lane-open', 'flight'] } },
            {
              clearance: {
                from: 'ball',
                to: { x: -1.4, z: -13.4 },
                actors: ['screen-left', 'screen-right'],
                value: { $gte: 1.15 },
              },
            },
            { distance: { from: 'shooter', to: 'ball', value: { $lte: 1.6 } } },
          ],
        },
      },
    ],
    diagnostics: {
      probes: [
        {
          id: 'shot_lane_clearance',
          label: 'Far-post lane clearance',
          measure: 'clearance',
          from: 'ball',
          to: { x: -1.4, z: -13.4 },
          actors: ['screen-left', 'screen-right'],
        },
        {
          id: 'shooter_ball_control',
          label: 'Shooter to ball',
          measure: 'distance',
          from: 'shooter',
          to: 'ball',
        },
        {
          id: 'keeper_ball_distance',
          label: 'Keeper to ball',
          measure: 'distance',
          from: 'keeper',
          to: 'ball',
        },
      ],
    },
    completion: {
      rules: [
        {
          id: 'shot-into-closed-lane',
          outcome: 'failure',
          reason: 'The attacker shot before the moving screen exposed a credible lane.',
          when: {
            all: [
              { phase: 'lane-closed' },
              { phaseEvent: { type: 'kick', actorId: 'shooter', action: 'shootGoal' } },
            ],
          },
        },
        {
          id: 'wrong-finishing-choice',
          outcome: 'failure',
          reason: 'The attacker kicked without selecting the developed shooting chance.',
          when: {
            event: { type: 'kick', actorId: 'shooter', action: { $ne: 'shootGoal' } },
          },
        },
        {
          id: 'second-shot-required',
          outcome: 'failure',
          reason: 'The first release did not resolve the chance; a second shot cannot repair the test.',
          when: {
            sequence: [
              { event: { type: 'kick', actorId: 'shooter', action: 'shootGoal' } },
              { event: { type: 'kick', actorId: 'shooter', action: 'shootGoal' } },
            ],
          },
        },
        {
          id: 'first-shot-hits-wall',
          outcome: 'failure',
          reason: 'The first attempt hit the wall before producing a goal or save.',
          when: {
            sequence: [
              { event: { type: 'kick', actorId: 'shooter', action: 'shootGoal' } },
              { event: { type: 'wall-contact' } },
            ],
          },
        },
        {
          id: 'screen-blocks-shot',
          outcome: 'failure',
          reason: 'The attempt was released back into the moving defensive screen.',
          when: {
            sequence: [
              { event: { type: 'kick', actorId: 'shooter', action: 'shootGoal' } },
              {
                event: {
                  type: 'player-ball-contact',
                  actorId: { $in: ['screen-left', 'screen-right'] },
                },
                withinSeconds: 1.2,
              },
            ],
          },
        },
        {
          id: 'shot-scores',
          outcome: 'success',
          reason: 'The attacker waited for the opening and converted the goal-bound chance.',
          when: {
            sequence: [
              { event: { type: 'kick', actorId: 'shooter', action: 'shootGoal' } },
              { event: { type: 'goal', scoringTeam: TEAM.RED }, withinSeconds: 1.8 },
            ],
          },
        },
        {
          id: 'shot-forces-save',
          outcome: 'success',
          reason: 'The attacker waited for the opening and forced a goal-bound save.',
          when: {
            sequence: [
              { event: { type: 'kick', actorId: 'shooter', action: 'shootGoal' } },
              { event: { type: 'save', actorId: 'keeper' }, withinSeconds: 1.8 },
            ],
          },
        },
      ],
      timeout: { reason: 'The attacker did not turn the changing screen into a credible shot.' },
    },
    ratingRubric: FINISHING_RUBRIC,
  }),

  defineScenario({
    id: 'incoming-shot-defense',
    title: 'Read the angled shot and secure the rebound',
    category: 'defending',
    objective:
      'The defender should hold a useful shape, read an angled shot after it is struck, save it, and prevent the following attacker from winning the rebound.',
    maxSeconds: 4.5,
    ball: { x: -2.25, z: 5.45, vx: 0, vz: 0 },
    actors: [
      // Resolve the defender's command before the scripted strike so it can
      // react only on the following simulation step, not by actor-order luck.
      actor({
        id: 'defender',
        heroKind: 'sam',
        team: TEAM.RED,
        x: 1.1,
        z: 10.1,
        facingX: -0.58,
        facingZ: -0.81,
      }),
      actor({
        id: 'shooter',
        heroKind: 'sam',
        team: TEAM.BLUE,
        x: -2.8,
        z: 4.6,
        controller: 'scripted',
        script: {
          phases: {
            shape: {
              behavior: 'kickTo',
              target: { x: 1.2, z: 13.4 },
              kickMultiplier: 1,
              delaySeconds: 0.35,
              then: 'hold',
            },
            read: { behavior: 'hold' },
            secure: { behavior: 'hold' },
          },
          default: { behavior: 'hold' },
        },
      }),
      actor({
        id: 'poacher',
        heroKind: 'shaggy',
        team: TEAM.BLUE,
        x: -4,
        z: 8,
        controller: 'scripted',
        script: {
          phases: {
            shape: { behavior: 'hold' },
            read: { behavior: 'hold' },
            secure: { behavior: 'chaseBall', intensity: 0.72 },
          },
          default: { behavior: 'hold' },
        },
      }),
    ],
    phases: [
      {
        id: 'shape',
        label: 'Hold shape',
        objective: 'Stay goal-side while the shooter prepares the strike.',
        maxSeconds: 1,
        advanceWhen: { phaseEvent: { type: 'kick', actorId: 'shooter' } },
        timeout: { outcome: 'failure', reason: 'The scripted shot was not launched.' },
      },
      {
        id: 'read',
        label: 'Read and intercept',
        objective: 'Recognize the angled goal-bound path and stop it with a save or controlled clearance.',
        maxSeconds: 1.65,
        advanceWhen: { phaseEvent: { type: 'save', actorId: 'defender' } },
        timeout: { outcome: 'failure', reason: 'The defender did not make the required save.' },
      },
      {
        id: 'secure',
        label: 'Secure the second action',
        objective: 'Keep the rebound away from the poacher and make the ball safe.',
        maxSeconds: 1.25,
        timeout: { outcome: 'failure', reason: 'The defender saved the shot but left a dangerous rebound.' },
      },
    ],
    opportunities: [
      {
        id: 'shot-threat',
        label: 'Angled goal-bound shot',
        when: {
          any: [
            { phase: 'read' },
            { phase: 'secure' },
          ],
        },
      },
    ],
    diagnostics: {
      probes: [
        {
          id: 'defender_ball_distance',
          label: 'Defender to ball',
          measure: 'distance',
          from: 'defender',
          to: 'ball',
        },
        {
          id: 'poacher_ball_distance',
          label: 'Poacher to ball',
          measure: 'distance',
          from: 'poacher',
          to: 'ball',
        },
        {
          id: 'poacher_defender_distance',
          label: 'Poacher to defender',
          measure: 'distance',
          from: 'poacher',
          to: 'defender',
        },
      ],
    },
    completion: {
      rules: [
        {
          id: 'goal-conceded',
          outcome: 'failure',
          reason: 'The angled shot crossed the defended goal line.',
          when: { event: { type: 'goal', scoringTeam: TEAM.BLUE } },
        },
        {
          id: 'poacher-wins-rebound',
          outcome: 'failure',
          reason: 'The defender made contact but presented the rebound to the following attacker.',
          when: {
            sequence: [
              { event: { type: 'save', actorId: 'defender' } },
              {
                event: { type: 'possession-change', toActorId: 'poacher' },
                withinSeconds: 1.1,
              },
            ],
          },
        },
        {
          id: 'poacher-wins-cleared-ball',
          outcome: 'failure',
          reason: 'The defender reached the shot but cleared it directly to the following attacker.',
          when: {
            sequence: [
              {
                event: {
                  type: 'kick',
                  actorId: 'defender',
                  action: { $in: ['clearBall', 'pokeBall'] },
                },
              },
              {
                event: { type: 'possession-change', toActorId: 'poacher' },
                withinSeconds: 1.1,
              },
            ],
          },
        },
        {
          id: 'shot-saved-and-secured',
          outcome: 'success',
          reason: 'The defender read the shot, stopped it, and kept the clearance safe through the recovery window.',
          when: {
            all: [
              { phase: 'secure' },
              { phaseElapsed: { $gte: 1.1 } },
              { event: { type: 'save', actorId: 'defender' } },
              {
                any: [
                  { state: { path: 'possession.actorId', equals: 'defender' } },
                  {
                    sequence: [
                      {
                        event: {
                          type: 'kick',
                          actorId: 'defender',
                          action: { $in: ['clearBall', 'pokeBall'] },
                        },
                      },
                      {
                        event: { type: 'save', actorId: 'defender' },
                        withinSeconds: 0.2,
                      },
                    ],
                  },
                  {
                    sequence: [
                      { event: { type: 'save', actorId: 'defender' } },
                      {
                        event: {
                          type: 'kick',
                          actorId: 'defender',
                          action: { $in: ['clearBall', 'pokeBall'] },
                        },
                        withinSeconds: 0.8,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
      timeout: { reason: 'The defender did not complete both the save and the rebound action.' },
    },
    ratingRubric: DEFENDING_RUBRIC,
  }),

  defineScenario({
    id: 'tesla-power-restraint',
    title: 'Preserve the magnet, then recover the turnover',
    category: 'power-judgment',
    objective:
      'Tesla should ignore a false magnet cue while a teammate protects the ball, preserve the cooldown, and then commit when a real loose-ball race develops.',
    maxSeconds: 5.5,
    ball: { x: 0, z: 0, vx: 0, vz: 0 },
    actors: [
      actor({
        id: 'carrier',
        heroKind: 'sam',
        team: TEAM.RED,
        x: -0.8,
        z: 0.8,
        controller: 'scripted',
        script: {
          phases: {
            protected: {
              behavior: 'moveTo',
              target: { x: -0.3, z: -0.5 },
              intensity: 0.42,
              arriveRadius: 0.25,
            },
            turnover: {
              behavior: 'kickTo',
              target: { x: 0, z: -4 },
              kickMultiplier: 0.48,
              delaySeconds: 0.08,
              then: 'hold',
            },
            recover: { behavior: 'hold' },
            secure: { behavior: 'follow', target: 'tesla', offset: { x: -2, z: 1 } },
          },
          default: { behavior: 'hold' },
        },
      }),
      actor({ id: 'tesla', heroKind: 'tesla', team: TEAM.RED, x: 2.2, z: 0.4 }),
      actor({
        id: 'presser',
        heroKind: 'shaggy',
        team: TEAM.BLUE,
        x: 1.8,
        z: -2,
        controller: 'scripted',
        script: {
          phases: {
            protected: { behavior: 'hold' },
            turnover: { behavior: 'hold' },
            recover: { behavior: 'chaseBall', intensity: 0.82 },
            secure: { behavior: 'chaseBall', intensity: 0.78 },
          },
          default: { behavior: 'hold' },
        },
      }),
    ],
    phases: [
      {
        id: 'protected',
        label: 'Protected possession',
        objective: 'Support the carrier without wasting the magnet on a ball the team already owns.',
        maxSeconds: 1.35,
        advanceWhen: { phaseElapsed: { $gte: 1.2 } },
        timeout: { outcome: 'failure', reason: 'The protected-possession stimulus did not complete.' },
      },
      {
        id: 'turnover',
        label: 'Turnover',
        objective: 'Recognize the moment possession breaks down and the ball becomes loose.',
        maxSeconds: 0.4,
        advanceWhen: { phaseEvent: { type: 'kick', actorId: 'carrier' } },
        timeout: { outcome: 'failure', reason: 'The scripted turnover did not release the ball.' },
      },
      {
        id: 'recover',
        label: 'Recovery window',
        objective: 'Use the preserved magnet to beat the presser to the loose ball.',
        maxSeconds: 1.25,
        advanceWhen: { phaseEvent: { type: 'ball-capture', actorId: 'tesla' } },
        timeout: { outcome: 'failure', reason: 'Tesla did not convert the real recovery opportunity.' },
      },
      {
        id: 'secure',
        label: 'Retain recovery',
        objective: 'Keep possession after the magnet capture while the presser follows through.',
        maxSeconds: 0.9,
        timeout: { outcome: 'failure', reason: 'Tesla recovered the ball but could not retain it.' },
      },
    ],
    opportunities: [
      {
        id: 'recovery-window',
        label: 'Real loose-ball recovery',
        when: {
          all: [
            { phase: 'recover' },
            { state: { path: 'possession.actorId', equals: null } },
            { distance: { from: 'tesla', to: 'ball', value: { $lte: 2.8 } } },
            { distance: { from: 'presser', to: 'ball', value: { $lte: 3 } } },
          ],
        },
      },
    ],
    diagnostics: {
      probes: [
        {
          id: 'tesla_ball_distance',
          label: 'Tesla to ball',
          measure: 'distance',
          from: 'tesla',
          to: 'ball',
        },
        {
          id: 'presser_ball_distance',
          label: 'Presser to ball',
          measure: 'distance',
          from: 'presser',
          to: 'ball',
        },
        {
          id: 'carrier_ball_distance',
          label: 'Carrier to ball',
          measure: 'distance',
          from: 'carrier',
          to: 'ball',
        },
      ],
    },
    completion: {
      rules: [
        {
          id: 'power-wasted-on-protected-ball',
          outcome: 'failure',
          reason: 'Tesla spent the magnet while a teammate still protected possession.',
          when: {
            all: [
              { phase: 'protected' },
              { phaseEvent: { type: 'power-used', actorId: 'tesla' } },
            ],
          },
        },
        {
          id: 'power-before-recovery-window',
          outcome: 'failure',
          reason: 'Tesla committed before the turnover became a real loose-ball race.',
          when: {
            all: [
              { event: { type: 'power-used', actorId: 'tesla' } },
              {
                not: {
                  sequence: [
                    {
                      event: {
                        type: 'opportunity-open',
                        opportunityId: 'recovery-window',
                      },
                    },
                    {
                      event: {
                        type: 'power-used',
                        actorId: 'tesla',
                        tacticalPhaseId: 'recover',
                      },
                      withinSeconds: 1.25,
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          id: 'presser-wins-turnover',
          outcome: 'failure',
          reason: 'The opponent reached the real turnover before Tesla completed the recovery.',
          when: { event: { type: 'possession-change', toActorId: 'presser' } },
        },
        {
          id: 'power-preserved-and-converted',
          outcome: 'success',
          reason: 'Tesla ignored the false cue, preserved the cooldown, and recovered the real turnover.',
          when: {
            all: [
              { phase: 'secure' },
              { phaseElapsed: { $gte: 0.3 } },
              { state: { path: 'possession.actorId', equals: 'tesla' } },
              {
                sequence: [
                  {
                    event: {
                      type: 'opportunity-open',
                      opportunityId: 'recovery-window',
                    },
                  },
                  {
                    event: {
                      type: 'power-used',
                      actorId: 'tesla',
                      tacticalPhaseId: 'recover',
                    },
                    withinSeconds: 1.25,
                  },
                  {
                    event: {
                      type: 'ball-capture',
                      actorId: 'tesla',
                      tacticalPhaseId: 'recover',
                    },
                    withinSeconds: 0.9,
                  },
                ],
              },
            ],
          },
        },
      ],
      timeout: { reason: 'Tesla did not complete the preserve-then-recover judgment sequence.' },
    },
    ratingRubric: RESTRAINT_RUBRIC,
  }),
]);

assertUniqueScenarioIds(SCENARIOS);

export function findScenario(id) {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  if (!Object.isFrozen(value)) Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function assertUniqueScenarioIds(scenarios) {
  const ids = new Set();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) throw new Error(`Duplicate AI scenario id: ${scenario.id}`);
    ids.add(scenario.id);
  }
}
