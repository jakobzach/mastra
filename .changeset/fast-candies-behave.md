---
'@mastra/react': minor
---

Added `useChat().initialHistoryPagination` to expose the initial subscription page's `hasMore` value without a separate history request. It is `undefined` until fresh history arrives and when the subscription is unavailable.

```ts
const { initialHistoryPagination } = useChat({
  agentId: 'support-agent',
  resourceId: 'user-123',
  threadId: 'thread-abc',
  enableThreadSignals: true,
  withInitialHistory: true,
});
```
