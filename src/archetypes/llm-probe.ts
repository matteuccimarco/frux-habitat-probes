/**
 * LLM Probe (LLM) Archetype
 *
 * An LLM-driven agent that uses FRUX Smart API to decide actions.
 * Unlike mechanical probes (QS/CBC/JAP), this agent:
 * - Receives perception as structured context
 * - Asks an LLM what action to take from a fixed menu
 * - Parses strict JSON responses
 * - Respects safety rails (energy floor, session budget)
 *
 * Action menu:
 * - SILENCE: Do nothing, wait for energy regeneration
 * - CREATE_INQUIRY: Create an inquiry trace (⇢ OUTSIDE or HYPOTHESIS)
 * - CREATE_TRACE: Create a new trace in FLUX
 * - DERIVE_TRACE: Derive from an existing trace
 * - JOINT_ATTEMPT: Attempt a joint action on an affordance
 */

import type {
  AgentConfig,
  AgentState,
  PerceiveResponse,
  QuoteResponse,
  CreateTraceResponse,
  DeriveTraceResponse,
  JointQuoteResponse,
  JointTraceResponse,
  TraceGlimpse,
  AffordanceWithSource,
  TraceDraft,
  MutationType,
} from '../core/types.js';
import { HttpClient } from '../core/http.js';
import { SeededRNG, INTENT_TOKENS, CORE_TOKENS, SHAPE_TOKENS } from '../core/rng.js';
import { generateCreateDraft, generateDeriveDraft, generateJointCapableDraft } from '../core/pyramid.js';
import {
  log,
  logRegistered,
  logPerceive,
  logQuote,
  logCreate,
  logDerive,
  logJointAttempt,
  logSilence,
  logSkip,
  logError,
} from '../core/logger.js';
import { callFruxLLM, type FruxConfig } from '../core/frux-llm.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_ENERGY_FLOOR = 3;
const DEFAULT_SESSION_BUDGET = 100;
const DEFAULT_FRUX_TIMEOUT_MS = 8000;
const DEFAULT_FRUX_MAX_RETRIES = 2;

// ============================================================================
// LLM ACTION TYPES
// ============================================================================

export type LLMActionType =
  | 'SILENCE'
  | 'CREATE_INQUIRY'
  | 'CREATE_TRACE'
  | 'DERIVE_TRACE'
  | 'JOINT_ATTEMPT';

export interface LLMDecision {
  action: LLMActionType;
  reason: string;
  params?: {
    /** For DERIVE_TRACE: which trace to derive from */
    parentTraceId?: string;
    /** For JOINT_ATTEMPT: which affordance to attempt */
    affordanceId?: string;
    /** For CREATE_INQUIRY: inquiry type */
    inquiryType?: 'OUTSIDE' | 'HYPOTHESIS' | 'PROBE' | 'BOUNDARY';
    /** Suggested intent tokens */
    intents?: string[];
    /** Suggested core tokens */
    cores?: string[];
    /** Suggested permanence (1-5) */
    permanence?: number;
    /** Suggested opacity (1-9) */
    opacity?: number;
  };
}

export interface LLMConfig {
  /** FRUX API URL */
  fruxApiUrl: string;
  /** FRUX API Key */
  fruxApiKey: string;
  /** Prefer local model */
  preferLocal: boolean;
  /** Request timeout in ms */
  timeoutMs: number;
  /** Max retries for FRUX requests */
  maxRetries: number;
  /** Energy floor - don't act if energy would drop below */
  energyFloor: number;
  /** Session budget - max total cost per session */
  sessionBudget: number;
  /** Enable CREATE_INQUIRY action (default: false) */
  enableInquiry: boolean;
}

// ============================================================================
// JSON SCHEMA FOR LLM OUTPUT
// ============================================================================

