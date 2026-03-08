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