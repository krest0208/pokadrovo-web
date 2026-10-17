# Accounts 0.8 — scope and checks

This update adds a Node/SQLite identity service, email registration/login, profile editing, owner login reuse, OAuth adapters/configuration and per-account project documents. The existing video compositor and AI plan protocol are not replaced.

## Completed locally

- 48 Node test groups passed against real HTTP requests and SQLite: 25 existing owner-admin tests plus 23 account/OAuth groups. Account tests include password hashing, CSRF, fixed origin, forgery, login throttling, owner/user role separation, project ownership and stale-account guards, revocation, username changes, secret storage, state binding/replay, professional Instagram limitation, Google signed ID-token validation and mocked callback flow.
- 120 existing editor-model assertions passed.
- 35 existing AI-protocol/transformation assertions passed.
- Full `src` TypeScript checked with TypeScript strict mode; the offline preview compiles the same source and uses the installed React 19.3.1 runtime, not a separate mocked interface.
- 25 Chromium UI-flow checks passed: registration from the lower create button, real server user creation/session and project persistence, profile update, logout/login, reopening a project, owner access, real users table, OAuth configuration display, editable owner login and profile width checks at 320/390/768/1024/1440.

## Browser test boundary

This environment blocks direct browser navigation to localhost. The UI ran in an about:blank test document with the actual application CSS/JS. A test-only Playwright binding forwarded fetch requests to the real local Node server with an isolated test cookie jar. Browser storage/history and the transport were adapted by the test harness, not production code. This verifies UI-to-server flows, **not** normal browser cookie policy, redirects, IndexedDB persistence or full real-origin authentication. No browser security policy was disabled. Server cookies, origins and unauthorised routes were independently checked over actual HTTP.

Screenshots show deliberately created test users/projects, not existing real visitors or a live deployment. No test password, cookie, SQLite database, OAuth secret or transport shim is committed.

## Not yet verified

Real Google/Facebook/Instagram app login, provider review, HTTP-to-HTTPS production configuration, email delivery, email verification/recovery, cross-device media restoration, all-browser persistent sessions and long-running exports. Provider callbacks have mocked protocol tests only. Instagram supports the professional-account API, not arbitrary personal accounts. Payments and actual AI montage remain unavailable.

The existing build workflow runs the actual Vite/React production build plus server and editor tests in GitHub Actions. Check the recorded run for the final committed SHA rather than treating this document as proof of a future CI result.