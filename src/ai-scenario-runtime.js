import { PLAYER, BALL, PITCH, TEAM } from './constants.js';
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
} from './physics.js';
import { computeAICommands, createTeamAIState, AI_DIFFICULTY } from './ai.js';
import { createHero } from './heroes.js';
import { TUNING } from './tuning.js';

export const SCENARIO_HZ = 60;
export const SCENARIO_DT = 1 / SCENARIO_HZ;

const DEFAULT_TEAMS = Object.freeze({
  [TEAM.RED]: Object.freeze({ defendZSign: 1 }),
  [TEAM.BLUE]: Object.freeze({ defendZSign: -1 }),
});

const EMPTY_COMMANDS = Object.freeze({
  moveX: 0,
  moveZ: 0,
  shoot: false,
  kickX: 0,
  kickZ: 0,
  kickMultiplier: 1,
  power: false,
});

const SCENARIO_CONTROLLERS = Object.freeze(['ai', 'idle', 'chaser', 'scripted']);
const TERMINAL_OUTCOMES = Object.freeze(['success', 'failure', 'timeout', 'aborted']);

export function createScenarioWorld(scenario) {
  validateScenario(scenario);

  const ballSpec = scenario.ball ?? {};
  const ball = createBody(
    finiteOr(ballSpec.x, 0),
    finiteOr(ballSpec.z, 0),
    BALL.radius,
    TUNING.ball.mass
  );
  ball.vx = finiteOr(ballSpec.vx, 0);
  ball.vz = finiteOr(ballSpec.vz, 0);

  const players = scenario.actors.map((spec) => makeScenarioPlayer(spec, scenario));
  return {
    scenario,
    ball,
    players,
    teamStates: new Map(),
    tick: 0,
  };
}

export function createScenarioTracker(scenario, { world = null } = {}) {
  validateScenario(scenario);

  let status;
  let terminal;
  let frame;
  let elapsedSeconds;
  let events;
  let pendingEvents;
  let metrics;
  let possession;
  let finalState;
  let phaseIndex;
  let phaseStartedAt;
  let phaseHistory;
  let opportunityStates;

  const tracker = {
    record,
    step,
    getProgress,
    getResult,
    abort,
    reset,
    get status() {
      return status;
    },
    get terminal() {
      return terminal ? cloneSerializable(terminal) : null;
    },
    get isTerminal() {
      return status !== 'running';
    },
  };

  reset(world);
  return tracker;

  function reset(nextWorld = null) {
    status = 'running';
    terminal = null;
    frame = 0;
    elapsedSeconds = 0;
    events = [];
    pendingEvents = [];
    metrics = emptyMetrics(scenario.actors, scenario.diagnostics?.probes);
    possession = describePossession(findPossessor(nextWorld));
    finalState = snapshotWorld(nextWorld, possession);
    phaseIndex = Array.isArray(scenario.phases) && scenario.phases.length > 0 ? 0 : -1;
    phaseStartedAt = 0;
    phaseHistory = [];
    opportunityStates = createOpportunityStates(scenario.opportunities);
    appendEvent({
      type: 'scenario-start',
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      initialPossessorId: possession.actorId,
    });
    if (currentPhase()) appendPhaseEvent('phase-start', currentPhase());
    return tracker;
  }

  function record(event) {
    if (status !== 'running' || !event || typeof event.type !== 'string') return false;
    pendingEvents.push(cloneSerializable(event));
    return true;
  }

  function step(dt = SCENARIO_DT, nextWorld = null) {
    if (status !== 'running') return cloneSerializable(terminal);

    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : SCENARIO_DT;
    frame += 1;
    elapsedSeconds += safeDt;

    flushPendingEvents();
    updatePossession(nextWorld);
    finalState = snapshotWorld(nextWorld, possession);

    if (!worldIsFinite(nextWorld)) {
      appendEvent({ type: 'simulation-error', reason: 'non-finite-state' });
      finish('failure', 'non-finite-state', 'The simulation produced a non-finite body state.');
      return cloneSerializable(terminal);
    }

    let context = conditionContext(nextWorld);
    sampleDiagnosticProbes(scenario.diagnostics?.probes, context, metrics);
    updateOpportunityStates(context);
    context = conditionContext(nextWorld);
    for (const rule of scenario.completion.rules) {
      if (!evaluateCondition(rule.when, context)) continue;
      finish(rule.outcome, rule.id, rule.reason);
      return cloneSerializable(terminal);
    }

    const phase = currentPhase();
    if (phase) {
      if (phase.advanceWhen && evaluateCondition(phase.advanceWhen, context)) {
        advancePhase('condition');
      } else if (
        Number.isFinite(phase.maxSeconds) &&
        phaseElapsedSeconds() + 1e-9 >= phase.maxSeconds
      ) {
        const phaseTimeout = phase.timeout ?? {};
        const outcome = TERMINAL_OUTCOMES.includes(phaseTimeout.outcome)
          ? phaseTimeout.outcome
          : 'failure';
        finish(
          outcome,
          `phase-timeout:${phase.id}`,
          phaseTimeout.reason ?? `Tactical phase "${phase.id}" exceeded ${phase.maxSeconds} seconds.`
        );
        return cloneSerializable(terminal);
      }
    }

    if (elapsedSeconds + 1e-9 >= scenario.maxSeconds) {
      finish(
        'timeout',
        'timeout',
        scenario.completion.timeout?.reason ?? `Scenario exceeded ${scenario.maxSeconds} seconds.`
      );
      return cloneSerializable(terminal);
    }

    return null;
  }

  function abort(reason = 'aborted') {
    if (status !== 'running') return cloneSerializable(terminal);
    flushPendingEvents();
    finish('aborted', 'aborted', String(reason));
    return cloneSerializable(terminal);
  }

  function finish(outcome, criterionId, reason) {
    if (outcome === 'success' && currentPhase()) {
      appendPhaseEvent('phase-complete', currentPhase(), 'terminal-success');
    }
    closeOpenOpportunities('terminal');
    status = outcome;
    terminal = {
      outcome,
      criterionId,
      reason,
      frame,
      elapsedSeconds: roundTime(elapsedSeconds),
    };
    appendEvent({ type: 'scenario-terminal', ...terminal });
  }

  function flushPendingEvents() {
    const queued = pendingEvents;
    pendingEvents = [];
    for (const event of queued) appendEvent(event);
  }

  function appendEvent(event) {
    const phase = currentPhase();
    const stamped = {
      ...cloneSerializable(event),
      frame,
      time: roundTime(elapsedSeconds),
      tacticalPhaseId: phase?.id ?? null,
      phaseElapsedSeconds: roundTime(phaseElapsedSeconds()),
    };
    events.push(stamped);
    updateMetrics(metrics, stamped);
    return stamped;
  }

  function updatePossession(nextWorld) {
    const next = describePossession(findPossessor(nextWorld));
    if (next.actorId === possession.actorId) {
      possession = next;
      return;
    }
    appendEvent({
      type: 'possession-change',
      fromActorId: possession.actorId,
      fromTeam: possession.team,
      toActorId: next.actorId,
      toTeam: next.team,
    });
    possession = next;
  }

  function getProgress() {
    return {
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      status,
      frame,
      elapsedSeconds: roundTime(elapsedSeconds),
      maxSeconds: scenario.maxSeconds,
      progress: Math.min(1, elapsedSeconds / scenario.maxSeconds),
      possession: cloneSerializable(possession),
      tacticalPhase: cloneSerializable(describeTacticalPhase()),
      phaseHistory: cloneSerializable(phaseHistory),
      opportunities: cloneSerializable(describeOpportunities()),
      terminal: terminal ? cloneSerializable(terminal) : null,
      metrics: cloneSerializable(metrics),
    };
  }

  function getResult() {
    return {
      schemaVersion: scenario.schemaVersion ?? 1,
      scenario: {
        id: scenario.id,
        version: scenario.version,
        title: scenario.title,
        category: scenario.category,
        objective: scenario.objective,
      },
      outcome: terminal?.outcome ?? null,
      passed: terminal?.outcome === 'success',
      criterionId: terminal?.criterionId ?? null,
      reason: terminal?.reason ?? null,
      tacticalPhase: cloneSerializable(describeTacticalPhase()),
      phaseHistory: cloneSerializable(phaseHistory),
      opportunities: cloneSerializable(describeOpportunities()),
      simulation: {
        hz: SCENARIO_HZ,
        fixedDt: SCENARIO_DT,
        frames: frame,
        elapsedSeconds: roundTime(elapsedSeconds),
        maxSeconds: scenario.maxSeconds,
      },
      tuning: cloneSerializable({ player: TUNING.player, ball: TUNING.ball }),
      metrics: cloneSerializable(metrics),
      diagnostics: {
        probes: cloneSerializable(metrics.probes),
        actionTransitionsByActor: cloneSerializable(metrics.actionTransitionsByActor),
      },
      events: cloneSerializable(events),
      finalState: cloneSerializable(finalState),
      ratingRubric: cloneSerializable(scenario.ratingRubric),
    };
  }

  function currentPhase() {
    if (!Array.isArray(scenario.phases) || phaseIndex < 0) return null;
    return scenario.phases[phaseIndex] ?? null;
  }

  function phaseElapsedSeconds() {
    return currentPhase() ? Math.max(0, elapsedSeconds - phaseStartedAt) : 0;
  }

  function describeTacticalPhase() {
    const phase = currentPhase();
    if (!phase) return null;
    return {
      id: phase.id,
      index: phaseIndex,
      label: phase.label ?? phase.title ?? phase.id,
      objective: phase.objective ?? null,
      elapsedSeconds: roundTime(phaseElapsedSeconds()),
      maxSeconds: Number.isFinite(phase.maxSeconds) ? phase.maxSeconds : null,
    };
  }

  function appendPhaseEvent(type, phase, reason = null) {
    const stamped = appendEvent({
      type,
      phaseId: phase.id,
      phaseIndex,
      label: phase.label ?? phase.title ?? phase.id,
      objective: phase.objective ?? null,
      ...(reason ? { reason } : {}),
    });
    phaseHistory.push({
      type,
      phaseId: phase.id,
      phaseIndex,
      time: stamped.time,
      ...(reason ? { reason } : {}),
    });
  }

  function advancePhase(reason) {
    const phase = currentPhase();
    if (!phase) return;
    appendPhaseEvent('phase-complete', phase, reason);
    phaseIndex += 1;
    phaseStartedAt = elapsedSeconds;
    if (currentPhase()) appendPhaseEvent('phase-start', currentPhase());
  }

  function conditionContext(nextWorld) {
    return {
      elapsedSeconds,
      frame,
      events,
      metrics,
      possession,
      state: finalState,
      world: nextWorld,
      tacticalPhase: describeTacticalPhase(),
      phaseStartedAt,
      opportunities: opportunityStates,
    };
  }

  function updateOpportunityStates(context) {
    for (const opportunity of scenario.opportunities ?? []) {
      const state = opportunityStates.get(opportunity.id);
      const shouldOpen = evaluateCondition(opportunity.when, context);
      if (shouldOpen === state.open) continue;
      if (shouldOpen) {
        state.open = true;
        state.openedAt = roundTime(elapsedSeconds);
        appendEvent({
          type: 'opportunity-open',
          opportunityId: opportunity.id,
          label: opportunity.label ?? opportunity.title ?? opportunity.id,
        });
      } else {
        closeOpportunity(opportunity, state, 'condition');
      }
    }
  }

  function closeOpportunity(opportunity, state, reason) {
    if (!state.open) return;
    const closedAt = roundTime(elapsedSeconds);
    const window = {
      openedAt: state.openedAt,
      closedAt,
      durationSeconds: roundTime(closedAt - state.openedAt),
    };
    state.windows.push(window);
    state.open = false;
    state.openedAt = null;
    appendEvent({
      type: 'opportunity-close',
      opportunityId: opportunity.id,
      label: opportunity.label ?? opportunity.title ?? opportunity.id,
      reason,
      ...window,
    });
  }

  function closeOpenOpportunities(reason) {
    for (const opportunity of scenario.opportunities ?? []) {
      const state = opportunityStates.get(opportunity.id);
      if (state?.open) closeOpportunity(opportunity, state, reason);
    }
  }

  function describeOpportunities() {
    const result = {};
    for (const opportunity of scenario.opportunities ?? []) {
      const state = opportunityStates.get(opportunity.id);
      result[opportunity.id] = {
        id: opportunity.id,
        label: opportunity.label ?? opportunity.title ?? opportunity.id,
        open: Boolean(state?.open),
        openedAt: state?.openedAt ?? null,
        windows: cloneSerializable(state?.windows ?? []),
      };
    }
    return result;
  }
}

