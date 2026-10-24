# Documents, consent and payment readiness

Implemented 24 October 2026. This is a technical publication workflow and a set of document drafts tailored to the actual editor. It is not proof of legal compliance, operator registration, a verified tax status, a signed payment-provider contract or YooKassa approval. Never enter invented merchant details, prices or claims about database location.

## Public documents

- `/legal`: document index.
- `/legal/terms`: user agreement, 18+ account eligibility, media rights, AI limitations, lawful liability limitations and preserved mandatory consumer rights.
- `/legal/privacy`: purposes, data, recipients, storage, retention, rights and contact procedure.
- `/legal/consent`: a separate personal-data consent; it does not cover advertising, optional analytics or media transfer to an AI provider.
- `/legal/payments`: conditional offer for actual available orders, coin accounting, provision of digital services, one-time payments, technical failures, withdrawal and refunds. No blanket “no refunds” clause and no automatic deduction of gateway commissions.
- `/legal/cookies`: essential browser storage and separate opt-in event metrics.
- `/legal/content`: source-material rights and rights-holder complaints.
- `/legal/contacts`: actual operator and seller details.

Documents are server-rendered, independently accessible without authentication or JavaScript, have responsive and print styles, support system light/dark preference, and do not load external fonts. Links are present on the homepage, pricing page, registration form and profile. The registration form opens each document in a new tab and has three separate, initially unchecked choices: agreement, personal-data consent, adult eligibility. No exact birth date or passport is collected.

## Before publication

The owner fills **Documents and details** in the authenticated admin panel. The panel requires current-password reauthentication and normal same-origin/CSRF validation. All saved form fields are explicitly allowlisted; password and unrelated properties are never stored in the public configuration.

Fill and verify:

1. Operator's actual full name/legal name, status, address for notices, working phone and support email. Publish only details intended for public access. A normal individual can identify the operator of a free service; this does not qualify them to sell through YooKassa.
2. Actual hosting provider, country of the primary database and every backup, plus the backup deletion schedule. The VPS IP and provider brand alone do not establish Russian localization compliance.
3. Processor legal names, purpose, countries, terms and retention for every enabled hosting/AI/payment service. Review the actual provider account's data settings, agreements and contractual processing restrictions.
4. Actual grounds and records for the processing notice and any separate cross-border notice. A checkbox cannot replace filing a required notification. Apply current Russian law and other laws applicable to the service/audience. If uncertain, keep the affected processing unavailable and obtain an appropriate review.
5. Data retention and an operational process for access, erasure, consent withdrawal, backups, security incidents and complaints. Reconcile the document's purpose-based retention with actual operations; there is no implemented automatic erasure of accounts/AI histories in this change.
6. Read and approve every document; only then check publication. This explicitly publishes the supplied operator information. Material edits generate a new version.

Until publication prerequisites are complete, pages are visibly labelled drafts/noindex; new registration, non-owner AI requests and opt-in event metrics are paused. Existing login, existing records and balances, aggregate page counts, guest editing and owner testing are preserved. Real sales require additional seller and billing readiness. Existing accounts are not silently recorded as having accepted the new documents.

## Evidence and revisions

`meta.legal_config` stores current public details. `legal_revisions` stores immutable public configuration and the complete HTML of each document only when a version is published; later template edits cannot rewrite an accepted snapshot. Document version combines the content edition and a fingerprint of all public configuration. Published snapshots remain accessible at `/legal/<document>?version=<version>`; draft snapshots are not archived as valid accepted documents.

Registration requires the exact current version and all three affirmative flags on the server, rechecked after password hashing. User creation and the `account_legal_acceptances` row are atomic. Receipt fields are account ID, version, server timestamp and separate terms/consent/adult flags. A stale, absent or unconfirmed version cannot register. No raw IP, password or media is added to this evidence table.

Existing live billing additionally requires actual published seller details (NPD/IP/company), the canonical `/legal/payments` URL and its current published version. Changing the documents closes creation of new paid orders until billing is updated. Already issued invoices and signed payment callbacks retain their original processing and terms evidence; do not remove invoices or financial ledgers. The purchase checkbox resets when the catalog reloads and links to the exact terms snapshot.

## Requests about personal data

Registered users can submit access, erasure or consent-withdrawal requests from their profile. Requests are authenticated, CSRF protected, rate limited and isolated by account. IDs, type and date are stored in `privacy_requests`; the owner sees up to 100 most recent requests and the user's existing account email under **Documents and details**. Nothing is emailed or shared externally automatically.

This registers a request; it does not silently delete the account, execute a refund or pretend the request was completed. The operator must verify the request as appropriate, act within the applicable statutory period, communicate the response and retain only records supported by a legal basis. Check this queue regularly. Do not request passwords, full card numbers or CVV. Financial records and valid obligations must not be destroyed by an indiscriminate user-table deletion. Establish an actual retention/deletion procedure before declaring the service ready for public use.

## YooKassa remains a separate integration

This change does **not** connect YooKassa, create an account, accept a contract, enable charges, choose prices or claim moderation success. The existing Robokassa implementation remains disabled until its independent prerequisites are met; provider migration must be an explicit subsequent implementation.

Before a YooKassa submission: establish an eligible seller status, finish onboarding and contract with actual documents, set genuine RUB prices and available services, present actual receipt/tax arrangements, implement and test YooKassa payment verification/idempotency/refunds, then request moderation. Avoid selling unavailable comparison tiers. Payment/readiness checkboxes are operational checks, not certifications.

Primary references checked 24 October 2026:

- YooKassa site preparation: https://yookassa.ru/docs/support/payments/onboarding/arrangement
- YooKassa onboarding and test stores: https://yookassa.ru/docs/support/payments/onboarding/overview
- YooKassa refunds: https://yookassa.ru/docs/support/merchant/payments/refunds
- Roskomnadzor personal-data portal: https://pd.rkn.gov.ru/
- Personal-data law, published by Ministry of Labour: https://mintrud.gov.ru/docs/laws/130

Verification: isolated HTTP/SQLite tests cover default draft gates, owner authentication/CSRF/reauthentication, incomplete publication, exact consent version and separate choices, atomic receipts, archive immutability, escaped operator text, request isolation and preservation of login/data on unpublishing. Existing accounts, billing, AI, security and delivery tests use explicitly synthetic fixtures in temporary databases only.