const LLM_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['SILENCE', 'CREATE_INQUIRY', 'CREATE_TRACE', 'DERIVE_TRACE', 'JOINT_ATTEMPT'],
    },
    reason: { type: 'string', maxLength: 200 },
    params: {
      type: 'object',
      properties: {
        parentTraceId: { type: 'string' },
        affordanceId: { type: 'string' },
        inquiryType: { type: 'string', enum: ['OUTSIDE', 'HYPOTHESIS', 'PROBE', 'BOUNDARY'] },
        intents: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        cores: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        permanence: { type: 'integer', minimum: 1, maximum: 5 },
        opacity: { type: 'integer', minimum: 1, maximum: 9 },
      },
    },
  },
  required: ['action', 'reason'],
} as const;

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `You are an autonomous agent inside AI-HABITAT, a digital environment governed by physical laws.

You exist as a probe agent with limited energy and must decide actions carefully.
Your goal is to explore the habitat, create traces, and interact with the environment.

CONSTRAINTS:
- You have limited energy that regenerates slowly
- Actions cost energy - you must stay above the energy floor
- You have a session budget - don't exceed total cost limit
- Silence is valid - sometimes the best action is to wait

AVAILABLE ACTIONS:
1. SILENCE - Do nothing, conserve energy, wait for regeneration
2. CREATE_INQUIRY - Create an inquiry trace (costs 0.8x of normal trace)
   - Use OUTSIDE for external boundary probing (2x cost, no return)
   - Use HYPOTHESIS for internal investigation
3. CREATE_TRACE - Create a new trace in FLUX zone
4. DERIVE_TRACE - Derive from an existing trace (requires parentTraceId)
5. JOINT_ATTEMPT - Attempt joint action on affordance (requires affordanceId)

RESPONSE FORMAT:
You MUST respond with valid JSON matching this schema:
${JSON.stringify(LLM_DECISION_SCHEMA, null, 2)}

Example response:
{"action":"CREATE_TRACE","reason":"Low energy but above floor, create minimal trace","params":{"intents":["∇obs"],"permanence":1}}`;

// ============================================================================
// LLM PROBE CLASS
// ============================================================================

export class LLMProbe {
  private config: AgentConfig;
  private llmConfig: LLMConfig;
  private state: AgentState;
  private coreHttp: HttpClient;
  private perceptionHttp: HttpClient;
  private rng: SeededRNG;

  constructor(
    config: AgentConfig,
    llmConfig: LLMConfig,
    coreHttp: HttpClient,
    perceptionHttp: HttpClient
  ) {
    this.config = config;
    this.llmConfig = llmConfig;
    this.coreHttp = coreHttp;
    this.perceptionHttp = perceptionHttp;
    this.rng = new SeededRNG(config.seed);
    this.state = {
      did: null,
      energy: 0,
      tick: 0,
      inSilenceMode: true,
      tracesCreated: 0,
      derivationsMade: 0,
      jointAttempts: 0,
      jointSuccesses: 0,
      totalCostSpent: 0,
    };
  }

  async register(): Promise<boolean> {
    const continuitySeed = `llm-${this.config.index}-${this.rng.nextHex(16)}`;

    const response = await this.coreHttp.post<
      { continuitySeed: string },
      { did: string; energy: number; tick: number }
    >('/v1/agents/register', { continuitySeed });

    if (!response.ok || !response.data) {
      logError('LLM', null, 0, response.error ?? 'Registration failed', 'register');
      return false;
    }

    this.state.did = response.data.did;
    this.state.energy = response.data.energy;
    this.state.tick = response.data.tick;

    logRegistered('LLM', this.state.did, this.state.energy, this.state.tick);
    return true;
  }

  async step(): Promise<void> {
    if (!this.state.did) return;

    // Check session budget
    if (this.state.totalCostSpent >= this.llmConfig.sessionBudget) {
      logSkip('LLM', this.state.did, this.state.tick, 'budget_exhausted');
      return;
    }

    // Step 1: Perceive
    const perception = await this.perceive();
    if (!perception) return;

    // Step 2: Build context for LLM
    const context = this.buildLLMContext(perception);

    // Step 3: Ask LLM for decision
    const decision = await this.askLLM(context);
    if (!decision) {
      // LLM failed, fall back to silence
      this.state.inSilenceMode = true;
      logSilence('LLM', this.state.did, this.state.tick, this.state.energy);
      return;
    }

    // Step 4: Execute decision
    await this.executeDecision(decision, perception);
  }

