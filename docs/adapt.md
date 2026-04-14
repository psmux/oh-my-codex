# `omx adapt` Foundation

`omx adapt <target>` is the OMX-owned foundation surface for persistent external-agent adaptation.

This PR adds only the shared foundation:

- CLI scaffold for `probe`, `status`, `init`, `envelope`, and `doctor`
- shared capability reporting with explicit ownership (`omx-owned`, `shared-contract`, `target-observed`)
- adapter-owned paths under `.omx/adapters/<target>/...`
- shared envelope/status/doctor/init behavior that does not touch `.omx/state/...`

Current targets:

- `openclaw`
- `hermes`

Examples:

```bash
omx adapt openclaw probe
omx adapt hermes status --json
omx adapt openclaw init --write
omx adapt hermes envelope --json
```

Foundation constraints:

- thin adapter surface only, not a bidirectional control plane
- no direct writes to `.omx/state/...`
- no direct writes to external runtime internals
- target capability reporting stays asymmetric; OMX reports what it owns, what is shared, and what is only target-observed

Target-specific Hermes and OpenClaw probe/integration logic is intentionally deferred to follow-on PRs.
