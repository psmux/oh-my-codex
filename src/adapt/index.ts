import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADAPT_SCHEMA_VERSION,
  type AdaptDoctorIssue,
  type AdaptDoctorReport,
  type AdaptEnvelope,
  type AdaptInitResult,
  type AdaptPlanningLink,
  type AdaptProbeReport,
  type AdaptStatusReport,
  type AdaptTarget,
} from "./contracts.js";
import { getAdaptTargetDescriptor, listAdaptTargets } from "./registry.js";
import { resolveAdaptPaths } from "./paths.js";
import { readLatestPlanningArtifacts } from "../planning/artifacts.js";

const FOUNDATION_CONSTRAINTS = [
  "Thin adapter surface only; no bidirectional control plane is claimed in this foundation PR.",
  "No direct writes to .omx/state/... or target runtime internals.",
  "Capability reporting is asymmetric: OMX-owned, shared-contract, and target-observed surfaces are reported separately.",
];

function toIsoTimestamp(now = new Date()): string {
  return now.toISOString();
}

export function supportedAdaptTargets(): string[] {
  return listAdaptTargets().map((descriptor) => descriptor.target);
}

export function buildAdaptPlanningLink(cwd: string): AdaptPlanningLink {
  const selection = readLatestPlanningArtifacts(cwd);
  if (!selection.prdPath) {
    return {
      prdPath: null,
      testSpecPaths: [],
      deepInterviewSpecPaths: [],
      summary: "No canonical OMX PRD/test-spec artifacts are present in this worktree.",
    };
  }

  const testSpecSummary = selection.testSpecPaths.length > 0
    ? `${selection.testSpecPaths.length} matching test spec artifact(s) linked.`
    : "PRD detected, but no matching test spec artifact was found for its slug.";

  return {
    prdPath: selection.prdPath,
    testSpecPaths: selection.testSpecPaths,
    deepInterviewSpecPaths: selection.deepInterviewSpecPaths,
    summary: testSpecSummary,
  };
}

export function buildAdaptEnvelope(
  cwd: string,
  target: AdaptTarget,
  now = new Date(),
): AdaptEnvelope {
  const descriptor = getAdaptTargetDescriptor(target);
  if (!descriptor) {
    throw new Error(`Unknown adapt target: ${target}`);
  }

  return {
    schemaVersion: ADAPT_SCHEMA_VERSION,
    generatedAt: toIsoTimestamp(now),
    target,
    displayName: descriptor.displayName,
    summary: descriptor.summary,
    adapterPaths: resolveAdaptPaths(cwd, target),
    planning: buildAdaptPlanningLink(cwd),
    capabilities: descriptor.capabilities,
    constraints: FOUNDATION_CONSTRAINTS,
  };
}

export function buildAdaptProbeReport(
  cwd: string,
  target: AdaptTarget,
  now = new Date(),
): AdaptProbeReport {
  const descriptor = getAdaptTargetDescriptor(target);
  if (!descriptor) {
    throw new Error(`Unknown adapt target: ${target}`);
  }

  return {
    schemaVersion: ADAPT_SCHEMA_VERSION,
    timestamp: toIsoTimestamp(now),
    target,
    phase: "foundation",
    summary: `${descriptor.displayName} probe foundation is available, but target-specific runtime probing is deferred.`,
    adapterPaths: resolveAdaptPaths(cwd, target),
    planning: buildAdaptPlanningLink(cwd),
    capabilities: descriptor.capabilities,
    targetRuntime: {
      state: "not-implemented",
      detail: descriptor.followupHint,
    },
    nextSteps: [
      `Run omx adapt ${target} init --write to materialize OMX-owned adapter artifacts.`,
      descriptor.followupHint,
    ],
  };
}