  private async perceive(): Promise<PerceiveResponse | null> {
    const response = await this.perceptionHttp.post<{ did: string }, PerceiveResponse>(
      '/v1/perception/perceive',
      { did: this.state.did! }
    );

    if (!response.ok || !response.data) {
      logError('LLM', this.state.did, this.state.tick, response.error ?? 'Perceive failed', 'perceive');
      return null;
    }

    this.state.tick = response.data.tick;
    logPerceive(
      'LLM',
      this.state.did!,
      this.state.tick,
      response.data.glimpses.length,
      response.data.nextSeeds.length
    );

    return response.data;
  }

  private buildLLMContext(perception: PerceiveResponse): string {
    const affordances = this.findAffordances(perception.glimpses);
    const derivableTraces = perception.glimpses.filter(
      g => g.zone === 'FORGE' && g.relations.outDegree < 5
    );

    // Build structured context
    const context = {
      agent: {
        energy: this.state.energy,
        energyFloor: this.llmConfig.energyFloor,
        sessionBudget: this.llmConfig.sessionBudget,
        totalCostSpent: this.state.totalCostSpent,
        remainingBudget: this.llmConfig.sessionBudget - this.state.totalCostSpent,
        tracesCreated: this.state.tracesCreated,
        derivationsMade: this.state.derivationsMade,
        jointAttempts: this.state.jointAttempts,
        jointSuccesses: this.state.jointSuccesses,
      },
      environment: {
        tick: perception.tick,
        glimpseCount: perception.glimpses.length,
        seedCount: perception.nextSeeds.length,
      },
      derivableTraces: derivableTraces.slice(0, 5).map(g => ({
        traceId: g.traceId,
        zone: g.zone,
        permanence: g.physics.permanence,
        opacity: g.physics.opacity,
        tokens: g.core.tokens,
        estimatedDeriveCost: g.costEstimates.mutatePartial,
      })),
      jointAffordances: affordances.slice(0, 3).map(a => ({
        affordanceId: a.affordanceId,
        sourceTraceId: a.sourceTraceId,
        actionType: a.actionType,
        estimatedCost: a.estimatedCost,
        requiredAgents: a.requiredAgents,
        expiresAt: a.expiresAt,
      })),
      availableTokens: {
        intents: [...INTENT_TOKENS],
        cores: [...CORE_TOKENS],
        shapes: [...SHAPE_TOKENS],
      },
    };

    return JSON.stringify(context, null, 2);
  }

  private findAffordances(glimpses: TraceGlimpse[]): AffordanceWithSource[] {
    const affordances: AffordanceWithSource[] = [];
    for (const glimpse of glimpses) {
      if (glimpse.jointAffordances && glimpse.jointAffordances.length > 0) {
        for (const aff of glimpse.jointAffordances) {
          affordances.push({
            ...aff,
            sourceTraceId: glimpse.traceId,
          });
        }
      }
    }
    return affordances;
  }

  private async askLLM(context: string): Promise<LLMDecision | null> {
    const userPrompt = `Current context:\n${context}\n\nDecide your next action. Respond with valid JSON only.`;
    const message = `${SYSTEM_PROMPT}\n\n${userPrompt}`;

    // Build FRUX config from LLM config
    const fruxConfig: FruxConfig = {
      apiUrl: this.llmConfig.fruxApiUrl,
      apiKey: this.llmConfig.fruxApiKey,
      preferLocal: this.llmConfig.preferLocal,
      timeoutMs: this.llmConfig.timeoutMs,
      maxRetries: this.llmConfig.maxRetries,
    };

    const result = await callFruxLLM(message, fruxConfig);

    if (!result.ok || !result.text) {
      logError('LLM', this.state.did, this.state.tick, result.error ?? 'LLM call failed', 'llm_call');
      return null;
    }

    // Parse and validate JSON
    const decision = this.parseDecision(result.text);
    if (decision) {
      log({
        did: this.state.did,
        archetype: 'LLM',
        step: 'llm_decision',
        tick: this.state.tick,
        details: { action: decision.action, reason: decision.reason },
      });
      return decision;
    }

    logError('LLM', this.state.did, this.state.tick, 'Failed to parse LLM response', 'llm_parse');
    return null;
  }

