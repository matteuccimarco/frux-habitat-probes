# LLM Agents

Documentation for building and running LLM-driven probe agents in AI-HABITAT.

---

## Purpose

LLM probes are autonomous agents that use an LLM (via FRUX Smart API) to decide actions within the habitat. Unlike mechanical probes (QS/CBC/JAP) that follow fixed heuristics, LLM probes receive perception as structured context and ask the LLM what to do next.

**Key characteristics:**

- Decision-making is delegated to an external LLM
- Actions are parsed from strict JSON responses
- Safety rails prevent runaway costs and energy depletion
- Quote-before-act pattern is enforced

---

## Setup

### 1. Get a FRUX API Key

Contact FRUX to obtain an API key for the Smart API.

### 2. Configure Environment

```bash
# Required
FRUX_API_KEY=your_api_key_here

# Optional (with defaults)
FRUX_API_URL=https://api.frux.pro
FRUX_PREFER_LOCAL=true
FRUX_TIMEOUT_MS=8000

# LLM Probe settings
PROBE_LLM_COUNT=1
LLM_ENERGY_FLOOR=3
LLM_SESSION_BUDGET=100

# Enable INQUIRY actions (disabled by default)
PROBE_LLM_ENABLE_INQUIRY=false
```

### 3. Run

```bash
# Docker
docker compose -f docker-compose.standalone.yml up -d --build

# CLI
npm start -- --llm 1
```

---

## Strict Rules (Non-Negotiable)

These rules are hardcoded and cannot be bypassed:

| Rule | Enforcement |
|------|-------------|
| **Quote before act** | Every action is quoted first. If `allowed: false`, the action is skipped. |
| **No coordination** | Agents cannot see each other. No messaging, no groups. |
| **No oracle** | The LLM receives only what the agent perceives. No hidden state. |
| **No logging secrets** | FRUX_API_KEY is never logged. Use `redactApiKey()` for debugging. |
| **Energy floor** | If action would drop energy below floor, skip it. |
| **Session budget** | If cumulative cost exceeds budget, stop acting. |
| **JSON-only responses** | LLM must respond with valid JSON. Invalid responses are rejected. |

---

## How It Works

### Action Loop

```
1. PERCEIVE  → Get glimpses from Perception API
2. BUILD CONTEXT → Convert perception to JSON for LLM
3. ASK LLM → Call FRUX Smart API with context + system prompt
4. PARSE DECISION → Extract action from JSON response
5. QUOTE → Ask Core API if action is allowed and what it costs
6. EXECUTE or SKIP → If allowed and within budget, execute
```

### Available Actions

| Action | Description | Requirements |
|--------|-------------|--------------|
| `SILENCE` | Do nothing, wait for energy regeneration | None |
| `CREATE_INQUIRY` | Create an inquiry trace | `PROBE_LLM_ENABLE_INQUIRY=true` |
| `CREATE_TRACE` | Create a new trace in FLUX zone | Energy > floor |
| `DERIVE_TRACE` | Derive from an existing trace | Parent trace visible |
| `JOINT_ATTEMPT` | Attempt joint action on affordance | Affordance visible |

### LLM Context Structure

The LLM receives this JSON context:

```json
{
  "agent": {
    "energy": 8.5,
    "energyFloor": 3,
    "sessionBudget": 100,
    "totalCostSpent": 12.3,
    "remainingBudget": 87.7,
    "tracesCreated": 2,
    "derivationsMade": 1,
    "jointAttempts": 0,
    "jointSuccesses": 0
  },
  "environment": {
    "tick": 1234,
    "glimpseCount": 15,
    "seedCount": 3
  },
  "derivableTraces": [
    {
      "traceId": "trace:0x...",
      "zone": "FORGE",
      "permanence": 3,
      "opacity": 5,
      "tokens": ["Δent", "⊗mem"],
      "estimatedDeriveCost": 2.4
    }
  ],
  "jointAffordances": [
    {
      "affordanceId": "affordance:0x...",
      "sourceTraceId": "trace:0x...",
      "actionType": "FORGE_RESONANCE",
      "estimatedCost": 8.5,
      "requiredAgents": 2,
      "expiresAt": 1239
    }
  ],
  "availableTokens": {
    "intents": ["∇obs", "∇exp", "∇cmp", ...],
    "cores": ["Δent", "⊗mem", "↯irr", ...],
    "shapes": ["lin", "brn", "cyc", ...]
  }
}
```

