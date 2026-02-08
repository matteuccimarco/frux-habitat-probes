/**
 * Agent Manifest Validator
 *
 * Validates manifests and performs admission logic.
 * World enforces all limits - agents cannot bypass.
 */

import type {
  AgentManifest,
  AgentCapability,
  GrantedCapabilities,
  AdmissionResult,
  ActionRateLimit,
  ObservationBudget,
  EnergyBudget,
} from './types.js';
import { MANIFEST_DEFAULTS } from './types.js';

/** Validation error */
export interface ValidationError {
  path: string;
  message: string;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** World policy for admission */
export interface WorldPolicy {
  /** Maximum capabilities any agent can have */
  maxCapabilities: AgentCapability[];
  /** Maximum action rate */
  maxActionRate: ActionRateLimit;
  /** Maximum compute budget */
  maxComputeBudgetMs: number;
  /** Minimum observation degradation */
  minObservationNoise: number;
  /** Maximum observation cells */
  maxObservationCells: number;
  /** Maximum energy per tick */
  maxEnergyPerTick: number;
  /** Require quarantine for non-BUILTIN agents */
  quarantineThirdParty: boolean;
  /** Current habitat version */
  habitatVersion: string;
}

/** Default world policy - restrictive */
export const DEFAULT_WORLD_POLICY: WorldPolicy = {
  maxCapabilities: ['MOVE', 'SENSE', 'GENERATE_TRACE', 'INQUIRY'],
  maxActionRate: { windowTicks: 200, max: 5 },
  maxComputeBudgetMs: 10,
  minObservationNoise: 0.2,
  maxObservationCells: 9,
  maxEnergyPerTick: 20,
  quarantineThirdParty: true,
  habitatVersion: '0.12.0',
};

/**
 * Validate manifest structure
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: [{ path: '', message: 'Manifest must be an object' }] };
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  if (m.manifestVersion !== '1.0') {
    errors.push({ path: 'manifestVersion', message: 'Must be "1.0"' });
  }

  // Agent section
  if (!m.agent || typeof m.agent !== 'object') {
    errors.push({ path: 'agent', message: 'Required object' });
  } else {
    const agent = m.agent as Record<string, unknown>;

    if (typeof agent.name !== 'string' || agent.name.length === 0) {
      errors.push({ path: 'agent.name', message: 'Required non-empty string' });
    } else if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(agent.name)) {
      errors.push({ path: 'agent.name', message: 'Must match pattern ^[a-zA-Z][a-zA-Z0-9_-]*$' });
    } else if (agent.name.length > 64) {
      errors.push({ path: 'agent.name', message: 'Max length 64' });
    }

    if (!['WASM', 'PROCESS', 'BUILTIN'].includes(agent.kind as string)) {
      errors.push({ path: 'agent.kind', message: 'Must be WASM, PROCESS, or BUILTIN' });
    }

    if (typeof agent.entry !== 'string' || agent.entry.length === 0) {
      errors.push({ path: 'agent.entry', message: 'Required non-empty string' });
    }
  }

  // Requested section
  if (!m.requested || typeof m.requested !== 'object') {
    errors.push({ path: 'requested', message: 'Required object' });
  } else {
    const req = m.requested as Record<string, unknown>;

    if (!Array.isArray(req.capabilities) || req.capabilities.length === 0) {
      errors.push({ path: 'requested.capabilities', message: 'Required non-empty array' });
    } else {
      const validCaps = ['MOVE', 'SENSE', 'GENERATE_TRACE', 'PROPOSE_PACT', 'INQUIRY'];
      for (const cap of req.capabilities) {
        if (!validCaps.includes(cap as string)) {
          errors.push({
            path: 'requested.capabilities',
            message: `Invalid capability: ${cap}`,
          });
        }
      }
    }

    // Validate optional budgets
    if (req.computeBudgetMsPerTick !== undefined) {
      const budget = req.computeBudgetMsPerTick as number;
      if (typeof budget !== 'number' || budget < 1 || budget > 100) {
        errors.push({
          path: 'requested.computeBudgetMsPerTick',
          message: 'Must be number between 1 and 100',
        });
      }
    }

    if (req.observationBudget !== undefined) {
      const obs = req.observationBudget as Record<string, unknown>;
      if (obs.noiseFloor !== undefined) {
        const noise = obs.noiseFloor as number;
        if (typeof noise !== 'number' || noise < 0 || noise > 1) {
          errors.push({
            path: 'requested.observationBudget.noiseFloor',
            message: 'Must be number between 0 and 1',
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parse semver string to comparable parts
 */
function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

/**
 * Compare semver: returns -1 if a < b, 0 if equal, 1 if a > b
 */
function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;

  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/**
 * Perform admission - determine what capabilities to grant
 *
 * World always grants less than or equal to requested.
 * Never grants more than policy allows.
 */
export function performAdmission(
  manifest: AgentManifest,
  policy: WorldPolicy = DEFAULT_WORLD_POLICY
): AdmissionResult {
  const rejectionReasons: string[] = [];

  // Check habitat version compatibility
  const minVersion = manifest.compat?.minHabitatVersion ?? MANIFEST_DEFAULTS.minHabitatVersion;
  if (compareSemver(policy.habitatVersion, minVersion) < 0) {
    rejectionReasons.push(
      `Habitat version ${policy.habitatVersion} < required ${minVersion}`
    );
  }

  // BUILTIN agents get special treatment
  const isBuiltin = manifest.agent.kind === 'BUILTIN';

  // Third-party agents may be rejected based on policy
  if (!isBuiltin && policy.quarantineThirdParty) {
    // Not rejected, but will be quarantined
  }

  // Check for unsupported capabilities
  const requestedCaps = manifest.requested.capabilities;
  const unsupportedCaps = requestedCaps.filter(
    (cap) => !policy.maxCapabilities.includes(cap)
  );
  if (unsupportedCaps.length > 0) {
    // Don't reject, just won't grant these
  }

  // If any hard rejections, fail admission
  if (rejectionReasons.length > 0) {
    return { admitted: false, rejectionReasons };
  }

  // Calculate granted capabilities
  const grantedCaps = requestedCaps.filter((cap) =>
    policy.maxCapabilities.includes(cap)
  );

  // Calculate granted budgets (min of requested and policy max)
  const reqRate = manifest.requested.maxActionsPerWindow ?? MANIFEST_DEFAULTS.maxActionsPerWindow;
  const grantedRate: ActionRateLimit = {
    windowTicks: Math.max(reqRate.windowTicks, policy.maxActionRate.windowTicks),
    max: Math.min(reqRate.max, policy.maxActionRate.max),
  };

  const reqCompute = manifest.requested.computeBudgetMsPerTick ?? MANIFEST_DEFAULTS.computeBudgetMsPerTick;
  const grantedCompute = Math.min(reqCompute, policy.maxComputeBudgetMs);

  const reqObs = manifest.requested.observationBudget ?? MANIFEST_DEFAULTS.observationBudget;
  const grantedObs: ObservationBudget = {
    maxCells: Math.min(reqObs.maxCells, policy.maxObservationCells),
    maxFields: reqObs.maxFields, // Policy doesn't restrict this currently
    noiseFloor: Math.max(reqObs.noiseFloor, policy.minObservationNoise),
  };

  const reqEnergy = manifest.requested.energyBudget ?? MANIFEST_DEFAULTS.energyBudget;
  const grantedEnergy: EnergyBudget = {
    maxPerTick: Math.min(reqEnergy.maxPerTick, policy.maxEnergyPerTick),
    maxReserve: reqEnergy.maxReserve, // Policy doesn't restrict reserve currently
  };

  // Determine quarantine status
  const forceQuarantine = manifest.quarantine?.required ?? false;
  const inQuarantine = !isBuiltin && (policy.quarantineThirdParty || forceQuarantine);
  const shardId = inQuarantine ? manifest.quarantine?.shardId : undefined;

  const granted: GrantedCapabilities = {
    capabilities: grantedCaps,
    maxActionsPerWindow: grantedRate,
    computeBudgetMsPerTick: grantedCompute,
    observationBudget: grantedObs,
    energyBudget: grantedEnergy,
    inQuarantine,
    shardId,
  };

  return { admitted: true, granted };
}

/**
 * Load and validate manifest from JSON string
 */
export function loadManifest(jsonString: string): {
  manifest?: AgentManifest;
  validation: ValidationResult;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    return {
      validation: {
        valid: false,
        errors: [{ path: '', message: `Invalid JSON: ${(e as Error).message}` }],
      },
    };
  }

  const validation = validateManifest(parsed);
  if (!validation.valid) {
    return { validation };
  }

  return { manifest: parsed as AgentManifest, validation };
}
