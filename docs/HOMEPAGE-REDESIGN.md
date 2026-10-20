# Pokadrovo homepage redesign

The homepage explains an editing workflow using original travel stills and clear interface illustrations. There are no video elements or video downloads on the homepage. Uploaded files still open in the real editor through its existing callbacks.

Pokadrovo uses its own source-to-sequence composition, original imagery, blue/graphite palette and warm coin accent. The fan opens once; scene buttons switch examples. Reduced-motion preferences disable movement.

The six process panels cover importing footage, writing a brief, consent-based video/audio analysis, reviewing an edit plan, manual adjustments and export. The panels explain the workflow without presenting customer results or claiming that a provider has completed real AI work. The page does not promise a working provider connection before setup is complete.

The footer includes every homepage destination, the format selector, recent projects, account access and an owner-only admin link. The platform marks are the actual brand silhouettes from Simple Icons; they are format selectors, not links to invented Pokadrovo social accounts.

## Coins and preliminary packages

`shared/coin-pricing.json` is the common public pricing source. The proposed packages contain 100, 500 and 1500 coins. These packages cannot be purchased yet. RUB conversion, Yandex price and payments remain unset/disabled. This release does not implement paid top-ups or a purchased-coin wallet.

The existing free trial is represented by 3 gift coins, at 1 coin per successful Qwen Reels request, for one project and 7 days from first use. It remains closed until the owner enables and configures the trial. Existing trial usage and expiry are preserved. Server validation owns the cost; browser-supplied prices or balances cannot alter it. An atomic reservation prevents overspending. Failed calls release their coin, duplicate IDs cannot charge again, and startup releases interrupted reservations once. Owners retain their free internal test exemption. Yandex remains unavailable to customers until its tariff is configured. Money is never charged by this release.

## Original image

Built-in imagegen generated `src/home/assets/coastal-story.webp`. The composition was stored as WebP for delivery without semantic edits. The six views are cropped with nested SVG viewports to preserve photographic proportions.

Prompt:

> Use case: photorealistic-natural. Asset type: cohesive still-image contact sheet for Pokadrovo browser video editor homepage, used as sample footage in process illustrations. Create ONE landscape 1536x1024 photographic contact sheet, exactly 3 columns by 2 rows of six equal rectangular photographs, edge-to-edge with NO gutters, no borders, no words. A coherent weekend road trip on a quiet rocky sea coast, natural cinematic documentary photography, tactile 35mm film detail, blue ocean and warm pale stone, amber sun. All six photographs share same realistic muted blue and cream color grade, not neon. Top left: closeup hands holding a compact silver camera near a car window with soft coastal hills beyond. Top middle: wide dramatic aerial coastline, deep blue sea and winding coast road. Top right: candid back view of one young adult traveler in pale shirt standing at sea overlook, no visible face. Bottom left: closeup of a simple ceramic cup and paper map on a sunlit cafe table with sea beyond, no legible writing. Bottom middle: waves breaking over pale coastal rocks, sun sparkles. Bottom right: spacious warm golden-hour coastline with a small figure on the cliff path. NO text, no UI, no logos, no watermark. This is illustrative sample footage, not actual screenshots or proof of generated video. High quality, calm editorial travel aesthetic.

## Verification and delivery

- TypeScript and Vite production build.
- HTTP/SQLite AI tests: server-owned cost, replay, refunds, restart recovery, owner exemption and locked paid mode.
- Existing account, owner, storage, editor and delivery regressions.
- Standalone package and Docker build context include the shared public coin configuration.
- Self-contained offline preview remains below its 1 MB limit.
- Updater stays restricted to VPS 138.16.185.3 and https://pokadrovo.ru; existing private account/provider data is retained with a backup before installation.

Browser viewing of a local preview is unavailable under this session's browser URL policy. Live responsive visual verification is still required after installation. A successful build or GitHub commit does not by itself establish that the VPS was updated.
