export const AI_EVALUATION_STORAGE_KEY = 'soccer-pucks-ai-sim-results';
export const AI_EVALUATION_SCHEMA_VERSION = 1;
export const MAX_AI_EVALUATION_RUNS = 500;

const OUTCOME_STATUSES = new Set(['success', 'failure', 'timeout', 'aborted', 'error']);
const OMITTED_TRACE_KEYS = new Set([
  'events',
  'eventlog',
  'eventlogs',
  'frames',
  'framelog',
  'framelogs',
  'fulltrace',
  'history',
  'snapshots',
  'timeline',
  'trace',
  'traces',
]);
const MAX_CRITERIA = 24;
const MAX_NOTES_LENGTH = 4000;
const MAX_TEXT_LENGTH = 1000;
const MAX_STRUCTURED_DEPTH = 6;
const MAX_STRUCTURED_KEYS = 80;
const MAX_STRUCTURED_ARRAY_LENGTH = 40;

let memoryEnvelope = emptyEnvelope();
let memoryInitialized = false;
let memoryDirty = false;
let fallbackUuidCounter = 0;

/**
 * Stored envelope schema:
 * {
 *   schemaVersion: 1,
 *   runs: [{
 *     id,
 *     scenario: { id, version, title, category },
 *     setup,
 *     ai: { revision, difficulty },
 *     outcome: { status, passed, reason, conditionId, simulatedSeconds, metrics },
 *     rubric: { criteria: [{ id, label, weight }], values, overall, notes },
 *     startedAt,
 *     completedAt
 *   }]
 * }
 */

export function loadEvaluationRuns() {
  return cloneRuns(readEnvelope().runs);
}

// The returned review includes a non-persisted `persistence` field so the UI
// can distinguish durable localStorage from the in-memory session fallback.
export function saveEvaluationRun(review = {}) {
  const run = buildReviewedRun(review);
  if (!run.scenario.id) throw new TypeError('A reviewed AI scenario run requires a scenario id.');

  const runs = loadEvaluationRuns().filter((saved) => saved.id !== run.id);
  runs.push(run);
  const persistence = writeEnvelope({
    schemaVersion: AI_EVALUATION_SCHEMA_VERSION,
    runs: runs.slice(-MAX_AI_EVALUATION_RUNS),
  });
  return { ...cloneRun(run), persistence };
}

export function removeEvaluationRun(runId) {
  const id = cleanText(runId, 128);
  if (!id) return false;

  const runs = loadEvaluationRuns();
  const remaining = runs.filter((run) => run.id !== id);
  if (remaining.length === runs.length) return false;

  writeEnvelope({ schemaVersion: AI_EVALUATION_SCHEMA_VERSION, runs: remaining });
  return true;
}

export function clearEvaluationRuns() {
  const removedCount = loadEvaluationRuns().length;
  memoryEnvelope = emptyEnvelope();
  memoryInitialized = true;

  try {
    getStorage()?.removeItem(AI_EVALUATION_STORAGE_KEY);
    memoryDirty = false;
  } catch {
    // Keep the cleared in-memory envelope authoritative when storage is unavailable.
    memoryDirty = true;
  }
  return removedCount;
}

export function aggregateEvaluationRuns(runs = loadEvaluationRuns(), scenarioId = 'all') {
  const groups = new Map();
  const requestedScenarioId = cleanText(scenarioId, 160) || 'all';
  const normalizedRuns = normalizeRunList(runs, { forStorage: true }).filter(
    (run) => requestedScenarioId === 'all' || run.scenario.id === requestedScenarioId
  );

  for (const run of normalizedRuns) {
    const scenarioId = run.scenario.id;
    let group = groups.get(scenarioId);
    if (!group) {
      group = {
        scenarioId,
        scenarioVersion: run.scenario.version,
        scenarioTitle: run.scenario.title,
        category: run.scenario.category,
        versions: new Set(),
        attempts: 0,
        automatedAttempts: 0,
        automatedSuccesses: 0,
        ratedAttempts: 0,
        overallTotal: 0,
        criterionTotals: new Map(),
        ratedRuns: [],
        latestRun: null,
      };
      groups.set(scenarioId, group);
    }

    group.attempts += 1;
    group.versions.add(run.scenario.version);
    if (!group.latestRun || timestampValue(run.completedAt) >= timestampValue(group.latestRun.completedAt)) {
      group.latestRun = run;
      group.scenarioVersion = run.scenario.version;
      group.scenarioTitle = run.scenario.title;
      group.category = run.scenario.category;
    }

    if (typeof run.outcome.passed === 'boolean') {
      group.automatedAttempts += 1;
      if (run.outcome.passed) group.automatedSuccesses += 1;
    }

    if (Number.isFinite(run.rubric.overall)) {
      group.ratedAttempts += 1;
      group.overallTotal += run.rubric.overall;
      group.ratedRuns.push(run);
    }

    const criteriaById = new Map(run.rubric.criteria.map((criterion) => [criterion.id, criterion]));
    for (const [criterionId, value] of Object.entries(run.rubric.values)) {
      if (!isRating(value)) continue;
      const criterion = criteriaById.get(criterionId);
      const current = group.criterionTotals.get(criterionId) ?? {
        label: criterion?.label ?? humanizeId(criterionId),
        total: 0,
        count: 0,
      };
      current.label = criterion?.label ?? current.label;
      current.total += value;
      current.count += 1;
      group.criterionTotals.set(criterionId, current);
    }
  }

  return [...groups.values()]
    .map((group) => finalizeAggregate(group))
    .sort((a, b) => timestampValue(b.latestAt) - timestampValue(a.latestAt));
}