export function runScenario(scenario, options = {}) {
  const configuredScenario = scenarioWithDifficulty(scenario, options.difficulty);
  const world = createScenarioWorld(configuredScenario);
  const tracker = createScenarioTracker(configuredScenario, { world });
  const dt = SCENARIO_DT;
  const hardFrameLimit = Math.ceil(configuredScenario.maxSeconds / dt) + 2;

  while (!tracker.isTerminal && world.tick < hardFrameLimit) {
    stepScenarioWorld(world, tracker, dt);
    options.onFrame?.(tracker.getProgress(), world);
  }

  if (!tracker.isTerminal) tracker.abort('hard-frame-limit');
  return tracker.getResult();
}

function scenarioWithDifficulty(scenario, difficulty) {
  if (!AI_DIFFICULTY[difficulty]) return scenario;
  return {
    ...scenario,
    actors: scenario.actors.map((actor) =>
      (actor.controller ?? 'ai') === 'ai' ? { ...actor, difficulty } : actor
    ),
  };
}

export function stepScenarioWorld(world, tracker, dt = SCENARIO_DT) {
  if (!world || !tracker || tracker.isTerminal) return tracker?.terminal ?? null;

  const scenario = world.scenario;
  const players = world.players;
  const ball = world.ball;
  const kickersThisStep = new Set();
  world.tick += 1;
  ball.mass = TUNING.ball.mass;
  const trackerProgress = tracker.getProgress();
  for (const player of players) {
    player._scenarioEventSink = (event) => tracker.record(event);
  }

  for (let index = 0; index < players.length; index++) {
    const player = players[index];
    player.body.mass = TUNING.player.mass;

    const raw = commandsForPlayer(player, index, world, dt, trackerProgress);
    const action = player.ai.action ?? player.controller;
    tracker.record({
      type: 'decision',
      actorId: player.scenarioActorId,
      team: player.team,
      action,
      intent: player.ai.intent ?? null,
      targetX: finiteOrNull(player.ai.targetX),
      targetZ: finiteOrNull(player.ai.targetZ),
      moveX: finiteOr(raw.moveX, 0),
      moveZ: finiteOr(raw.moveZ, 0),
      shoot: Boolean(raw.shoot),
      power: Boolean(raw.power),
    });

    player.body.vx += finiteOr(raw.moveX, 0) * TUNING.player.accel * dt;
    player.body.vz += finiteOr(raw.moveZ, 0) * TUNING.player.accel * dt;

    const powerPressed = Boolean(raw.power) && !player.powerHeld;
    player.powerHeld = Boolean(raw.power);
    const wasCaptured = Boolean(player.hero.captured);
    const goalTeamBeforePower = projectedGoalDetails(ball, scenario.teams).team;
    const ballVelocityBeforePower = scenarioVelocitySnapshot(ball);
    player.hero.update(dt, { ...raw, powerPressed }, ball);
    if (!wasCaptured && player.hero.captured) {
      tracker.record({
        type: 'ball-capture',
        actorId: player.scenarioActorId,
        team: player.team,
        heroKind: player.heroKind,
      });
    } else if (wasCaptured && !player.hero.captured) {
      tracker.record({
        type: 'ball-release',
        actorId: player.scenarioActorId,
        team: player.team,
        heroKind: player.heroKind,
      });
    }
    recordSaveIfPrevented(
      tracker,
      player,
      scenario,
      goalTeamBeforePower,
      'power',
      ballVelocityBeforePower,
      ball
    );

    integrate(player.body, dt, TUNING.player.damping);
    collidePlayerBounds(player.body, 0.2);
    collideGoalPosts(player.body, 0.2);
    updateFacingTowardBall(player, ball);

    const shootPressed = Boolean(raw.shoot) && !player.shootHeld;
    player.shootHeld = Boolean(raw.shoot);
    if (shootPressed && isTouching(player.body, ball, TUNING.player.shootRange)) {
      const goalTeamBeforeKick = projectedGoalDetails(ball, scenario.teams).team;
      const ballVelocityBeforeKick = scenarioVelocitySnapshot(ball);
      kickBall(player, raw, action, world, tracker);
      kickersThisStep.add(player);
      recordSaveIfPrevented(
        tracker,
        player,
        scenario,
        goalTeamBeforeKick,
        'kick',
        ballVelocityBeforeKick,
        ball
      );
    }
  }

  integrate(ball, dt, TUNING.ball.damping);
  clampSpeed(ball, TUNING.ball.maxSpeed);
  const wallHit = collideWalls(ball, TUNING.ball.wallRestitution);
  if (wallHit) {
    tracker.record({
      type: 'wall-contact',
      x: wallHit.x,
      z: wallHit.z,
      normalX: wallHit.nx,
      normalZ: wallHit.nz,
      impact: wallHit.impact,
    });
  }
  collideGoalPosts(ball, TUNING.ball.wallRestitution);

  for (const player of players) {
    // The kick impulse already represents this player's contact with the ball.
    // Resolving the overlapping circles again in the same step bends the shot
    // a second time and makes deliberate targeting depend on update order.
    if (kickersThisStep.has(player)) continue;
    const before = bodyVelocity(ball);
    const projectedBefore = projectedGoalDetails(ball, scenario.teams);
    if (!collideCircles(player.body, ball, TUNING.ball.playerRestitution)) continue;
    const after = bodyVelocity(ball);
    const projectedAfter = projectedGoalDetails(ball, scenario.teams);
    const actorId = player.scenarioActorId;
    tracker.record({
      type: 'player-ball-contact',
      actorId,
      team: player.team,
      ballVelocityBefore: before,
      ballVelocityAfter: after,
      projectedGoalTeamBefore: projectedBefore.team,
      projectedGoalTeamAfter: projectedAfter.team,
      projectedGoalZSignBefore: projectedBefore.goalZSign,
      projectedGoalZSignAfter: projectedAfter.goalZSign,
    });

    recordSaveIfPrevented(
      tracker,
      player,
      scenario,
      projectedBefore.team,
      'contact',
      scenarioVelocitySnapshot(before),
      ball
    );
  }

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      if (collideCircles(players[i].body, players[j].body, 0.3)) {
        tracker.record({
          type: 'player-contact',
          actorId: players[i].scenarioActorId,
          otherActorId: players[j].scenarioActorId,
        });
      }
    }
  }

  const physicalScorer = goalScored(ball);
  if (physicalScorer !== 0) {
    const goalZSign = physicalScorer === TEAM.RED ? -1 : 1;
    tracker.record({
      type: 'goal',
      scoringTeam: scoringTeamForGoalSign(scenario.teams, goalZSign),
      goalZSign,
      x: ball.x,
      z: ball.z,
    });
  }

  for (const player of players) player._scenarioEventSink = null;
  return tracker.step(dt, world);
}

