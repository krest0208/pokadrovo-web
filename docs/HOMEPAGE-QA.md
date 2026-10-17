# Layered homepage verification

Date: 2026-10-17.

## Scope

The homepage is replaced, not the editor. All seven `AiHomeProps` callbacks/data fields keep the existing contract. `Studio.tsx`, `BrandMark.tsx`, video-export code, project storage, package manifests and the CI workflow are unchanged.

The existing GitHub workflow runs TypeScript checking and the Vite build only. It does not publish to hosting. No deployment or domain action is part of this change.

## Local browser run

41 of 41 assertions passed using headless Chromium 144 and a self-contained HTML preview of the new homepage. The local preview uses the React 16 class-component-compatible harness supplied with the earlier preview; production still uses React 19. This is not a full production-browser end-to-end test.

Verified:

- Homepage rendering, decoding all bundled WebP images and zero external requests.
- Light/dark theme changes.
- Expanded/reassembled layers, continuous depth slider and tracing-paper plane.
- Motion on/off and reduced-motion CSS.
- Three contact-sheet selections; image dialog and Escape dismissal.
- Preset prompts and user text reaching the editor callback without interpreting markup.
- Preview-only brief export explicitly labelled `aiProcessed: false`.
- Local file staging, user image replacement, callback filenames and removal.
- Unsupported attachment types rejected.
- Workflow tab keyboard navigation and FAQ expansion.
- Responsive widths 320, 390, 768, 1024 and 1440 pixels: no horizontal document overflow, primary controls reachable.
- Mobile navigation opening and Escape dismissal.
- No JavaScript page errors.

TypeScript transpilation of the standalone component files reported zero diagnostics. This is separate from full-project type checking.

## Limits and follow-up

- The local harness checks callback handoffs, not complete video processing or final export.
- The harness used an about:blank document, so localStorage-unavailable fallback was tested, not persistence across full application restarts.
- Real-device Android/iOS checks and Firefox/Safari were not run.
- The final React 19 project check is the GitHub Actions run attached to this commit; inspect its actual result rather than treating the local preview run as a substitute.
- AI analysis/generation is not connected and is explicitly described as planned.