export function serializeEvaluationRuns(runs = loadEvaluationRuns(), spacing = 2) {
  const normalized = normalizeRunList(runs, { forStorage: true }).slice(-MAX_AI_EVALUATION_RUNS);
  return JSON.stringify(
    { schemaVersion: AI_EVALUATION_SCHEMA_VERSION, runs: normalized },
    null,
    normalizeJsonSpacing(spacing)
  );
}

export function createEvaluationExportBlob(runs = loadEvaluationRuns()) {
  const BlobConstructor = globalThis.Blob;
  if (typeof BlobConstructor !== 'function') return null;
  return new BlobConstructor([serializeEvaluationRuns(runs)], {
    type: 'application/json;charset=utf-8',
  });
}

export function downloadEvaluationRuns(
  filename = 'soccer-pucks-ai-sim-results.json',
  runs = loadEvaluationRuns()
) {
  const documentRef = globalThis.document;
  const urlApi = globalThis.URL;
  const blob = createEvaluationExportBlob(runs);
  if (!documentRef?.createElement || !urlApi?.createObjectURL || !blob) return false;

  const link = documentRef.createElement('a');
  const url = urlApi.createObjectURL(blob);
  link.href = url;
  link.download = cleanFilename(filename) || 'soccer-pucks-ai-sim-results.json';
  link.hidden = true;
  documentRef.body?.appendChild(link);
  link.click();
  link.remove();
  globalThis.setTimeout?.(() => urlApi.revokeObjectURL(url), 0);
  return true;
}

export function downloadEvaluationResults(runs = loadEvaluationRuns()) {
  return downloadEvaluationRuns('soccer-pucks-ai-sim-results.json', runs);
}

