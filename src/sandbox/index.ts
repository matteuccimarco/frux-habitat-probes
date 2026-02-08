/**
 * Sandbox Module
 *
 * Isolated execution environment for third-party agents.
 * World enforces ALL limits - agents cannot bypass.
 */

export type {
  SandboxMode,
  SandboxAgentState,
  DegradedObservation,
  ObservedCell,
  ActionRequest,
  ActionResult,
  ActionRejection,
  ActionRejectionCode,
  SandboxContext,
  ActionWindowState,
  SandboxStepInput,
  SandboxStepOutput,
  SandboxExecutionResult,
  SandboxError,
  SandboxErrorCode,
} from './types.js';

export type { AgentStepFn } from './executor.js';

export {
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
