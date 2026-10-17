# Editor 0.6: scope and checks

## Implemented
- AI prompt panel and launch button; disconnected state by default.
- Optional typed server provider, request export, plan import, strict operation validation,
  dry-run, stale-snapshot rejection, cancellation and a single undoable apply.
- Track context menu for video/image/audio/text and empty lanes; copy/cut/paste, split,
  trims, audio/text import, mute, detach, inspector shortcuts and keyboard navigation.
- Direct canvas move/resize/rotation with pointer capture, aspect lock, independent scales,
  Escape rollback and one history entry per completed gesture.
- Rectangle, rounded rectangle and ellipse masks; source cropping.
- Six system font presets, weight, italic and alignment; local custom-font registry prepared.
- Preview and export share geometry, masks and font styles.

Existing Reels/regular modes, audio mixing, speed, local project data and layered homepage are retained.
New project fields have backwards-compatible defaults. No hosting or Android changes.

## Local verification
- Original editor model suite: 120 assertions passed.
- New geometry / font / AI-contract suite: 35 checks passed, including malformed plans,
  nonexistent targets, unknown operations, crop bounds, stale snapshots, cancellation and atomic history.
- Headless Chromium UI: 46 assertions passed against the exact TypeScript modules transpiled into
  a self-contained bundle using the installed React 19 production runtime. Checks cover prompt
  handoff, image gestures, context tools, text styling, plan confirmation/undo, no uncaught errors
  and widths 320, 390, 768, 1024 and 1440 pixels.
- An actual 1-second WebM was encoded: ffprobe identified VP9 video and Opus audio.
  Canvas pixels confirmed the elliptical mask; the export used the same geometry and serif caption path.
- Editor and shell TypeScript passed strict checking locally. Full Vite build is separately checked in CI.

The local browser cannot navigate file/localhost URLs in this environment, so the UI suite used
set_content on an isolated page. Real-origin IndexedDB persistence was NOT retested. Storage errors
are caught; in-memory imports and editor operations remain usable. Real user device testing, long
exports, custom font files and a live AI provider are NOT claimed as tested.

No provider was silently mocked in the delivered product. The imported plan in QA was a test fixture,
not AI output. The standalone HTML is the actual editor UI; it is not a hosted service.
