/**
 * Tests for FRUX LLM Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callFruxLLM, isFruxConfigured, redactApiKey, type FruxConfig } from './frux-llm.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('frux-llm', () => {
  const validConfig: FruxConfig = {
    apiUrl: 'https://api.frux.pro',
    apiKey: 'sk-test-1234567890abcdef',
    preferLocal: true,
    timeoutMs: 5000,
    maxRetries: 1,
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('callFruxLLM', () => {
    it('returns error when API key is missing', async () => {
      const configNoKey = { ...validConfig, apiKey: '' };
      const result = await callFruxLLM('test message', configNoKey);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('FRUX_API_KEY not configured');
    });

    it('parses FRUX Smart API response format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: { message: 'Hello from FRUX' },
        }),
      });

      const result = await callFruxLLM('test message', validConfig);

      expect(result.ok).toBe(true);
      expect(result.text).toBe('Hello from FRUX');
    });

    it('parses OpenAI-style response format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'OpenAI style response' } }],
        }),
      });

      const result = await callFruxLLM('test message', validConfig);

      expect(result.ok).toBe(true);
      expect(result.text).toBe('OpenAI style response');
    });

    it('parses direct text field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'Direct text response',
        }),
      });

      const result = await callFruxLLM('test message', validConfig);

      expect(result.ok).toBe(true);
      expect(result.text).toBe('Direct text response');
    });

    it('returns error on 401 without retry', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await callFruxLLM('test message', validConfig);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid FRUX_API_KEY (401)');
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retry on 401
    });

    it('retries on 500 error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ text: 'Success after retry' }),
        });

      const result = await callFruxLLM('test message', validConfig);

      expect(result.ok).toBe(true);
      expect(result.text).toBe('Success after retry');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns error on empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await callFruxLLM('test message', validConfig);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Empty response from FRUX');
    });

    it('sends correct request body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'OK' }),
      });

      await callFruxLLM('test message', validConfig);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.frux.pro/api/v1/smart/chat',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer sk-test-1234567890abcdef',
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining('"message":"test message"'),
        })
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.preferLocal).toBe(true);
      expect(body.skipWebSearch).toBe(true);
      expect(body.responseFormat).toBe('json');
    });
  });

  describe('isFruxConfigured', () => {
    it('returns true for valid API key', () => {
      expect(isFruxConfigured('sk-1234567890')).toBe(true);
    });

    it('returns false for undefined', () => {
      expect(isFruxConfigured(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isFruxConfigured('')).toBe(false);
    });

    it('returns false for REPLACE_ME placeholder', () => {
      expect(isFruxConfigured('REPLACE_ME')).toBe(false);
    });
  });

  describe('redactApiKey', () => {
    it('redacts middle of API key', () => {
      expect(redactApiKey('sk-1234567890abcdef')).toBe('sk-1...cdef');
    });

    it('returns *** for short keys', () => {
      expect(redactApiKey('short')).toBe('***');
    });

    it('returns *** for undefined', () => {
      expect(redactApiKey(undefined)).toBe('***');
    });

    it('returns *** for empty string', () => {
      expect(redactApiKey('')).toBe('***');
    });
  });
});
