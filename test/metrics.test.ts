import { describe, it, expect, beforeEach } from 'vitest';
import { 
  recordIngest, 
  recordExtraction, 
  recordSearch, 
  recordError,
  getMetrics, 
  getSearchLatencyPercentiles, 
  resetMetrics 
} from '../src/metrics.js';

describe('Metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should record ingests', () => {
    recordIngest(5);
    expect(getMetrics().claims_ingested).toBe(5);
  });

  it('should record extractions', () => {
    recordExtraction(3);
    expect(getMetrics().claims_extracted).toBe(3);
  });

  it('should record searches and latency', () => {
    recordSearch(10);
    recordSearch(20);
    expect(getMetrics().searches_executed).toBe(2);
    expect(getMetrics().search_latency_ms).toHaveLength(2);
  });

  it('should record errors', () => {
    recordError('test error');
    expect(getMetrics().errors).toBe(1);
    expect(getMetrics().last_error).toBe('test error');
  });

  it('should calculate latency percentiles', () => {
    for (let i = 1; i <= 100; i++) recordSearch(i);
    const p = getSearchLatencyPercentiles();
    // Allow small variance in percentile calculation
    expect(p.p50).toBeGreaterThanOrEqual(49);
    expect(p.p50).toBeLessThanOrEqual(51);
    expect(p.p95).toBeGreaterThanOrEqual(94);
    expect(p.p95).toBeLessThanOrEqual(96);
    expect(p.p99).toBeGreaterThanOrEqual(98);
    expect(p.p99).toBeLessThanOrEqual(100);
  });

  it('should track uptime', () => {
    const m = getMetrics();
    expect(m.uptime_ms).toBeGreaterThan(0);
  });

  it('should reset metrics', () => {
    recordIngest(10);
    recordError('err');
    resetMetrics();
    expect(getMetrics().claims_ingested).toBe(0);
    expect(getMetrics().errors).toBe(0);
    expect(getMetrics().last_error).toBeUndefined();
  });
});
