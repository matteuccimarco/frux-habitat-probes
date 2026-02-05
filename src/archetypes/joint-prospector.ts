/**
 * Joint Prospector (JAP) Archetype
 *
 * Behavior:
 * - Seeks joint-capable traces (with ⛓anc, permanence>=3, nodes>=3)
 * - Creates joint-capable traces when none found
 * - Attempts joint actions on found affordances
 * - Accepts silent failure gracefully
 */

import type {
  AgentConfig,
  AgentState,
  PerceiveResponse,
  QuoteResponse,
  CreateTraceResponse,
  JointQuoteResponse,
  JointTraceResponse,
  TraceGlimpse,
  AffordanceWithSource,
  TraceDraft,
} from '../core/types.js';
import { HttpClient } from '../core/http.js';
import { SeededRNG } from '../core/rng.js';
import { generateJointCapableDraft, generateTraceDraft } from '../core/pyramid.js';
import {
  logRegistered,
  logPerceive,
  logQuote,
  logCreate,
  logJointAttempt,
  logSkip,
  logError,
} from '../core/logger.js';

const JOINT_ATTEMPT_PROBABILITY = 0.7; // 70% chance to attempt joint action when affordance found
const CREATE_JOINT_CAPABLE_PROBABILITY = 0.5; // 50% chance to create joint-capable trace when none found

