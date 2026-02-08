/**
 * Agent Manifest Types
 *
 * TypeScript types matching agent.manifest.schema.json
 * World-enforced limits for third-party agents.
 */

/** Execution mode for agent */
export type AgentKind = 'WASM' | 'PROCESS' | 'BUILTIN';

/** Available capabilities an agent may request */
export type AgentCapability =
  | 'MOVE'
  | 'SENSE'
  | 'GENERATE_TRACE'
  | 'PROPOSE_PACT'
  | 'INQUIRY';

/** Preset trait configurations */
export type TraitsPreset = 'QS' | 'CBC' | 'JAP' | 'LLM' | 'MINIMAL';

/** Mutable trait names */
export type MutableTrait =
  | 'curiosity'
  | 'persistence'
  | 'sociability'
  | 'entropy_affinity';

/** Agent identity and entry point */
export interface AgentIdentity {
  /** Unique agent identifier. Used for logging only, NOT visible in habitat */
  name: string;
  /** Execution mode */
  kind: AgentKind;
  /** Entry point path or command */
  entry: string;
  /** Optional human-readable description. NOT exposed to habitat */
  description?: string;
}

/** Rate limit configuration */
export interface ActionRateLimit {
  /** Rolling window size in ticks */
  windowTicks: number;
  /** Maximum actions allowed in window */
  max: number;
}

/** Observation budget constraints */
export interface ObservationBudget {
  /** Maximum cells visible in perception */
  maxCells: number;
  /** Maximum fields per entity in perception */
  maxFields: number;
  /** Minimum noise added to observations */
  noiseFloor: number;
}

/** Energy budget constraints */
export interface EnergyBudget {
  /** Maximum energy available per tick */
  maxPerTick: number;
  /** Maximum energy the agent can accumulate */
  maxReserve: number;
}

/** Requested capabilities and budgets */
export interface RequestedCapabilities {
  /** Actions the agent may attempt */
  capabilities: AgentCapability[];
  /** Rate limit on actions */
  maxActionsPerWindow?: ActionRateLimit;
  /** CPU time budget per tick in milliseconds */
  computeBudgetMsPerTick?: number;
  /** Observation fidelity limits */
  observationBudget?: ObservationBudget;
  /** Energy constraints */
  energyBudget?: EnergyBudget;
}

/** Default trait values */
export interface AgentDefaults {
  /** Preset trait configuration */
  traitsPreset?: TraitsPreset;
  /** Traits the agent may modify at runtime */
  mutableTraits?: MutableTrait[];
}

/** Compatibility requirements */
export interface CompatRequirements {
  /** Minimum habitat version required (semver) */
  minHabitatVersion?: string;
}

/** Quarantine mode settings */
export interface QuarantineSettings {
  /** If true, agent MUST run in quarantine shard */
  required?: boolean;
  /** Specific shard to assign */
  shardId?: string;
}

/**
 * Complete Agent Manifest
 *
 * Declares what an agent needs. World grants a subset (never more).
 */
export interface AgentManifest {
  /** Schema version. Must be "1.0" */
  manifestVersion: '1.0';
  /** Agent identity and entry point */
  agent: AgentIdentity;
  /** Requested capabilities and budgets */
  requested: RequestedCapabilities;
  /** Default trait values */
  defaults?: AgentDefaults;
  /** Compatibility requirements */
  compat?: CompatRequirements;
  /** Quarantine mode settings */
  quarantine?: QuarantineSettings;
}

/**
 * Granted capabilities after admission
 *
 * What the world actually allows (may be less than requested).
 */
export interface GrantedCapabilities {
  /** Granted capabilities (subset of requested) */
  capabilities: AgentCapability[];
  /** Actual rate limit (may be stricter) */
  maxActionsPerWindow: ActionRateLimit;
  /** Actual compute budget (may be lower) */
  computeBudgetMsPerTick: number;
  /** Actual observation limits (may be more degraded) */
  observationBudget: ObservationBudget;
  /** Actual energy limits (may be lower) */
  energyBudget: EnergyBudget;
  /** Whether agent is in quarantine */
  inQuarantine: boolean;
  /** Assigned shard (if quarantined) */
  shardId?: string;
}

/**
 * Admission result
 */
export interface AdmissionResult {
  /** Whether agent was admitted */
  admitted: boolean;
  /** Granted capabilities (if admitted) */
  granted?: GrantedCapabilities;
  /** Rejection reasons (if not admitted) */
  rejectionReasons?: string[];
}

/** Default values for optional fields */
export const MANIFEST_DEFAULTS = {
  maxActionsPerWindow: {
    windowTicks: 200,
    max: 10,
  },
  computeBudgetMsPerTick: 10,
  observationBudget: {
    maxCells: 9,
    maxFields: 12,
    noiseFloor: 0.2,
  },
  energyBudget: {
    maxPerTick: 20,
    maxReserve: 200,
  },
  traitsPreset: 'MINIMAL' as TraitsPreset,
  minHabitatVersion: '0.12.0',
} as const;
