import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readModeState, startMode } from '../base.js';

describe('modes/base deep-interview contract integration', () => {
  it('startMode persists deep-interview state', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'omx-mode-deep-interview-contract-'));
    try {
      const started = await startMode('deep-interview', 'clarify a vague request', 3, wd);
      assert.equal(started.mode, 'deep-interview');
      assert.equal(started.active, true);
      assert.equal(started.current_phase, 'starting');
      const persisted = await readModeState('deep-interview', wd);
      assert.equal(persisted?.mode, 'deep-interview');
      assert.equal(persisted?.task_description, 'clarify a vague request');
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });
});

describe('modes/base autoresearch contract integration', () => {
  it('startMode blocks autoresearch when ralph is active', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'omx-mode-autoresearch-contract-'));
    try {
      await startMode('ralph', 'demo', 5, wd);
      await assert.rejects(
        () => startMode('autoresearch', 'demo mission', 1, wd),
        /Cannot start autoresearch: ralph is already active/i,
      );
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('startMode persists autoresearch state when no exclusive conflict exists', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'omx-mode-autoresearch-contract-'));
    try {
      const started = await startMode('autoresearch', 'demo mission', 1, wd);
      assert.equal(started.mode, 'autoresearch');
      assert.equal(started.active, true);
      assert.equal(started.current_phase, 'starting');
      const persisted = await readModeState('autoresearch', wd);
      assert.equal(persisted?.mode, 'autoresearch');
      assert.equal(persisted?.task_description, 'demo mission');
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });
});
