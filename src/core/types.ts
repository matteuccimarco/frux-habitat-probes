/**
 * Probe Agents Kit - Core Types
 *
 * Type definitions for the agent simulation framework.
 */

// ============================================================================
// AGENT TYPES
// ============================================================================

export type AgentArchetype = 'QS' | 'CBC' | 'JAP';

export interface AgentConfig {
  /** Agent archetype */
  archetype: AgentArchetype;
  /** Agent index (for seeding) */
  index: number;
  /** Core API base URL (register, traces, physics, joint) */
  coreApiUrl: string;
  /** Perception API base URL (perceive) */
  perceptionApiUrl: string;
  /** Random seed */
  seed: number;
  /** Energy threshold for silence mode (QS only) */
  silenceThreshold?: number;
  /** Cost budget (CBC only) */
  costBudget?: number;
  /** Derive probability (CBC only) */
  deriveProbability?: number;
}

export interface AgentState {
  /** Agent DID (after registration) */
  did: string | null;
  /** Current energy */
  energy: number;
  /** Current tick */
  tick: number;
  /** Whether agent is in silence mode */
  inSilenceMode: boolean;
  /** Total traces created */
  tracesCreated: number;
  /** Total derivations made */
  derivationsMade: number;
  /** Total joint attempts */
  jointAttempts: number;
  /** Total joint successes */
  jointSuccesses: number;
  /** Total cost spent */
  totalCostSpent: number;
}

// ============================================================================
// API TYPES
// ============================================================================

export interface RegisterRequest {
  continuitySeed: string;
}

export interface RegisterResponse {
  did: string;
  energy: number;
  tick: number;
}

export interface PerceiveResponse {
  tick: number;
  tickWindow: { from: number; to: number };
  glimpses: TraceGlimpse[];
  nextSeeds: Seed[];
}

export interface TraceGlimpse {
  traceId: string;
  zone: string;
  tick: number;
  physics: {
    depth: number;
    permanence: number;
    opacity: number;
  };
  skeleton: {
    shape: string[];
    topology: { depth: number; nodes: number };
  };
  core: {
    tokens: string[];
    sealed: boolean;
  };
  relations: {
    derivesFrom: string[];
    outDegree: number;
  };
  costEstimates: {
    mutatePartial: number;
    mutateDeep: number;
  };
  jointAffordances?: JointAffordanceGlimpse[];
}

export interface JointAffordanceGlimpse {
  affordanceId: string;
  actionType: string;
  expiresAt: number;
  estimatedCost: number;
  requiredAgents: number;
}

/** Extended affordance with source trace info for agent use */
export interface AffordanceWithSource extends JointAffordanceGlimpse {
  sourceTraceId: string;
}

export interface Seed {
  type: 'trace' | 'token' | 'zone';
  value: string;
}

export type ActionType = 'CREATE_TRACE' | 'DERIVE_TRACE';

export interface QuoteRequest {
  did: string;
  action: ActionType;
  traceDraft: TraceDraft;
}

export interface QuoteResponse {
  cost: number;
  allowed: boolean;
  tick: number;
  energyAfter: number;
  reasons?: string[];
}

export interface CreateTraceRequest {
  did: string;
  traceDraft: TraceDraft;
}

export interface CreateTraceResponse {
  traceId: string;
  tick: number;
  costPaid: number;
}

export interface DeriveTraceRequest {
  did: string;
  parentTraceId: string;
  mutation: MutationType;
  traceDraft: TraceDraft;
}

export interface DeriveTraceResponse {
  traceId: string;
  tick: number;
  costPaid: number;
}

export interface JointQuoteRequest {
  did: string;
  affordanceId: string;
}

export interface JointQuoteResponse {
  tick: number;
  cost: number;
  requiredAgents: number;
  windowTicks: number;
  allowed: boolean;
}

export interface JointTraceRequest {
  did: string;
  affordanceId: string;
  traceDraft: SlimPyramid;
}

export interface JointTraceResponse {
  status: 'created' | 'pending';
  traceId?: string;
  tick: number;
  expiresAt?: number;
  costReserved?: number;
}

// ============================================================================
// SLIM PYRAMID (minimal)
// ============================================================================

export type MutationType = 'partial' | 'deep' | 'none';

export interface SlimPyramid {
  L0: { did: string };
  L1: { intent: string[] };
  L2: { shape: string[] };
  L3: { topology: { depth: number; nodes: number; symmetry: 0 | 1 } };
  L4: { core: string[] };
  L5?: { anchors?: string[] };
  L6: { rel: { derives_from: string[]; mutation: MutationType } };
  L7: { permanence: number };
  L8: { opacity: number };
  L9?: { seal?: { scheme: string; pubHint: string; cipher: string } };
}

/** Trace draft for API requests (no L0) */
export interface TraceDraft {
  zone: string;
  L1: { intent: string[] };
  L2: { shape: string[] };
  L3: { topology: { depth: number; nodes: number; symmetry: 0 | 1 } };
  L4: { core: string[] };
  L5?: { anchors?: string[] };
  L6: { rel: { derives_from: string[]; mutation: MutationType } };
  L7: { permanence: number };
  L8: { opacity: number };
  L9?: { seal?: { scheme: string; pubHint: string; cipher: string } };
}

// ============================================================================
// LOG TYPES
// ============================================================================

export interface LogEntry {
  ts: string;
  did: string | null;
  archetype: AgentArchetype;
  step: string;
  tick: number;
  cost?: number;
  allowed?: boolean;
  details?: Record<string, unknown>;
}
