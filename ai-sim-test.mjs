import { SCENARIOS, findScenario, SCENARIO_SCHEMA_VERSION } from './src/ai-scenarios.js';
import {
  SCENARIO_HZ,
  SCENARIO_DT,
  createScenarioWorld,
  createScenarioTracker,
  stepScenarioWorld,
  projectedGoalTeam,
  runScenario,
} from './src/ai-scenario-runtime.js';

export {
  SCENARIOS,
  SCENARIO_SCHEMA_VERSION,
  SCENARIO_HZ,
  SCENARIO_DT,
  findScenario,
  createScenarioWorld,
  createScenarioTracker,
  stepScenarioWorld,
  projectedGoalTeam,
  runScenario,
};

export function runScenarioById(id, options) {
  const scenario = findScenario(id);
  if (!scenario) throw new RangeError(`Unknown AI scenario: ${id}`);
  return runScenario(scenario, options);
}

export async function runAllScenarioResults(onProgress, options = {}) {
  const results = [];
  const total = SCENARIOS.length;
  for (let index = 0; index < total; index++) {
    const scenario = SCENARIOS[index];
    await onProgress?.(index, total, scenario.label);
    results.push(runScenario(scenario, options));
  }
  await onProgress?.(total, total, null);
  return results;
}

// Kept as a text-returning facade for both existing UIs. Call
// runAllScenarioResults() when structured data is needed.
export async function runAllScenarios(onProgress, options = {}) {
  const results = await runAllScenarioResults(onProgress, options);
  return formatSuiteReport(results);
}

export function formatSuiteReport(results) {
  const reports = results.map(formatScenarioResult);
  const counts = { success: 0, failure: 0, timeout: 0, aborted: 0 };
  for (const result of results) {
    const key = result.outcome ?? 'aborted';
    counts[key] = (counts[key] ?? 0) + 1;
  }

  reports.push(
    [
      '=== Scenario suite summary ===',
      `success ${counts.success}  failure ${counts.failure}  timeout ${counts.timeout}  aborted ${counts.aborted}`,
      `all succeeded: ${counts.success === results.length}`,
      'note: staged failures are diagnostic evidence, not automatically harness errors',
    ].join('\n')
  );
  return reports.join('\n\n');
}

export function formatScenarioResult(result) {
  const lines = [];
  const { scenario, simulation, metrics } = result;
  lines.push(`=== ${scenario.title} [${scenario.id}@${scenario.version}] ===`);
  lines.push(
    `outcome: ${(result.outcome ?? 'running').toUpperCase()}  time: ${simulation.elapsedSeconds.toFixed(2)}s  frames: ${simulation.frames}`
  );
  if (result.reason) lines.push(`reason: ${result.reason}`);
  appendTacticalReport(lines, result);

  for (const [actorId, actions] of Object.entries(metrics.decisionFrames)) {
    const total = Object.values(actions).reduce((sum, count) => sum + count, 0);
    const actionText = Object.entries(actions)
      .sort((a, b) => b[1] - a[1])
      .map(([action, count]) => `${action} ${Math.round((count / Math.max(total, 1)) * 100)}%`)
      .join('  ');
    lines.push(
      `  ${actorId}: ${actionText || 'no decisions'}  kicks ${metrics.kicksByActor[actorId] ?? 0}  powers ${metrics.powerUsesByActor[actorId] ?? 0}  contacts ${metrics.contactsByActor[actorId] ?? 0}  saves ${metrics.savesByActor[actorId] ?? 0}  captures ${metrics.capturesByActor[actorId] ?? 0}`
    );
  }

  const notable = result.events.filter((event) =>
    ['power-used', 'hero-effect', 'ball-capture', 'kick', 'save', 'goal'].includes(event.type)
  );
  for (const event of notable) lines.push(`  @${event.time.toFixed(2)}s ${formatEvent(event)}`);
  return lines.join('\n');
}

