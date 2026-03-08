import { Claim } from './types.js';

const GRAPHITI_URL = process.env.GRAPHITI_URL || 'http://localhost:8721';
const TIMEOUT_MS = 5000;

export async function ingestClaims(claims: Claim[], groupId: string): Promise<{ ingested: number; duplicates: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  
  try {
    const response = await fetch(`${GRAPHITI_URL}/claims/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claims, group_id: groupId }),
      signal: controller.signal,
    });
    
    if (!response.ok) {
      throw new Error(`Graphiti error: ${response.status}`);
    }
    
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchClaims(
  query: string,
  groupId: string,
  options: { status?: string[]; limit?: number } = {}
): Promise<Claim[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000); // 1s timeout for assemble
  
  try {
    const response = await fetch(`${GRAPHITI_URL}/claims/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        group_id: groupId,
        status: options.status || ['active'],
        limit: options.limit || 20,
      }),
      signal: controller.signal,
    });
    
    if (!response.ok) {
      throw new Error(`Graphiti search error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.claims || [];
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('Graphiti search timed out, returning empty claims');
    }
    return []; // Graceful degradation
  } finally {
    clearTimeout(timeout);
  }
}

export async function markSessionClaimsArchived(sessionId: string): Promise<void> {
  // This is optional - marks claims from this session as archived
  // For now, skip this as the PATCH endpoint updates individual claims
  // A bulk endpoint would be needed: POST /claims/archive-session
  console.log(`Would mark claims for session ${sessionId} as archived`);
}