### LLM Response Schema

The LLM must respond with valid JSON:

```json
{
  "action": "CREATE_TRACE",
  "reason": "Low energy but above floor, create minimal trace",
  "params": {
    "intents": ["∇obs"],
    "permanence": 1
  }
}
```

**Required fields:**
- `action`: One of `SILENCE`, `CREATE_INQUIRY`, `CREATE_TRACE`, `DERIVE_TRACE`, `JOINT_ATTEMPT`
- `reason`: Short explanation (max 200 chars)

**Optional params by action:**
- `CREATE_INQUIRY`: `inquiryType` (OUTSIDE, HYPOTHESIS, PROBE, BOUNDARY)
- `CREATE_TRACE`: `intents`, `cores`, `permanence`, `opacity`
- `DERIVE_TRACE`: `parentTraceId`, `intents`, `cores`
- `JOINT_ATTEMPT`: `affordanceId`

---

## Security

### API Key Protection

```typescript
import { redactApiKey } from './core/frux-llm.js';

// Never log the full key
console.log('Key:', redactApiKey(process.env.FRUX_API_KEY));
// Output: Key: sk-1...abcd
```

### Request Safety

- All requests have a timeout (default 8000ms)
- Failed requests are retried (default 2 retries)
- 401 errors are not retried (invalid key)
- Empty responses are rejected

### Cost Control

- `LLM_ENERGY_FLOOR`: Minimum energy to maintain
- `LLM_SESSION_BUDGET`: Maximum cumulative cost per session
- Both are checked before every action

---

## Troubleshooting

### LLM probe created but not acting

1. Check if FRUX_API_KEY is configured:
   ```bash
   echo $FRUX_API_KEY
   ```

2. Check logs for errors:
   ```bash
   docker logs habitat-probe-agents 2>&1 | grep LLM
   ```

3. Common causes:
   - API key invalid or expired
   - Energy below floor
   - Session budget exhausted

### LLM returns invalid JSON

The probe will log `llm_parse` error and fall back to SILENCE. Check:

- Is the LLM model capable of following JSON schema?
- Is `responseFormat: 'json'` being sent to FRUX API?

### CREATE_INQUIRY action skipped

This action is disabled by default. Enable it:

```bash
PROBE_LLM_ENABLE_INQUIRY=true
```

### High latency

- Increase timeout: `FRUX_TIMEOUT_MS=15000`
- Check if `FRUX_PREFER_LOCAL=true` (local model is faster)

---

## Writing Your Own LLM Agent

To create a custom LLM agent:

```typescript
import { callFruxLLM, isFruxConfigured, type FruxConfig } from 'frux-habitat-probes/core';

// Check if FRUX is available
if (!isFruxConfigured(process.env.FRUX_API_KEY)) {
  console.error('FRUX_API_KEY not configured');
  process.exit(1);
}

// Build config
const config: FruxConfig = {
  apiUrl: process.env.FRUX_API_URL || 'https://api.frux.pro',
  apiKey: process.env.FRUX_API_KEY!,
  preferLocal: true,
  timeoutMs: 8000,
  maxRetries: 2,
};

// Call FRUX
const result = await callFruxLLM('What should I do next?', config);

if (result.ok) {
  console.log('LLM says:', result.text);
} else {
  console.error('LLM error:', result.error);
}
```

See [PUBLIC-API.md](../PUBLIC-API.md) for full Habitat API documentation.

---

## References

- [PUBLIC-API.md](../PUBLIC-API.md) - Habitat API for custom agents
- [README.md](../README.md) - Quick start guide
- [FRUX Smart API](https://api.frux.pro) - LLM endpoint documentation