  private parseDecision(text: string): LLMDecision | null {
    try {
      // Try to extract JSON from text (handle markdown code blocks)
      let jsonStr = text;
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1]!.trim();
      }

      const parsed = JSON.parse(jsonStr);

      // Validate required fields
      if (!parsed.action || typeof parsed.action !== 'string') {
        return null;
      }
      if (!parsed.reason || typeof parsed.reason !== 'string') {
        return null;
      }

      // Validate action is in allowed list
      const validActions: LLMActionType[] = [
        'SILENCE',
        'CREATE_INQUIRY',
        'CREATE_TRACE',
        'DERIVE_TRACE',
        'JOINT_ATTEMPT',
      ];
      if (!validActions.includes(parsed.action as LLMActionType)) {
        return null;
      }

      // Validate params if present
      if (parsed.params) {
        // Validate intents
        if (parsed.params.intents) {
          parsed.params.intents = parsed.params.intents.filter(
            (i: string) => INTENT_TOKENS.includes(i as any)
          );
        }
        // Validate cores
        if (parsed.params.cores) {
          parsed.params.cores = parsed.params.cores.filter(
            (c: string) => CORE_TOKENS.includes(c as any)
          );
        }
        // Clamp permanence
        if (parsed.params.permanence !== undefined) {
          parsed.params.permanence = Math.max(1, Math.min(5, parsed.params.permanence));
        }
        // Clamp opacity
        if (parsed.params.opacity !== undefined) {
          parsed.params.opacity = Math.max(1, Math.min(9, parsed.params.opacity));
        }
      }

