/**
 * Probe Agents Kit - Logger
 *
 * JSON line logging for structured output.
 * Format: { ts, did, archetype, step, tick, cost?, allowed?, details? }
 */

import type { AgentArchetype, LogEntry } from './types.js';

let verbose = false;

export function setVerbose(v: boolean): void {
  verbose = v;
}

export function log(entry: Omit<LogEntry, 'ts'>): void {
  const fullEntry: LogEntry = {
    ts: new Date().toISOString(),
    ...entry,
  };
  console.log(JSON.stringify(fullEntry));
}

export function logVerbose(entry: Omit<LogEntry, 'ts'>): void {
  if (!verbose) return;
  log(entry);
}

export function logError(
  archetype: AgentArchetype,
  did: string | null,
  tick: number,
  error: unknown,
  context?: string
): void {
  log({
    did,
    archetype,
    step: 'error',
    tick,
    details: {
      context,
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

export function logStart(archetype: AgentArchetype, index: number): void {
  log({
    did: null,
    archetype,
    step: 'init',
    tick: 0,
    details: { index },
  });
}

export function logRegistered(archetype: AgentArchetype, did: string, energy: number, tick: number): void {
  log({
    did,
    archetype,
    step: 'registered',
    tick,
    details: { energy },
  });
}

export function logPerceive(
  archetype: AgentArchetype,
  did: string,
  tick: number,
  glimpseCount: number,
  seedCount: number
): void {
  logVerbose({
    did,
    archetype,
    step: 'perceive',
    tick,
    details: { glimpseCount, seedCount },
  });
}

export function logQuote(
  archetype: AgentArchetype,
  did: string,
  tick: number,
  cost: number,
  allowed: boolean
): void {
  log({
    did,
    archetype,
    step: 'quote',
    tick,
    cost,
    allowed,
  });
}

export function logCreate(
  archetype: AgentArchetype,
  did: string,
  tick: number,
  traceId: string,
  cost: number
): void {
  log({
    did,
    archetype,
    step: 'create',
    tick,
    cost,
    details: { traceId },
  });
}

export function logDerive(
  archetype: AgentArchetype,
  did: string,
  tick: number,
  traceId: string,
  parentIds: string[],
  cost: number
): void {
  log({
    did,
    archetype,
    step: 'derive',
    tick,
    cost,
    details: { traceId, parentIds },
  });
}

export function logJointAttempt(
  archetype: AgentArchetype,
  did: string,
  tick: number,
  affordanceId: string,
  status: 'created' | 'pending'
): void {
  log({
    did,
    archetype,
    step: 'joint_attempt',
    tick,
    details: { affordanceId, status },
  });
}

export function logSilence(
  archetype: AgentArchetype,
  did: string,
  tick: number,
  energy: number
): void {
  logVerbose({
    did,
    archetype,
    step: 'silence',
    tick,
    details: { energy, reason: 'low_energy' },
  });
}

export function logSkip(
  archetype: AgentArchetype,
  did: string,
  tick: number,
  reason: string
): void {
  logVerbose({
    did,
    archetype,
    step: 'skip',
    tick,
    details: { reason },
  });
}
