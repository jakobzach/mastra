---
'@mastra/client-js': patch
---

Fixed thread subscription reconnects to stop and report HTTP 401 and 403 errors while preserving retries for transient failures.