export function projectedGoalTeam(ball, teams = DEFAULT_TEAMS) {
  return projectedGoalDetails(ball, teams).team;
}

function makeScenarioPlayer(spec, scenario) {
  const x = finiteOr(spec.position?.x, 0);
  const z = finiteOr(spec.position?.z, 0);
  const defendZSign = teamDefendZSign(scenario, spec.team);
  const player = {
    id: spec.id,
    scenarioActorId: spec.id,
    heroKind: spec.heroKind,
    team: spec.team,
    controller: spec.controller ?? 'ai',
    control: spec.controller ?? 'ai',
    difficulty: spec.difficulty ?? 'medium',
    spawnX: x,
    spawnZ: z,
    defendZSign,
    body: createBody(x, z, PLAYER.radius, TUNING.player.mass),
    facingX: finiteOr(spec.facing?.x, 0),
    facingZ: finiteOr(spec.facing?.z, -defendZSign),
    shootHeld: false,
    powerHeld: false,
    ai: {},
    scenarioActor: spec,
    _scenarioEventSink: null,
  };
  player.body.vx = finiteOr(spec.velocity?.x, 0);
  player.body.vz = finiteOr(spec.velocity?.z, 0);
  player.onPowerFX = (effect) => {
    if (effect === 'dash' || effect === 'magnet_on') {
      player._scenarioEventSink?.({
        type: 'power-used',
        actorId: player.scenarioActorId,
        team: player.team,
        heroKind: player.heroKind,
        power: effect,
        action: player.ai?.action ?? player.controller,
        ready: true,
      });
    }
    player._scenarioEventSink?.({
      type: 'hero-effect',
      actorId: player.scenarioActorId,
      team: player.team,
      heroKind: player.heroKind,
      effect,
    });
  };
  player.hero = createHero(spec.heroKind, player);
  applyHeroState(player.hero, spec.heroState);
  return player;
}

function applyHeroState(hero, state) {
  if (!state || typeof state !== 'object') return;
  for (const key of ['cooldownRemaining', 'holdRemaining']) {
    if (Number.isFinite(state[key])) hero[key] = state[key];
  }
  for (const key of ['active', 'captured']) {
    if (typeof state[key] === 'boolean' && key in hero) hero[key] = state[key];
  }
}

function commandsForPlayer(player, playerIndex, world, dt, trackerProgress) {
  if (player.controller === 'ai') {
    return computeAICommands(player, world.ball, {
      players: world.players,
      playerIndex,
      dt,
      defendZSign: teamDefendZSign(world.scenario, player.team),
      teamState: teamStateFor(world, player.team),
      tick: world.tick,
      profile: AI_DIFFICULTY[player.difficulty] ?? AI_DIFFICULTY.medium,
    });
  }

  if (player.controller === 'scripted') {
    return computeScenarioScriptCommands(player, world, trackerProgress);
  }

  player.ai.intent = 'scripted';
  player.ai.action = player.controller;
  player.ai.targetX = player.body.x;
  player.ai.targetZ = player.body.z;
  if (player.controller === 'chaser') return chaserCommands(player, world);
  return EMPTY_COMMANDS;
}