function appendTacticalReport(lines, result) {
  const diagnostics = result.diagnostics ?? {};
  const metrics = result.metrics ?? {};
  const phaseHistory = Array.isArray(result.phaseHistory)
    ? result.phaseHistory
    : Array.isArray(diagnostics.phaseHistory)
      ? diagnostics.phaseHistory
      : Array.isArray(metrics.phaseHistory)
        ? metrics.phaseHistory
        : [];
  const opportunities =
    result.opportunities ?? diagnostics.opportunities ?? metrics.opportunities ?? {};
  const probes = diagnostics.probes ?? metrics.probes ?? {};
  const transitions =
    diagnostics.actionTransitionsByActor ?? metrics.actionTransitionsByActor ?? {};
  if (
    !phaseHistory.length &&
    !Object.keys(opportunities).length &&
    !Object.keys(probes).length &&
    !Object.keys(transitions).length
  ) {
    return;
  }

  lines.push('tactical diagnostics:');
  for (const entry of phaseHistory) {
    const verb = entry.type === 'phase-complete' ? 'completed' : 'started';
    const reason = entry.reason ? ` · ${entry.reason}` : '';
    lines.push(
      `  phase @${formatDiagnosticTime(entry.time)} ${entry.phaseId || 'unknown'} ${verb}${reason}`
    );
  }

  for (const [key, opportunity] of Object.entries(opportunities)) {
    const label = opportunity?.label || opportunity?.id || key;
    const windows = Array.isArray(opportunity?.windows) ? opportunity.windows : [];
    const formatted = windows.map((window) => {
      const end = window.closedAt != null && Number.isFinite(Number(window.closedAt))
        ? formatDiagnosticTime(window.closedAt)
        : 'open';
      return `${formatDiagnosticTime(window.openedAt)}–${end}`;
    });
    if (opportunity?.open && !windows.some((window) => window?.closedAt == null)) {
      formatted.push(`${formatDiagnosticTime(opportunity.openedAt)}–open`);
    }
    lines.push(`  opportunity ${label}: ${formatted.join(', ') || 'no window'}`);
  }

  for (const [key, probe] of Object.entries(probes)) {
    const label = probe?.label || probe?.id || key;
    const measure = probe?.measure ? ` ${probe.measure}` : '';
    lines.push(
      `  probe ${label}: n=${probe?.samples ?? 0} min=${formatDiagnosticNumber(probe?.min)} max=${formatDiagnosticNumber(probe?.max)} avg=${formatDiagnosticNumber(probe?.average)} last=${formatDiagnosticNumber(probe?.last)}${measure}`
    );
  }

  for (const [actorId, actorTransitions] of Object.entries(transitions)) {
    if (!Array.isArray(actorTransitions) || !actorTransitions.length) continue;
    const path = actorTransitions
      .map((transition) => {
        const from = transition.from ? `${transition.from} -> ` : '';
        const phase = transition.tacticalPhaseId ? ` [${transition.tacticalPhaseId}]` : '';
        return `@${formatDiagnosticTime(transition.time)} ${from}${transition.to || 'unknown'}${phase}`;
      })
      .join('  ');
    lines.push(`  actions ${actorId}: ${path}`);
  }
}

function formatDiagnosticTime(value) {
  const number = Number(value);
  return `${(Number.isFinite(number) ? Math.max(0, number) : 0).toFixed(2)}s`;
}

function formatDiagnosticNumber(value) {
  if (value == null || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const absolute = Math.abs(number);
  return absolute >= 100 ? number.toFixed(0) : absolute >= 10 ? number.toFixed(1) : number.toFixed(2);
}

function formatEvent(event) {
  if (event.type === 'power-used') return `${event.actorId} used power during ${event.action}`;
  if (event.type === 'hero-effect') return `${event.actorId} effect ${event.effect}`;
  if (event.type === 'ball-capture') return `${event.actorId} captured the ball`;
  if (event.type === 'kick') {
    const receiver = event.intendedReceiverId ? ` to ${event.intendedReceiverId}` : '';
    return `${event.actorId} kicked (${event.action})${receiver}`;
  }
  if (event.type === 'save') return `${event.actorId} saved a goal-bound ball`;
  if (event.type === 'goal') return `team ${event.scoringTeam} scored`;
  return event.type;
}
