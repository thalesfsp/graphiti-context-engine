class MessageQueue {
    reset() {
        this.queue = [];
        this.seen.clear();
    }
    queue = [];
    seen = new Set();
    enqueue(item) {
        // Dedupe by sessionId + messageId
        const key = `${item.sessionId}:${item.messageId}`;
        if (!this.seen.has(key)) {
            this.seen.add(key);
            this.queue.push(item);
        }
    }
    drain() {
        const items = [...this.queue];
        this.seen.clear();
        this.queue = [];
        return items;
    }
    size() {
        return this.queue.length;
    }
}
export const messageQueue = new MessageQueue();
//# sourceMappingURL=queue.js.map