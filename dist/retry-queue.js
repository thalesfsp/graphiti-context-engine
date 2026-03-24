const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 60000; // 1 minute
class RetryQueue {
    queue = [];
    add(claims, groupId) {
        this.queue.push({ claims, groupId, attempts: 0, lastAttempt: Date.now() });
    }
    async processRetries(ingestFn) {
        const now = Date.now();
        const toRetry = this.queue.filter(item => item.attempts < MAX_RETRIES && now - item.lastAttempt >= RETRY_DELAY_MS);
        for (const item of toRetry) {
            try {
                await ingestFn(item.claims, item.groupId);
                // Success - remove from queue
                this.queue = this.queue.filter(i => i !== item);
            }
            catch {
                item.attempts++;
                item.lastAttempt = now;
                if (item.attempts >= MAX_RETRIES) {
                    console.error(`Claim ingestion failed after ${MAX_RETRIES} retries, dropping`);
                    this.queue = this.queue.filter(i => i !== item);
                }
            }
        }
    }
    size() {
        return this.queue.length;
    }
}
export const retryQueue = new RetryQueue();
//# sourceMappingURL=retry-queue.js.map