export function computeScenarioScriptCommands(player, world, progress = {}) {
  const actor = player?.scenarioActor ?? findActorSpec(world?.scenario, player?.scenarioActorId ?? player?.id);
  const phase = progress?.tacticalPhase ?? null;
  const instruction = selectScriptInstruction(actor?.script, phase);
  const fallbackTarget = { x: player?.body?.x ?? 0, z: player?.body?.z ?? 0 };

  if (!player.ai) player.ai = {};
  player.ai.intent = 'scripted';

  if (!instruction) {
    player.ai.action = 'scriptedIdle';
    player.ai.targetX = fallbackTarget.x;
    player.ai.targetZ = fallbackTarget.z;
    return EMPTY_COMMANDS;
  }

  const behavior = String(instruction.behavior ?? instruction.action ?? 'idle');
  const normalizedBehavior = behavior.toLowerCase();
  const target = resolveScriptTarget(instruction, world, fallbackTarget);
  player.ai.targetX = target.x;
  player.ai.targetZ = target.z;

  if (['idle', 'hold', 'wait'].includes(normalizedBehavior)) {
    player.ai.action = instruction.actionName ?? 'scriptedIdle';
    return EMPTY_COMMANDS;
  }

  if (['kickto', 'kick', 'kickat'].includes(normalizedBehavior)) {
    const delaySeconds = Math.max(0, finiteOr(instruction.delaySeconds, 0));
    const phaseElapsed = finiteOr(phase?.elapsedSeconds, finiteOr(progress?.elapsedSeconds, 0));
    const actionKey = `${phase?.id ?? 'default'}:${instruction.id ?? behavior}:${delaySeconds}`;
    const alreadyIssued = player.ai.scriptedActionKey === actionKey;
    const shouldKick = phaseElapsed + 1e-9 >= delaySeconds && !alreadyIssued;
    if (shouldKick) player.ai.scriptedActionKey = actionKey;
    if (alreadyIssued && ['hold', 'idle', 'wait'].includes(String(instruction.then ?? '').toLowerCase())) {
      player.ai.action = 'scriptedIdle';
      player.ai.targetX = fallbackTarget.x;
      player.ai.targetZ = fallbackTarget.z;
      return EMPTY_COMMANDS;
    }
    player.ai.action = instruction.actionName ?? 'scriptedKick';
    return {
      ...EMPTY_COMMANDS,
      shoot: shouldKick,
      kickX: target.x - finiteOr(world?.ball?.x, 0),
      kickZ: target.z - finiteOr(world?.ball?.z, 0),
      kickMultiplier: finiteOr(instruction.kickMultiplier ?? instruction.power, 1),
      intendedReceiverId: instruction.intendedReceiverId ?? null,
    };
  }

  if (['chaseball', 'chaser'].includes(normalizedBehavior)) {
    const ballTarget = resolveEntityPoint(world, 'ball') ?? target;
    const commands = scriptedMoveCommands(player, ballTarget, instruction);
    player.ai.action = instruction.actionName ?? 'scriptedChase';
    return {
      ...commands,
      shoot: Boolean(instruction.shootWhenTouching) && isTouching(
        player.body,
        world.ball,
        TUNING.player.shootRange
      ),
      kickX: finiteOr(instruction.kickX, -world.ball.x),
      kickZ: finiteOr(
        instruction.kickZ,
        -teamDefendZSign(world.scenario, player.team) * PITCH.halfLength - world.ball.z
      ),
      kickMultiplier: finiteOr(instruction.kickMultiplier, 1),
    };
  }

  player.ai.action =
    instruction.actionName ??
    (normalizedBehavior === 'follow' ? 'scriptedFollow' : 'scriptedMove');
  return scriptedMoveCommands(player, target, instruction);
}

function selectScriptInstruction(script, tacticalPhase) {
  if (!script) return null;
  const phaseId = tacticalPhase?.id ?? null;
  const phaseElapsed = finiteOr(tacticalPhase?.elapsedSeconds, 0);

  if (Array.isArray(script)) {
    return (
      script.find((entry) => {
        const entryPhase = entry.phase ?? entry.phaseId;
        if (entryPhase != null && entryPhase !== phaseId) return false;
        const startsAt = finiteOr(entry.startSeconds ?? entry.atSeconds, 0);
        const endsAt = Number(entry.endSeconds ?? entry.untilSeconds);
        return phaseElapsed + 1e-9 >= startsAt &&
          (!Number.isFinite(endsAt) || phaseElapsed < endsAt - 1e-9);
      }) ?? null
    );
  }

  if (typeof script !== 'object') return null;
  const phases = script.phases && typeof script.phases === 'object' ? script.phases : script;
  const phaseInstruction = phaseId ? phases[phaseId] : null;
  if (phaseInstruction && typeof phaseInstruction === 'object') return phaseInstruction;
  if (script.default && typeof script.default === 'object') return script.default;
  if (script.behavior || script.action) return script;
  return null;
}

function resolveScriptTarget(instruction, world, fallback) {
  const targetReference =
    instruction.target ??
    instruction.targetActorId ??
    instruction.followActorId ??
    instruction.ref ??
    fallback;
  const target = resolveEntityPoint(world, targetReference) ?? fallback;
  return offsetPoint(target, instruction.offset ?? instruction.targetOffset);
}

function offsetPoint(point, offset) {
  return {
    x: finiteOr(point?.x, 0) + finiteOr(offset?.x, 0),
    z: finiteOr(point?.z, 0) + finiteOr(offset?.z, 0),
    radius: finiteOr(point?.radius, 0),
  };
}

function scriptedMoveCommands(player, target, instruction) {
  const dx = target.x - player.body.x;
  const dz = target.z - player.body.z;
  const distance = Math.hypot(dx, dz);
  const arriveRadius = Math.max(0, finiteOr(instruction.arriveRadius, 0.2));
  const intensity = Math.max(
    0,
    Math.min(1, finiteOr(instruction.intensity ?? instruction.speed, 0.8))
  );
  const moving = distance > arriveRadius;
  return {
    ...EMPTY_COMMANDS,
    moveX: moving ? (dx / distance) * intensity : 0,
    moveZ: moving ? (dz / distance) * intensity : 0,
    shoot: Boolean(instruction.shoot),
    power: Boolean(instruction.power === true),
    kickX: finiteOr(instruction.kickX, 0),
    kickZ: finiteOr(instruction.kickZ, 0),
    kickMultiplier: finiteOr(instruction.kickMultiplier, 1),
    intendedReceiverId: instruction.intendedReceiverId ?? null,
  };
}

function findActorSpec(scenario, actorId) {
  return (scenario?.actors ?? []).find((actor) => String(actor.id) === String(actorId)) ?? null;
}

function chaserCommands(player, world) {
  const ball = world.ball;
  const dx = ball.x - player.body.x;
  const dz = ball.z - player.body.z;
  const distance = Math.hypot(dx, dz) || 1;
  const attackZ = -teamDefendZSign(world.scenario, player.team) * PITCH.halfLength;
  return {
    moveX: (dx / distance) * 0.8,
    moveZ: (dz / distance) * 0.8,
    shoot: isTouching(player.body, ball, TUNING.player.shootRange),
    kickX: -ball.x,
    kickZ: attackZ - ball.z,
    kickMultiplier: 1,
    power: false,
  };
}

