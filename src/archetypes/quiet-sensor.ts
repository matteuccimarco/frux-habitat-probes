/**
 * Quiet Sensor (QS) Archetype
 *
 * Behavior:
 * - Perceive-only until energy >= threshold
 * - When above threshold: maybe create a trace (10% chance)
 * - Primary role: observe and regenerate
 *
 * Silence is valid behavior - "Silence is valid; not acting is still probing."
 */

import type { AgentConfig, AgentState, PerceiveResponse, QuoteResponse, CreateTraceResponse, TraceDraft } from '../core/types.js';
import { HttpClient } from '../core/http.js';
import { SeededRNG } from '../core/rng.js';
import { generateCreateDraft } from '../core/pyramid.js';
import {
  log,
  logRegistered,
  logPerceive,
  logQuote,
  logCreate,
  logSilence,
  logSkip,
  logError,
} from '../core/logger.js';

const DEFAULT_SILENCE_THRESHOLD = 5;
const CREATE_PROBABILITY = 0.1; // 10% chance to create when above threshold

export class QuietSensor {
  private config: AgentConfig;
  private state: AgentState;
  private coreHttp: HttpClient;
  private perceptionHttp: HttpClient;
  private rng: SeededRNG;
  private silenceThreshold: number;

  constructor(config: AgentConfig, coreHttp: HttpClient, perceptionHttp: HttpClient) {
    this.config = config;
    this.coreHttp = coreHttp;
    this.perceptionHttp = perceptionHttp;
    this.rng = new SeededRNG(config.seed);
    this.silenceThreshold = config.silenceThreshold ?? DEFAULT_SILENCE_THRESHOLD;
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
    const continuitySeed = `qs-${this.config.index}-${this.rng.nextHex(16)}`;

    const response = await this.coreHttp.post<{ continuitySeed: string }, { did: string; energy: number; tick: number }>(
      '/v1/agents/register',
      { continuitySeed }
    );

    if (!response.ok || !response.data) {
      logError('QS', null, 0, response.error ?? 'Registration failed', 'register');
      return false;
    }

    this.state.did = response.data.did;
    this.state.energy = response.data.energy;
    this.state.tick = response.data.tick;

    logRegistered('QS', this.state.did, this.state.energy, this.state.tick);
    return true;
  }

  async step(): Promise<void> {
    if (!this.state.did) return;

    // Step 1: Perceive (always)
    const perceiveResponse = await this.perceive();
    if (!perceiveResponse) return;

    // Check energy level
    if (this.state.energy < this.silenceThreshold) {
      // Silence mode: just perceive, don't act
      this.state.inSilenceMode = true;
      logSilence('QS', this.state.did, this.state.tick, this.state.energy);
      return;
    }

    this.state.inSilenceMode = false;

    // Step 2: Maybe create a trace (10% chance)
    if (this.rng.nextBool(CREATE_PROBABILITY)) {
      await this.maybeCreate(perceiveResponse);
    } else {
      logSkip('QS', this.state.did, this.state.tick, 'rng_skip');
    }
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
    logPerceive(
      'QS',
      this.state.did!,
      this.state.tick,
      response.data.glimpses.length,
      response.data.nextSeeds.length
    );

    return response.data;
  }

  private async maybeCreate(_perception: PerceiveResponse): Promise<void> {
    // Generate a trace draft for FLUX zone
    const traceDraft = generateCreateDraft(this.rng, {
      permanence: this.rng.nextInt(1, 3), // Low permanence for QS
      opacity: this.rng.nextInt(1, 5),
    });

    // Quote first
    const quoteResponse = await this.coreHttp.post<
      { did: string; action: string; traceDraft: TraceDraft },
      QuoteResponse
    >(
      '/v1/physics/quote',
      { did: this.state.did!, action: 'CREATE_TRACE', traceDraft }
    );

    if (!quoteResponse.ok || !quoteResponse.data) {
      logError('QS', this.state.did, this.state.tick, quoteResponse.error ?? 'Quote failed', 'quote');
      return;
    }

    const quote = quoteResponse.data;
    this.state.energy = quote.energyAfter;

    logQuote('QS', this.state.did!, this.state.tick, quote.cost, quote.allowed);

    if (!quote.allowed) {
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
      logError('QS', this.state.did, this.state.tick, createResponse.error ?? 'Create failed', 'create');
      return;
    }

    this.state.tracesCreated++;
    this.state.totalCostSpent += createResponse.data.costPaid;
    this.state.tick = createResponse.data.tick;

    logCreate('QS', this.state.did!, this.state.tick, createResponse.data.traceId, createResponse.data.costPaid);
  }

  getState(): AgentState {
    return { ...this.state };
  }
}

export function createQuietSensor(config: AgentConfig, coreHttp: HttpClient, perceptionHttp: HttpClient): QuietSensor {
  return new QuietSensor(config, coreHttp, perceptionHttp);
}
