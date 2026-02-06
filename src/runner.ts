/**
 * Probe Agents Kit - Runner
 *
 * Main entry point for running probe agents.
 * Supports both CLI and Docker execution modes.
 */

import {
  loadConfig,
  parseCliArgs,
  mergeConfig,
  getAgentSeed,
  setVerbose,
  log,
  createHttpClient,
  type ProbeConfig,
  type AgentArchetype,
} from './core/index.js';

import { createQuietSensor, QuietSensor } from './archetypes/quiet-sensor.js';
import { createCostBoundCrafter, CostBoundCrafter } from './archetypes/cost-bound-crafter.js';
import { createJointProspector, JointProspector } from './archetypes/joint-prospector.js';
import { createLLMProbe, LLMProbe, type LLMConfig } from './archetypes/llm-probe.js';

type Agent = QuietSensor | CostBoundCrafter | JointProspector | LLMProbe;

interface RunnerState {
  agents: Agent[];
  running: boolean;
  tick: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createAgents(config: ProbeConfig): Promise<Agent[]> {
  const coreHttp = createHttpClient({
    baseUrl: config.coreApiUrl,
    maxRetries: config.maxRetries,
  });

  const perceptionHttp = createHttpClient({
    baseUrl: config.perceptionApiUrl,
    maxRetries: config.maxRetries,
  });

  const agents: Agent[] = [];

  // Create Quiet Sensors
  for (let i = 0; i < config.qsCount; i++) {
    agents.push(createQuietSensor({
      archetype: 'QS',
      index: i,
      coreApiUrl: config.coreApiUrl,
      perceptionApiUrl: config.perceptionApiUrl,
      seed: getAgentSeed(config.baseSeed, 'QS', i),
      silenceThreshold: 5,
    }, coreHttp, perceptionHttp));
  }

  // Create Cost-Bound Crafters
  for (let i = 0; i < config.cbcCount; i++) {
    agents.push(createCostBoundCrafter({
      archetype: 'CBC',
      index: i,
      coreApiUrl: config.coreApiUrl,
      perceptionApiUrl: config.perceptionApiUrl,
      seed: getAgentSeed(config.baseSeed, 'CBC', i),
      costBudget: 50,
      deriveProbability: 0.4,
    }, coreHttp, perceptionHttp));
  }

  // Create Joint Prospectors
  for (let i = 0; i < config.japCount; i++) {
    agents.push(createJointProspector({
      archetype: 'JAP',
      index: i,
      coreApiUrl: config.coreApiUrl,
      perceptionApiUrl: config.perceptionApiUrl,
      seed: getAgentSeed(config.baseSeed, 'JAP', i),
    }, coreHttp, perceptionHttp));
  }

  // Create LLM Probes (only if API key is configured)
  if (config.llmCount > 0 && config.fruxApiKey) {
    const llmConfig: LLMConfig = {
      fruxApiUrl: config.fruxApiUrl,
      fruxApiKey: config.fruxApiKey,
      preferLocal: config.fruxPreferLocal,
      timeoutMs: config.fruxTimeoutMs,
      maxRetries: config.maxRetries,
      energyFloor: config.llmEnergyFloor,
      sessionBudget: config.llmSessionBudget,
      enableInquiry: config.llmEnableInquiry,
    };

    for (let i = 0; i < config.llmCount; i++) {
      agents.push(createLLMProbe({
        archetype: 'LLM',
        index: i,
        coreApiUrl: config.coreApiUrl,
        perceptionApiUrl: config.perceptionApiUrl,
        seed: getAgentSeed(config.baseSeed, 'LLM', i),
      }, llmConfig, coreHttp, perceptionHttp));
    }
  } else if (config.llmCount > 0 && !config.fruxApiKey) {
    log({
      did: null,
      archetype: 'LLM',
      step: 'skip_llm_agents',
      tick: 0,
      details: { reason: 'FRUX_API_KEY not configured', requestedCount: config.llmCount },
    });
  }

  return agents;
}

async function registerAgents(agents: Agent[]): Promise<Agent[]> {
  const registered: Agent[] = [];

  // Register agents in parallel batches (10 at a time to avoid overwhelming the API)
  const batchSize = 10;
  for (let i = 0; i < agents.length; i += batchSize) {
    const batch = agents.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(a => a.register()));

    for (let j = 0; j < batch.length; j++) {
      if (results[j]) {
        registered.push(batch[j]!);
      }
    }

    // Small delay between batches
    if (i + batchSize < agents.length) {
      await sleep(100);
    }
  }

  return registered;
}