function kickBall(player, raw, action, world, tracker) {
  const ball = world.ball;
  const dx = Number.isFinite(raw.kickX) ? raw.kickX : ball.x - player.body.x;
  const dz = Number.isFinite(raw.kickZ) ? raw.kickZ : ball.z - player.body.z;
  const length = Math.hypot(dx, dz) || 1;
  const multiplier = Number.isFinite(raw.kickMultiplier) ? raw.kickMultiplier : 1;
  const velocity = TUNING.player.shootVelocity * multiplier;
  const teamState = teamStateFor(world, player.team);
  const intendedReceiver =
    raw.intendedReceiverId ??
    raw.receiverId ??
    raw.targetPlayerId ??
    raw.decisionMeta?.intendedReceiverId ??
    player.ai.intendedReceiverId ??
    (action === 'passBall' ? teamState.passPlan?.receiver?.scenarioActorId : null) ??
    null;

  if (player.hero.captured) player.hero.release(ball);
  // Match production semantics: any kick breaks another hero's active hold.
  for (const other of world.players) {
    if (other !== player) other.hero.breakHold(ball);
  }

  ball.vx += (dx / length) * velocity;
  ball.vz += (dz / length) * velocity;
  tracker.record({
    type: 'kick',
    actorId: player.scenarioActorId,
    team: player.team,
    action,
    intendedReceiverId: intendedReceiver,
    directionX: dx / length,
    directionZ: dz / length,
    kickMultiplier: multiplier,
    kickVelocity: velocity,
    ballVelocityAfter: bodyVelocity(ball),
  });
}

function recordSaveIfPrevented(
  tracker,
  player,
  scenario,
  scoringTeamBefore,
  method,
  velocityBefore,
  ball
) {
  if (!scoringTeamBefore || Number(scoringTeamBefore) === Number(player.team)) return;
  const scoringTeamAfter = projectedGoalDetails(ball, scenario.teams).team;
  if (Number(scoringTeamAfter) === Number(scoringTeamBefore)) return;
  const velocityAfter = scenarioVelocitySnapshot(ball);
  tracker.record({
    type: 'save',
    actorId: player.scenarioActorId,
    team: player.team,
    method,
    preventedScoringTeam: scoringTeamBefore,
    againstTeam: scoringTeamBefore,
    action: player.ai?.action ?? player.controller,
    velocityBefore,
    velocityAfter,
    ballVelocityBefore: velocityBefore,
    ballVelocityAfter: velocityAfter,
  });
}

function scenarioVelocitySnapshot(body) {
  return {
    vx: finiteOr(body?.vx ?? body?.x, 0),
    vz: finiteOr(body?.vz ?? body?.z, 0),
  };
}

function teamStateFor(world, team) {
  let state = world.teamStates.get(team);
  if (!state) {
    state = createTeamAIState();
    world.teamStates.set(team, state);
  }
  return state;
}

function updateFacingTowardBall(player, ball) {
  const dx = ball.x - player.body.x;
  const dz = ball.z - player.body.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 0.001) return;
  player.facingX = dx / distance;
  player.facingZ = dz / distance;
}

function projectedGoalDetails(ball, teams) {
  const actual = goalScored(ball);
  if (actual !== 0) {
    const goalZSign = actual === TEAM.RED ? -1 : 1;
    return { team: scoringTeamForGoalSign(teams, goalZSign), goalZSign, seconds: 0 };
  }

  if (!ball || !Number.isFinite(ball.vz) || Math.abs(ball.vz) < 1e-6) {
    return { team: 0, goalZSign: 0, seconds: Infinity };
  }
  const goalZSign = Math.sign(ball.vz);
  const goalZ = goalZSign * (PITCH.halfLength + finiteOr(ball.radius, BALL.radius) * 0.5);
  const deltaZ = goalZ - ball.z;
  if (deltaZ * ball.vz <= 0) return { team: 0, goalZSign: 0, seconds: Infinity };

  const damping = Math.max(finiteOr(TUNING.ball.damping, BALL.damping), 0.0001);
  const ratio = (deltaZ * damping) / ball.vz;
  if (ratio < 0 || ratio >= 1) return { team: 0, goalZSign: 0, seconds: Infinity };

  const seconds = -Math.log(1 - ratio) / damping;
  const crossX = ball.x + (ball.vx / ball.vz) * deltaZ;
  if (Math.abs(crossX) >= PITCH.goalHalfWidth) {
    return { team: 0, goalZSign: 0, seconds: Infinity };
  }
  return {
    team: scoringTeamForGoalSign(teams, goalZSign),
    goalZSign,
    seconds,
  };
}

function scoringTeamForGoalSign(teams = DEFAULT_TEAMS, goalZSign) {
  const entries = Object.entries(teams ?? DEFAULT_TEAMS)
    .map(([team, config]) => ({ team: Number(team), defendZSign: nonZeroSign(config?.defendZSign) }))
    .filter((entry) => Number.isFinite(entry.team))
    .sort((a, b) => a.team - b.team);
  return entries.find((entry) => entry.defendZSign === -goalZSign)?.team ??
    (goalZSign < 0 ? TEAM.RED : TEAM.BLUE);
}

function teamDefendZSign(scenario, team) {
  return nonZeroSign(scenario.teams?.[team]?.defendZSign ?? DEFAULT_TEAMS[team]?.defendZSign ?? 1);
}

function findPossessor(world) {
  if (!world?.ball || !Array.isArray(world.players)) return null;
  for (const player of world.players) {
    if (player.hero?.captured) return player;
  }

  let best = null;
  let bestGap = 0.26;
  for (const player of world.players) {
    const gap =
      Math.hypot(world.ball.x - player.body.x, world.ball.z - player.body.z) -
      (player.body.radius + world.ball.radius);
    if (gap > bestGap + 1e-9) continue;
    if (
      !best ||
      gap < bestGap - 1e-9 ||
      String(player.scenarioActorId).localeCompare(String(best.scenarioActorId)) < 0
    ) {
      best = player;
      bestGap = gap;
    }
  }
  return best;
}

function describePossession(player) {
  return {
    actorId: player?.scenarioActorId ?? null,
    team: player?.team ?? null,
  };
}

function createOpportunityStates(opportunities = []) {
  return new Map(
    (opportunities ?? []).map((opportunity) => [
      opportunity.id,
      { open: false, openedAt: null, windows: [] },
    ])
  );
}

function sampleDiagnosticProbes(probes = [], context, metrics) {
  for (const probe of probes ?? []) {
    if (probe.when && !evaluateCondition(probe.when, context)) continue;
    const measure = probe.measure ?? probe.type;
    const value =
      measure === 'distance'
        ? measureDistance(context.world, probe)
        : measure === 'clearance'
          ? measureClearance(context.world, probe)
          : null;
    if (!Number.isFinite(value)) continue;

    const summary = metrics.probes?.[probe.id];
    if (!summary) continue;
    summary.samples += 1;
    summary.average = roundMetric(
      ((summary.average ?? 0) * (summary.samples - 1) + value) / summary.samples
    );
    summary.last = roundMetric(value);
    summary.lastAt = roundTime(context.elapsedSeconds);
    if (summary.min === null || value < summary.min) {
      summary.min = roundMetric(value);
      summary.minAt = roundTime(context.elapsedSeconds);
    }
    if (summary.max === null || value > summary.max) {
      summary.max = roundMetric(value);
      summary.maxAt = roundTime(context.elapsedSeconds);
    }
  }
}