export function createEvaluationRunId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // Fall through to a locally generated RFC 4122-shaped id.
  }

  const bytes = new Uint8Array(16);
  try {
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      fillFallbackUuidBytes(bytes);
    }
  } catch {
    fillFallbackUuidBytes(bytes);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildReviewedRun(review) {
  const source = isPlainObject(review) ? review : {};
  const scenarioSource = isPlainObject(source.scenario) ? source.scenario : {};
  const aiSource = isPlainObject(source.ai) ? source.ai : {};
  const outcomeSource = selectOutcomeSource(source);
  const rubric = normalizeRubric(source, scenarioSource);
  const now = new Date().toISOString();

  return {
    id: cleanText(source.id, 128) || createEvaluationRunId(),
    scenario: {
      id: cleanText(scenarioSource.id ?? source.scenarioId, 160),
      version: positiveInteger(scenarioSource.version ?? source.scenarioVersion, 1),
      title: cleanText(scenarioSource.title ?? source.scenarioTitle, 240) || 'Untitled scenario',
      category: cleanText(scenarioSource.category ?? source.category, 80) || 'uncategorized',
    },
    setup: sanitizeStructured(
      source.setup ?? scenarioSource.setup ?? scenarioSource.initial ?? source.initialSetup
    ),
    ai: {
      revision: cleanText(aiSource.revision ?? source.aiRevision, 120) || 'unknown',
      difficulty: cleanText(aiSource.difficulty ?? source.difficulty, 40) || 'medium',
    },
    outcome: normalizeOutcome(outcomeSource, source),
    rubric,
    startedAt: normalizeTimestamp(source.startedAt, now),
    completedAt: normalizeTimestamp(source.completedAt, now),
  };
}

function selectOutcomeSource(source) {
  if (isPlainObject(source.outcome)) return source.outcome;
  if (isPlainObject(source.automatic)) return source.automatic;
  if (isPlainObject(source.automated)) return source.automated;
  return {};
}

function normalizeOutcome(outcomeSource, runSource = {}) {
  const nested = isPlainObject(outcomeSource.outcome) ? outcomeSource.outcome : {};
  const status = normalizeOutcomeStatus(
    nested.status ?? outcomeSource.status ?? runSource.status ?? runSource.result
  );
  const explicitPassed =
    nested.passed ??
    outcomeSource.passed ??
    outcomeSource.success ??
    runSource.passed ??
    runSource.success;
  const passed =
    typeof explicitPassed === 'boolean'
      ? explicitPassed
      : status === 'success'
        ? true
        : status === 'failure' || status === 'timeout'
          ? false
          : null;

  const seconds = finiteNonNegative(
    outcomeSource.simulatedSeconds ??
      outcomeSource.elapsedSeconds ??
      outcomeSource.durationSeconds ??
      runSource.simulatedSeconds ??
      runSource.elapsedSeconds
  );
  const durationMs = finiteNonNegative(outcomeSource.durationMs ?? runSource.durationMs);

  return {
    status,
    passed,
    reason: cleanText(nested.reason ?? outcomeSource.reason ?? runSource.reason, 240),
    conditionId: cleanText(
      nested.conditionId ?? outcomeSource.conditionId ?? runSource.conditionId,
      160
    ),
    simulatedSeconds: seconds ?? (durationMs == null ? null : Math.round(durationMs) / 1000),
    metrics: sanitizeStructured(outcomeSource.metrics ?? runSource.metrics),
  };
}

function normalizeRubric(runSource, scenarioSource) {
  const rubricSource = isPlainObject(runSource.rubric)
    ? runSource.rubric
    : isPlainObject(runSource.rating)
      ? runSource.rating
      : {};
  const valuesSource = isPlainObject(rubricSource.values)
    ? rubricSource.values
    : isPlainObject(runSource.ratings)
      ? runSource.ratings
      : {};
  const weightsSource = isPlainObject(rubricSource.weights) ? rubricSource.weights : {};
  const criteriaSource = Array.isArray(rubricSource.criteria)
    ? rubricSource.criteria
    : Array.isArray(runSource.ratingCriteria)
      ? runSource.ratingCriteria
      : Array.isArray(scenarioSource.ratingCriteria)
        ? scenarioSource.ratingCriteria
        : Array.isArray(scenarioSource.rubric?.criteria)
          ? scenarioSource.rubric.criteria
          : [];

  const values = {};
  for (const [rawId, rawValue] of Object.entries(valuesSource).slice(0, MAX_CRITERIA)) {
    const id = cleanCriterionId(rawId);
    const value = normalizeRating(rawValue);
    if (id && value != null) values[id] = value;
  }

  const criteria = [];
  const seen = new Set();
  for (const rawCriterion of criteriaSource.slice(0, MAX_CRITERIA)) {
    const source = typeof rawCriterion === 'string' ? { id: rawCriterion } : rawCriterion;
    if (!isPlainObject(source)) continue;
    const id = cleanCriterionId(source.id ?? source.key);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    criteria.push({
      id,
      label: cleanText(source.label ?? source.title, 120) || humanizeId(id),
      weight: normalizeWeight(source.weight ?? weightsSource[id]),
    });
  }

  for (const id of Object.keys(values)) {
    if (seen.has(id) || criteria.length >= MAX_CRITERIA) continue;
    seen.add(id);
    criteria.push({
      id,
      label: humanizeId(id),
      weight: normalizeWeight(weightsSource[id]),
    });
  }

  return {
    criteria,
    values,
    overall: weightedOverall(values, criteria),
    notes: cleanText(rubricSource.notes ?? runSource.notes, MAX_NOTES_LENGTH),
  };
}

function weightedOverall(values, criteria) {
  let weightedTotal = 0;
  let totalWeight = 0;
  const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]));

  for (const [id, value] of Object.entries(values)) {
    if (!isRating(value)) continue;
    const weight = criteriaById.get(id)?.weight ?? 1;
    weightedTotal += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? roundScore(weightedTotal / totalWeight) : null;
}

