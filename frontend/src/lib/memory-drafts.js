// Drafts belong to one application session, even when logout/login happens in
// the same tab. Invalidate queued autosaves as well as already saved values.
export const memoryDrafts = new Map();
let sessionId = 0;

export function getDraftSessionId() {
    return sessionId;
}

export function clearMemoryDrafts() {
    sessionId += 1;
    memoryDrafts.clear();
}