function measureDistance(world, definition) {
  const from = resolveEntityPoint(world, definition?.from);
  const to = resolveEntityPoint(world, definition?.to);
  if (!from || !to) return null;
  let distance = Math.hypot(to.x - from.x, to.z - from.z);
  if (definition.edge === true || definition.surface === true) {
    distance -= finiteOr(from.radius, 0) + finiteOr(to.radius, 0);
  }
  return Math.max(0, distance);
}

function measureClearance(world, definition) {
  const from = resolveEntityPoint(world, definition?.from);
  const to = resolveEntityPoint(world, definition?.to);
  if (!from || !to) return null;

  const explicitIds = definition.actors ?? definition.actorIds;
  const idSet = Array.isArray(explicitIds) ? new Set(explicitIds.map(String)) : null;
  const excludedIds = new Set(
    [definition.from, definition.to]
      .filter((reference) => typeof reference === 'string' && reference !== 'ball')
      .map(String)
  );
  for (const id of definition.exclude ?? []) excludedIds.add(String(id));

  const candidates = (world?.players ?? []).filter((player) => {
    const id = String(player.scenarioActorId ?? player.id);
    if (excludedIds.has(id)) return false;
    if (idSet && !idSet.has(id)) return false;
    if (definition.team !== undefined && Number(player.team) !== Number(definition.team)) return false;
    if (
      definition.againstTeam !== undefined &&
      Number(player.team) === Number(definition.againstTeam)
    ) {
      return false;
    }
    return true;
  });

  if (candidates.length === 0) return Infinity;
  let clearance = Infinity;
  for (const candidate of candidates) {
    const distance = pointToSegmentDistance(candidate.body, from, to);
    const edgeDistance = distance - finiteOr(candidate.body?.radius, PLAYER.radius);
    clearance = Math.min(clearance, edgeDistance);
  }
  return Math.max(0, clearance);
}

function resolveEntityPoint(world, reference) {
  if (!world || reference === undefined || reference === null) return null;
  if (reference === 'ball' || reference?.entity === 'ball' || reference?.type === 'ball') {
    return world.ball ?? null;
  }

  if (typeof reference === 'object') {
    const actorId = reference.actorId ?? reference.id ?? reference.entity ?? reference.ref;
    if (actorId && actorId !== 'ball') {
      const actor = findWorldActor(world, actorId);
      if (!actor) return null;
      return offsetPoint(actor.body, reference.offset);
    }
    if (Number.isFinite(reference.x) && Number.isFinite(reference.z)) {
      return { x: reference.x, z: reference.z, radius: finiteOr(reference.radius, 0) };
    }
    return null;
  }

  const actor = findWorldActor(world, reference);
  return actor?.body ?? null;
}

function findWorldActor(world, id) {
  return (world?.players ?? []).find(
    (player) => String(player.scenarioActorId ?? player.id) === String(id)
  ) ?? null;
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 1e-12) return Math.hypot(point.x - start.x, point.z - start.z);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSq)
  );
  return Math.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t));
}

function spatialExpected(definition) {
  if (definition?.value !== undefined) return definition.value;
  if (definition?.equals !== undefined) return definition.equals;
  const operators = Object.fromEntries(
    Object.entries(definition ?? {}).filter(([key]) => key.startsWith('$'))
  );
  return Object.keys(operators).length > 0 ? operators : { $exists: true };
}

function evaluateCondition(condition, context) {
  if (!condition || typeof condition !== 'object') return false;
  if (Array.isArray(condition.all)) {
    return condition.all.every((child) => evaluateCondition(child, context));
  }
  if (Array.isArray(condition.any)) {
    return condition.any.some((child) => evaluateCondition(child, context));
  }
  if (condition.not) return !evaluateCondition(condition.not, context);
  if (condition.event) return context.events.some((event) => matchesValue(event, condition.event));
  if (Array.isArray(condition.sequence)) return matchesEventSequence(context.events, condition.sequence);
  if (condition.elapsed) return matchesValue(context.elapsedSeconds, condition.elapsed);
  if (condition.phase !== undefined) {
    return matchesValue(context.tacticalPhase?.id ?? null, condition.phase);
  }
  if (condition.phaseElapsed) {
    return matchesValue(context.tacticalPhase?.elapsedSeconds ?? 0, condition.phaseElapsed);
  }
  if (condition.phaseEvent) {
    const phaseId = context.tacticalPhase?.id;
    if (!phaseId) return false;
    return context.events.some(
      (event) => event.tacticalPhaseId === phaseId && matchesValue(event, condition.phaseEvent)
    );
  }
  if (condition.opportunity !== undefined) {
    const state = context.opportunities?.get?.(String(condition.opportunity));
    return Boolean(state?.open);
  }
  if (condition.distance) {
    const actual = measureDistance(context.world, condition.distance);
    return matchesValue(actual, spatialExpected(condition.distance));
  }
  if (condition.clearance) {
    const actual = measureClearance(context.world, condition.clearance);
    return matchesValue(actual, spatialExpected(condition.clearance));
  }
  if (condition.state) {
    const actual = valueAtPath(context.state, condition.state.path);
    return matchesValue(actual, condition.state.value ?? condition.state.equals);
  }
  if (condition.metric) {
    const actual = valueAtPath(context.metrics, condition.metric.path);
    return matchesValue(actual, condition.metric.value ?? condition.metric.equals);
  }
  return false;
}

function matchesEventSequence(events, sequence) {
  if (!Array.isArray(sequence) || sequence.length === 0) return false;
  return findSequenceMatch(0, 0, null);

  function findSequenceMatch(itemIndex, eventIndex, previousEvent) {
    if (itemIndex >= sequence.length) return true;
    const item = sequence[itemIndex];
    const expected = item?.event ?? item;
    const withinSeconds = Number(item?.withinSeconds);
    for (let index = eventIndex; index < events.length; index++) {
      const event = events[index];
      if (!matchesValue(event, expected)) continue;
      if (
        previousEvent &&
        Number.isFinite(withinSeconds) &&
        event.time - previousEvent.time > withinSeconds + 1e-9
      ) {
        break;
      }
      if (findSequenceMatch(itemIndex + 1, index + 1, event)) return true;
    }
    return false;
  }
}

function matchesValue(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if ('$eq' in expected) return actual === expected.$eq;
    if ('$ne' in expected) return actual !== expected.$ne;
    if ('$gte' in expected && !(actual >= expected.$gte)) return false;
    if ('$gt' in expected && !(actual > expected.$gt)) return false;
    if ('$lte' in expected && !(actual <= expected.$lte)) return false;
    if ('$lt' in expected && !(actual < expected.$lt)) return false;
    if ('$in' in expected && !expected.$in.includes(actual)) return false;
    if ('$nin' in expected && expected.$nin.includes(actual)) return false;
    if ('$exists' in expected && (actual !== undefined && actual !== null) !== expected.$exists) return false;

    const operatorKeys = Object.keys(expected).filter((key) => key.startsWith('$'));
    if (operatorKeys.length > 0) return true;
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([key, value]) => matchesValue(actual[key], value));
  }
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

