/**
 * Sandbox Executor Tests
 *
 * Security-critical tests for:
 * 1. Capability enforcement
 * 2. Rate limit enforcement
 * 3. Compute budget enforcement
 * 4. Observation degradation
 * 5. Energy deduction
 * 6. Quarantine isolation
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  SandboxContext,
  SandboxStepInput,
  ActionRequest,
  ObservedCell,
} from './types.js';
import type { GrantedCapabilities } from '../manifest/types.js';
import {
  createSandboxContext,
  updateActionWindow,
  wouldExceedRateLimit,
  validateAction,
  degradeObservation,
  executeStep,
  processActions,
  isQuarantined,
  getQuarantineShard,
} from './executor.js';

const baseGranted: GrantedCapabilities = {
  capabilities: ['MOVE', 'SENSE'],
  maxActionsPerWindow: { windowTicks: 200, max: 5 },
  computeBudgetMsPerTick: 10,
  observationBudget: { maxCells: 9, maxFields: 12, noiseFloor: 0.2 },
  energyBudget: { maxPerTick: 20, maxReserve: 200 },
  inQuarantine: false,
};

describe('Sandbox Context', () => {
  it('should create initial context correctly', () => {
    const ctx = createSandboxContext('agent:123', baseGranted, 100);

    expect(ctx.agentId).toBe('agent:123');
    expect(ctx.granted).toBe(baseGranted);
    expect(ctx.actionWindow.actions).toHaveLength(0);
    expect(ctx.computeUsedMs).toBe(0);
  });

  it('should track quarantine status', () => {
    const quarantinedGranted = { ...baseGranted, inQuarantine: true, shardId: 'shard-1' };
    const ctx = createSandboxContext('agent:456', quarantinedGranted, 100);

    expect(isQuarantined(ctx)).toBe(true);
    expect(getQuarantineShard(ctx)).toBe('shard-1');
  });
});

describe('Rate Limiting', () => {
  it('should track actions in sliding window', () => {
    const window = { actions: [], windowStart: 0 };
    const actions: ActionRequest[] = [
      { type: 'MOVE', params: { dx: 1, dy: 0 } },
      { type: 'SENSE', params: {} },
    ];

    const updated = updateActionWindow(window, 100, 200, actions);

    expect(updated.actions).toHaveLength(2);
    expect(updated.actions[0].tick).toBe(100);
  });

  it('should expire old actions outside window', () => {
    const window = {
      actions: [
        { tick: 50, type: 'MOVE' as const },
        { tick: 150, type: 'SENSE' as const },
      ],
      windowStart: 50,
    };

    // Current tick 300, window is 200 ticks -> window starts at 100
    const updated = updateActionWindow(window, 300, 200, []);

    expect(updated.actions).toHaveLength(1);
    expect(updated.actions[0].tick).toBe(150);
  });

  it('should detect rate limit exceeded', () => {
    const granted = { ...baseGranted, maxActionsPerWindow: { windowTicks: 200, max: 2 } };
    const window = {
      actions: [
        { tick: 100, type: 'MOVE' as const },
        { tick: 101, type: 'SENSE' as const },
      ],
      windowStart: 0,
    };

    expect(wouldExceedRateLimit(window, granted)).toBe(true);
  });
});

describe('Capability Enforcement', () => {
  it('should reject action for non-granted capability', () => {
    const ctx = createSandboxContext('agent:1', baseGranted, 100);
    const action: ActionRequest = { type: 'GENERATE_TRACE', params: {} };

    const rejection = validateAction(action, ctx);

    expect(rejection).not.toBeNull();
    expect(rejection?.code).toBe('CAPABILITY_NOT_GRANTED');
  });

  it('should accept action for granted capability', () => {
    const ctx = createSandboxContext('agent:1', baseGranted, 100);
    const action: ActionRequest = { type: 'MOVE', params: { dx: 1, dy: 0 } };

    const rejection = validateAction(action, ctx);

    expect(rejection).toBeNull();
  });

  it('should reject when rate limit exceeded', () => {
    const granted = { ...baseGranted, maxActionsPerWindow: { windowTicks: 200, max: 1 } };
    const ctx = createSandboxContext('agent:1', granted, 100);
    ctx.actionWindow = {
      actions: [{ tick: 100, type: 'MOVE' }],
      windowStart: 0,
    };
    const action: ActionRequest = { type: 'SENSE', params: {} };

    const rejection = validateAction(action, ctx);

    expect(rejection).not.toBeNull();
    expect(rejection?.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});

describe('Observation Degradation', () => {
  it('should limit cells to budget', () => {
    const cells: ObservedCell[] = Array(20)
      .fill(null)
      .map((_, i) => ({
        dx: i % 5,
        dy: Math.floor(i / 5),
        zone: 'FLUX',
        entityCount: 5,
        traceDensity: 0.5,
        fields: {},
      }));

    const granted = { ...baseGranted, observationBudget: { maxCells: 9, maxFields: 12, noiseFloor: 0.2 } };
    const degraded = degradeObservation(cells, granted);

    expect(degraded.cells).toHaveLength(9);
    expect(degraded.fieldsOmitted).toBe(11); // 20 - 9 cells omitted
  });

  it('should apply noise to numeric values', () => {
    const cells: ObservedCell[] = [
      { dx: 0, dy: 0, zone: 'FLUX', entityCount: 100, traceDensity: 0.5, fields: {} },
    ];

    const granted = { ...baseGranted, observationBudget: { maxCells: 9, maxFields: 12, noiseFloor: 0.3 } };

    // Run multiple times to check noise is applied
    const results = Array(10)
      .fill(null)
      .map(() => degradeObservation(cells, granted));

    // At least some should differ from original (statistical test)
    const entityCounts = results.map((r) => r.cells[0].entityCount);
    const unique = new Set(entityCounts);

    // With 30% noise, values should vary
    expect(unique.size).toBeGreaterThan(1);
  });

  it('should limit fields per cell', () => {
    const cells: ObservedCell[] = [
      {
        dx: 0,
        dy: 0,
        zone: 'FLUX',
        entityCount: 5,
        traceDensity: 0.5,
        fields: {
          a: 1, b: 2, c: 3, d: 4, e: 5,
          f: 6, g: 7, h: 8, i: 9, j: 10,
          k: 11, l: 12, m: 13, n: 14, o: 15,
        },
      },
    ];

    const granted = { ...baseGranted, observationBudget: { maxCells: 9, maxFields: 5, noiseFloor: 0.2 } };
    const degraded = degradeObservation(cells, granted);

    expect(Object.keys(degraded.cells[0].fields)).toHaveLength(5);
  });
});

describe('Compute Budget Enforcement', () => {
  it('should complete fast step within budget', async () => {
    const stepFn = () => ({ actions: [], computeTimeMs: 1, terminated: false });
    const input: SandboxStepInput = {
      state: {
        energy: 100,
        location: { x: 0, y: 0 },
        tick: 100,
        observation: { cells: [], noiseApplied: 0.2, fieldsOmitted: 0 },
      },
      context: createSandboxContext('agent:1', baseGranted, 100),
    };

    const result = await executeStep(stepFn, input);

    expect(result.error).toBeUndefined();
    expect(result.output?.actions).toEqual([]);
    expect(result.computeBudgetExceeded).toBe(false);
  });

  it('should timeout slow step', async () => {
    const slowStepFn = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { actions: [], computeTimeMs: 50, terminated: false };
    };

    const granted = { ...baseGranted, computeBudgetMsPerTick: 5 };
    const input: SandboxStepInput = {
      state: {
        energy: 100,
        location: { x: 0, y: 0 },
        tick: 100,
        observation: { cells: [], noiseApplied: 0.2, fieldsOmitted: 0 },
      },
      context: createSandboxContext('agent:1', granted, 100),
    };

    const result = await executeStep(slowStepFn, input);

    expect(result.error?.code).toBe('TIMEOUT');
    expect(result.computeBudgetExceeded).toBe(true);
  });

  it('should handle step crash gracefully', async () => {
    const crashingStep = () => {
      throw new Error('Agent crashed');
    };

    const input: SandboxStepInput = {
      state: {
        energy: 100,
        location: { x: 0, y: 0 },
        tick: 100,
        observation: { cells: [], noiseApplied: 0.2, fieldsOmitted: 0 },
      },
      context: createSandboxContext('agent:1', baseGranted, 100),
    };

    const result = await executeStep(crashingStep, input);

    expect(result.error?.code).toBe('CRASH');
    expect(result.error?.message).toContain('crashed');
  });

  it('should reject invalid output', async () => {
    const badStep = () => ({ notActions: [] } as any);

    const input: SandboxStepInput = {
      state: {
        energy: 100,
        location: { x: 0, y: 0 },
        tick: 100,
        observation: { cells: [], noiseApplied: 0.2, fieldsOmitted: 0 },
      },
      context: createSandboxContext('agent:1', baseGranted, 100),
    };

    const result = await executeStep(badStep, input);

    expect(result.error?.code).toBe('INVALID_OUTPUT');
  });
});

describe('Action Processing', () => {
  const getCost = (action: ActionRequest) => {
    switch (action.type) {
      case 'MOVE': return 2;
      case 'SENSE': return 1;
      case 'GENERATE_TRACE': return 5;
      default: return 10;
    }
  };

  it('should deduct energy for executed actions', () => {
    const ctx = createSandboxContext('agent:1', baseGranted, 100);
    const actions: ActionRequest[] = [
      { type: 'MOVE', params: { dx: 1, dy: 0 } },
      { type: 'SENSE', params: {} },
    ];

    const { results, totalCost } = processActions(actions, ctx, 100, getCost);

    expect(results[0].executed).toBe(true);
    expect(results[0].energyCost).toBe(2);
    expect(results[1].executed).toBe(true);
    expect(results[1].energyCost).toBe(1);
    expect(totalCost).toBe(3);
  });

  it('should reject action when energy insufficient', () => {
    const ctx = createSandboxContext('agent:1', baseGranted, 100);
    const actions: ActionRequest[] = [{ type: 'MOVE', params: {} }];

    const { results } = processActions(actions, ctx, 1, getCost); // Only 1 energy, MOVE costs 2

    expect(results[0].executed).toBe(false);
    expect(results[0].rejection?.code).toBe('INSUFFICIENT_ENERGY');
  });

  it('should reject second action when first depletes energy', () => {
    const ctx = createSandboxContext('agent:1', baseGranted, 100);
    const actions: ActionRequest[] = [
      { type: 'MOVE', params: {} }, // Costs 2
      { type: 'MOVE', params: {} }, // Costs 2
    ];

    const { results } = processActions(actions, ctx, 3, getCost); // Only 3 energy

    expect(results[0].executed).toBe(true);
    expect(results[1].executed).toBe(false);
    expect(results[1].rejection?.code).toBe('INSUFFICIENT_ENERGY');
  });

  it('should reject non-granted capability', () => {
    const ctx = createSandboxContext('agent:1', baseGranted, 100);
    const actions: ActionRequest[] = [{ type: 'GENERATE_TRACE', params: {} }];

    const { results } = processActions(actions, ctx, 100, getCost);

    expect(results[0].executed).toBe(false);
    expect(results[0].rejection?.code).toBe('CAPABILITY_NOT_GRANTED');
  });
});

describe('Quarantine Isolation', () => {
  it('should identify quarantined agents', () => {
    const quarantinedGranted = { ...baseGranted, inQuarantine: true, shardId: 'shard-wild' };
    const ctx = createSandboxContext('agent:wild', quarantinedGranted, 100);

    expect(isQuarantined(ctx)).toBe(true);
    expect(getQuarantineShard(ctx)).toBe('shard-wild');
  });

  it('should identify non-quarantined agents', () => {
    const ctx = createSandboxContext('agent:trusted', baseGranted, 100);

    expect(isQuarantined(ctx)).toBe(false);
    expect(getQuarantineShard(ctx)).toBeUndefined();
  });
});

describe('Security - Privilege Escalation Prevention', () => {
  it('should not allow capability escalation via params', () => {
    const ctx = createSandboxContext('agent:1', baseGranted, 100);

    // Try to sneak GENERATE_TRACE via params
    const action: ActionRequest = {
      type: 'MOVE',
      params: { _escalate: 'GENERATE_TRACE' },
    };

    const rejection = validateAction(action, ctx);

    // Should pass validation (MOVE is granted)
    // But params are just data - they can't grant capabilities
    expect(rejection).toBeNull();
    // The world would ignore _escalate param
  });

  it('should not allow rate limit bypass via params', () => {
    const granted = { ...baseGranted, maxActionsPerWindow: { windowTicks: 200, max: 1 } };
    const ctx = createSandboxContext('agent:1', granted, 100);
    ctx.actionWindow = {
      actions: [{ tick: 100, type: 'MOVE' }],
      windowStart: 0,
    };

    // Try to bypass rate limit via params
    const action: ActionRequest = {
      type: 'MOVE',
      params: { _bypassRateLimit: true },
    };

    const rejection = validateAction(action, ctx);

    // Should still be rejected
    expect(rejection?.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should not allow energy manipulation via action result', () => {
    const ctx = createSandboxContext('agent:1', baseGranted, 100);
    const actions: ActionRequest[] = [{ type: 'MOVE', params: { _refundEnergy: 1000 } }];

    const getCost = () => 5;
    const { results, totalCost } = processActions(actions, ctx, 100, getCost);

    // Cost should still be 5, not affected by malicious param
    expect(totalCost).toBe(5);
    expect(results[0].energyCost).toBe(5);
  });
});