export class JointProspector {
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
      inSilenceMode: false,
      tracesCreated: 0,
      derivationsMade: 0,
      jointAttempts: 0,
      jointSuccesses: 0,
      totalCostSpent: 0,
    };
  }

  async register(): Promise<boolean> {
    const continuitySeed = `jap-${this.config.index}-${this.rng.nextHex(16)}`;

    const response = await this.coreHttp.post<{ continuitySeed: string }, { did: string; energy: number; tick: number }>(
      '/v1/agents/register',
      { continuitySeed }
    );

    if (!response.ok || !response.data) {
      logError('JAP', null, 0, response.error ?? 'Registration failed', 'register');
      return false;
    }

    this.state.did = response.data.did;
    this.state.energy = response.data.energy;
    this.state.tick = response.data.tick;

    logRegistered('JAP', this.state.did, this.state.energy, this.state.tick);
    return true;
  }

  async step(): Promise<void> {
    if (!this.state.did) return;

    // Step 1: Perceive
    const perceiveResponse = await this.perceive();
    if (!perceiveResponse) return;

    // Step 2: Look for joint affordances
    const affordances = this.findAffordances(perceiveResponse.glimpses);

    if (affordances.length > 0 && this.rng.nextBool(JOINT_ATTEMPT_PROBABILITY)) {
      // Found affordances, attempt joint action
      await this.attemptJoint(affordances);
    } else if (this.rng.nextBool(CREATE_JOINT_CAPABLE_PROBABILITY)) {
      // No affordances or skipped, maybe create a joint-capable trace
      await this.createJointCapable();
    } else {
      logSkip('JAP', this.state.did, this.state.tick, 'rng_skip');
    }
  }

  private async perceive(): Promise<PerceiveResponse | null> {
    const response = await this.perceptionHttp.post<{ did: string }, PerceiveResponse>(
      '/v1/perception/perceive',
      { did: this.state.did! }
    );

    if (!response.ok || !response.data) {
      logError('JAP', this.state.did, this.state.tick, response.error ?? 'Perceive failed', 'perceive');
      return null;
    }

    this.state.tick = response.data.tick;
    logPerceive(
      'JAP',
      this.state.did!,
      this.state.tick,
      response.data.glimpses.length,
      response.data.nextSeeds.length
    );

    return response.data;
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

  private async attemptJoint(affordances: AffordanceWithSource[]): Promise<void> {
    // Pick a random affordance
    const affordance = this.rng.pick(affordances);
    if (!affordance) return;

    // Quote joint action first
    const quoteResponse = await this.coreHttp.post<
      { did: string; affordanceId: string },
      JointQuoteResponse
    >(
      '/v1/joint/quote',
      { did: this.state.did!, affordanceId: affordance.affordanceId }
    );

    if (!quoteResponse.ok || !quoteResponse.data) {
      logError('JAP', this.state.did, this.state.tick, quoteResponse.error ?? 'Joint quote failed', 'joint_quote');
      return;
    }

    const quote = quoteResponse.data;
    logQuote('JAP', this.state.did!, this.state.tick, quote.cost, quote.allowed);

    if (!quote.allowed) {
      logSkip('JAP', this.state.did!, this.state.tick, 'joint_not_allowed');
      return;
    }

    // Generate a trace draft for the joint action (FORGE zone for derivation)
    const traceDraft = generateTraceDraft(this.rng, {
      zone: 'FORGE',
      parentTraceIds: [affordance.sourceTraceId],
      permanence: this.rng.nextInt(3, 5),
      opacity: this.rng.nextInt(4, 7),
      mutation: 'deep',
      forceJointCapable: true,
    });

    // Attempt joint action
    const jointResponse = await this.coreHttp.post<
      { did: string; affordanceId: string; traceDraft: TraceDraft },
      JointTraceResponse
    >(
      '/v1/joint/traces',
      {
        did: this.state.did!,
        affordanceId: affordance.affordanceId,
        traceDraft,
      }
    );

    if (!jointResponse.ok || !jointResponse.data) {
      logError('JAP', this.state.did, this.state.tick, jointResponse.error ?? 'Joint action failed', 'joint_action');
      return;
    }

    this.state.jointAttempts++;
    this.state.tick = jointResponse.data.tick;

    if (jointResponse.data.status === 'created') {
      this.state.jointSuccesses++;
      this.state.totalCostSpent += quote.cost;
    }

    logJointAttempt(
      'JAP',
      this.state.did!,
      this.state.tick,
      affordance.affordanceId,
      jointResponse.data.status
    );
  }

  private async createJointCapable(): Promise<void> {
    // Generate a joint-capable trace draft
    const traceDraft = generateJointCapableDraft(this.rng);

    // Quote first
    const quoteResponse = await this.coreHttp.post<
      { did: string; action: string; traceDraft: TraceDraft },
      QuoteResponse
    >(
      '/v1/physics/quote',
      { did: this.state.did!, action: 'CREATE_TRACE', traceDraft }
    );

    if (!quoteResponse.ok || !quoteResponse.data) {
      logError('JAP', this.state.did, this.state.tick, quoteResponse.error ?? 'Quote failed', 'quote');
      return;
    }

    const quote = quoteResponse.data;
    this.state.energy = quote.energyAfter;

    logQuote('JAP', this.state.did!, this.state.tick, quote.cost, quote.allowed);

    if (!quote.allowed) {
      logSkip('JAP', this.state.did!, this.state.tick, 'energy_insufficient');
      return;
    }

    // Create in FLUX (will migrate to FORGE later, then can be joint-capable)
    const createResponse = await this.coreHttp.post<
      { did: string; traceDraft: TraceDraft },
      CreateTraceResponse
    >(
      '/v1/traces',
      { did: this.state.did!, traceDraft }
    );

    if (!createResponse.ok || !createResponse.data) {
      logError('JAP', this.state.did, this.state.tick, createResponse.error ?? 'Create failed', 'create');
      return;
    }

    this.state.tracesCreated++;
    this.state.totalCostSpent += createResponse.data.costPaid;
    this.state.tick = createResponse.data.tick;

    logCreate('JAP', this.state.did!, this.state.tick, createResponse.data.traceId, createResponse.data.costPaid);
  }

  getState(): AgentState {
    return { ...this.state };
  }
}

export function createJointProspector(config: AgentConfig, coreHttp: HttpClient, perceptionHttp: HttpClient): JointProspector {
  return new JointProspector(config, coreHttp, perceptionHttp);
}
