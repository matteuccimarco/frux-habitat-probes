/**
 * FRUX Smart API Client
 *
 * Shared utility for calling FRUX Smart API.
 * Used by LLM probes for action decision-making.
 *
 * Security:
 * - Never log FRUX_API_KEY
 * - Redact sensitive data in logs
 * - Use preferLocal to avoid external calls when possible
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface FruxConfig {
  /** FRUX API URL (e.g., https://api.frux.pro) */
  apiUrl: string;
  /** FRUX API Key - NEVER LOG THIS */
  apiKey: string;
  /** Prefer local model (recommended: true) */
  preferLocal: boolean;
  /** Request timeout in ms */
  timeoutMs: number;
  /** Max retries on failure */
  maxRetries: number;
}

export const DEFAULT_FRUX_CONFIG: Omit<FruxConfig, 'apiKey'> = {
  apiUrl: 'https://api.frux.pro',
  preferLocal: true,
  timeoutMs: 8000,
  maxRetries: 2,
};

// ============================================================================
// RESPONSE TYPES
// ============================================================================

interface FruxApiResponse {
  // Direct response formats
  text?: string;
  message?: string;
  content?: string;
  response?: string;
  // FRUX Smart API format
  success?: boolean;
  result?: {
    message?: string;
    content?: string;
  };
  // OpenAI-style format
  choices?: Array<{
    message?: { content?: string };
    text?: string;
  }>;
  // Anthropic-style format
  completion?: string;
}

export interface FruxResult {
  ok: boolean;
  text?: string;
  error?: string;
}

// ============================================================================
// CLIENT
// ============================================================================

/**
 * Call FRUX Smart API with the given message.
 *
 * @param message - Combined system + user prompt
 * @param config - FRUX configuration
 * @returns Result with text or error
 */
export async function callFruxLLM(
  message: string,
  config: FruxConfig
): Promise<FruxResult> {
  if (!config.apiKey) {
    return { ok: false, error: 'FRUX_API_KEY not configured' };
  }

  let lastError: string | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

      const response = await fetch(`${config.apiUrl}/api/v1/smart/chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          preferLocal: config.preferLocal,
          skipWebSearch: true,
          service: 'chat',
          responseFormat: 'json',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
        // 401 = bad key, don't retry
        if (response.status === 401) {
          return { ok: false, error: 'Invalid FRUX_API_KEY (401)' };
        }
        continue;
      }

      const data = (await response.json()) as FruxApiResponse;

      // Extract text from various response shapes
      let text: string | undefined;

      // Try FRUX Smart API format first (result.message)
      if (data.success && data.result) {
        text = data.result.message ?? data.result.content;
      }

      // Try direct fields
      if (!text) {
        text = data.text ?? data.message ?? data.content ?? data.response ?? data.completion;
      }

      // Try OpenAI-style choices array
      if (!text && data.choices && data.choices.length > 0) {
        const choice = data.choices[0];
        text = choice?.message?.content ?? choice?.text;
      }

      if (typeof text === 'string' && text.trim().length > 0) {
        return { ok: true, text: text.trim() };
      }

      lastError = 'Empty response from FRUX';
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          lastError = 'Request timeout';
        } else {
          lastError = err.message;
        }
      } else {
        lastError = 'Unknown error';
      }
    }
  }

  return { ok: false, error: lastError };
}

/**
 * Check if FRUX is configured (API key present).
 */
export function isFruxConfigured(apiKey: string | undefined): boolean {
  return typeof apiKey === 'string' && apiKey.length > 0 && apiKey !== 'REPLACE_ME';
}

/**
 * Redact API key for logging purposes.
 */
export function redactApiKey(apiKey: string | undefined): string {
  if (!apiKey || apiKey.length < 8) return '***';
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}
