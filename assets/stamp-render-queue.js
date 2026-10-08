// Stamp image decoding must finish before PDF capture or undo. Failed placement
// blocks that save attempt rather than silently saving an unstamped document.
class StampRenderQueue {
    constructor() { this.pending = new Set(); this.errors = []; }
    add(work) {
        const promise = Promise.resolve().then(work);
        this.pending.add(promise);
        promise.catch(error => { this.errors.push(error); }).finally(() => { this.pending.delete(promise); });
        return promise;
    }
    async wait() {
        while (this.pending.size) await Promise.allSettled([...this.pending]);
        if (this.errors.length) {
            const error = this.errors[0]; this.errors = [];
            throw error;
        }
    }
}
if (typeof module !== 'undefined') module.exports = StampRenderQueue;