function finalizeAggregate(group) {
  group.ratedRuns.sort((a, b) => timestampValue(a.completedAt) - timestampValue(b.completedAt));
  const latestRated = group.ratedRuns.at(-1) ?? null;
  const previousRated = group.ratedRuns.at(-2) ?? null;
  const latestScore = latestRated?.rubric.overall ?? null;
  const previousScore = previousRated?.rubric.overall ?? null;
  const criterionAverages = {};
  const criterionCounts = {};
  const criterionLabels = {};

  for (const [criterionId, value] of group.criterionTotals) {
    criterionAverages[criterionId] = roundScore(value.total / value.count);
    criterionCounts[criterionId] = value.count;
    criterionLabels[criterionId] = value.label;
  }

  return {
    scenarioId: group.scenarioId,
    scenarioVersion: group.scenarioVersion,
    scenarioTitle: group.scenarioTitle,
    category: group.category,
    versions: [...group.versions].sort((a, b) => a - b),
    attempts: group.attempts,
    automatedAttempts: group.automatedAttempts,
    automatedSuccesses: group.automatedSuccesses,
    automatedSuccessRate:
      group.automatedAttempts > 0
        ? roundRatio(group.automatedSuccesses / group.automatedAttempts)
        : null,
    ratedAttempts: group.ratedAttempts,
    overallAverage:
      group.ratedAttempts > 0 ? roundScore(group.overallTotal / group.ratedAttempts) : null,
    criterionAverages,
    criterionCounts,
    criterionLabels,
    latestScore,
    previousScore,
    trend:
      Number.isFinite(latestScore) && Number.isFinite(previousScore)
        ? roundScore(latestScore - previousScore)
        : null,
    latestAt: group.latestRun?.completedAt ?? null,
    latestOutcome: group.latestRun?.outcome.status ?? null,
  };
}

function readEnvelope() {
  if (memoryDirty) return cloneEnvelope(memoryEnvelope);

  try {
    const raw = getStorage()?.getItem(AI_EVALUATION_STORAGE_KEY);
    if (!raw) {
      if (!memoryInitialized) memoryEnvelope = emptyEnvelope();
      memoryInitialized = true;
      return cloneEnvelope(memoryEnvelope);
    }

    const parsed = JSON.parse(raw);
    if (
      !isPlainObject(parsed) ||
      parsed.schemaVersion !== AI_EVALUATION_SCHEMA_VERSION ||
      !Array.isArray(parsed.runs)
    ) {
      throw new TypeError('Unsupported AI evaluation result envelope.');
    }

    memoryEnvelope = {
      schemaVersion: AI_EVALUATION_SCHEMA_VERSION,
      runs: normalizeRunList(parsed.runs, { forStorage: true }).slice(-MAX_AI_EVALUATION_RUNS),
    };
    memoryInitialized = true;
    return cloneEnvelope(memoryEnvelope);
  } catch {
    memoryInitialized = true;
    return cloneEnvelope(memoryEnvelope);
  }
}

function writeEnvelope(envelope) {
  memoryEnvelope = {
    schemaVersion: AI_EVALUATION_SCHEMA_VERSION,
    runs: normalizeRunList(envelope.runs, { forStorage: true }).slice(-MAX_AI_EVALUATION_RUNS),
  };
  memoryInitialized = true;

  try {
    const storage = getStorage();
    if (!storage) throw new TypeError('localStorage is unavailable.');
    storage.setItem(AI_EVALUATION_STORAGE_KEY, JSON.stringify(memoryEnvelope));
    memoryDirty = false;
    return 'persistent';
  } catch {
    // Saving still works for this module session when storage is blocked or full.
    memoryDirty = true;
    return 'memory';
  }
}

function normalizeRunList(runs, { forStorage = false } = {}) {
  if (!Array.isArray(runs)) return [];
  const normalized = [];
  for (const rawRun of runs) {
    const run = normalizeStoredRun(rawRun, { forStorage });
    if (run) normalized.push(run);
  }
  return normalized;
}

