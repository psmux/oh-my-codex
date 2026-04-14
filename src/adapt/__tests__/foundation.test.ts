import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAdaptEnvelope,
  buildAdaptStatusReport,
  buildAdaptDoctorReport,
  initAdaptFoundation,
} from "../index.js";
import { resolveAdaptPaths } from "../paths.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "omx-adapt-foundation-"));
});

afterEach(async () => {
  if (tempDir && existsSync(tempDir)) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("adapt foundation", () => {
  it("resolves OMX-owned adapter paths under .omx/adapters/<target>", () => {
    const paths = resolveAdaptPaths(tempDir, "openclaw");
    assert.equal(paths.adapterRoot, join(tempDir, ".omx", "adapters", "openclaw"));
    assert.equal(paths.configPath, join(tempDir, ".omx", "adapters", "openclaw", "adapter.json"));
    assert.equal(paths.envelopePath, join(tempDir, ".omx", "adapters", "openclaw", "envelope.json"));
    assert.equal(paths.probeReportPath, join(tempDir, ".omx", "adapters", "openclaw", "reports", "probe.json"));
    assert.equal(paths.statusReportPath, join(tempDir, ".omx", "adapters", "openclaw", "reports", "status.json"));
  });

  it("links the latest canonical PRD/test-spec artifacts into the envelope", async () => {
    const plansDir = join(tempDir, ".omx", "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, "prd-alpha.md"), "# Alpha\n");
    await writeFile(join(plansDir, "test-spec-alpha.md"), "# Alpha Test Spec\n");
    await writeFile(join(plansDir, "prd-zeta.md"), "# Zeta\n");
    await writeFile(join(plansDir, "test-spec-zeta.md"), "# Zeta Test Spec\n");

    const envelope = buildAdaptEnvelope(tempDir, "openclaw", new Date("2026-04-14T00:00:00.000Z"));
    assert.equal(envelope.planning.prdPath, join(plansDir, "prd-zeta.md"));
    assert.deepEqual(envelope.planning.testSpecPaths, [join(plansDir, "test-spec-zeta.md")]);
    assert.match(envelope.planning.summary, /matching test spec/i);
  });

  it("reports asymmetric capability ownership in the shared envelope", () => {
    const envelope = buildAdaptEnvelope(tempDir, "hermes", new Date("2026-04-14T00:00:00.000Z"));
    const ownerships = new Set(envelope.capabilities.map((capability) => capability.ownership));
    assert.deepEqual(
      [...ownerships].sort(),
      ["omx-owned", "shared-contract", "target-observed"],
    );
  });

  it("keeps init preview read-only until --write is used", () => {
    const result = initAdaptFoundation(tempDir, "hermes", false, new Date("2026-04-14T00:00:00.000Z"));
    const paths = resolveAdaptPaths(tempDir, "hermes");
    assert.equal(result.write, false);
    assert.deepEqual(result.wrotePaths, []);
    assert.equal(existsSync(paths.configPath), false);
    assert.equal(existsSync(join(tempDir, ".omx", "state")), false);
  });

  it("writes only OMX-owned adapter artifacts during init --write", () => {
    const result = initAdaptFoundation(tempDir, "openclaw", true, new Date("2026-04-14T00:00:00.000Z"));
    const paths = resolveAdaptPaths(tempDir, "openclaw");
    assert.equal(result.write, true);
    assert.deepEqual(result.wrotePaths, [paths.configPath, paths.envelopePath]);
    assert.equal(existsSync(paths.configPath), true);
    assert.equal(existsSync(paths.envelopePath), true);
    assert.equal(existsSync(join(tempDir, ".omx", "state")), false);

    const envelope = JSON.parse(readFileSync(paths.envelopePath, "utf-8")) as {
      target: string;
      adapterPaths: { configPath: string };
    };
    assert.equal(envelope.target, "openclaw");
    assert.equal(envelope.adapterPaths.configPath, paths.configPath);
  });

  it("reports initialization status without claiming target-runtime health", () => {
    const status = buildAdaptStatusReport(tempDir, "openclaw", new Date("2026-04-14T00:00:00.000Z"));
    assert.equal(status.adapter.state, "not-initialized");
    assert.equal(status.targetRuntime.state, "unknown");
    assert.match(status.targetRuntime.detail, /follow-on PR/i);
  });

  it("doctor surfaces actionable foundation-only remediation", () => {
    const doctor = buildAdaptDoctorReport(tempDir, "hermes", new Date("2026-04-14T00:00:00.000Z"));
    assert.equal(doctor.issues[0]?.code, "adapter_not_initialized");
    assert.match(doctor.nextSteps.join("\n"), /init --write/i);
    assert.match(doctor.nextSteps.join("\n"), /follow-on PR/i);
  });
});
