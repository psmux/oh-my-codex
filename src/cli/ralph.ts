import { startMode, updateModeState } from '../modes/base.js';
import { ensureCanonicalRalphArtifacts } from '../ralph/persistence.js';

export const RALPH_HELP = `omx ralph - Launch Codex with ralph persistence mode active

Usage:
  omx ralph [task text...]
  omx ralph --prd "<task text>"
  omx ralph [ralph-options] [codex-args...] [task text...]

Options:
  --help, -h           Show this help message
  --prd <task text>    PRD mode shortcut: mark the task text explicitly
  --prd=<task text>    Same as --prd "<task text>"
  -i <path>     Reference image path for visual iteration guidance (repeatable)
  --images-dir <dir>  Directory containing reference images for visual tasks

PRD mode:
  Ralph initializes persistence artifacts in .omx/ so PRD and progress
  state can survive across Codex sessions. Provide task text either as
  positional words or with --prd.

Common patterns:
  omx ralph "Fix flaky notify-hook tests"
  omx ralph --prd "Ship release checklist automation"
  omx ralph --model gpt-5 "Refactor state hydration"
  omx ralph -- --task-with-leading-dash
`;

/**
 * Codex CLI flags that consume the next argv token as their value.
 * Both long (--flag value) and short (-f value) forms are listed.
 * Flags using --flag=value syntax are handled generically.
 */
const VALUE_TAKING_FLAGS = new Set([
  '--model',
  '--provider',
  '--config',
  '-c',            // codex -c key=value
  '-i',            // images-dir short form
  '--images-dir',
]);

/**
 * Extract the human-readable task description from ralph CLI argv,
 * excluding option flags and their values.
 *
 * Supports:
 *  - `--` separator: everything after `--` is treated as task text
 *  - `--flag=value` syntax: the entire token is skipped
 *  - `--flag value` / `-f value` for known VALUE_TAKING_FLAGS: both tokens skipped
 *  - Unknown flags (e.g. `--yolo`): skipped as boolean flags
 *  - Positional tokens (not starting with `-`): collected as task text
 */
export function extractRalphTaskDescription(args: readonly string[]): string {
  const words: string[] = [];
  let i = 0;

  while (i < args.length) {
    const token = args[i];

    // `--` separator: everything remaining is task text
    if (token === '--') {
      for (let j = i + 1; j < args.length; j++) {
        words.push(args[j]);
      }
      break;
    }

    // --flag=value: skip entire token
    if (token.startsWith('--') && token.includes('=')) {
      i++;
      continue;
    }

    // Known value-taking flag: skip this token and the next (its value)
    if (token.startsWith('-') && VALUE_TAKING_FLAGS.has(token)) {
      i += 2; // skip flag + value
      continue;
    }

    // Any other flag: skip as boolean
    if (token.startsWith('-')) {
      i++;
      continue;
    }

    // Positional argument: part of the task description
    words.push(token);
    i++;
  }

  return words.join(' ') || 'ralph-cli-launch';
}

export function normalizeRalphCliArgs(args: readonly string[]): string[] {
  const normalized: string[] = [];
  let i = 0;

  while (i < args.length) {
    const token = args[i];

    if (token === '--prd') {
      const next = args[i + 1];
      if (next && next !== '--' && !next.startsWith('-')) {
        normalized.push(next);
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (token.startsWith('--prd=')) {
      const value = token.slice('--prd='.length);
      if (value.length > 0) {
        normalized.push(value);
      }
      i++;
      continue;
    }

    normalized.push(token);
    i++;
  }

  return normalized;
}

export interface RalphLaunchVisualConfig {
  referenceImages: string[];
  imagesDir?: string;
}

export function parseRalphLaunchVisualConfig(args: string[]): RalphLaunchVisualConfig {
  const referenceImages: string[] = [];
  let imagesDir: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i] ?? '';
    if (token === '-i') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        referenceImages.push(next);
        i += 1;
      }
      continue;
    }
    if (token.startsWith('-i=')) {
      const value = token.slice(3).trim();
      if (value) referenceImages.push(value);
      continue;
    }
    if (token === '--images-dir') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        imagesDir = next;
        i += 1;
      }
      continue;
    }
    if (token.startsWith('--images-dir=')) {
      const value = token.slice('--images-dir='.length).trim();
      if (value) imagesDir = value;
      continue;
    }
  }

  return { referenceImages, imagesDir };
}

export async function ralphCommand(args: string[]): Promise<void> {
  const normalizedArgs = normalizeRalphCliArgs(args);
  const cwd = process.cwd();

  if (normalizedArgs[0] === '--help' || normalizedArgs[0] === '-h') {
    console.log(RALPH_HELP);
    return;
  }

  // Initialize ralph persistence artifacts (state dirs, legacy PRD/progress migration)
  const artifacts = await ensureCanonicalRalphArtifacts(cwd);
  const visualConfig = parseRalphLaunchVisualConfig(args);

  // Write initial ralph mode state
  const task = extractRalphTaskDescription(normalizedArgs);
  await startMode('ralph', task, 50);
  await updateModeState('ralph', {
    current_phase: 'starting',
    canonical_progress_path: artifacts.canonicalProgressPath,
    visual_iteration: {
      reference_images: visualConfig.referenceImages,
      ...(visualConfig.imagesDir ? { images_dir: visualConfig.imagesDir } : {}),
      pass_threshold: 90,
    },
    ...(artifacts.canonicalPrdPath ? { canonical_prd_path: artifacts.canonicalPrdPath } : {}),
  });

  if (artifacts.migratedPrd) {
    console.log(`[ralph] Migrated legacy PRD -> ${artifacts.canonicalPrdPath}`);
  }
  if (artifacts.migratedProgress) {
    console.log(`[ralph] Migrated legacy progress -> ${artifacts.canonicalProgressPath}`);
  }

  console.log('[ralph] Ralph persistence mode active. Launching Codex...');

  // Dynamic import avoids a circular dependency with index.ts
  const { launchWithHud } = await import('./index.js');
  await launchWithHud(normalizedArgs);
}
