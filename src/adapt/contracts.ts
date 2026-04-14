export const ADAPT_SCHEMA_VERSION = "1.0";

export const ADAPT_TARGETS = ["openclaw", "hermes"] as const;
export type AdaptTarget = (typeof ADAPT_TARGETS)[number];

export const ADAPT_SUBCOMMANDS = [
  "probe",
  "status",
  "init",
  "envelope",
  "doctor",
] as const;
export type AdaptSubcommand = (typeof ADAPT_SUBCOMMANDS)[number];

export type AdaptCapabilityOwnership =
  | "omx-owned"
  | "shared-contract"
  | "target-observed";

export type AdaptCapabilityStatus = "ready" | "stub" | "unsupported";

export interface AdaptCapabilityReport {
  id: string;
  label: string;
  ownership: AdaptCapabilityOwnership;
  status: AdaptCapabilityStatus;
  summary: string;
}

export interface AdaptTargetDescriptor {
  target: AdaptTarget;
  displayName: string;
  summary: string;
  followupHint: string;
  capabilities: AdaptCapabilityReport[];
}

export interface AdaptPathSet {
  adapterRoot: string;
  configPath: string;
  envelopePath: string;
  reportsDir: string;
  probeReportPath: string;
  statusReportPath: string;
}

export interface AdaptPlanningLink {
  prdPath: string | null;
  testSpecPaths: string[];
  deepInterviewSpecPaths: string[];
  summary: string;
}

export interface AdaptEnvelope {
  schemaVersion: string;
  generatedAt: string;
  target: AdaptTarget;
  displayName: string;
  summary: string;
  adapterPaths: AdaptPathSet;
  planning: AdaptPlanningLink;
  capabilities: AdaptCapabilityReport[];
  constraints: string[];
}

export interface AdaptProbeReport {
  schemaVersion: string;
  timestamp: string;
  target: AdaptTarget;
  phase: "foundation";
  summary: string;
  adapterPaths: AdaptPathSet;
  planning: AdaptPlanningLink;
  capabilities: AdaptCapabilityReport[];
  targetRuntime: {
    state: "not-implemented";
    detail: string;
  };
  nextSteps: string[];
}

export interface AdaptStatusReport {
  schemaVersion: string;
  timestamp: string;
  target: AdaptTarget;
  phase: "foundation";
  summary: string;
  adapter: {
    state: "initialized" | "not-initialized";
    detail: string;
    configPath: string;
    envelopePath: string;
  };
  targetRuntime: {
    state: "unknown";
    detail: string;
  };
  planning: AdaptPlanningLink;
  capabilities: AdaptCapabilityReport[];
}

export interface AdaptDoctorIssue {
  code: string;
  message: string;
}

export interface AdaptDoctorReport {
  schemaVersion: string;
  timestamp: string;
  target: AdaptTarget;
  phase: "foundation";
  summary: string;
  issues: AdaptDoctorIssue[];
  nextSteps: string[];
}

export interface AdaptInitResult {
  schemaVersion: string;
  timestamp: string;
  target: AdaptTarget;
  write: boolean;
  summary: string;
  previewPaths: string[];
  wrotePaths: string[];
  envelope: AdaptEnvelope;
}