export function buildAdaptStatusReport(
  cwd: string,
  target: AdaptTarget,
  now = new Date(),
): AdaptStatusReport {
  const descriptor = getAdaptTargetDescriptor(target);
  if (!descriptor) {
    throw new Error(`Unknown adapt target: ${target}`);
  }

  const paths = resolveAdaptPaths(cwd, target);
  const initialized = existsSync(paths.configPath) && existsSync(paths.envelopePath);

  return {
    schemaVersion: ADAPT_SCHEMA_VERSION,
    timestamp: toIsoTimestamp(now),
    target,
    phase: "foundation",
    summary: initialized
      ? `${descriptor.displayName} adapter foundation is initialized under OMX-owned paths.`
      : `${descriptor.displayName} adapter foundation has not been initialized yet.`,
    adapter: {
      state: initialized ? "initialized" : "not-initialized",
      detail: initialized
        ? "Adapter foundation artifacts exist under .omx/adapters/<target>/..."
        : "Run init --write to create OMX-owned adapter artifacts.",
      configPath: paths.configPath,
      envelopePath: paths.envelopePath,
    },
    targetRuntime: {
      state: "unknown",
      detail: descriptor.followupHint,
    },
    planning: buildAdaptPlanningLink(cwd),
    capabilities: descriptor.capabilities,
  };
}

export function buildAdaptDoctorReport(
  cwd: string,
  target: AdaptTarget,
  now = new Date(),
): AdaptDoctorReport {
  const descriptor = getAdaptTargetDescriptor(target);
  if (!descriptor) {
    throw new Error(`Unknown adapt target: ${target}`);
  }

  const status = buildAdaptStatusReport(cwd, target, now);
  const planning = buildAdaptPlanningLink(cwd);
  const issues: AdaptDoctorIssue[] = [];

  if (status.adapter.state === "not-initialized") {
    issues.push({
      code: "adapter_not_initialized",
      message: `No adapter foundation artifacts exist for ${target} under ${join(".omx", "adapters", target)}.`,
    });
  }

  if (!planning.prdPath) {
    issues.push({
      code: "planning_artifacts_missing",
      message: "No canonical OMX PRD artifact is available to link into the adapter envelope.",
    });
  }

  issues.push({
    code: "target_specific_logic_deferred",
    message: descriptor.followupHint,
  });

  return {
    schemaVersion: ADAPT_SCHEMA_VERSION,
    timestamp: toIsoTimestamp(now),
    target,
    phase: "foundation",
    summary: `Foundation doctor for ${descriptor.displayName} reports only OMX-owned adapter readiness and shared planning linkage.`,
    issues,
    nextSteps: [
      `Run omx adapt ${target} init --write.`,
      "Keep follow-on integration work out of .omx/state/... and target runtime internals unless a reviewed contract exists.",
      descriptor.followupHint,
    ],
  };
}

export function initAdaptFoundation(
  cwd: string,
  target: AdaptTarget,
  write = false,
  now = new Date(),
): AdaptInitResult {
  const descriptor = getAdaptTargetDescriptor(target);
  if (!descriptor) {
    throw new Error(`Unknown adapt target: ${target}`);
  }

  const envelope = buildAdaptEnvelope(cwd, target, now);
  const paths = envelope.adapterPaths;
  const previewPaths = [
    paths.adapterRoot,
    paths.configPath,
    paths.envelopePath,
    paths.reportsDir,
    paths.probeReportPath,
    paths.statusReportPath,
  ];
  const wrotePaths: string[] = [];

  if (write) {
    mkdirSync(paths.reportsDir, { recursive: true });
    const config = {
      schemaVersion: ADAPT_SCHEMA_VERSION,
      target,
      createdAt: toIsoTimestamp(now),
      phase: "foundation",
      summary: descriptor.summary,
      followupHint: descriptor.followupHint,
      constraints: FOUNDATION_CONSTRAINTS,
    };
    writeFileSync(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
    writeFileSync(paths.envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf-8");
    wrotePaths.push(paths.configPath, paths.envelopePath);
  }

  return {
    schemaVersion: ADAPT_SCHEMA_VERSION,
    timestamp: toIsoTimestamp(now),
    target,
    write,
    summary: write
      ? `${descriptor.displayName} adapter foundation was written under OMX-owned paths.`
      : `${descriptor.displayName} adapter foundation preview is ready; rerun with --write to materialize it.`,
    previewPaths,
    wrotePaths,
    envelope,
  };
}