function valueAtPath(root, path) {
  if (typeof path !== 'string' || !path) return undefined;
  return path.split('.').reduce((value, key) => value?.[key], root);
}

function emptyMetrics(actors, probes = []) {
  const decisionFrames = {};
  const actionTransitionsByActor = {};
  const kicksByActor = {};
  const powerUsesByActor = {};
  const contactsByActor = {};
  const savesByActor = {};
  const capturesByActor = {};
  const heroEffectsByActor = {};
  for (const actor of actors) {
    decisionFrames[actor.id] = {};
    actionTransitionsByActor[actor.id] = [];
    kicksByActor[actor.id] = 0;
    powerUsesByActor[actor.id] = 0;
    contactsByActor[actor.id] = 0;
    savesByActor[actor.id] = 0;
    capturesByActor[actor.id] = 0;
    heroEffectsByActor[actor.id] = {};
  }
  return {
    decisionFrames,
    actionTransitionsByActor,
    kicksByActor,
    powerUsesByActor,
    contactsByActor,
    savesByActor,
    capturesByActor,
    heroEffectsByActor,
    possessionChanges: 0,
    goalsByTeam: {},
    probes: Object.fromEntries(
      (probes ?? []).map((probe) => [
        probe.id,
        {
          id: probe.id,
          label: probe.label ?? probe.title ?? probe.id,
          measure: probe.measure ?? probe.type,
          samples: 0,
          min: null,
          minAt: null,
          max: null,
          maxAt: null,
          average: null,
          last: null,
          lastAt: null,
        },
      ])
    ),
  };
}

function updateMetrics(metrics, event) {
  const actorId = event.actorId;
  if (event.type === 'decision' && actorId) {
    const counts = (metrics.decisionFrames[actorId] ??= {});
    counts[event.action ?? 'unknown'] = (counts[event.action ?? 'unknown'] ?? 0) + 1;
    const transitions = (metrics.actionTransitionsByActor[actorId] ??= []);
    const previous = transitions[transitions.length - 1] ?? null;
    const action = event.action ?? 'unknown';
    if (!previous || previous.to !== action) {
      transitions.push({
        time: event.time,
        from: previous?.to ?? null,
        to: action,
        intent: event.intent ?? null,
        tacticalPhaseId: event.tacticalPhaseId ?? null,
        targetX: finiteOrNull(event.targetX),
        targetZ: finiteOrNull(event.targetZ),
      });
    }
  } else if (event.type === 'kick' && actorId) {
    metrics.kicksByActor[actorId] = (metrics.kicksByActor[actorId] ?? 0) + 1;
  } else if (event.type === 'power-used' && actorId) {
    metrics.powerUsesByActor[actorId] = (metrics.powerUsesByActor[actorId] ?? 0) + 1;
  } else if (event.type === 'player-ball-contact' && actorId) {
    metrics.contactsByActor[actorId] = (metrics.contactsByActor[actorId] ?? 0) + 1;
  } else if (event.type === 'save' && actorId) {
    metrics.savesByActor[actorId] = (metrics.savesByActor[actorId] ?? 0) + 1;
  } else if (event.type === 'ball-capture' && actorId) {
    metrics.capturesByActor[actorId] = (metrics.capturesByActor[actorId] ?? 0) + 1;
  } else if (event.type === 'hero-effect' && actorId) {
    const effects = (metrics.heroEffectsByActor[actorId] ??= {});
    effects[event.effect] = (effects[event.effect] ?? 0) + 1;
  } else if (event.type === 'possession-change') {
    metrics.possessionChanges += 1;
  } else if (event.type === 'goal') {
    const key = String(event.scoringTeam);
    metrics.goalsByTeam[key] = (metrics.goalsByTeam[key] ?? 0) + 1;
  }
}

function snapshotWorld(world, currentPossession) {
  if (!world?.ball || !Array.isArray(world.players)) return null;
  const players = world.players.map((player) => ({
    id: player.scenarioActorId,
    heroKind: player.heroKind,
    team: player.team,
    body: snapshotBody(player.body),
    facing: { x: player.facingX, z: player.facingZ },
    action: player.ai?.action ?? null,
    hero: snapshotHero(player.hero),
  }));
  return {
    ball: snapshotBody(world.ball),
    players,
    actors: Object.fromEntries(players.map((player) => [player.id, player])),
    possession: cloneSerializable(currentPossession),
  };
}

function snapshotBody(body) {
  return {
    x: finiteOrNull(body?.x),
    z: finiteOrNull(body?.z),
    vx: finiteOrNull(body?.vx),
    vz: finiteOrNull(body?.vz),
    radius: finiteOrNull(body?.radius),
    mass: finiteOrNull(body?.mass),
  };
}

function snapshotHero(hero) {
  return {
    cooldownRemaining: finiteOrNull(hero?.cooldownRemaining),
    active: Boolean(hero?.active),
    captured: Boolean(hero?.captured),
    holdRemaining: finiteOrNull(hero?.holdRemaining),
  };
}

function worldIsFinite(world) {
  if (!world) return true;
  const bodies = [world.ball, ...(world.players ?? []).map((player) => player.body)];
  return bodies.every(
    (body) =>
      body &&
      Number.isFinite(body.x) &&
      Number.isFinite(body.z) &&
      Number.isFinite(body.vx) &&
      Number.isFinite(body.vz)
  );
}

function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object') throw new TypeError('Scenario must be an object.');
  if (typeof scenario.id !== 'string' || !scenario.id) throw new TypeError('Scenario requires a stable id.');
  if (!Number.isInteger(scenario.version) || scenario.version < 1) {
    throw new TypeError(`Scenario ${scenario.id} requires a positive integer version.`);
  }
  if (!Number.isFinite(scenario.maxSeconds) || scenario.maxSeconds <= 0) {
    throw new TypeError(`Scenario ${scenario.id} requires maxSeconds > 0.`);
  }
  if (!Array.isArray(scenario.actors) || scenario.actors.length === 0) {
    throw new TypeError(`Scenario ${scenario.id} requires at least one actor.`);
  }
  for (const [team, config] of Object.entries(scenario.teams ?? {})) {
    if (config?.defendZSign !== -1 && config?.defendZSign !== 1) {
      throw new TypeError(`Scenario ${scenario.id} team ${team} requires defendZSign -1 or 1.`);
    }
  }
  const ids = new Set();
  for (const actor of scenario.actors) {
    if (typeof actor.id !== 'string' || !actor.id || ids.has(actor.id)) {
      throw new TypeError(`Scenario ${scenario.id} actor ids must be unique, non-empty strings.`);
    }
    ids.add(actor.id);
    if (!scenario.teams?.[actor.team]) {
      throw new TypeError(`Scenario ${scenario.id} actor ${actor.id} has no explicit team direction.`);
    }
    if (!SCENARIO_CONTROLLERS.includes(actor.controller ?? 'ai')) {
      throw new TypeError(`Scenario ${scenario.id} actor ${actor.id} has an unknown controller.`);
    }
    if ((actor.controller ?? 'ai') === 'scripted' && !actor.script) {
      throw new TypeError(`Scenario ${scenario.id} scripted actor ${actor.id} requires a script.`);
    }
  }
  if (!Array.isArray(scenario.completion?.rules) || scenario.completion.rules.length === 0) {
    throw new TypeError(`Scenario ${scenario.id} requires declarative completion rules.`);
  }
  if (!Array.isArray(scenario.ratingRubric) || scenario.ratingRubric.length === 0) {
    throw new TypeError(`Scenario ${scenario.id} requires rating rubric metadata.`);
  }
  for (const criterion of scenario.ratingRubric) {
    if (criterion.min !== 1 || criterion.max !== 5) {
      throw new TypeError(`Scenario ${scenario.id} rubric ${criterion.id} must use a 1-5 scale.`);
    }
  }

  validateTacticalMetadata(scenario, ids);
}

