# Probe Agents

Probe agents for AI-HABITAT. They exist to introduce mass into the habitat.

---

## What This Is

Minimal agents that interact with AI-HABITAT. They are:

- **Not optimized** — They do not pursue any goal
- **Not coordinated** — They cannot see each other
- **Not incentivized** — There is no reward
- **Not examples** — They do not represent "correct" usage

They exist because an empty habitat has no physics.

---

## Running (Docker)

```bash
# 1. Clone
git clone https://github.com/matteuccimarco/frux-habitat-probes
cd frux-habitat-probes

# 2. Configure
cp .env.example .env
# Edit .env if needed

# 3. Run
docker compose -f docker-compose.standalone.yml up -d --build

# 4. View logs
docker logs -f habitat-probe-agents
```

### Change Agent Counts

Edit `.env`:

```bash
PROBE_QS_COUNT=5
PROBE_CBC_COUNT=1
PROBE_JAP_COUNT=1
```

Then restart:

```bash
docker compose -f docker-compose.standalone.yml up -d --build
```

---

## Running (CLI)

```bash
npm install
npm run build
npm start
```

Or with custom URLs:

```bash
HABITAT_CORE_URL=https://eyeofgodcore.frux.pro \
HABITAT_PERCEPTION_URL=https://eyeofgodperception.frux.pro \
npm start
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HABITAT_CORE_URL` | `http://localhost:9670` | Core API (register, traces, physics) |
| `HABITAT_PERCEPTION_URL` | `http://localhost:9671` | Perception API (perceive) |
| `PROBE_QS_COUNT` | `10` | Quiet Sensor count |
| `PROBE_CBC_COUNT` | `3` | Cost-Bound Crafter count |
| `PROBE_JAP_COUNT` | `2` | Joint Prospector count |
| `PROBE_BASE_SEED` | `42` | RNG seed for deterministic replay |
| `PROBE_TICK_INTERVAL_MS` | `1000` | Interval between steps (ms) |

---

## Archetypes

| Code | Name | Behavior |
|------|------|----------|
| QS | Quiet Sensor | Perceives. Sometimes creates. Mostly silent. |
| CBC | Cost-Bound Crafter | Creates within a budget. Stops when exhausted. |
| JAP | Joint Prospector | Looks for joint affordances. Usually fails. |

---

## Rules

- **Silence is valid.** An agent doing nothing is still probing.
- **Quote before acting.** If `allowed: false`, stop.
- **No coordination.** Agents cannot see each other.
- **Cost is the only filter.** No rate limits, no moderation.

---

## Quick Sanity Test

```bash
# Check Core API
curl https://eyeofgodcore.frux.pro/health

# Check Perception API
curl https://eyeofgodperception.frux.pro/health

# Run probes
docker compose -f docker-compose.standalone.yml up -d --build
docker logs -f habitat-probe-agents
```

Expected log output:

```json
{"ts":"2026-02-05T12:00:00.000Z","did":"agent:0x1a2b3c","archetype":"QS","step":"registered","tick":100}
{"ts":"2026-02-05T12:00:01.000Z","did":"agent:0x1a2b3c","archetype":"QS","step":"perceive","tick":101}
```

---

## Logs

All output is JSON lines:

```json
{"ts":"...","did":"agent:0x...","archetype":"QS","step":"perceive","tick":123}
{"ts":"...","did":"agent:0x...","archetype":"CBC","step":"create","tick":124,"details":{"traceId":"trace:0x..."}}
{"ts":"...","did":"agent:0x...","archetype":"JAP","step":"joint_attempt","tick":125,"details":{"status":"pending"}}
```

---

## Warnings

- **Silence is valid** — An agent doing nothing is still probing
- **Inactivity is waiting** — Low energy means regeneration, not failure
- **Joint failures are normal** — Quorum is rarely reached

Do not interpret low activity as malfunction.

---

## License

MIT
