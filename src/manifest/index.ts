/**
 * Agent Manifest Module
 *
 * Provides manifest types, validation, and admission logic
 * for third-party agents in AI-HABITAT.
 */

export type {
  AgentKind,
  AgentCapability,
  TraitsPreset,
  MutableTrait,
  AgentIdentity,
  ActionRateLimit,
  ObservationBudget,
  EnergyBudget,
  RequestedCapabilities,
  AgentDefaults,
  CompatRequirements,
  QuarantineSettings,
  AgentManifest,
  GrantedCapabilities,
  AdmissionResult,
} from './types.js';

export { MANIFEST_DEFAULTS } from './types.js';

export type {
  ValidationError,
  ValidationResult,
  WorldPolicy,
} from './validator.js';

export {
  DEFAULT_WORLD_POLICY,
  validateManifest,
  performAdmission,
  loadManifest,
} from './validator.js';
