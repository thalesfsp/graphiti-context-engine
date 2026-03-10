import { searchClaims } from '../src/graphiti-client.js';

let isGraphitiAvailable = false;

describe('E2E: Real Graphiti', () => {
  beforeAll(async () => {
    // Check if Graphiti is available, skip suite if not
    const health = await fetch('http://localhost:8721/health').catch(() => null);
    isGraphitiAvailable = !!health?.ok;
    if (!isGraphitiAvailable) {
      console.log('Skipping E2E tests - Graphiti not available');
    }
  });

  it.skipIf(() => !isGraphitiAvailable)('should return results from /search endpoint', async () => {
    const response = await fetch('http://localhost:8721/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', group_ids: ['system'], num_results: 5 }),
    });
    
    // If Graphiti is down, this will just fail (which is fine if beforeAll skips it properly, 
    // but Jest beforeAll skip logic isn't native, so we check again if fetch fails)
    if (!response) {
      return; 
    }
    
    expect(response.ok).toBe(true);
    const data = await response.json() as any;
    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
  });

  it.skipIf(() => !isGraphitiAvailable)('should format claims properly in searchClaims() wrapper', async () => {
    try {
      const claims = await searchClaims('memory', ['system'], { limit: 1 });
      
      // We don't guarantee results if db is empty, but if there are results they should match Claim format
      if (claims.length > 0) {
        const claim = claims[0];
        expect(claim).toBeDefined();
        // Since we mapped edges to claims, verify the mapping
        expect(claim?.claim_id).toBeDefined();
        expect(claim?.subject).toBeDefined();
        expect(claim?.predicate).toBeDefined();
        expect(claim?.object).toBeDefined();
      }
    } catch (e: any) {
      // Graceful fail if graphiti not running
      if (e.message && e.message.includes('fetch failed')) {
        console.warn('Graphiti unreachable, skipping test');
      } else {
        throw e;
      }
    }
  });
});