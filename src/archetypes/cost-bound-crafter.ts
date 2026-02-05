/**
 * Cost-Bound Crafter (CBC) Archetype
 *
 * Behavior:
 * - Active creator within cost budget
 * - Quote before every action (never acts blind)
 * - Creates in FLUX, derives in FORGE
 * - Respects session budget limit
 */

import type {
  AgentConfig,
  AgentState,
  PerceiveResponse,
  QuoteResponse,
  CreateTraceResponse,
  DeriveTraceResponse,
  TraceGlimpse,
  TraceDraft,
} from '../core/types.js';
import { HttpClient } from '../core/http.js';
import { SeededRNG } from '../core/rng.js';
import { generateCreateDraft, generateDeriveDraft } from '../core/pyramid.js';
import {
  logRegistered,
  logPerceive,
  logQuote,
  logCreate,
  logDerive,
  logSkip,
  logError,
} from '../core/logger.js';

const DEFAULT_COST_BUDGET = 50;
const DEFAULT_DERIVE_PROBABILITY = 0.4; // 40% chance to derive vs create

export class CostBoundCrafter {
  private config: AgentConfig;
  private state: AgentState;
  private coreHttp: HttpClient;
  private perceptionHttp: HttpClient;
  private rng: SeededRNG;
  private costBudget: number;
  private deriveProbability: number;

  constructor(config: AgentConfig, coreHttp: HttpClient, perceptionHttp: HttpClient) {
    this.config = config;
    this.coreHttp = coreHttp;
    this.perceptionHttp = perceptionHttp;
    this.rng = new SeededRNG(config.seed);
    this.costBudget = config.costBudget ?? DEFAULT_COST_BUDGET;
    this.deriveProbability = config.deriveProbability ?? DEFAULT_DERIVE_PROBABILITY;
    this.state = {
      did: null,
      energy: 0,
      tick: 0,
      inSilenceMode: false,
      tracesCreated: 0,
      derivationsMade: 0,
      jointAttempts: 0,
      jointSuccesses: 0,
      totalCostSpent: 0,
    };
  }

  async register(): Promise<boolean> {
    const continuitySeed = `cbc-${this.config.index}-${this.rng.nextHex(16)}`;

    const response = await this.coreHttp.post<{ continuitySeed: string }, { did: string; energy: number; tick: number }>(
      '/v1/agents/register',
      { continuitySeed }
    );

    if (!response.ok || !response.data) {
      logError('CBC', null, 0, response.error ?? 'Registration failed', 'register');
      return false;
    }

    this.state.did = response.data.did;
    this.state.energy = response.data.energy;
    this.state.tick = response.data.tick;

    logRegistered('CBC', this.state.did, this.state.energy, this.state.tick);
    return true;
  }

  async step(): Promise<void> {
    if (!this.state.did) return;

    // Check budget
    if (this.state.totalCostSpent >= this.costBudget) {
      logSkip('CBC', this.state.did, this.state.tick, 'budget_exhausted');
      return;
    }

    // Step 1: Perceive
    const perceiveResponse = await this.perceive();
    if (!perceiveResponse) return;

    // Step 2: Decide action (derive or create)
    const forgeGlimpses = perceiveResponse.glimpses.filter(
      g => g.zone === 'FORGE' && g.relations.outDegree < 5
    );

    const shouldDerive = forgeGlimpses.length > 0 && this.rng.nextBool(this.deriveProbability);

    if (shouldDerive) {
      await this.derive(perceiveResponse, forgeGlimpses);
    } else {
      await this.create();
    }
  }

  private async perceive(): Promise<PerceiveResponse | null> {
    const response = await this.perceptionHttp.post<{ did: string }, PerceiveResponse>(
      '/v1/perception/perceive',
      { did: this.state.did! }
    );

    if (!response.ok || !response.data) {
      logError('CBC', this.state.did, this.state.tick, response.error ?? 'Perceive failed', 'perceive');
      return null;
    }

    this.state.tick = response.data.tick;
    logPerceive(
      'CBC',
      this.state.did!,
      this.state.tick,
      response.data.glimpses.length,
      response.data.nextSeeds.length
    );

    return response.data;
  }

