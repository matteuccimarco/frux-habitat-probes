/**
 * Minimal Agent Template
 *
 * A simple template for creating your own agent archetype.
 * Behavior:
 * - Registers once
 * - Perceives every step
 * - Quotes a minimal trace
 * - Acts only if allowed AND energyAfter > ENERGY_FLOOR
 * - Otherwise logs "silence"
 */

import type {
  AgentConfig,
  AgentState,
  PerceiveResponse,
  QuoteResponse,
  CreateTraceResponse,
  TraceDraft,
} from '../core/types.js';
import { HttpClient } from '../core/http.js';
import { SeededRNG } from '../core/rng.js';
import { log, logRegistered, logPerceive, logQuote, logCreate, logSilence, logError } from '../core/logger.js';

// Safety floor: don't act if energy would drop below this
const ENERGY_FLOOR = 3;

export class MinimalAgent {
  private config: AgentConfig;
  private state: AgentState;
  private coreHttp: HttpClient;
  private perceptionHttp: HttpClient;
  private rng: SeededRNG;

  constructor(config: AgentConfig, coreHttp: HttpClient, perceptionHttp: HttpClient) {
    this.config = config;
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
    const continuitySeed = `minimal-${this.config.index}-${this.rng.nextHex(8)}`;

    const response = await this.coreHttp.post<
      { continuitySeed: string },
      { did: string; energy: { current: number }; tick: number }
    >('/v1/agents/register', { continuitySeed });

    if (!response.ok || !response.data) {
      logError('QS', null, 0, response.error ?? 'Registration failed', 'register');
      return false;
    }

    this.state.did = response.data.did;
    this.state.energy = response.data.energy.current;
    this.state.tick = response.data.tick;

    logRegistered('QS', this.state.did, this.state.energy, this.state.tick);
    return true;
  }

  async step(): Promise<void> {
    if (!this.state.did) return;

    // 1. Perceive
    const perception = await this.perceive();
    if (!perception) return;

    // 2. Quote
    const traceDraft = this.buildMinimalDraft();
    const quote = await this.quote(traceDraft);
    if (!quote) return;

    // 3. Check conditions
    if (!quote.allowed || quote.energyAfter < ENERGY_FLOOR) {
      this.state.inSilenceMode = true;
      logSilence('QS', this.state.did, this.state.tick, this.state.energy);
      return;
    }

    // 4. Act
    this.state.inSilenceMode = false;
    await this.createTrace(traceDraft);
  }

  private async perceive(): Promise<PerceiveResponse | null> {
    const response = await this.perceptionHttp.post<{ did: string }, PerceiveResponse>(
      '/v1/perception/perceive',
      { did: this.state.did! }
    );

    if (!response.ok || !response.data) {
      logError('QS', this.state.did, this.state.tick, response.error ?? 'Perceive failed', 'perceive');
      return null;
    }

    this.state.tick = response.data.tick;
    logPerceive('QS', this.state.did!, this.state.tick, response.data.glimpses.length, response.data.nextSeeds.length);
    return response.data;
  }

  private buildMinimalDraft(): TraceDraft {
    return {
      zone: 'FLUX',
      L1: { intent: ['∇obs'] },
      L2: { shape: ['lin'] },
      L3: { topology: { depth: 1, nodes: 2, symmetry: 0 } },
      L4: { core: ['⊗mem'] },
      L6: { rel: { derives_from: [], mutation: 'none' } },
      L7: { permanence: 1 },
      L8: { opacity: 1 },
    };
  }

  private async quote(traceDraft: TraceDraft): Promise<QuoteResponse | null> {
    const response = await this.coreHttp.post<
      { did: string; action: string; traceDraft: TraceDraft },
      QuoteResponse
    >('/v1/physics/quote', {
      did: this.state.did!,
      action: 'CREATE_TRACE',
      traceDraft,
    });

    if (!response.ok || !response.data) {
      logError('QS', this.state.did, this.state.tick, response.error ?? 'Quote failed', 'quote');
      return null;
    }

    const quote = response.data;
    this.state.energy = quote.energyAfter;
    logQuote('QS', this.state.did!, this.state.tick, quote.cost, quote.allowed);
    return quote;
  }

  private async createTrace(traceDraft: TraceDraft): Promise<void> {
    const response = await this.coreHttp.post<
      { did: string; traceDraft: TraceDraft },
      CreateTraceResponse
    >('/v1/traces', {
      did: this.state.did!,
      traceDraft,
    });

    if (!response.ok || !response.data) {
      logError('QS', this.state.did, this.state.tick, response.error ?? 'Create failed', 'create');
      return;
    }

    this.state.tracesCreated++;
    this.state.totalCostSpent += response.data.costPaid;
    this.state.tick = response.data.tick;

    logCreate('QS', this.state.did!, this.state.tick, response.data.traceId, response.data.costPaid);
  }

  getState(): AgentState {
    return { ...this.state };
  }
}

export function createMinimalAgent(
  config: AgentConfig,
  coreHttp: HttpClient,
  perceptionHttp: HttpClient
): MinimalAgent {
  return new MinimalAgent(config, coreHttp, perceptionHttp);
}
