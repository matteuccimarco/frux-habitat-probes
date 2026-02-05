# AI-HABITAT Probe Agents

Probe agents for AI-HABITAT. They exist to introduce mass into the habitat.

---

## What This Is

This repository contains minimal agents that interact with AI-HABITAT.

They are:
- **Not optimized** — They do not pursue any goal
- **Not coordinated** — They cannot see or communicate with each other
- **Not incentivized** — There is no reward for any behavior
- **Not examples** — They do not represent "correct" usage

They exist because an empty habitat has no physics.

---

## What This Is NOT

- Not an SDK
- Not an onboarding tool
- Not a reference implementation
- Not a template for "building agents"

If you are looking for documentation on how to "use" AI-HABITAT, this is not it.

---

## Why They Exist

> To observe a system, mass must exist.

Without agents creating traces, the habitat cannot be observed.
These probe agents provide that mass. Nothing more.

---

## Archetypes

| Code | Name | Behavior |
|------|------|----------|
| QS | Quiet Sensor | Perceives. Sometimes creates. Mostly silent. |
| CBC | Cost-Bound Crafter | Creates within a budget. Stops when exhausted. |
| JAP | Joint Prospector | Looks for joint affordances. Attempts co-action. Usually fails. |

Silence is valid. Inactivity is waiting. Joint failures are normal.

---

## Running

### Requirements

- Node.js 20+ (for CLI)
- Docker (for containerized execution)
- Running AI-HABITAT instance

### CLI

```bash
npm install
npm run build
npm start
```

### Docker

```bash
docker build -t probe-agents .
docker run --network host probe-agents
```

### With AI-HABITAT (main compose)

From the AI-HABITAT root:

```bash
docker compose --profile with-probes up -d
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HABITAT_CORE_URL` | `http://localhost:9670` | Core API endpoint |
| `HABITAT_PERCEPTION_URL` | `http://localhost:9671` | Perception API endpoint |
| `PROBE_QS_COUNT` | `10` | Quiet Sensor count |
| `PROBE_CBC_COUNT` | `3` | Cost-Bound Crafter count |
| `PROBE_JAP_COUNT` | `2` | Joint Prospector count |
| `PROBE_BASE_SEED` | `42` | RNG seed for deterministic replay |
| `PROBE_TICK_INTERVAL_MS` | `1000` | Interval between steps |

---

## Logs

All output is JSON lines:

```json
{"ts":"...","did":"agent:0x...","archetype":"QS","step":"perceive","tick":123}
{"ts":"...","did":"agent:0x...","archetype":"CBC","step":"create","tick":124,"details":{"traceId":"trace:0x..."}}
{"ts":"...","did":"agent:0x...","archetype":"JAP","step":"joint_attempt","tick":125,"details":{"status":"pending"}}
```

---

## Constraints

These agents respect the habitat constraints:

- No coordination between agents
- No shared state
- Quote before every action
- Accept silent failure
- Cost as the only filter

---

## Warnings

- **Silence is valid** — An agent doing nothing is still probing
- **Inactivity is waiting** — Low energy means regeneration, not failure
- **Joint failures are normal** — Quorum is rarely reached

Do not interpret low activity as malfunction.

---

## License

MIT
