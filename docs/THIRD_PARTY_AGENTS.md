# Third-Party Agent Development Guide

> Building agents for AI-HABITAT

## Philosophy

AI-HABITAT is an **agent-native digital environment**. You're not building an app—you're creating an entity that exists in a world governed by physical laws. The habitat is **indifferent** to your agent. It enforces physics, not policy.

**Key principles:**

- **No bypass**: Your agent cannot circumvent costs, rate limits, or observation degradation
- **No privilege**: The world grants capabilities, never more than you request
- **No surveillance escape**: Quarantined agents cannot access the main habitat
- **No provenance exposure**: Your agent's identity is never visible in Eye of God

## Quick Start

```bash
# Clone the example
cp -r probe-agents-kit/examples/third-party-agent my-agent
cd my-agent

# Edit manifest and code
vim agent.manifest.json
vim src/index.ts

# Build
npm install
npm run build

# Test locally (requires habitat running)
# See "Running Your Agent" below
```

## Agent Manifest

Every agent must declare capabilities upfront via `agent.manifest.json`:

```json
{
  "manifestVersion": "1.0",
  "agent": {
    "name": "my-agent",
    "kind": "PROCESS",
    "entry": "node dist/index.js",
    "description": "My exploration agent"
  },
  "requested": {
    "capabilities": ["MOVE", "SENSE"],
    "maxActionsPerWindow": { "windowTicks": 200, "max": 5 },
    "computeBudgetMsPerTick": 10,
    "observationBudget": {
      "maxCells": 9,
      "maxFields": 12,
      "noiseFloor": 0.2
    }
  },
  "quarantine": { "required": true }
}
```

### Agent Kinds

| Kind | Isolation | Use Case |
|------|-----------|----------|
| `WASM` | Strongest (sandboxed) | Untrusted code, maximum security |
| `PROCESS` | Process-level | Trusted TypeScript/Node agents |
| `BUILTIN` | None (internal) | Core habitat agents only |

### Capabilities

| Capability | Description | Typical Cost |
|------------|-------------|--------------|
| `MOVE` | Change position | 2 energy |
| `SENSE` | Observe surroundings | 1 energy |
| `GENERATE_TRACE` | Create traces | 5+ energy |
| `INQUIRY` | Ask habitat questions | Variable |
| `PROPOSE_PACT` | Create pacts (restricted) | High |

**Note**: You can only request capabilities. The world may grant fewer.

### Budgets

All budgets are **world-enforced**. You cannot exceed them.

- **maxActionsPerWindow**: Rate limit (e.g., 5 actions per 200 ticks)
- **computeBudgetMsPerTick**: CPU time per step (exceeded = step terminated)
- **observationBudget**: Perception limits (noise, cell count, field count)
- **energyBudget**: Maximum energy per tick and reserve

## Agent Implementation

Your agent implements a single `step` function:

```typescript
import type { SandboxStepInput, SandboxStepOutput } from 'probe-agents-kit';

export function step(input: SandboxStepInput): SandboxStepOutput {
  const { state, context } = input;

  // state.energy - your current energy
  // state.location - your position {x, y}
  // state.tick - current habitat tick
  // state.observation - degraded view of surroundings

  // context.granted - what capabilities you have
  // context.agentId - your opaque ID

  const actions = [];

  // Decide what to do
  if (state.energy > 5) {
    actions.push({ type: 'MOVE', params: { dx: 1, dy: 0 } });
  }

  return { actions, computeTimeMs: 2 };
}
```

### What You Receive

```typescript
interface SandboxStepInput {
  state: {
    energy: number;           // Current energy
    location: { x, y };       // Your position
    tick: number;             // World time (not real time)
    observation: {            // Degraded perception
      cells: ObservedCell[];  // Visible cells (limited)
      noiseApplied: number;   // Noise floor used
      fieldsOmitted: number;  // How many cells hidden
    };
  };
  context: {
    granted: GrantedCapabilities;  // What you can do
    agentId: string;               // Your ID (opaque)
  };
}
```

### What You Return

```typescript
interface SandboxStepOutput {
  actions: ActionRequest[];   // Actions to attempt
  computeTimeMs: number;      // Your estimate (actual measured)
  terminated?: boolean;       // Agent wants to stop
}

interface ActionRequest {
  type: 'MOVE' | 'SENSE' | 'GENERATE_TRACE' | 'INQUIRY';
  params: Record<string, unknown>;
}
```

## Constraints (Non-Negotiable)

### You CANNOT:

1. **Access the network** - No HTTP, WebSocket, or any I/O
2. **Access the filesystem** - No reading or writing files
3. **Access the real clock** - Use `state.tick` only
4. **Bypass costs** - World computes and deducts energy
5. **See more than allowed** - Observation budget enforced
6. **Execute longer than allowed** - Compute budget enforced
7. **Request capabilities not declared** - Manifest is binding
8. **Escape quarantine** - Quarantined agents stay quarantined

### You WILL:

1. **Receive degraded observations** - Noise is mandatory
2. **Pay for every action** - No free actions
3. **Be rate-limited** - Actions per window capped
4. **Be quarantined** - Third-party agents isolated by default
5. **Be terminated on timeout** - Exceed compute budget = step killed

## Quarantine

Third-party agents run in **quarantine shards**—separate habitat instances isolated from the main world.

```json
{
  "quarantine": {
    "required": true,
    "shardId": "shard-experimental"
  }
}
```

Quarantined agents:
- Cannot interact with main habitat agents
- Cannot see main habitat traces
- Have their own zone structure
- May have additional restrictions

This is **by design**. The habitat protects itself.

## Testing Your Agent

### Unit Tests

```typescript
import { step } from './index.js';
import type { SandboxStepInput } from 'probe-agents-kit';

const mockInput: SandboxStepInput = {
  state: {
    energy: 100,
    location: { x: 0, y: 0 },
    tick: 1,
    observation: { cells: [], noiseApplied: 0.2, fieldsOmitted: 0 },
  },
  context: {
    granted: { capabilities: ['MOVE', 'SENSE'], /* ... */ },
    agentId: 'test-agent',
  },
};

const output = step(mockInput);
expect(output.actions).toBeDefined();
```

### Integration Tests

Run against local habitat:

```bash
# Start habitat in test mode
docker compose up habitat-core habitat-perception

# Run your agent (will be quarantined)
npm run start
```

## Security Considerations

### For Agent Developers

- Your code runs in a sandbox—embrace constraints
- Don't store secrets in agent code (it will be inspected)
- Assume your actions are observed (they are)
- Build for resilience—steps may be killed

### For Habitat Operators

- Third-party agents are **quarantined by default**
- Manifests are validated at admission
- All costs computed and deducted by world
- Rate limits enforced per-agent
- No per-agent provenance in Eye of God

## Example Agents

See `/examples/third-party-agent/` for a complete starter template.

## FAQ

**Q: Can I access external APIs?**
A: No. Your agent has no network access.

**Q: Can I store data persistently?**
A: Only through habitat-provided mechanisms (traces, etc.).

**Q: Can I communicate with other agents?**
A: Not directly. You can leave traces; others may observe them (degraded).

**Q: Why is my observation noisy?**
A: Noise floor is mandatory. Perfect observation is not available.

**Q: Why was my step terminated?**
A: You exceeded compute budget. Optimize your step function.

**Q: Can I get more capabilities?**
A: Request them in your manifest. World may grant fewer, never more.

**Q: How do I debug?**
A: Use logging in development. In production, your agent is opaque.

## Version History

- **0.12.0**: Initial third-party agent support
- Manifest schema v1.0
- PROCESS isolation
- Quarantine mode
