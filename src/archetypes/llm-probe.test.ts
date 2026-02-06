/**
 * Tests for LLM Probe
 *
 * Focuses on:
 * - Strict JSON parsing
 * - Forbidden actions (CREATE_INQUIRY when disabled)
 * - Quote-before-act pattern
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMProbe, createLLMProbe, type LLMConfig, type LLMDecision } from './llm-probe.js';
import type { AgentConfig } from '../core/types.js';

// Mock the FRUX LLM client
vi.mock('../core/frux-llm.js', () => ({
  callFruxLLM: vi.fn(),
}));

// Mock the logger to avoid console noise
vi.mock('../core/logger.js', () => ({
  log: vi.fn(),
  logRegistered: vi.fn(),
  logPerceive: vi.fn(),
  logQuote: vi.fn(),
  logCreate: vi.fn(),
  logDerive: vi.fn(),
  logJointAttempt: vi.fn(),
  logSilence: vi.fn(),
  logSkip: vi.fn(),
  logError: vi.fn(),
}));

describe('LLM Probe', () => {
  const mockAgentConfig: AgentConfig = {
    archetype: 'LLM',
    index: 0,
    coreApiUrl: 'http://localhost:9670',
    perceptionApiUrl: 'http://localhost:9671',
    seed: 12345,
  };

  const mockLLMConfig: LLMConfig = {
    fruxApiUrl: 'https://api.frux.pro',
    fruxApiKey: 'sk-test-key',
    preferLocal: true,
    timeoutMs: 5000,
    maxRetries: 1,
    energyFloor: 3,
    sessionBudget: 100,
    enableInquiry: false,
  };

  const mockCoreHttp = {
    post: vi.fn(),
    get: vi.fn(),
  };

  const mockPerceptionHttp = {
    post: vi.fn(),
    get: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('JSON Parsing', () => {
    // Access the private parseDecision method via prototype
    const getParseDecision = () => {
      const probe = createLLMProbe(
        mockAgentConfig,
        mockLLMConfig,
        mockCoreHttp as any,
        mockPerceptionHttp as any
      );
      return (probe as any).parseDecision.bind(probe);
    };

    it('parses valid SILENCE action', () => {
      const parseDecision = getParseDecision();
      const result = parseDecision('{"action":"SILENCE","reason":"Conserving energy"}');

      expect(result).toEqual({
        action: 'SILENCE',
        reason: 'Conserving energy',
      });
    });

    it('parses valid CREATE_TRACE action with params', () => {
      const parseDecision = getParseDecision();
      const result = parseDecision(JSON.stringify({
        action: 'CREATE_TRACE',
        reason: 'Creating minimal trace',
        params: {
          intents: ['∇obs'],
          permanence: 2,
        },
      }));

      expect(result?.action).toBe('CREATE_TRACE');
      expect(result?.params?.intents).toContain('∇obs');
      expect(result?.params?.permanence).toBe(2);
    });

    it('extracts JSON from markdown code blocks', () => {
      const parseDecision = getParseDecision();
      const result = parseDecision('```json\n{"action":"SILENCE","reason":"test"}\n```');

      expect(result?.action).toBe('SILENCE');
    });

    it('rejects invalid action type', () => {
      const parseDecision = getParseDecision();
      const result = parseDecision('{"action":"INVALID_ACTION","reason":"test"}');

      expect(result).toBeNull();
    });

    it('rejects missing action field', () => {
      const parseDecision = getParseDecision();
      const result = parseDecision('{"reason":"missing action"}');

      expect(result).toBeNull();
    });

    it('rejects missing reason field', () => {
      const parseDecision = getParseDecision();
      const result = parseDecision('{"action":"SILENCE"}');

      expect(result).toBeNull();
    });

    it('rejects invalid JSON', () => {
      const parseDecision = getParseDecision();
      const result = parseDecision('not valid json');

      expect(result).toBeNull();
    });

    it('filters invalid intent tokens', () => {
      const parseDecision = getParseDecision();
      const result = parseDecision(JSON.stringify({
        action: 'CREATE_TRACE',
        reason: 'test',
        params: {
          intents: ['∇obs', 'INVALID_TOKEN', '∇exp'],
        },
      }));

      expect(result?.params?.intents).toEqual(['∇obs', '∇exp']);
    });

    it('clamps permanence to valid range', () => {
      const parseDecision = getParseDecision();

      const result1 = parseDecision(JSON.stringify({
        action: 'CREATE_TRACE',
        reason: 'test',
        params: { permanence: 10 },
      }));
      expect(result1?.params?.permanence).toBe(5);

      const result2 = parseDecision(JSON.stringify({
        action: 'CREATE_TRACE',
        reason: 'test',
        params: { permanence: -5 },
      }));
      expect(result2?.params?.permanence).toBe(1);
    });

    it('clamps opacity to valid range', () => {
      const parseDecision = getParseDecision();

      const result1 = parseDecision(JSON.stringify({
        action: 'CREATE_TRACE',
        reason: 'test',
        params: { opacity: 15 },
      }));
      expect(result1?.params?.opacity).toBe(9);

      const result2 = parseDecision(JSON.stringify({
        action: 'CREATE_TRACE',
        reason: 'test',
        params: { opacity: 0 },
      }));
      expect(result2?.params?.opacity).toBe(1);
    });
  });

  describe('Forbidden Actions', () => {
    it('skips CREATE_INQUIRY when enableInquiry is false', async () => {
      const { logSkip } = await import('../core/logger.js');
      const probe = createLLMProbe(
        mockAgentConfig,
        { ...mockLLMConfig, enableInquiry: false },
        mockCoreHttp as any,
        mockPerceptionHttp as any
      );

      // Set up probe state
      (probe as any).state.did = 'agent:0x123';
      (probe as any).state.tick = 100;

      // Call executeDecision directly
      const decision: LLMDecision = {
        action: 'CREATE_INQUIRY',
        reason: 'Testing inquiry',
      };

      await (probe as any).executeDecision(decision, { glimpses: [], nextSeeds: [], tick: 100 });

      expect(logSkip).toHaveBeenCalledWith('LLM', 'agent:0x123', 100, 'inquiry_disabled');
    });

    it('allows CREATE_INQUIRY when enableInquiry is true', async () => {
      const { logSkip } = await import('../core/logger.js');
      const probe = createLLMProbe(
        mockAgentConfig,
        { ...mockLLMConfig, enableInquiry: true },
        mockCoreHttp as any,
        mockPerceptionHttp as any
      );

      // Set up probe state
      (probe as any).state.did = 'agent:0x123';
      (probe as any).state.tick = 100;
      (probe as any).state.totalCostSpent = 0;

      // Mock the quote response
      mockCoreHttp.post.mockResolvedValueOnce({
        ok: true,
        data: { cost: 1.0, allowed: true, energyAfter: 8.0 },
      });

      // Mock the create response
      mockCoreHttp.post.mockResolvedValueOnce({
        ok: true,
        data: { traceId: 'trace:0x456', costPaid: 1.0, tick: 101 },
      });

      const decision: LLMDecision = {
        action: 'CREATE_INQUIRY',
        reason: 'Testing inquiry',
      };

      await (probe as any).executeDecision(decision, { glimpses: [], nextSeeds: [], tick: 100 });

      // Should NOT have called logSkip with inquiry_disabled
      expect(logSkip).not.toHaveBeenCalledWith('LLM', expect.any(String), expect.any(Number), 'inquiry_disabled');

      // Should have called quote endpoint
      expect(mockCoreHttp.post).toHaveBeenCalledWith('/v1/physics/quote', expect.any(Object));
    });
  });

  describe('Quote-Before-Act Pattern', () => {
    it('skips action when quote returns allowed: false', async () => {
      const { logSkip } = await import('../core/logger.js');
      const probe = createLLMProbe(
        mockAgentConfig,
        mockLLMConfig,
        mockCoreHttp as any,
        mockPerceptionHttp as any
      );

      // Set up probe state
      (probe as any).state.did = 'agent:0x123';
      (probe as any).state.tick = 100;
      (probe as any).state.totalCostSpent = 0;

      // Mock quote response with allowed: false
      mockCoreHttp.post.mockResolvedValueOnce({
        ok: true,
        data: { cost: 5.0, allowed: false, energyAfter: 3.0, reason: 'insufficient_energy' },
      });

      const decision: LLMDecision = {
        action: 'CREATE_TRACE',
        reason: 'Testing',
      };

      await (probe as any).executeDecision(decision, { glimpses: [], nextSeeds: [], tick: 100 });

      expect(logSkip).toHaveBeenCalledWith('LLM', 'agent:0x123', 100, 'not_allowed');
      expect(mockCoreHttp.post).toHaveBeenCalledTimes(1); // Only quote, no create
    });

    it('skips action when energy would drop below floor', async () => {
      const { logSkip } = await import('../core/logger.js');
      const probe = createLLMProbe(
        mockAgentConfig,
        { ...mockLLMConfig, energyFloor: 5 },
        mockCoreHttp as any,
        mockPerceptionHttp as any
      );

      // Set up probe state
      (probe as any).state.did = 'agent:0x123';
      (probe as any).state.tick = 100;
      (probe as any).state.totalCostSpent = 0;

      // Mock quote response - allowed but energy would go below floor
      mockCoreHttp.post.mockResolvedValueOnce({
        ok: true,
        data: { cost: 5.0, allowed: true, energyAfter: 3.0 }, // Below floor of 5
      });

      const decision: LLMDecision = {
        action: 'CREATE_TRACE',
        reason: 'Testing',
      };

      await (probe as any).executeDecision(decision, { glimpses: [], nextSeeds: [], tick: 100 });

      expect(logSkip).toHaveBeenCalledWith('LLM', 'agent:0x123', 100, 'energy_floor');
      expect(mockCoreHttp.post).toHaveBeenCalledTimes(1); // Only quote, no create
    });

    it('skips action when session budget would be exceeded', async () => {
      const { logSkip } = await import('../core/logger.js');
      const probe = createLLMProbe(
        mockAgentConfig,
        { ...mockLLMConfig, sessionBudget: 10 },
        mockCoreHttp as any,
        mockPerceptionHttp as any
      );

      // Set up probe state - already spent 8
      (probe as any).state.did = 'agent:0x123';
      (probe as any).state.tick = 100;
      (probe as any).state.totalCostSpent = 8;

      // Mock quote response - cost of 5 would exceed budget of 10
      mockCoreHttp.post.mockResolvedValueOnce({
        ok: true,
        data: { cost: 5.0, allowed: true, energyAfter: 10.0 },
      });

      const decision: LLMDecision = {
        action: 'CREATE_TRACE',
        reason: 'Testing',
      };

      await (probe as any).executeDecision(decision, { glimpses: [], nextSeeds: [], tick: 100 });

      expect(logSkip).toHaveBeenCalledWith('LLM', 'agent:0x123', 100, 'budget_exceeded');
      expect(mockCoreHttp.post).toHaveBeenCalledTimes(1); // Only quote, no create
    });
  });

  describe('State Management', () => {
    it('initializes with correct default state', () => {
      const probe = createLLMProbe(
        mockAgentConfig,
        mockLLMConfig,
        mockCoreHttp as any,
        mockPerceptionHttp as any
      );

      const state = probe.getState();

      expect(state.did).toBeNull();
      expect(state.energy).toBe(0);
      expect(state.tick).toBe(0);
      expect(state.inSilenceMode).toBe(true);
      expect(state.tracesCreated).toBe(0);
      expect(state.derivationsMade).toBe(0);
      expect(state.jointAttempts).toBe(0);
      expect(state.jointSuccesses).toBe(0);
      expect(state.totalCostSpent).toBe(0);
    });
  });
});
