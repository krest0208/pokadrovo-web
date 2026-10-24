# Accounts, recovery and database operations

Implemented 24 October 2026. These features do not require paid services or a new database provider. Accounts, project metadata, wallet records, legal acceptance and recovery digests share the existing persistent SQLite database. Never initialise a replacement database or replace a master key to fix a login problem.

## Open registration

The production accounts feature must be enabled and the operator's genuine documents published. The owner can inspect **Accounts and database** for database health, account/project counts and the exact outstanding document fields, then open **Documents and details**. Complete the real operator identity, contact information, storage/backup and processor/notice facts and their review before publication. Do not fabricate these values or check reviews that have not been performed. Billing and YooKassa activation remain separate; a normal individual can operate a free service without being declared an eligible payment merchant.

The registration form requires its current document version, independent terms and personal-data consent and adult eligibility. The server checks these facts after password hashing as well as before it. A published version change is recognised on tab focus and reopening login; the user does not need to keep a stale signup form indefinitely. Existing login and password recovery remain available if new signup is paused. A new document template edition requires the operator to review and approve the changed text again; a prior publication flag cannot silently approve new terms or create a consent receipt without an archived document.

## Passwords and offline recovery

Email is the account identifier. Email delivery and ownership confirmation are **not configured** and `emailVerified` is not set by password signup. Do not describe the site as sending confirmation/reset emails. A working mail delivery service and actual sender credentials/domain settings would be required for that separate integration; the current work does not create an external mailbox or accept an email-provider contract.

Each password signup issues a 192-bit random offline recovery code. The server sends it once in the private no-store signup response and retains only a keyed digest bound to that account. It never appears in an account listing, subsequent login/session response, URL, telemetry, local storage or project metadata. The UI asks the user to save it outside the site. Clipboard copying requires their button press.

**Forgot password?** accepts the email, saved code and a strong matching new password. It uses same-origin/CSRF validation, public rate limits and a global work limit. Missing accounts and incorrect codes use the same error. The code and password are rechecked after asynchronous hashing to prevent racing resets. A successful transaction changes the password, revokes all prior user sessions and rotates the code. It does not automatically sign in, delete projects/coins or change the administrator's credentials/TOTP.

Users with an existing password can create a replacement recovery code in **Profile → Security**, confirming their current password. Password changes also issue a fresh code and revoke the old one. Existing users are not assigned visible or predictable default recovery codes. A user who loses both password and code needs a separately verified support process; do not reset on the basis of a claimed email address alone.

## Database health and backups

**Accounts and database** is owner-only. The API requires the existing owner session; mutations additionally require same-origin/CSRF and current-password reauthentication. Owner status exposes integrity checks, schema/WAL/foreign-key configuration, counts and backup dates/sizes. Public health exposes only a cached boolean database readiness check. It never exposes private filesystem paths, database downloads, key content, recovery codes or API credentials.

On an HTTPS server with accounts enabled, automatic backup starts checking one minute after startup and checks every five minutes. It creates at most one successful scheduled snapshot per day. Local development/testing defaults to manual operation. A manual owner action can create a verified snapshot without a paid provider.

Snapshots use Node's SQLite online backup API (available in Node 22.16+), not a raw copy of a live WAL database. A candidate is built in a private temporary directory, checked for SQLite integrity and foreign-key validity, paired with the matching master key, and atomically renamed only after success. Directories are mode 0700 and files 0600. Symlink destinations are refused. Failure removes the partial copy and preserves the last good one. Shutdown waits for an active copy before closing SQLite.

Only the generated snapshot directories are rotated. Keep up to seven copies over seven days, with a 512 MiB overall history budget and a 128 MiB source-size cap. Low disk space prevents a new copy without removing the last known good snapshot. The latest successful copy is preserved if no replacement exists; cleanup resumes after downtime. Backups are inside the existing private data directory, outside public/dist and the Git checkout. No production database, upload or key is committed.

These copies are on the **same VPS**. They help with application/data mistakes, but do not protect against loss of the VPS or someone who can already read its private directory. Off-server storage is not configured and must not be claimed. Confirm the actual country of the database and all copies before publishing the hosting facts.

## Restore procedure

Restore is intentionally not a one-click public/admin HTTP action. Confirm the incident, stop the application, preserve the current private directory, and copy a selected verified bundle into a new empty private directory. The `owner.sqlite` and matching `master.key` must come from the same bundle. Preserve private permissions, configure the application to use that directory, then verify owner/user login, stored project metadata and payment/coin reconciliation before reopening service. Consider transactions and refunds that occurred after the snapshot: restoring old wallet data requires reconciliation. Never overwrite a running database, create a new key against old encrypted data, or restore by deleting financial ledgers.

## Verification

New real HTTP/SQLite tests cover private recovery proof storage, generic invalid-proof responses, single-use and concurrent reset, current-password rotation, owner separation, CSRF/origin/rate limits, session revocation and preservation of projects/coins/consent. Database tests cover owner-only diagnostics and manual copies, private permissions, a genuine restore with matching encrypted settings, failed-copy preservation, bounded retention and symlink rejection. Existing account, billing, security, guest editor, restart and preview checks remain part of validation.

Primary implementation references:

- Node SQLite backup: https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html
- OWASP recovery guidance: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
