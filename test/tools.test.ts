/**
 * Tests for graphiti-context-engine tools
 * 
 * Covers:
 * - Happy path for all tools
 * - Edge cases (empty strings, special characters, missing fields)
 * - Bad paths (server down, 500 errors, timeouts, invalid responses)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
import graphitiPlugin from './index';

// Mock OpenClawPluginApi
const mockApi = {
  registerContextEngine: vi.fn(),
  registerTool: vi.fn(),
};

describe('graphiti-context-engine plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('plugin structure', () => {
    it('exports plugin with required fields', () => {
      expect(graphitiPlugin.id).toBe('graphiti-context-engine');
      expect(graphitiPlugin.name).toBe('Graphiti Context Engine');
      expect(typeof graphitiPlugin.register).toBe('function');
    });

    it('registers context engine and 3 tools', () => {
      graphitiPlugin.register(mockApi as any);
      expect(mockApi.registerContextEngine).toHaveBeenCalledTimes(1);
      expect(mockApi.registerTool).toHaveBeenCalledTimes(3);
    });

    it('registers tools with correct names', () => {
      graphitiPlugin.register(mockApi as any);
      const toolNames = mockApi.registerTool.mock.calls.map(
        (call: any[]) => call[0].name
      );
      expect(toolNames).toContain('graphiti_search');
      expect(toolNames).toContain('graphiti_store');
      expect(toolNames).toContain('graphiti_get');
    });
  });

  describe('graphiti_search tool', () => {
    let searchExecute: Function;

    beforeEach(() => {
      graphitiPlugin.register(mockApi as any);
      const searchCall = mockApi.registerTool.mock.calls.find(
        (call: any[]) => call[0].name === 'graphiti_search'
      );
      searchExecute = searchCall[0].execute;
    });

    it('happy path: returns results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { uuid: '123', fact: 'Test fact', score: 0.9 },
            { uuid: '456', fact: 'Another fact', score: 0.8 },
          ],
        }),
      });

      const result = await searchExecute('tool-1', { query: 'test query' });
      
      expect(result.details.count).toBe(2);
      expect(result.content[0].text).toContain('Found 2 result(s)');
    });

    it('empty query: still calls API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const result = await searchExecute('tool-1', { query: '' });
      
      expect(mockFetch).toHaveBeenCalled();
      expect(result.content[0].text).toContain('No results');
    });

    it('special characters in query: handles correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await searchExecute('tool-1', { query: '日本語 <script>alert(1)</script> "quotes"' });
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toBe('日本語 <script>alert(1)</script> "quotes"');
    });

    it('server returns 500: graceful error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await searchExecute('tool-1', { query: 'test' });
      
      expect(result.content[0].text).toContain('Graphiti search error');
      expect(result.details.error).toBeDefined();
    });

    it('server down: graceful error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await searchExecute('tool-1', { query: 'test' });
      
      expect(result.content[0].text).toContain('Graphiti search failed');
    });

    it('timeout: returns timeout message', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const result = await searchExecute('tool-1', { query: 'test' });
      
      expect(result.content[0].text).toContain('timed out');
    });

    it('invalid JSON response: graceful error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); },
      });

      const result = await searchExecute('tool-1', { query: 'test' });
      
      expect(result.details.error).toBeDefined();
    });

    it('with group filter: includes group_ids in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await searchExecute('tool-1', { query: 'test', group: 'helix' });
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.group_ids).toEqual(['helix']);
    });

    it('with limit: includes num_results in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await searchExecute('tool-1', { query: 'test', limit: 5 });
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.num_results).toBe(5);
    });
  });

  describe('graphiti_store tool', () => {
    let storeExecute: Function;

    beforeEach(() => {
      graphitiPlugin.register(mockApi as any);
      const storeCall = mockApi.registerTool.mock.calls.find(
        (call: any[]) => call[0].name === 'graphiti_store'
      );
      storeExecute = storeCall[0].execute;
    });

    it('happy path: stores fact', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', episode_id: 'abc-123' }),
      });

      const result = await storeExecute('tool-1', {
        fact: 'Test fact',
        group_id: 'system',
      });
      
      expect(result.content[0].text).toContain('Stored in Graphiti');
      expect(result.details.episode_id).toBe('abc-123');
    });

    it('empty fact: sends to API (validation on server)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        text: async () => 'fact must be at least 1 character',
      });

      const result = await storeExecute('tool-1', {
        fact: '',
        group_id: 'system',
      });
      
      expect(result.content[0].text).toContain('error');
    });

    it('very long fact (2000+ chars): sends to API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        text: async () => 'fact must be at most 2000 characters',
      });

      const longFact = 'a'.repeat(2500);
      const result = await storeExecute('tool-1', {
        fact: longFact,
        group_id: 'system',
      });
      
      expect(result.content[0].text).toContain('error');
    });

    it('invalid group_id: sends to API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', episode_id: 'xyz-789' }),
      });

      // Now accepts any string, so this should work
      const result = await storeExecute('tool-1', {
        fact: 'Test',
        group_id: 'custom-group',
      });
      
      expect(result.details.group_id).toBe('custom-group');
    });

    it('server 500: graceful error with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Neo4j connection failed',
      });

      const result = await storeExecute('tool-1', {
        fact: 'Test',
        group_id: 'system',
      });
      
      expect(result.content[0].text).toContain('Neo4j connection failed');
    });

    it('with custom source: includes source in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', episode_id: 'abc' }),
      });

      await storeExecute('tool-1', {
        fact: 'Test',
        group_id: 'system',
        source: 'user-input',
      });
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.source).toBe('user-input');
    });

    it('timeout: returns timeout message', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const result = await storeExecute('tool-1', {
        fact: 'Test',
        group_id: 'system',
      });
      
      expect(result.content[0].text).toContain('timed out');
    });

    it('null response fields: handles gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', episode_id: null }),
      });

      const result = await storeExecute('tool-1', {
        fact: 'Test',
        group_id: 'system',
      });
      
      expect(result.content[0].text).toContain('unknown');
    });

    it('network DNS failure: graceful error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND localhost'));

      const result = await storeExecute('tool-1', {
        fact: 'Test',
        group_id: 'system',
      });
      
      expect(result.content[0].text).toContain('failed');
      expect(result.details.error).toContain('ENOTFOUND');
    });

    it('very long group_id: sends to API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', episode_id: 'xyz' }),
      });

      const longGroupId = 'a'.repeat(500);
      await storeExecute('tool-1', {
        fact: 'Test',
        group_id: longGroupId,
      });
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.group_id.length).toBe(500);
    });
  });

  describe('graphiti_get tool', () => {
    let getExecute: Function;

    beforeEach(() => {
      graphitiPlugin.register(mockApi as any);
      const getCall = mockApi.registerTool.mock.calls.find(
        (call: any[]) => call[0].name === 'graphiti_get'
      );
      getExecute = getCall[0].execute;
    });

    it('happy path: returns entity', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'ok',
          type: 'entity',
          uuid: '123-456',
          name: 'Test Entity',
          summary: 'A test entity',
          group_id: 'system',
        }),
      });

      const result = await getExecute('tool-1', { id: '123-456' });
      
      expect(result.content[0].text).toContain('Test Entity');
      expect(result.details.found).toBe(true);
    });

    it('not found: returns 404 message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await getExecute('tool-1', { id: 'nonexistent' });
      
      expect(result.content[0].text).toContain('not found');
      expect(result.details.found).toBe(false);
    });

    it('invalid UUID format: sends to API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await getExecute('tool-1', { id: 'not-a-valid-uuid' });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/entity/not-a-valid-uuid'),
        expect.any(Object)
      );
    });

    it('special characters in ID: URL encoded', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await getExecute('tool-1', { id: 'test/with/slashes' });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/entity/test%2Fwith%2Fslashes'),
        expect.any(Object)
      );
    });

    it('empty ID: sends to API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await getExecute('tool-1', { id: '' });
      
      expect(mockFetch).toHaveBeenCalled();
    });

    it('server 500: graceful error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await getExecute('tool-1', { id: '123' });
      
      expect(result.content[0].text).toContain('error');
    });

    it('timeout: returns timeout message', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const result = await getExecute('tool-1', { id: '123' });
      
      expect(result.content[0].text).toContain('timed out');
    });

    it('null fields in response: handles gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'ok',
          uuid: '123',
          name: null,
          summary: null,
          group_id: null,
        }),
      });

      const result = await getExecute('tool-1', { id: '123' });
      
      expect(result.content[0].text).toContain('(none)');
      expect(result.details.found).toBe(true);
    });

    it('malformed JSON response: graceful error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new SyntaxError('Unexpected token'); },
      });

      const result = await getExecute('tool-1', { id: '123' });
      
      expect(result.details.error).toBeDefined();
    });

    it('SQL/Cypher injection attempt in ID: handled safely', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await getExecute('tool-1', { id: "'; DROP TABLE nodes; --" });
      
      // Should not crash, should return not found or error
      expect(mockFetch).toHaveBeenCalled();
      expect(result.content[0].text).toBeDefined();
    });
  });

  describe('edge cases across all tools', () => {
    beforeEach(() => {
      graphitiPlugin.register(mockApi as any);
    });

    it('concurrent requests: each gets independent response', async () => {
      const searchCall = mockApi.registerTool.mock.calls.find(
        (call: any[]) => call[0].name === 'graphiti_search'
      );
      const searchExecute = searchCall[0].execute;

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [{ uuid: '1', fact: 'First' }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [{ uuid: '2', fact: 'Second' }] }),
        });

      const [result1, result2] = await Promise.all([
        searchExecute('tool-1', { query: 'first' }),
        searchExecute('tool-2', { query: 'second' }),
      ]);

      expect(result1.details.results[0].id).toBe('1');
      expect(result2.details.results[0].id).toBe('2');
    });

    it('response with extra unexpected fields: ignores them', async () => {
      const searchCall = mockApi.registerTool.mock.calls.find(
        (call: any[]) => call[0].name === 'graphiti_search'
      );
      const searchExecute = searchCall[0].execute;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            uuid: '123',
            fact: 'Test',
            unexpected_field: 'should be ignored',
            another_field: { nested: true },
          }],
          extra_root_field: 'also ignored',
        }),
      });

      const result = await searchExecute('tool-1', { query: 'test' });
      
      expect(result.details.count).toBe(1);
      expect(result.details.results[0].id).toBe('123');
    });

    it('very large response: handles without crash', async () => {
      const searchCall = mockApi.registerTool.mock.calls.find(
        (call: any[]) => call[0].name === 'graphiti_search'
      );
      const searchExecute = searchCall[0].execute;

      // Generate 1000 results
      const largeResults = Array.from({ length: 1000 }, (_, i) => ({
        uuid: `uuid-${i}`,
        fact: `Fact number ${i} with some extra content to make it larger`,
        score: Math.random(),
      }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: largeResults }),
      });

      const result = await searchExecute('tool-1', { query: 'test' });
      
      expect(result.details.count).toBe(1000);
    });
  });
});
