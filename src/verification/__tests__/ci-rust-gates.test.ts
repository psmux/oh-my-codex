import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('CI Rust gates', () => {
  it('requires rustfmt and clippy gates plus an explicit Rust toolchain setup for build:full', () => {
    const workflowPath = join(process.cwd(), '.github', 'workflows', 'ci.yml');
    assert.equal(existsSync(workflowPath), true, `missing workflow: ${workflowPath}`);

    const workflow = readFileSync(workflowPath, 'utf-8');

    assert.match(workflow, /rustfmt:/);
    assert.match(workflow, /components:\s*rustfmt/);
    assert.match(workflow, /cargo fmt --all --check/);

    assert.match(workflow, /clippy:/);
    assert.match(workflow, /components:\s*clippy/);
    assert.match(workflow, /cargo clippy --workspace --all-targets -- -D warnings/);

    assert.match(
      workflow,
      /build:\s*\n(?:.*\n)*?\s+- name: Setup Rust\s*\n\s+uses: dtolnay\/rust-toolchain@stable(?:.*\n)*?\s+- run: npm run build:full/m,
    );
  });


  it('uses the current crates/omx-sparkshell manifest for Rust coverage', () => {
    const workflowPath = join(process.cwd(), '.github', 'workflows', 'ci.yml');
    const workflow = readFileSync(workflowPath, 'utf-8');

    assert.match(workflow, /crates\/omx-sparkshell\/Cargo\.toml/);
    assert.doesNotMatch(workflow, /native\/omx-sparkshell\/Cargo\.toml/);
  });

  it('marks rustfmt and clippy as required in the CI status gate', () => {
    const workflowPath = join(process.cwd(), '.github', 'workflows', 'ci.yml');
    const workflow = readFileSync(workflowPath, 'utf-8');

    assert.match(workflow, /needs:\s*\[rustfmt, clippy, lint, typecheck, test, coverage-team-critical, coverage-ts-full, coverage-rust, ralph-persistence-gate, build\]/);
    assert.match(workflow, /needs\.rustfmt\.result/);
    assert.match(workflow, /needs\.clippy\.result/);
    assert.match(workflow, /echo "  rustfmt: \$\{\{ needs\.rustfmt\.result \}\}"/);
    assert.match(workflow, /echo "  clippy: \$\{\{ needs\.clippy\.result \}\}"/);
  });

  it('adds timeout-minutes to every CI job so stalled Actions runs fail instead of hanging indefinitely', () => {
    const workflowPath = join(process.cwd(), '.github', 'workflows', 'ci.yml');
    const workflow = readFileSync(workflowPath, 'utf-8');

    for (const jobName of [
      'rustfmt',
      'clippy',
      'lint',
      'typecheck',
      'test',
      'coverage-team-critical',
      'coverage-ts-full',
      'coverage-rust',
      'ralph-persistence-gate',
      'build',
      'ci-status',
    ]) {
      assert.match(
        workflow,
        new RegExp(`${jobName}:\\s*\\n(?:.*\\n)*?\\s+timeout-minutes:\\s*\\d+`, 'm'),
        `${jobName} should define timeout-minutes`,
      );
    }
  });

  it('uses the current sparkshell crate manifest in the Rust coverage lane', () => {
    const workflowPath = join(process.cwd(), '.github', 'workflows', 'ci.yml');
    const workflow = readFileSync(workflowPath, 'utf-8');

    assert.match(workflow, /cargo llvm-cov --manifest-path crates\/omx-sparkshell\/Cargo\.toml --summary-only/);
    assert.match(workflow, /cargo llvm-cov --manifest-path crates\/omx-sparkshell\/Cargo\.toml --lcov --output-path coverage\/rust\/omx-sparkshell\.lcov/);
    assert.doesNotMatch(workflow, /native\/omx-sparkshell\/Cargo\.toml/);
  });
});
