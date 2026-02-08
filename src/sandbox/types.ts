/**
 * Sandbox Types
 *
 * Types for isolated agent execution.
 * Agents cannot access network, filesystem, or clock outside what habitat mediates.
 */

import type { GrantedCapabilities, AgentCapability } from '../manifest/types.js';

/** Sandbox execution mode */
export type SandboxMode = 'WASM' | 'PROCESS' | 'INLINE';

/** Agent state visible to sandbox */
export interface SandboxAgentState {
  /** Agent's current energy */
  energy: number;
  /** Agent's location in habitat */
  location: { x: number; y: number };
  /** Current tick */
  tick: number;
  /** Degraded observation of surroundings */
  observation: DegradedObservation;
}

/** Degraded observation with noise applied */
export interface DegradedObservation {
  /** Visible cells (limited by budget) */
  cells: ObservedCell[];
  /** Noise floor applied */
  noiseApplied: number;
  /** Fields omitted due to budget */
  fieldsOmitted: number;
}

/** Single observed cell */
export interface ObservedCell {
  /** Relative position from agent */
  dx: number;
  dy: number;
  /** Zone type (may be noisy) */
  zone: string;
  /** Entity count (degraded) */
  entityCount: number;
  /** Trace density (degraded) */
  traceDensity: number;
  /** Additional fields (limited by budget) */
  fields: Record<string, unknown>;
}

/** Action request from agent */
export interface ActionRequest {
  /** Action type */
  type: AgentCapability;
  /** Action-specific parameters */
  params: Record<string, unknown>;
}

/** Action result from world */
export interface ActionResult {
  /** Whether action was executed */
  executed: boolean;
  /** Energy cost deducted */
  energyCost: number;
  /** Result data (if any) */
  result?: unknown;
  /** Rejection reason (if not executed) */
  rejection?: ActionRejection;
}

/** Reason for action rejection */
export interface ActionRejection {
  code: ActionRejectionCode;
  message: string;
}

export type ActionRejectionCode =
  | 'INSUFFICIENT_ENERGY'
  | 'CAPABILITY_NOT_GRANTED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INVALID_PARAMS'
  | 'WORLD_REJECTED'
  | 'COMPUTE_BUDGET_EXCEEDED';

/** Sandbox execution context */
export interface SandboxContext {
  /** Granted capabilities */
  granted: GrantedCapabilities;
  /** Agent DID (opaque to sandbox) */
  agentId: string;
  /** Shard ID (if quarantined) */
  shardId?: string;
  /** Action rate tracking */
  actionWindow: ActionWindowState;
  /** Compute time used this tick */
  computeUsedMs: number;
}

/** Sliding window for action rate limiting */
export interface ActionWindowState {
  /** Actions in current window */
  actions: { tick: number; type: AgentCapability }[];
  /** Window start tick */
  windowStart: number;
}

/** Sandbox step input */
export interface SandboxStepInput {
  /** Current agent state */
  state: SandboxAgentState;
  /** Execution context */
  context: SandboxContext;
}

/** Sandbox step output */
export interface SandboxStepOutput {
  /** Actions to attempt (will be validated by world) */
  actions: ActionRequest[];
  /** Compute time used (reported by sandbox) */
  computeTimeMs: number;
  /** Agent terminated itself */
  terminated?: boolean;
}

/** Sandbox execution result */
export interface SandboxExecutionResult {
  /** Output from agent step */
  output?: SandboxStepOutput;
  /** Error if step failed */
  error?: SandboxError;
  /** Actual compute time (measured by host) */
  actualComputeMs: number;
  /** Whether compute budget was exceeded */
  computeBudgetExceeded: boolean;
}

/** Sandbox execution error */
export interface SandboxError {
  code: SandboxErrorCode;
  message: string;
  stack?: string;
}

export type SandboxErrorCode =
  | 'TIMEOUT'
  | 'MEMORY_EXCEEDED'
  | 'INVALID_OUTPUT'
  | 'CRASH'
  | 'SANDBOX_VIOLATION';
