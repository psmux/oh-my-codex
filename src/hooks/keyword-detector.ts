/**
 * Keyword Detection Engine
 *
 * In OMC, this runs as a UserPromptSubmit hook that detects magic keywords
 * and injects skill prompts via system-reminder.
 *
 * In OMX, this logic is embedded in the AGENTS.md orchestration brain,
 * and can also be used by the notify hook for state tracking.
 *
 * When Codex CLI adds pre-hook support, this module can be promoted
 * to an external hook handler.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { classifyTaskSize, isHeavyMode, type TaskSizeResult, type TaskSizeThresholds } from './task-size-detector.js';
import { isApprovedExecutionFollowupShortcut, type FollowupMode } from '../team/followup-planner.js';
import { isPlanningComplete, readPlanningArtifacts } from '../planning/artifacts.js';
import { KEYWORD_TRIGGER_DEFINITIONS, compareKeywordMatches } from './keyword-registry.js';
import {
  SKILL_ACTIVE_STATE_FILE,
  writeSkillActiveStateCopies,
  type SkillActiveEntry,
} from '../state/skill-active.js';

export interface KeywordMatch {
  keyword: string;
  skill: string;
  priority: number;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export type SkillActivePhase = 'planning' | 'executing' | 'reviewing' | 'completing';

export interface DeepInterviewInputLock {
  active: boolean;
  scope: 'deep-interview-auto-approval';
  acquired_at: string;
  released_at?: string;
  exit_reason?: 'success' | 'error' | 'abort' | 'handoff';
  blocked_inputs: string[];
  message: string;
}

export interface SkillActiveState {
  version: 1;
  active: boolean;
  skill: string;
  keyword: string;
  phase: SkillActivePhase;
  activated_at: string;
  updated_at: string;
  source: 'keyword-detector';
  session_id?: string;
  thread_id?: string;
  turn_id?: string;
  input_lock?: DeepInterviewInputLock;
  active_skills?: SkillActiveEntry[];
  initialized_mode?: string;
  initialized_state_path?: string;
  [key: string]: unknown;
}

export interface RecordSkillActivationInput {
  stateDir: string;
  text: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  nowIso?: string;
}

export const DEEP_INTERVIEW_STATE_FILE = 'deep-interview-state.json';
export const DEEP_INTERVIEW_BLOCKED_APPROVAL_INPUTS = ['yes', 'y', 'proceed', 'continue', 'ok', 'sure', 'go ahead', 'next i should'] as const;
export const DEEP_INTERVIEW_INPUT_LOCK_MESSAGE = 'Deep interview is active; auto-approval shortcuts are blocked until the interview finishes.';

type StatefulSkillMode = 'deep-interview' | 'autopilot' | 'ralph' | 'ralplan' | 'ultrawork' | 'ultraqa' | 'team';

interface StatefulSkillSeedConfig {
  mode: StatefulSkillMode;
  initialPhase: string;
  includeIteration?: boolean;
  scope?: 'session' | 'root';
}

const STATEFUL_SKILL_SEED_CONFIG: Record<StatefulSkillMode, StatefulSkillSeedConfig> = {
  'deep-interview': { mode: 'deep-interview', initialPhase: 'intent-first' },
  autopilot: { mode: 'autopilot', initialPhase: 'planning' },
  ralph: { mode: 'ralph', initialPhase: 'starting', includeIteration: true },
  ralplan: { mode: 'ralplan', initialPhase: 'planning' },
  team: { mode: 'team', initialPhase: 'starting', scope: 'root' },
  ultrawork: { mode: 'ultrawork', initialPhase: 'planning' },
  ultraqa: { mode: 'ultraqa', initialPhase: 'planning' },
};

interface DeepInterviewModeState {
  active: boolean;
  mode: 'deep-interview';
  current_phase: string;
  started_at: string;
  updated_at: string;
  completed_at?: string;
  session_id?: string;
  thread_id?: string;
  turn_id?: string;
  input_lock?: DeepInterviewInputLock;
}

function createDeepInterviewInputLock(nowIso: string, previous?: DeepInterviewInputLock): DeepInterviewInputLock {
  return {
    active: true,
    scope: 'deep-interview-auto-approval',
    acquired_at: previous?.active ? previous.acquired_at : nowIso,
    blocked_inputs: [...DEEP_INTERVIEW_BLOCKED_APPROVAL_INPUTS],
    message: DEEP_INTERVIEW_INPUT_LOCK_MESSAGE,
  };
}

function releaseDeepInterviewInputLock(
  previous: DeepInterviewInputLock | undefined,
  nowIso: string,
  reason: DeepInterviewInputLock['exit_reason'] = 'handoff',
): DeepInterviewInputLock | undefined {
  if (!previous) return undefined;
  return {
    ...previous,
    active: false,
    released_at: nowIso,
    exit_reason: reason,
  };
}

async function readExistingSkillState(statePath: string): Promise<SkillActiveState | null> {
  try {
    const raw = await readFile(statePath, 'utf-8');
    return JSON.parse(raw) as SkillActiveState;
  } catch {
    return null;
  }
}

function buildActiveSkills(state: SkillActiveState): SkillActiveEntry[] | undefined {
  if (!state.active) return undefined;
  return [{
    skill: state.skill,
    phase: state.phase,
    active: true,
    activated_at: state.activated_at,
    updated_at: state.updated_at,
    session_id: state.session_id,
    thread_id: state.thread_id,
    turn_id: state.turn_id,
  }];
}

async function readExistingDeepInterviewState(statePath: string): Promise<DeepInterviewModeState | null> {
  try {
    const raw = await readFile(statePath, 'utf-8');
    return JSON.parse(raw) as DeepInterviewModeState;
  } catch {
    return null;
  }
}

async function readJsonStateIfExists(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function persistDeepInterviewModeState(
  stateDir: string,
  nextSkill: SkillActiveState | null,
  nowIso: string,
  previousSkill: SkillActiveState | null,
  input: RecordSkillActivationInput,
): Promise<void> {
  const statePath = join(stateDir, DEEP_INTERVIEW_STATE_FILE);
  const previousModeState = await readExistingDeepInterviewState(statePath);

  if (nextSkill?.skill === 'deep-interview' && nextSkill.active) {
    const nextState: DeepInterviewModeState = {
      active: true,
      mode: 'deep-interview',
      current_phase: previousModeState?.active ? previousModeState.current_phase || 'intent-first' : 'intent-first',
      started_at: previousModeState?.active ? previousModeState.started_at || nowIso : nowIso,
      updated_at: nowIso,
      session_id: input.sessionId ?? previousModeState?.session_id,
      thread_id: input.threadId ?? previousModeState?.thread_id,
      turn_id: input.turnId ?? previousModeState?.turn_id,
      ...(nextSkill.input_lock ? { input_lock: nextSkill.input_lock } : {}),
    };
    await writeFile(statePath, JSON.stringify(nextState, null, 2));
    return;
  }

  const hadActiveDeepInterview = previousSkill?.skill === 'deep-interview' && previousSkill.active === true;
  if (!previousModeState?.active && !hadActiveDeepInterview) return;

  const releasedInputLock = nextSkill?.skill === 'deep-interview' ? nextSkill.input_lock : previousSkill?.input_lock;
  const nextState: DeepInterviewModeState = {
    active: false,
    mode: 'deep-interview',
    current_phase: 'completing',
    started_at: previousModeState?.started_at || previousSkill?.activated_at || nowIso,
    updated_at: nowIso,
    completed_at: nowIso,
    session_id: input.sessionId ?? previousModeState?.session_id ?? previousSkill?.session_id,
    thread_id: input.threadId ?? previousModeState?.thread_id ?? previousSkill?.thread_id,
    turn_id: input.turnId ?? previousModeState?.turn_id ?? previousSkill?.turn_id,
    ...(releasedInputLock ? { input_lock: releasedInputLock } : {}),
  };
  await writeFile(statePath, JSON.stringify(nextState, null, 2));
}

function resolveSeedStateFilePath(
  stateDir: string,
  mode: StatefulSkillMode,
  sessionId?: string,
  scope: 'session' | 'root' = 'session',
): {
  absolutePath: string;
  relativePath: string;
} {
  if (scope !== 'root' && sessionId?.trim()) {
    return {
      absolutePath: join(stateDir, 'sessions', sessionId, `${mode}-state.json`),
      relativePath: `.omx/state/sessions/${sessionId}/${mode}-state.json`,
    };
  }

  return {
    absolutePath: join(stateDir, `${mode}-state.json`),
    relativePath: `.omx/state/${mode}-state.json`,
  };
}

async function persistStatefulSkillSeedState(
  stateDir: string,
  nextSkill: SkillActiveState,
  nowIso: string,
  previousSkill: SkillActiveState | null,
): Promise<SkillActiveState> {
  const config = STATEFUL_SKILL_SEED_CONFIG[nextSkill.skill as StatefulSkillMode];
  if (!config) return nextSkill;

  const { absolutePath, relativePath } = resolveSeedStateFilePath(
    stateDir,
    config.mode,
    nextSkill.session_id,
    config.scope,
  );
  const existingModeState = await readJsonStateIfExists(absolutePath);
  const sameActiveSkill = previousSkill?.skill === nextSkill.skill && previousSkill.active;
  const existingModeMatches = safeString(existingModeState?.mode).trim() === config.mode;
  const existingPhase = safeString(existingModeState?.current_phase).trim();
  const preserveExistingModeState = existingModeMatches
    && existingPhase !== ''
    && (
      sameActiveSkill
      || (config.mode === 'team' && existingModeState?.active === true)
    );
  const startedAt = previousSkill?.skill === nextSkill.skill && previousSkill.active
    ? safeString(existingModeState?.started_at).trim() || previousSkill.activated_at || nowIso
    : preserveExistingModeState
      ? safeString(existingModeState?.started_at).trim() || nowIso
    : nowIso;

  const baseState: Record<string, unknown> = {
    ...(preserveExistingModeState ? existingModeState : {}),
    active: true,
    mode: config.mode,
    current_phase: preserveExistingModeState
      ? existingPhase || config.initialPhase
      : config.initialPhase,
    started_at: startedAt,
    updated_at: nowIso,
    session_id: nextSkill.session_id || safeString(existingModeState?.session_id).trim() || undefined,
    thread_id: nextSkill.thread_id || safeString(existingModeState?.thread_id).trim() || undefined,
    turn_id: nextSkill.turn_id || safeString(existingModeState?.turn_id).trim() || undefined,
  };

  if (config.includeIteration) {
    baseState.iteration = typeof existingModeState?.iteration === 'number' ? existingModeState.iteration : 0;
    baseState.max_iterations = typeof existingModeState?.max_iterations === 'number' ? existingModeState.max_iterations : 50;
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(baseState, null, 2));

  return {
    ...nextSkill,
    initialized_mode: config.mode,
    initialized_state_path: relativePath,
  };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && /[A-Za-z0-9_]/.test(ch));
}

function keywordToPattern(keyword: string): RegExp {
  const escaped = escapeRegex(keyword);
  const startsWithWord = isWordChar(keyword[0]);
  const endsWithWord = isWordChar(keyword[keyword.length - 1]);
  const prefix = startsWithWord ? '\\b' : '';
  const suffix = endsWithWord ? '\\b' : '';
  return new RegExp(`${prefix}${escaped}${suffix}`, 'i');
}

const KEYWORD_MAP: Array<{ pattern: RegExp; skill: string; priority: number }> = KEYWORD_TRIGGER_DEFINITIONS.map((entry) => ({
  pattern: keywordToPattern(entry.keyword),
  skill: entry.skill,
  priority: entry.priority,
}));

const KEYWORDS_REQUIRING_INTENT = new Set(['team', 'swarm']);

const TEAM_SWARM_INTENT_PATTERNS: Record<'team' | 'swarm', RegExp[]> = {
  team: [
    /(?:^|[^\w])\$(?:team)\b/i,
    /\/prompts:team\b/i,
    /\b(?:use|run|start|enable|launch|invoke|activate|orchestrate|coordinate)\s+(?:a\s+|an\s+|the\s+)?team\b/i,
    /\bteam\s+(?:mode|orchestration|workflow|agents?)\b/i,
  ],
  swarm: [
    /(?:^|[^\w])\$(?:swarm)\b/i,
    /\/prompts:swarm\b/i,
    /\b(?:use|run|start|enable|launch|invoke|activate|orchestrate|coordinate)\s+(?:a\s+|an\s+|the\s+)?swarm\b/i,
    /\bswarm\s+(?:mode|orchestration|workflow|agents?)\b/i,
  ],
};

function hasExplicitPromptsInvocation(text: string): boolean {
  return /(?:^|\s)\/prompts:[\w.-]+(?=[\s.,!?;:]|$)/i.test(text);
}

function hasExplicitSkillLikeInvocation(text: string): boolean {
  return /(?:^|[^\w])\$([a-z][a-z0-9-]*)\b/i.test(text);
}

function extractExplicitSkillInvocations(text: string): KeywordMatch[] {
  const results: KeywordMatch[] = [];
  const regex = /(?:^|[^\w])\$([a-z][a-z0-9-]*)\b/gi;
  let match: RegExpExecArray | null;
  let captureStarted = false;
  let lastMatchEnd = -1;

  while ((match = regex.exec(text)) !== null) {
    const token = (match[1] ?? '').toLowerCase();
    if (!token) continue;

    const normalizedSkill = token === 'swarm' ? 'team' : token;
    const registryEntry = KEYWORD_TRIGGER_DEFINITIONS.find((entry) => entry.skill.toLowerCase() === normalizedSkill);
    if (!registryEntry) continue;

    const matchStart = match.index + match[0].lastIndexOf('$');
    if (captureStarted) {
      const between = text.slice(lastMatchEnd, matchStart);
      if (!/^\s*$/.test(between)) break;
    }

    captureStarted = true;
    lastMatchEnd = matchStart + token.length + 1;

    if (results.some((item) => item.skill === normalizedSkill)) continue;

    results.push({
      keyword: `$${token}`,
      skill: normalizedSkill,
      priority: registryEntry.priority,
    });
  }

  return results;
}

function hasIntentContextForKeyword(text: string, keyword: string): boolean {
  if (!KEYWORDS_REQUIRING_INTENT.has(keyword.toLowerCase())) return true;
  const k = keyword.toLowerCase() as 'team' | 'swarm';
  return TEAM_SWARM_INTENT_PATTERNS[k].some((pattern) => pattern.test(text));
}

/**
 * Detect keywords in user input text
 * Returns explicit `$skill` matches first (left-to-right),
 * then appends implicit keyword matches sorted by priority.
 */
