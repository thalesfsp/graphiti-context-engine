import type { Claim } from './types.js';
declare class RetryQueue {
    private queue;
    add(claims: Claim[], groupId: string): void;
    processRetries(ingestFn: (claims: Claim[], groupId: string) => Promise<any>): Promise<void>;
    size(): number;
}
export declare const retryQueue: RetryQueue;
export {};
//# sourceMappingURL=retry-queue.d.ts.map