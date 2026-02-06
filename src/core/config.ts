/**
 * Probe Agents Kit - Configuration
 *
 * Parses environment variables and CLI arguments.
 * Env vars take precedence over defaults.
 */

import type { AgentArchetype } from './types.js';

export interface ProbeConfig {
  /** Core API base URL (without trailing slash) - register, traces, physics, joint */
  coreApiUrl: string;
  /** Perception API base URL (without trailing slash) - perceive */
  perceptionApiUrl: string;
  /** Number of Quiet Sensor agents */
  qsCount: number;
  /** Number of Cost-Bound Crafter agents */
  cbcCount: number;
  /** Number of Joint Prospector agents */
  japCount: number;
  /** Number of LLM Probe agents */
  llmCount: number;
  /** Base random seed */
  baseSeed: number;
  /** Tick interval in milliseconds */
  tickIntervalMs: number;
  /** Max retries for HTTP requests */
  maxRetries: number;
  /** Enable verbose logging */
  verbose: boolean;
  /** FRUX Smart API URL (for LLM probes) */
  fruxApiUrl: string;
  /** FRUX API Key (for LLM probes) */
  fruxApiKey: string;
  /** Prefer local FRUX model */
  fruxPreferLocal: boolean;
  /** FRUX request timeout in ms */
  fruxTimeoutMs: number;
  /** LLM probe energy floor */
  llmEnergyFloor: number;
  /** LLM probe session budget */
  llmSessionBudget: number;
  /** Enable CREATE_INQUIRY action for LLM probes (default: false) */
  llmEnableInquiry: boolean;
}

const defaults: ProbeConfig = {
  coreApiUrl: 'http://localhost:9670',
  perceptionApiUrl: 'http://localhost:9671',
  qsCount: 10,
  cbcCount: 3,
  japCount: 2,
  llmCount: 0,
  baseSeed: 42,
  tickIntervalMs: 1000,
  maxRetries: 3,
  verbose: false,
  fruxApiUrl: 'https://api.frux.pro',
  fruxApiKey: '',
  fruxPreferLocal: true,
  fruxTimeoutMs: 8000,
  llmEnergyFloor: 3,
  llmSessionBudget: 100,
  llmEnableInquiry: false,
};

function parseIntEnv(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function parseBoolEnv(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return fallback;
  return val.toLowerCase() === 'true' || val === '1';
}

function parseStringEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): ProbeConfig {
  return {
    coreApiUrl: parseStringEnv('HABITAT_CORE_URL', defaults.coreApiUrl),
    perceptionApiUrl: parseStringEnv('HABITAT_PERCEPTION_URL', defaults.perceptionApiUrl),
    qsCount: parseIntEnv('PROBE_QS_COUNT', defaults.qsCount),
    cbcCount: parseIntEnv('PROBE_CBC_COUNT', defaults.cbcCount),
    japCount: parseIntEnv('PROBE_JAP_COUNT', defaults.japCount),
    llmCount: parseIntEnv('PROBE_LLM_COUNT', defaults.llmCount),
    baseSeed: parseIntEnv('PROBE_BASE_SEED', defaults.baseSeed),
    tickIntervalMs: parseIntEnv('PROBE_TICK_INTERVAL_MS', defaults.tickIntervalMs),
    maxRetries: parseIntEnv('PROBE_MAX_RETRIES', defaults.maxRetries),
    verbose: parseBoolEnv('PROBE_VERBOSE', defaults.verbose),
    fruxApiUrl: parseStringEnv('FRUX_API_URL', defaults.fruxApiUrl),
    fruxApiKey: parseStringEnv('FRUX_API_KEY', defaults.fruxApiKey),
    fruxPreferLocal: parseBoolEnv('FRUX_PREFER_LOCAL', defaults.fruxPreferLocal),
    fruxTimeoutMs: parseIntEnv('FRUX_TIMEOUT_MS', defaults.fruxTimeoutMs),
    llmEnergyFloor: parseIntEnv('LLM_ENERGY_FLOOR', defaults.llmEnergyFloor),
    llmSessionBudget: parseIntEnv('LLM_SESSION_BUDGET', defaults.llmSessionBudget),
    llmEnableInquiry: parseBoolEnv('PROBE_LLM_ENABLE_INQUIRY', defaults.llmEnableInquiry),
  };
}

export function parseCliArgs(args: string[]): Partial<ProbeConfig> {
  const result: Partial<ProbeConfig> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--core-url':
        if (next) result.coreApiUrl = next;
        i++;
        break;
      case '--perception-url':
        if (next) result.perceptionApiUrl = next;
        i++;
        break;
      case '--qs':
        if (next) result.qsCount = parseInt(next, 10);
        i++;
        break;
      case '--cbc':
        if (next) result.cbcCount = parseInt(next, 10);
        i++;
        break;
      case '--jap':
        if (next) result.japCount = parseInt(next, 10);
        i++;
        break;
      case '--llm':
        if (next) result.llmCount = parseInt(next, 10);
        i++;
        break;
      case '--seed':
        if (next) result.baseSeed = parseInt(next, 10);
        i++;
        break;
      case '--tick-interval':
        if (next) result.tickIntervalMs = parseInt(next, 10);
        i++;
        break;
      case '--retries':
        if (next) result.maxRetries = parseInt(next, 10);
        i++;
        break;
      case '--verbose':
      case '-v':
        result.verbose = true;
        break;
      case '--frux-url':
        if (next) result.fruxApiUrl = next;
        i++;
        break;
      case '--frux-key':
        if (next) result.fruxApiKey = next;
        i++;
        break;
      case '--frux-local':
        result.fruxPreferLocal = true;
        break;
      case '--frux-timeout':
        if (next) result.fruxTimeoutMs = parseInt(next, 10);
        i++;
        break;
      case '--llm-floor':
        if (next) result.llmEnergyFloor = parseInt(next, 10);
        i++;
        break;
      case '--llm-budget':
        if (next) result.llmSessionBudget = parseInt(next, 10);
        i++;
        break;
      case '--llm-enable-inquiry':
        result.llmEnableInquiry = true;
        break;
    }
  }

  return result;
}

export function mergeConfig(envConfig: ProbeConfig, cliOverrides: Partial<ProbeConfig>): ProbeConfig {
  return { ...envConfig, ...cliOverrides };
}

export function getAgentSeed(baseSeed: number, archetype: AgentArchetype, index: number): number {
  // Deterministic seed per agent: hash(baseSeed + archetype + index)
  const archetypeOffsets: Record<AgentArchetype, number> = {
    QS: 0,
    CBC: 1000,
    JAP: 2000,
    LLM: 3000,
  };
  const archetypeOffset = archetypeOffsets[archetype];
  return baseSeed * 31 + archetypeOffset + index;
}