export function detectKeywords(text: string): KeywordMatch[] {
  const explicit = extractExplicitSkillInvocations(text);
  if (hasExplicitPromptsInvocation(text) && explicit.length === 0) {
    return [];
  }
  if (explicit.length === 0 && hasExplicitSkillLikeInvocation(text)) {
    return [];
  }
  if (explicit.length > 0) {
    return explicit;
  }

  const implicit: KeywordMatch[] = [];

  for (const { pattern, skill, priority } of KEYWORD_MAP) {
    const match = text.match(pattern);
    if (match) {
      if (!hasIntentContextForKeyword(text, match[0].toLowerCase())) continue;
      implicit.push({
        keyword: match[0],
        skill,
        priority,
      });
    }
  }

  const merged: KeywordMatch[] = [...explicit];
  const sortedImplicit = implicit.sort(compareKeywordMatches);
  for (const item of sortedImplicit) {
    if (merged.some((existing) => existing.skill === item.skill)) continue;
    merged.push(item);
  }

  return merged;
}

/**
 * Get the highest-priority keyword match
 */
export function detectPrimaryKeyword(text: string): KeywordMatch | null {
  const matches = detectKeywords(text);
  return matches.length > 0 ? matches[0] : null;
}

export async function recordSkillActivation(input: RecordSkillActivationInput): Promise<SkillActiveState | null> {
  const match = detectPrimaryKeyword(input.text);
  if (!match) return null;

  const nowIso = input.nowIso ?? new Date().toISOString();
  const statePath = join(input.stateDir, SKILL_ACTIVE_STATE_FILE);
  const previous = await readExistingSkillState(statePath);
  const hadDeepInterviewLock = previous?.skill === 'deep-interview' && previous?.input_lock?.active === true;
  const matches = detectKeywords(input.text);
  const hasCancelIntent = matches.some((entry) => entry.skill === 'cancel');

  if (hasCancelIntent && hadDeepInterviewLock) {
    const state: SkillActiveState = {
      version: 1,
      active: false,
      skill: 'deep-interview',
      keyword: previous?.keyword || 'deep interview',
      phase: 'completing',
      activated_at: previous?.activated_at || nowIso,
      updated_at: nowIso,
      source: 'keyword-detector',
      session_id: input.sessionId ?? previous?.session_id,
      thread_id: input.threadId ?? previous?.thread_id,
      turn_id: input.turnId ?? previous?.turn_id,
      active_skills: [],
      ...(previous?.input_lock ? { input_lock: releaseDeepInterviewInputLock(previous.input_lock, nowIso, 'abort') } : {}),
    };

    try {
      await writeSkillActiveStateCopies(dirname(dirname(input.stateDir)), state, input.sessionId);
      await persistDeepInterviewModeState(input.stateDir, state, nowIso, previous, input);
    } catch (error) {
      console.warn('[omx] warning: failed to persist keyword activation state', error);
    }

    return state;
  }

  const sameSkill = previous?.active === true && previous.skill === match.skill;
  const sameKeyword = previous?.keyword?.toLowerCase() === match.keyword.toLowerCase();

  const deepInterviewInputLock = match.skill === 'deep-interview'
    ? createDeepInterviewInputLock(nowIso, previous?.input_lock)
    : releaseDeepInterviewInputLock(previous?.input_lock, nowIso);

  const state: SkillActiveState = {
    version: 1,
    active: true,
    skill: match.skill,
    keyword: match.keyword,
    phase: 'planning',
    activated_at: sameSkill && sameKeyword ? previous.activated_at : nowIso,
    updated_at: nowIso,
    source: 'keyword-detector',
    session_id: input.sessionId,
    thread_id: input.threadId,
    turn_id: input.turnId,
    active_skills: [{
      skill: match.skill,
      phase: 'planning',
      active: true,
      activated_at: sameSkill && sameKeyword ? previous?.activated_at : nowIso,
      updated_at: nowIso,
      session_id: input.sessionId,
      thread_id: input.threadId,
      turn_id: input.turnId,
    }],
    ...(deepInterviewInputLock ? { input_lock: deepInterviewInputLock } : {}),
  };

  try {
    const nextState = await persistStatefulSkillSeedState(input.stateDir, state, nowIso, previous);
    nextState.active_skills = buildActiveSkills(nextState);
    await writeSkillActiveStateCopies(dirname(dirname(input.stateDir)), nextState, input.sessionId);
    await persistDeepInterviewModeState(input.stateDir, nextState, nowIso, previous, input);
    return nextState;
  } catch (error) {
    console.warn('[omx] warning: failed to persist keyword activation state', error);
  }

  return state;
}