  private async create(): Promise<void> {
    // Generate trace draft for FLUX zone
    const traceDraft = generateCreateDraft(this.rng, {
      permanence: this.rng.nextInt(2, 3), // 2-3, capped at 3 for FLUX
      opacity: this.rng.nextInt(3, 7),
      nodes: this.rng.nextInt(2, 4),
    });

    // Quote first (never act blind)
    const quoteResponse = await this.coreHttp.post<
      { did: string; action: string; traceDraft: TraceDraft },
      QuoteResponse
    >(
      '/v1/physics/quote',
      { did: this.state.did!, action: 'CREATE_TRACE', traceDraft }
    );

    if (!quoteResponse.ok || !quoteResponse.data) {
      logError('CBC', this.state.did, this.state.tick, quoteResponse.error ?? 'Quote failed', 'quote');
      return;
    }

    const quote = quoteResponse.data;
    this.state.energy = quote.energyAfter;

    logQuote('CBC', this.state.did!, this.state.tick, quote.cost, quote.allowed);

    // Check budget and permission
    if (!quote.allowed || this.state.totalCostSpent + quote.cost > this.costBudget) {
      logSkip('CBC', this.state.did!, this.state.tick, 'budget_or_energy');
      return;
    }

    // Create trace
    const createResponse = await this.coreHttp.post<
      { did: string; traceDraft: TraceDraft },
      CreateTraceResponse
    >(
      '/v1/traces',
      { did: this.state.did!, traceDraft }
    );

    if (!createResponse.ok || !createResponse.data) {
      logError('CBC', this.state.did, this.state.tick, createResponse.error ?? 'Create failed', 'create');
      return;
    }

    this.state.tracesCreated++;
    this.state.totalCostSpent += createResponse.data.costPaid;
    this.state.tick = createResponse.data.tick;

    logCreate('CBC', this.state.did!, this.state.tick, createResponse.data.traceId, createResponse.data.costPaid);
  }

  private async derive(perception: PerceiveResponse, forgeGlimpses: TraceGlimpse[]): Promise<void> {
    // Pick a random parent trace from FORGE glimpses
    const parent = this.rng.pick(forgeGlimpses);
    if (!parent) {
      await this.create();
      return;
    }

    // Generate derivation draft
    const traceDraft = generateDeriveDraft(this.rng, parent.traceId, 'partial');

    // Quote first
    const quoteResponse = await this.coreHttp.post<
      { did: string; action: string; traceDraft: TraceDraft },
      QuoteResponse
    >(
      '/v1/physics/quote',
      { did: this.state.did!, action: 'DERIVE_TRACE', traceDraft }
    );

    if (!quoteResponse.ok || !quoteResponse.data) {
      logError('CBC', this.state.did, this.state.tick, quoteResponse.error ?? 'Quote failed', 'quote');
      return;
    }

    const quote = quoteResponse.data;
    this.state.energy = quote.energyAfter;

    logQuote('CBC', this.state.did!, this.state.tick, quote.cost, quote.allowed);

    // Check budget and permission
    if (!quote.allowed || this.state.totalCostSpent + quote.cost > this.costBudget) {
      logSkip('CBC', this.state.did!, this.state.tick, 'budget_or_energy');
      return;
    }

    // Derive trace
    const deriveResponse = await this.coreHttp.post<
      { did: string; parentTraceId: string; mutation: string; traceDraft: TraceDraft },
      DeriveTraceResponse
    >(
      '/v1/traces/derive',
      {
        did: this.state.did!,
        parentTraceId: parent.traceId,
        mutation: 'partial',
        traceDraft,
      }
    );

    if (!deriveResponse.ok || !deriveResponse.data) {
      logError('CBC', this.state.did, this.state.tick, deriveResponse.error ?? 'Derive failed', 'derive');
      return;
    }

    this.state.derivationsMade++;
    this.state.totalCostSpent += deriveResponse.data.costPaid;
    this.state.tick = deriveResponse.data.tick;

    logDerive(
      'CBC',
      this.state.did!,
      this.state.tick,
      deriveResponse.data.traceId,
      [parent.traceId],
      deriveResponse.data.costPaid
    );
  }

  getState(): AgentState {
    return { ...this.state };
  }
}

export function createCostBoundCrafter(config: AgentConfig, coreHttp: HttpClient, perceptionHttp: HttpClient): CostBoundCrafter {
  return new CostBoundCrafter(config, coreHttp, perceptionHttp);
}