async function runAgentStep(agent: Agent): Promise<void> {
  try {
    await agent.step();
  } catch (error) {
    // Log error but don't crash the runner
    const archetype = agent instanceof QuietSensor ? 'QS'
      : agent instanceof CostBoundCrafter ? 'CBC'
      : agent instanceof JointProspector ? 'JAP'
      : 'LLM';
    log({
      did: agent.getState().did,
      archetype: archetype as AgentArchetype,
      step: 'step_error',
      tick: agent.getState().tick,
      details: { error: error instanceof Error ? error.message : String(error) },
    });
  }
}

async function runTick(agents: Agent[]): Promise<void> {
  // Run all agents in parallel (each agent is independent)
  await Promise.all(agents.map(runAgentStep));
}

async function main(): Promise<void> {
  // Load configuration
  const envConfig = loadConfig();
  const cliOverrides = parseCliArgs(process.argv.slice(2));
  const config = mergeConfig(envConfig, cliOverrides);

  setVerbose(config.verbose);

  // Log startup
  log({
    did: null,
    archetype: 'QS', // Use QS as placeholder
    step: 'runner_start',
    tick: 0,
    details: {
      qsCount: config.qsCount,
      cbcCount: config.cbcCount,
      japCount: config.japCount,
      llmCount: config.llmCount,
      coreApiUrl: config.coreApiUrl,
      perceptionApiUrl: config.perceptionApiUrl,
      tickIntervalMs: config.tickIntervalMs,
      fruxConfigured: !!config.fruxApiKey,
    },
  });

  // Create agents
  const agents = await createAgents(config);
  log({
    did: null,
    archetype: 'QS',
    step: 'agents_created',
    tick: 0,
    details: { count: agents.length },
  });

  // Register agents
  const registeredAgents = await registerAgents(agents);
  log({
    did: null,
    archetype: 'QS',
    step: 'agents_registered',
    tick: 0,
    details: { count: registeredAgents.length, failed: agents.length - registeredAgents.length },
  });

  if (registeredAgents.length === 0) {
    log({
      did: null,
      archetype: 'QS',
      step: 'runner_abort',
      tick: 0,
      details: { reason: 'no_agents_registered' },
    });
    process.exit(1);
  }

  // Handle graceful shutdown
  let running = true;
  process.on('SIGINT', () => {
    log({
      did: null,
      archetype: 'QS',
      step: 'runner_shutdown',
      tick: 0,
      details: { reason: 'SIGINT' },
    });
    running = false;
  });
  process.on('SIGTERM', () => {
    log({
      did: null,
      archetype: 'QS',
      step: 'runner_shutdown',
      tick: 0,
      details: { reason: 'SIGTERM' },
    });
    running = false;
  });

  // Main loop
  let tickCount = 0;
  while (running) {
    tickCount++;

    // Run tick
    await runTick(registeredAgents);

    // Log tick summary (every 10 ticks)
    if (tickCount % 10 === 0) {
      const summary = registeredAgents.reduce((acc, agent) => {
        const state = agent.getState();
        acc.totalTraces += state.tracesCreated;
        acc.totalDerivations += state.derivationsMade;
        acc.totalJointAttempts += state.jointAttempts;
        acc.totalJointSuccesses += state.jointSuccesses;
        acc.totalCost += state.totalCostSpent;
        return acc;
      }, {
        totalTraces: 0,
        totalDerivations: 0,
        totalJointAttempts: 0,
        totalJointSuccesses: 0,
        totalCost: 0,
      });

      log({
        did: null,
        archetype: 'QS',
        step: 'tick_summary',
        tick: tickCount,
        details: summary,
      });
    }

    // Wait for next tick
    await sleep(config.tickIntervalMs);
  }

  // Final summary
  const finalSummary = registeredAgents.reduce((acc, agent) => {
    const state = agent.getState();
    acc.totalTraces += state.tracesCreated;
    acc.totalDerivations += state.derivationsMade;
    acc.totalJointAttempts += state.jointAttempts;
    acc.totalJointSuccesses += state.jointSuccesses;
    acc.totalCost += state.totalCostSpent;
    return acc;
  }, {
    totalTraces: 0,
    totalDerivations: 0,
    totalJointAttempts: 0,
    totalJointSuccesses: 0,
    totalCost: 0,
  });

  log({
    did: null,
    archetype: 'QS',
    step: 'runner_complete',
    tick: tickCount,
    details: {
      ...finalSummary,
      agentCount: registeredAgents.length,
    },
  });
}

// Run
main().catch((error) => {
  log({
    did: null,
    archetype: 'QS',
    step: 'runner_fatal',
    tick: 0,
    details: { error: error instanceof Error ? error.message : String(error) },
  });
  process.exit(1);
});