/**
 * Pre-execution gate — ported from OMC src/hooks/keyword-detector/index.ts
 *
 * In OMC these functions run at prompt time in bridge.ts (mandatory enforcement).
 * In OMX they generate AGENTS.md instructions and serve as test infrastructure.
 * See task-size-detector.ts for full advisory-nature documentation.
 */

/**
 * Execution mode keywords subject to the ralplan-first gate.
 * These modes spin up heavy orchestration and should not run on vague requests.
 */
export const EXECUTION_GATE_KEYWORDS = new Set<string>([
  'ralph',
  'autopilot',
  'team',
  'ultrawork',
]);

/**
 * Escape hatch prefixes that bypass the ralplan gate.
 */
export const GATE_BYPASS_PREFIXES = ['force:', '!'];

/**
 * Positive signals that the prompt IS well-specified enough for direct execution.
 * If ANY of these are present, the prompt auto-passes the gate (fast path).
 */
export const WELL_SPECIFIED_SIGNALS: RegExp[] = [
  // References specific files by extension
  /\b[\w/.-]+\.(?:ts|js|py|go|rs|java|tsx|jsx|vue|svelte|rb|c|cpp|h|css|scss|html|json|yaml|yml|toml)\b/,
  // References specific paths with directory separators
  /(?:src|lib|test|spec|app|pages|components|hooks|utils|services|api|dist|build|scripts)\/\w+/,
  // References specific functions/classes/methods by keyword
  /\b(?:function|class|method|interface|type|const|let|var|def|fn|struct|enum)\s+\w{2,}/i,
  // CamelCase identifiers (likely symbol names: processKeyword, getUserById)
  /\b[a-z]+(?:[A-Z][a-z]+)+\b/,
  // PascalCase identifiers (likely class/type names: KeywordDetector, UserModel)
  /\b[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+\b/,
  // snake_case identifiers with 2+ segments (likely symbol names: user_model, get_user)
  /\b[a-z]+(?:_[a-z]+)+\b/,
  // Bare issue/PR number (#123, #42)
  /(?:^|\s)#\d+\b/,
  // Has numbered steps or bullet list (structured request)
  /(?:^|\n)\s*(?:\d+[.)]\s|-\s+\S|\*\s+\S)/m,
  // Has acceptance criteria or test spec keywords
  /\b(?:acceptance\s+criteria|test\s+(?:spec|plan|case)|should\s+(?:return|throw|render|display|create|delete|update))\b/i,
  // Has specific error or issue reference
  /\b(?:error:|bug\s*#?\d+|issue\s*#\d+|stack\s*trace|exception|TypeError|ReferenceError|SyntaxError)\b/i,
  // Has a code block with substantial content
  /```[\s\S]{20,}?```/,
  // PR or commit reference
  /\b(?:PR\s*#\d+|commit\s+[0-9a-f]{7}|pull\s+request)\b/i,
  // "in <specific-path>" pattern
  /\bin\s+[\w/.-]+\.(?:ts|js|py|go|rs|java|tsx|jsx)\b/,
  // Test runner commands (explicit test target)
  /\b(?:npm\s+test|npx\s+(?:vitest|jest)|pytest|cargo\s+test|go\s+test|make\s+test)\b/i,
];

/**
 * Check if a prompt is underspecified for direct execution.
 * Returns true if the prompt lacks enough specificity for heavy execution modes.
 *
 * Conservative: only gates clearly vague prompts. Borderline cases pass through.
 */
export function isUnderspecifiedForExecution(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  // Escape hatch: force: or ! prefix bypasses the gate
  for (const prefix of GATE_BYPASS_PREFIXES) {
    if (trimmed.startsWith(prefix)) return false;
  }

  // If any well-specified signal is present, pass through
  if (WELL_SPECIFIED_SIGNALS.some(p => p.test(trimmed))) return false;

  // Strip mode keywords for effective word counting
  const stripped = trimmed
    .replace(/\b(?:ralph|autopilot|team|ultrawork|ulw|swarm)\b/gi, '')
    .trim();
  const effectiveWords = stripped.split(/\s+/).filter(w => w.length > 0).length;

  // Short prompts without well-specified signals are underspecified
  if (effectiveWords <= 15) return true;

  return false;
}

/**
 * Apply the ralplan-first gate: if execution keywords are present
 * but the prompt is underspecified, redirect to ralplan.
 *
 * Returns the modified keyword list and gate metadata.
 */
export interface ApplyRalplanGateOptions {
  cwd?: string;
  priorSkill?: string | null;
}

export function applyRalplanGate(
  keywords: string[],
  text: string,
  options: ApplyRalplanGateOptions = {},
): { keywords: string[]; gateApplied: boolean; gatedKeywords: string[] } {
  if (keywords.length === 0) {
    return { keywords, gateApplied: false, gatedKeywords: [] };
  }

  // Don't gate if cancel is present (cancel always wins)
  if (keywords.includes('cancel')) {
    return { keywords, gateApplied: false, gatedKeywords: [] };
  }

  // Don't gate if ralplan is already in the list
  if (keywords.includes('ralplan')) {
    return { keywords, gateApplied: false, gatedKeywords: [] };
  }

  // Check if any execution keywords are present
  const executionKeywords = keywords.filter(k => EXECUTION_GATE_KEYWORDS.has(k));
  if (executionKeywords.length === 0) {
    return { keywords, gateApplied: false, gatedKeywords: [] };
  }

  // Check if prompt is underspecified
  if (!isUnderspecifiedForExecution(text)) {
    return { keywords, gateApplied: false, gatedKeywords: [] };
  }

  const planningComplete = isPlanningComplete(readPlanningArtifacts(options.cwd ?? process.cwd()));
  const shortFollowupBypasses = executionKeywords.filter((keyword) => {
    const normalizedKeyword = keyword === 'swarm' ? 'team' : keyword;
    if (normalizedKeyword !== 'team' && normalizedKeyword !== 'ralph') return false;
    return isApprovedExecutionFollowupShortcut(
      normalizedKeyword as FollowupMode,
      text,
      {
        planningComplete,
        priorSkill: options.priorSkill,
      },
    );
  });
  if (shortFollowupBypasses.length > 0) {
    return { keywords, gateApplied: false, gatedKeywords: [] };
  }

  // Gate: replace execution keywords with ralplan
  const filtered = keywords.filter(k => !EXECUTION_GATE_KEYWORDS.has(k));
  if (!filtered.includes('ralplan')) {
    filtered.push('ralplan');
  }

  return { keywords: filtered, gateApplied: true, gatedKeywords: executionKeywords };
}

/**
 * Options for task-size-aware keyword filtering
 */
export interface TaskSizeFilterOptions {
  /** Enable task-size detection. Default: true */
  enabled?: boolean;
  /** Word count threshold for small tasks. Default: 50 */
  smallWordLimit?: number;
  /** Word count threshold for large tasks. Default: 200 */
  largeWordLimit?: number;
  /** Suppress heavy modes for small tasks. Default: true */
  suppressHeavyModesForSmallTasks?: boolean;
}

/**
 * Get all keywords with task-size-based filtering applied.
 * For small tasks, heavy orchestration modes (ralph/autopilot/team/ultrawork etc.)
 * are suppressed to avoid over-orchestration.
 */
export function getAllKeywordsWithSizeCheck(
  text: string,
  options: TaskSizeFilterOptions = {},
): { keywords: string[]; taskSizeResult: TaskSizeResult | null; suppressedKeywords: string[] } {
  const {
    enabled = true,
    smallWordLimit = 50,
    largeWordLimit = 200,
    suppressHeavyModesForSmallTasks = true,
  } = options;

  const keywords = detectKeywords(text).map(m => m.skill);

  if (!enabled || !suppressHeavyModesForSmallTasks || keywords.length === 0) {
    return { keywords, taskSizeResult: null, suppressedKeywords: [] };
  }

  const thresholds: TaskSizeThresholds = { smallWordLimit, largeWordLimit };
  const taskSizeResult = classifyTaskSize(text, thresholds);

  // Only suppress heavy modes for small tasks
  if (taskSizeResult.size !== 'small') {
    return { keywords, taskSizeResult, suppressedKeywords: [] };
  }

  const suppressedKeywords: string[] = [];
  const filteredKeywords = keywords.filter(keyword => {
    if (isHeavyMode(keyword)) {
      suppressedKeywords.push(keyword);
      return false;
    }
    return true;
  });

  return {
    keywords: filteredKeywords,
    taskSizeResult,
    suppressedKeywords,
  };
}
