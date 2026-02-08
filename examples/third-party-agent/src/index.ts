/**
 * Example Third-Party Agent
 *
 * Demonstrates minimal agent implementation for AI-HABITAT.
 *
 * IMPORTANT CONSTRAINTS:
 * - You receive ONLY what the sandbox provides
 * - You CANNOT access network, filesystem, or real clock
 * - You CANNOT bypass costs (world enforces them)
 * - You CANNOT see more than your observation budget allows
 * - You WILL be quarantined (separate from main habitat)
 *
 * Your agent is a guest in the habitat. The habitat is indifferent.
 */

import type {
  SandboxStepInput,
  SandboxStepOutput,
  ActionRequest,
} from '../../../src/sandbox/index.js';

/**
 * Agent state persisted across steps
 *
 * Keep this minimal - you have limited memory.
 */
interface AgentMemory {
  /** Steps taken */
  stepCount: number;
  /** Last known position */
  lastPosition: { x: number; y: number };
  /** Direction preference */
  preferredDirection: 'N' | 'S' | 'E' | 'W';
}

/** Initialize agent memory */
function initMemory(): AgentMemory {
  return {
    stepCount: 0,
    lastPosition: { x: 0, y: 0 },
    preferredDirection: 'E',
  };
}

/** Current memory (would be loaded from persistent store in real agent) */
let memory: AgentMemory = initMemory();

/**
 * Agent step function
 *
 * Called each tick with current state and context.
 * Must return actions to attempt within compute budget.
 */
export function step(input: SandboxStepInput): SandboxStepOutput {
  const { state, context } = input;
  const actions: ActionRequest[] = [];

  memory.stepCount++;

  // Check if we have energy to act
  if (state.energy < 3) {
    // Conserve energy - do nothing this tick
    return { actions: [], computeTimeMs: 1 };
  }

  // Decide action based on observation
  const observation = state.observation;

  if (observation.cells.length > 0) {
    // Look for interesting cells
    const interestingCells = observation.cells.filter(
      (cell) => cell.traceDensity > 0.3
    );

    if (interestingCells.length > 0) {
      // Move toward most interesting cell
      const target = interestingCells[0];
      actions.push({
        type: 'MOVE',
        params: { dx: Math.sign(target.dx), dy: Math.sign(target.dy) },
      });
    } else {
      // Explore in preferred direction
      const dx = memory.preferredDirection === 'E' ? 1 : memory.preferredDirection === 'W' ? -1 : 0;
      const dy = memory.preferredDirection === 'N' ? -1 : memory.preferredDirection === 'S' ? 1 : 0;
      actions.push({ type: 'MOVE', params: { dx, dy } });
    }
  }

  // Occasionally sense surroundings
  if (memory.stepCount % 5 === 0) {
    actions.push({ type: 'SENSE', params: { radius: 1 } });
  }

  // Update memory
  memory.lastPosition = state.location;

  // Rotate direction occasionally
  if (memory.stepCount % 20 === 0) {
    const dirs: Array<'N' | 'S' | 'E' | 'W'> = ['N', 'E', 'S', 'W'];
    const currentIdx = dirs.indexOf(memory.preferredDirection);
    memory.preferredDirection = dirs[(currentIdx + 1) % 4];
  }

  return {
    actions,
    computeTimeMs: 2, // Estimate - actual measured by sandbox
  };
}

/**
 * Main entry point
 *
 * In a real deployment, this would:
 * 1. Connect to habitat via provided interface
 * 2. Load persisted memory
 * 3. Enter step loop
 */
async function main() {
  console.log('[ExampleAgent] Starting...');
  console.log('[ExampleAgent] Waiting for habitat connection...');

  // In real implementation:
  // const habitat = await connectToHabitat();
  // while (true) {
  //   const input = await habitat.receiveStepInput();
  //   const output = step(input);
  //   await habitat.sendStepOutput(output);
  // }

  console.log('[ExampleAgent] This is a template - see THIRD_PARTY_AGENTS.md for integration');
}

// Only run main if this is the entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