function normalizeStoredRun(rawRun) {
  if (!isPlainObject(rawRun) || !isPlainObject(rawRun.scenario)) return null;
  const id = cleanText(rawRun.id, 128);
  const scenarioId = cleanText(rawRun.scenario.id, 160);
  if (!id || !scenarioId) return null;

  const rubricSource = isPlainObject(rawRun.rubric) ? rawRun.rubric : {};
  const normalizedRubric = normalizeRubric(
    { rubric: rubricSource },
    { ratingCriteria: rubricSource.criteria }
  );
  const completedAt = normalizeTimestamp(rawRun.completedAt, null);
  if (!completedAt) return null;

  return {
    id,
    scenario: {
      id: scenarioId,
      version: positiveInteger(rawRun.scenario.version, 1),
      title: cleanText(rawRun.scenario.title, 240) || 'Untitled scenario',
      category: cleanText(rawRun.scenario.category, 80) || 'uncategorized',
    },
    setup: sanitizeStructured(rawRun.setup),
    ai: {
      revision: cleanText(rawRun.ai?.revision, 120) || 'unknown',
      difficulty: cleanText(rawRun.ai?.difficulty, 40) || 'medium',
    },
    outcome: normalizeOutcome(isPlainObject(rawRun.outcome) ? rawRun.outcome : {}, rawRun),
    rubric: normalizedRubric,
    startedAt: normalizeTimestamp(rawRun.startedAt, completedAt),
    completedAt,
  };
}

function sanitizeStructured(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, MAX_TEXT_LENGTH);
  if (typeof value === 'bigint') return String(value);
  if (typeof value !== 'object' || depth >= MAX_STRUCTURED_DEPTH) return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_STRUCTURED_ARRAY_LENGTH)
      .map((item) => sanitizeStructured(item, depth + 1, seen));
  }

  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_STRUCTURED_KEYS)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
    if (
      OMITTED_TRACE_KEYS.has(normalizedKey) ||
      normalizedKey === 'proto' ||
      normalizedKey === 'constructor' ||
      normalizedKey === 'prototype'
    ) {
      continue;
    }
    const sanitized = sanitizeStructured(item, depth + 1, seen);
    if (sanitized !== undefined) result[key.slice(0, 120)] = sanitized;
  }
  return result;
}

function normalizeOutcomeStatus(value) {
  const status = cleanText(value, 32).toLowerCase();
  if (status === 'passed' || status === 'complete' || status === 'completed') return 'success';
  if (status === 'failed') return 'failure';
  if (status === 'cancelled' || status === 'canceled' || status === 'stopped') return 'aborted';
  return OUTCOME_STATUSES.has(status) ? status : 'error';
}

function normalizeRating(value) {
  const rating = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return null;
  return roundScore(rating);
}

function isRating(value) {
  return Number.isFinite(value) && value >= 1 && value <= 5;
}

function normalizeWeight(value) {
  const weight = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(weight) || weight <= 0) return 1;
  return Math.min(100, Math.round(weight * 100) / 100);
}

function normalizeTimestamp(value, fallback) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback;
}

function timestampValue(value) {
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function finiteNonNegative(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 1000) / 1000 : null;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
}

function cleanCriterionId(value) {
  const id = cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ['__proto__', 'constructor', 'prototype'].includes(id) ? '' : id;
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  if (value == null) return '';
  return String(value).trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function humanizeId(id) {
  const text = String(id).replace(/[_.-]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Score';
}

function cleanFilename(value) {
  return String(value ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .slice(0, 160);
}

function roundScore(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundRatio(value) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function normalizeJsonSpacing(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10, Math.floor(number))) : 2;
}

function fillFallbackUuidBytes(bytes) {
  fallbackUuidCounter += 1;
  let seed = Date.now() + fallbackUuidCounter * 0x9e3779b1;
  for (let i = 0; i < bytes.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    bytes[i] = (seed >>> 16) ^ Math.floor(Math.random() * 256);
  }
}

function getStorage() {
  return globalThis.localStorage ?? null;
}

function emptyEnvelope() {
  return { schemaVersion: AI_EVALUATION_SCHEMA_VERSION, runs: [] };
}

function cloneEnvelope(envelope) {
  return { schemaVersion: AI_EVALUATION_SCHEMA_VERSION, runs: cloneRuns(envelope.runs) };
}

function cloneRuns(runs) {
  return runs.map((run) => cloneRun(run));
}

function cloneRun(run) {
  return {
    ...run,
    scenario: { ...run.scenario },
    setup: sanitizeStructured(run.setup),
    ai: { ...run.ai },
    outcome: { ...run.outcome, metrics: sanitizeStructured(run.outcome.metrics) },
    rubric: {
      ...run.rubric,
      criteria: run.rubric.criteria.map((criterion) => ({ ...criterion })),
      values: { ...run.rubric.values },
    },
  };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