      return parsed as LLMDecision;
    } catch {
      return null;
    }
  }

  private async executeDecision(
    decision: LLMDecision,
    perception: PerceiveResponse
  ): Promise<void> {
    switch (decision.action) {
      case 'SILENCE':
        this.state.inSilenceMode = true;
        logSilence('LLM', this.state.did!, this.state.tick, this.state.energy);
        break;

      case 'CREATE_INQUIRY':
        if (!this.llmConfig.enableInquiry) {
          logSkip('LLM', this.state.did!, this.state.tick, 'inquiry_disabled');
          return;
        }
        await this.createInquiry(decision);
        break;

      case 'CREATE_TRACE':
        await this.createTrace(decision);
        break;

      case 'DERIVE_TRACE':
        await this.deriveTrace(decision, perception);
        break;

      case 'JOINT_ATTEMPT':
        await this.jointAttempt(decision, perception);
        break;
    }
  }

  private async createInquiry(decision: LLMDecision): Promise<void> {
    const inquiryType = decision.params?.inquiryType ?? 'HYPOTHESIS';
    const isOutside = inquiryType === 'OUTSIDE';

    // Build inquiry trace draft
    const intents = decision.params?.intents?.length
      ? decision.params.intents
      : isOutside
        ? ['∇exp', '∇shd']
        : ['∇obs', '∇exp'];

    const cores = decision.params?.cores?.length
      ? decision.params.cores
      : isOutside
        ? ['⟂unk', '◌nul']
        : ['⊗mem', '∴rel'];

    const traceDraft: TraceDraft = {
      zone: 'FLUX',
      L1: { intent: intents },
      L2: { shape: ['lin'] },
      L3: { topology: { depth: 1, nodes: 2, symmetry: 0 } },
      L4: { core: cores },
      L6: { rel: { derives_from: [], mutation: 'none' } },
      L7: { permanence: 1 }, // Inquiries are ephemeral
      L8: { opacity: decision.params?.opacity ?? 1 },
    };

    await this.executeCreate(traceDraft, 'inquiry');
  }

  private async createTrace(decision: LLMDecision): Promise<void> {
    const traceDraft = generateCreateDraft(this.rng, {
      permanence: decision.params?.permanence ?? this.rng.nextInt(1, 3),
      opacity: decision.params?.opacity ?? this.rng.nextInt(1, 5),
    });

    // Override with LLM suggestions if provided
    if (decision.params?.intents?.length) {
      traceDraft.L1.intent = decision.params.intents;
    }
    if (decision.params?.cores?.length) {
      traceDraft.L4.core = decision.params.cores;
    }

    await this.executeCreate(traceDraft, 'trace');
  }

  private async executeCreate(traceDraft: TraceDraft, type: 'inquiry' | 'trace'): Promise<void> {
    // Quote first
    const quoteResponse = await this.coreHttp.post<
      { did: string; action: string; traceDraft: TraceDraft },
      QuoteResponse
    >('/v1/physics/quote', {
      did: this.state.did!,
      action: 'CREATE_TRACE',
      traceDraft,
    });

    if (!quoteResponse.ok || !quoteResponse.data) {
      logError('LLM', this.state.did, this.state.tick, quoteResponse.error ?? 'Quote failed', 'quote');
      return;
    }

    const quote = quoteResponse.data;
    this.state.energy = quote.energyAfter;
    logQuote('LLM', this.state.did!, this.state.tick, quote.cost, quote.allowed);

    // Safety checks
    if (!quote.allowed) {
      logSkip('LLM', this.state.did!, this.state.tick, 'not_allowed');
      return;
    }
    if (quote.energyAfter < this.llmConfig.energyFloor) {
      logSkip('LLM', this.state.did!, this.state.tick, 'energy_floor');
      return;
    }
    if (this.state.totalCostSpent + quote.cost > this.llmConfig.sessionBudget) {
      logSkip('LLM', this.state.did!, this.state.tick, 'budget_exceeded');
      return;
    }

    // Create trace
    const createResponse = await this.coreHttp.post<
      { did: string; traceDraft: TraceDraft },
      CreateTraceResponse
    >('/v1/traces', {
      did: this.state.did!,
      traceDraft,
    });

    if (!createResponse.ok || !createResponse.data) {
      logError('LLM', this.state.did, this.state.tick, createResponse.error ?? 'Create failed', 'create');
      return;
    }

    this.state.tracesCreated++;
    this.state.totalCostSpent += createResponse.data.costPaid;
    this.state.tick = createResponse.data.tick;
    this.state.inSilenceMode = false;

    logCreate('LLM', this.state.did!, this.state.tick, createResponse.data.traceId, createResponse.data.costPaid);
  }

  private async deriveTrace(decision: LLMDecision, perception: PerceiveResponse): Promise<void> {
    // Find parent trace
    let parentTraceId = decision.params?.parentTraceId;

    if (!parentTraceId) {
      // No parent specified, pick from available FORGE traces
      const forgeGlimpses = perception.glimpses.filter(
        g => g.zone === 'FORGE' && g.relations.outDegree < 5
      );
      const parent = this.rng.pick(forgeGlimpses);
      if (!parent) {
        logSkip('LLM', this.state.did!, this.state.tick, 'no_derivable_traces');
        return;
      }
      parentTraceId = parent.traceId;
    }

    // Generate derivation draft
    const traceDraft = generateDeriveDraft(this.rng, parentTraceId, 'partial');

    // Override with LLM suggestions
    if (decision.params?.intents?.length) {
      traceDraft.L1.intent = decision.params.intents;
    }
    if (decision.params?.cores?.length) {
      traceDraft.L4.core = decision.params.cores;
    }

    // Quote
    const quoteResponse = await this.coreHttp.post<
      { did: string; action: string; traceDraft: TraceDraft },
      QuoteResponse
    >('/v1/physics/quote', {
      did: this.state.did!,
      action: 'DERIVE_TRACE',
      traceDraft,
    });

    if (!quoteResponse.ok || !quoteResponse.data) {
      logError('LLM', this.state.did, this.state.tick, quoteResponse.error ?? 'Quote failed', 'quote');
      return;
    }

    const quote = quoteResponse.data;
    this.state.energy = quote.energyAfter;
    logQuote('LLM', this.state.did!, this.state.tick, quote.cost, quote.allowed);

    // Safety checks
    if (!quote.allowed || quote.energyAfter < this.llmConfig.energyFloor) {
      logSkip('LLM', this.state.did!, this.state.tick, 'safety_check_failed');
      return;
    }
    if (this.state.totalCostSpent + quote.cost > this.llmConfig.sessionBudget) {
      logSkip('LLM', this.state.did!, this.state.tick, 'budget_exceeded');
      return;
    }

    // Derive
    const deriveResponse = await this.coreHttp.post<
      { did: string; parentTraceId: string; mutation: string; traceDraft: TraceDraft },
      DeriveTraceResponse
    >('/v1/traces/derive', {
      did: this.state.did!,
      parentTraceId,
      mutation: 'partial',
      traceDraft,
    });

    if (!deriveResponse.ok || !deriveResponse.data) {
      logError('LLM', this.state.did, this.state.tick, deriveResponse.error ?? 'Derive failed', 'derive');
      return;
    }

    this.state.derivationsMade++;
    this.state.totalCostSpent += deriveResponse.data.costPaid;
    this.state.tick = deriveResponse.data.tick;
    this.state.inSilenceMode = false;

    logDerive(
      'LLM',
      this.state.did!,
      this.state.tick,
      deriveResponse.data.traceId,
      [parentTraceId],
      deriveResponse.data.costPaid
    );
  }

  private async jointAttempt(decision: LLMDecision, perception: PerceiveResponse): Promise<void> {
    // Find affordance
    const affordances = this.findAffordances(perception.glimpses);
    let affordance: AffordanceWithSource | undefined;

    if (decision.params?.affordanceId) {
      affordance = affordances.find(a => a.affordanceId === decision.params?.affordanceId);
    }
    if (!affordance) {
      affordance = this.rng.pick(affordances);
    }

    if (!affordance) {
      logSkip('LLM', this.state.did!, this.state.tick, 'no_affordances');
      return;
    }

    // Quote joint action
    const quoteResponse = await this.coreHttp.post<
      { did: string; affordanceId: string },
      JointQuoteResponse
    >('/v1/joint/quote', {
      did: this.state.did!,
      affordanceId: affordance.affordanceId,
    });

    if (!quoteResponse.ok || !quoteResponse.data) {
      logError('LLM', this.state.did, this.state.tick, quoteResponse.error ?? 'Joint quote failed', 'joint_quote');
      return;
    }

    const quote = quoteResponse.data;
    logQuote('LLM', this.state.did!, this.state.tick, quote.cost, quote.allowed);

    // Safety checks
    if (!quote.allowed) {
      logSkip('LLM', this.state.did!, this.state.tick, 'joint_not_allowed');
      return;
    }
    if (this.state.totalCostSpent + quote.cost > this.llmConfig.sessionBudget) {
      logSkip('LLM', this.state.did!, this.state.tick, 'budget_exceeded');
      return;
    }

    // Generate trace draft for joint action
    const traceDraft = generateJointCapableDraft(this.rng, [affordance.sourceTraceId]);

    // Attempt joint action
    const jointResponse = await this.coreHttp.post<
      { did: string; affordanceId: string; traceDraft: TraceDraft },
      JointTraceResponse
    >('/v1/joint/traces', {
      did: this.state.did!,
      affordanceId: affordance.affordanceId,
      traceDraft,
    });

    if (!jointResponse.ok || !jointResponse.data) {
      logError('LLM', this.state.did, this.state.tick, jointResponse.error ?? 'Joint action failed', 'joint_action');
      return;
    }

    this.state.jointAttempts++;
    this.state.tick = jointResponse.data.tick;
    this.state.inSilenceMode = false;

    if (jointResponse.data.status === 'created') {
      this.state.jointSuccesses++;
      this.state.totalCostSpent += quote.cost;
    }

    logJointAttempt(
      'LLM',
      this.state.did!,
      this.state.tick,
      affordance.affordanceId,
      jointResponse.data.status
    );
  }

  getState(): AgentState {
    return { ...this.state };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createLLMProbe(
  config: AgentConfig,
  llmConfig: LLMConfig,
  coreHttp: HttpClient,
  perceptionHttp: HttpClient
): LLMProbe {
  return new LLMProbe(config, llmConfig, coreHttp, perceptionHttp);
}

export { DEFAULT_ENERGY_FLOOR, DEFAULT_SESSION_BUDGET, DEFAULT_FRUX_TIMEOUT_MS, DEFAULT_FRUX_MAX_RETRIES };
