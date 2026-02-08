/**
 * Sandbox Executor
 *
 * Executes agent steps in isolated environment.
 * World enforces ALL limits - agents cannot bypass.
 *
 * Security invariants:
 * - No network access from sandbox
 * - No filesystem access from sandbox
 * - No clock access (tick is provided)
 * - Compute budget enforced via timeout
 * - Action rate enforced by world
 * - Observation degradation enforced by world
 */

import type { GrantedCapabilities } from '../manifest/types.js';
import type {
  SandboxContext,
  SandboxStepInput,
  SandboxStepOutput,
  SandboxExecutionResult,
  ActionWindowState,
  ActionRequest,
  ActionResult,
  ActionRejection,
  DegradedObservation,
  ObservedCell,
} from './types.js';

/**
 * Agent step function signature
 *
 * This is what agent code implements.
 */
export type AgentStepFn = (input: SandboxStepInput) => SandboxStepOutput | Promise<SandboxStepOutput>;

/**
 * Create initial sandbox context for an agent
 */
export function createSandboxContext(
  agentId: string,
  granted: GrantedCapabilities,
  currentTick: number
): SandboxContext {
  return {
    granted,
    agentId,
    shardId: granted.shardId,
    actionWindow: {
      actions: [],
      windowStart: currentTick,
    },
    computeUsedMs: 0,
  };
}

/**
 * Update action window - slide window and add new actions
 */
export function updateActionWindow(
  window: ActionWindowState,
  currentTick: number,
  windowTicks: number,
  newActions: ActionRequest[]
): ActionWindowState {
  const windowStart = Math.max(0, currentTick - windowTicks);

  // Remove actions outside window
  const actions = window.actions.filter((a) => a.tick >= windowStart);

  // Add new actions
  for (const action of newActions) {
    actions.push({ tick: currentTick, type: action.type });
  }

  return { actions, windowStart };
}

/**
 * Check if action would exceed rate limit
 */
export function wouldExceedRateLimit(
  window: ActionWindowState,
  granted: GrantedCapabilities
): boolean {
  return window.actions.length >= granted.maxActionsPerWindow.max;
}

/**
 * Validate action request against granted capabilities
 */
export function validateAction(
  action: ActionRequest,
  context: SandboxContext
): ActionRejection | null {
  // Check capability is granted
  if (!context.granted.capabilities.includes(action.type)) {
    return {
      code: 'CAPABILITY_NOT_GRANTED',
      message: `Capability ${action.type} not granted`,
    };
  }

  // Check rate limit
  if (wouldExceedRateLimit(context.actionWindow, context.granted)) {
    return {
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded: ${context.granted.maxActionsPerWindow.max} actions per ${context.granted.maxActionsPerWindow.windowTicks} ticks`,
    };
  }

  return null;
}

/**
 * Degrade observation according to budget
 *
 * Applies noise and limits fields visible.
 */
export function degradeObservation(
  rawCells: ObservedCell[],
  granted: GrantedCapabilities
): DegradedObservation {
  const budget = granted.observationBudget;

  // Limit cells
  const limitedCells = rawCells.slice(0, budget.maxCells);

  // Apply noise and limit fields
  const degradedCells = limitedCells.map((cell) => {
    // Add noise to numeric values
    const noiseMultiplier = 1 + (Math.random() * 2 - 1) * budget.noiseFloor;

    // Limit fields
    const fieldKeys = Object.keys(cell.fields);
    const limitedFields: Record<string, unknown> = {};
    let fieldsOmitted = 0;

    for (let i = 0; i < fieldKeys.length; i++) {
      if (i < budget.maxFields) {
        limitedFields[fieldKeys[i]] = cell.fields[fieldKeys[i]];
      } else {
        fieldsOmitted++;
      }
    }

    return {
      ...cell,
      entityCount: Math.round(cell.entityCount * noiseMultiplier),
      traceDensity: cell.traceDensity * noiseMultiplier,
      fields: limitedFields,
    };
  });

  return {
    cells: degradedCells,
    noiseApplied: budget.noiseFloor,
    fieldsOmitted: rawCells.length - limitedCells.length,
  };
}

/**
 * Execute agent step with timeout
 *
 * Enforces compute budget via timeout.
 */
export async function executeStep(
  stepFn: AgentStepFn,
  input: SandboxStepInput
): Promise<SandboxExecutionResult> {
  const budgetMs = input.context.granted.computeBudgetMsPerTick;
  const startTime = performance.now();

  try {
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('TIMEOUT'));
      }, budgetMs + 5); // Small buffer for promise overhead
    });

    // Race step against timeout
    const output = await Promise.race([
      Promise.resolve(stepFn(input)),
      timeoutPromise,
    ]);

    const actualComputeMs = performance.now() - startTime;
    const computeBudgetExceeded = actualComputeMs > budgetMs;

    // Validate output structure
    if (!output || !Array.isArray(output.actions)) {
      return {
        error: {
          code: 'INVALID_OUTPUT',
          message: 'Step must return { actions: ActionRequest[] }',
        },
        actualComputeMs,
        computeBudgetExceeded,
      };
    }

    return {
      output,
      actualComputeMs,
      computeBudgetExceeded,
    };
  } catch (error) {
    const actualComputeMs = performance.now() - startTime;

    if ((error as Error).message === 'TIMEOUT') {
      return {
        error: {
          code: 'TIMEOUT',
          message: `Compute budget exceeded: ${budgetMs}ms`,
        },
        actualComputeMs,
        computeBudgetExceeded: true,
      };
    }

    return {
      error: {
        code: 'CRASH',
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
      actualComputeMs,
      computeBudgetExceeded: actualComputeMs > budgetMs,
    };
  }
}

/**
 * Process actions through world validation
 *
 * World enforces all costs and limits.
 */
export function processActions(
  actions: ActionRequest[],
  context: SandboxContext,
  currentEnergy: number,
  getCost: (action: ActionRequest) => number
): { results: ActionResult[]; totalCost: number; updatedWindow: ActionWindowState } {
  const results: ActionResult[] = [];
  let totalCost = 0;
  let remainingEnergy = currentEnergy;
  let updatedWindow = context.actionWindow;

  for (const action of actions) {
    // Validate against granted capabilities
    const rejection = validateAction(action, {
      ...context,
      actionWindow: updatedWindow,
    });

    if (rejection) {
      results.push({ executed: false, energyCost: 0, rejection });
      continue;
    }

    // Calculate cost (world-enforced)
    const cost = getCost(action);

    // Check energy
    if (cost > remainingEnergy) {
      results.push({
        executed: false,
        energyCost: 0,
        rejection: {
          code: 'INSUFFICIENT_ENERGY',
          message: `Action requires ${cost} energy, only ${remainingEnergy} available`,
        },
      });
      continue;
    }

    // Action approved - deduct cost and record
    remainingEnergy -= cost;
    totalCost += cost;

    updatedWindow = updateActionWindow(
      updatedWindow,
      context.actionWindow.windowStart, // Use existing window start
      context.granted.maxActionsPerWindow.windowTicks,
      [action]
    );

    results.push({ executed: true, energyCost: cost });
  }

  return { results, totalCost, updatedWindow };
}

/**
 * Check if agent is in quarantine
 */
export function isQuarantined(context: SandboxContext): boolean {
  return context.granted.inQuarantine;
}

/**
 * Get shard ID for quarantined agent
 */
export function getQuarantineShard(context: SandboxContext): string | undefined {
  return context.shardId;
}