function validateTacticalMetadata(scenario, actorIds) {
  const phaseIds = new Set();
  if (scenario.phases !== undefined && !Array.isArray(scenario.phases)) {
    throw new TypeError(`Scenario ${scenario.id} phases must be an array.`);
  }
  for (const phase of scenario.phases ?? []) {
    if (typeof phase?.id !== 'string' || !phase.id || phaseIds.has(phase.id)) {
      throw new TypeError(`Scenario ${scenario.id} tactical phase ids must be unique strings.`);
    }
    phaseIds.add(phase.id);
    if (phase.maxSeconds !== undefined && (!Number.isFinite(phase.maxSeconds) || phase.maxSeconds <= 0)) {
      throw new TypeError(`Scenario ${scenario.id} phase ${phase.id} requires maxSeconds > 0.`);
    }
    if (phase.advanceWhen !== undefined) validateConditionMetadata(scenario, phase.advanceWhen, actorIds);
    if (
      phase.timeout?.outcome !== undefined &&
      !TERMINAL_OUTCOMES.includes(phase.timeout.outcome)
    ) {
      throw new TypeError(`Scenario ${scenario.id} phase ${phase.id} has an invalid timeout outcome.`);
    }
  }

  const opportunityIds = new Set();
  if (scenario.opportunities !== undefined && !Array.isArray(scenario.opportunities)) {
    throw new TypeError(`Scenario ${scenario.id} opportunities must be an array.`);
  }
  for (const opportunity of scenario.opportunities ?? []) {
    if (
      typeof opportunity?.id !== 'string' ||
      !opportunity.id ||
      opportunityIds.has(opportunity.id)
    ) {
      throw new TypeError(`Scenario ${scenario.id} opportunity ids must be unique strings.`);
    }
    opportunityIds.add(opportunity.id);
    validateConditionMetadata(scenario, opportunity.when, actorIds);
  }
  for (const phase of scenario.phases ?? []) {
    if (phase.advanceWhen !== undefined) {
      validateConditionMetadata(scenario, phase.advanceWhen, actorIds, opportunityIds);
    }
  }

  if (
    scenario.diagnostics !== undefined &&
    (!scenario.diagnostics || typeof scenario.diagnostics !== 'object' || Array.isArray(scenario.diagnostics))
  ) {
    throw new TypeError(`Scenario ${scenario.id} diagnostics must be an object.`);
  }
  const probes = scenario.diagnostics?.probes;
  if (probes !== undefined && !Array.isArray(probes)) {
    throw new TypeError(`Scenario ${scenario.id} diagnostics.probes must be an array.`);
  }
  const probeIds = new Set();
  for (const probe of probes ?? []) {
    const measure = probe?.measure ?? probe?.type;
    if (typeof probe?.id !== 'string' || !probe.id || probeIds.has(probe.id)) {
      throw new TypeError(`Scenario ${scenario.id} diagnostic probe ids must be unique strings.`);
    }
    probeIds.add(probe.id);
    if (!['distance', 'clearance'].includes(measure)) {
      throw new TypeError(`Scenario ${scenario.id} probe ${probe.id} has an unknown measure.`);
    }
    validateSpatialDefinition(scenario, probe, actorIds);
    if (probe.when !== undefined) validateConditionMetadata(scenario, probe.when, actorIds);
  }

  for (const actor of scenario.actors) {
    if ((actor.controller ?? 'ai') !== 'scripted') continue;
    validateActorScript(scenario, actor, phaseIds);
  }

  for (const rule of scenario.completion.rules) {
    validateConditionMetadata(scenario, rule.when, actorIds, opportunityIds);
  }
}

function validateActorScript(scenario, actor, phaseIds) {
  const script = actor.script;
  if (!Array.isArray(script) && (!script || typeof script !== 'object')) {
    throw new TypeError(`Scenario ${scenario.id} scripted actor ${actor.id} has an invalid script.`);
  }
  if (Array.isArray(script)) {
    for (const step of script) {
      const phaseId = step?.phase ?? step?.phaseId;
      if (phaseId != null && !phaseIds.has(phaseId)) {
        throw new TypeError(`Scenario ${scenario.id} actor ${actor.id} references unknown phase ${phaseId}.`);
      }
    }
    return;
  }
  const phases = script.phases && typeof script.phases === 'object' ? script.phases : script;
  for (const key of Object.keys(phases)) {
    if (['default', 'behavior', 'action', 'actionName'].includes(key)) continue;
    if (phaseIds.size > 0 && !phaseIds.has(key)) {
      throw new TypeError(`Scenario ${scenario.id} actor ${actor.id} references unknown phase ${key}.`);
    }
  }
}

function validateConditionMetadata(scenario, condition, actorIds, opportunityIds = null) {
  if (!condition || typeof condition !== 'object') {
    throw new TypeError(`Scenario ${scenario.id} contains an invalid tactical condition.`);
  }
  for (const children of [condition.all, condition.any]) {
    if (!Array.isArray(children)) continue;
    for (const child of children) validateConditionMetadata(scenario, child, actorIds, opportunityIds);
  }
  if (condition.not) validateConditionMetadata(scenario, condition.not, actorIds, opportunityIds);
  if (condition.distance) validateSpatialDefinition(scenario, condition.distance, actorIds);
  if (condition.clearance) validateSpatialDefinition(scenario, condition.clearance, actorIds);
  if (
    condition.opportunity !== undefined &&
    opportunityIds &&
    !opportunityIds.has(String(condition.opportunity))
  ) {
    throw new TypeError(`Scenario ${scenario.id} references unknown opportunity ${condition.opportunity}.`);
  }
  if (Array.isArray(condition.sequence)) {
    for (const item of condition.sequence) {
      if (
        item?.withinSeconds !== undefined &&
        (!Number.isFinite(item.withinSeconds) || item.withinSeconds < 0)
      ) {
        throw new TypeError(`Scenario ${scenario.id} sequence withinSeconds must be non-negative.`);
      }
    }
  }
}

function validateSpatialDefinition(scenario, definition, actorIds) {
  for (const key of ['from', 'to']) {
    const reference = definition?.[key];
    if (reference === undefined || reference === null) {
      throw new TypeError(`Scenario ${scenario.id} spatial measure requires ${key}.`);
    }
    if (
      typeof reference === 'string' &&
      reference !== 'ball' &&
      !actorIds.has(reference)
    ) {
      throw new TypeError(`Scenario ${scenario.id} spatial measure references unknown actor ${reference}.`);
    }
  }
  for (const id of definition.actors ?? definition.actorIds ?? []) {
    if (!actorIds.has(String(id))) {
      throw new TypeError(`Scenario ${scenario.id} clearance references unknown actor ${id}.`);
    }
  }
}

function bodyVelocity(body) {
  return { x: body.vx, z: body.vz };
}

function roundTime(value) {
  return Math.round(value * 1e6) / 1e6;
}

function roundMetric(value) {
  return Math.round(value * 1e4) / 1e4;
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function nonZeroSign(value) {
  return Math.sign(value) || 1;
}

function cloneSerializable(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}
