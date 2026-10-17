# Homepage: viewport motion, layout and brand refresh

## Scope

Only the layered homepage, its motion controller, spacing and shared BrandMark / SVG icons changed. The editor engine, existing project callback contracts, dependencies and hosting configuration are unchanged. No hosting or deployment was performed.

The new `home-scroll.ts` controller observes eight independent zones: intro, layered hero, brief, process, mission, projects, FAQ and footer. Animation starts at 16% intersection, stops outside the viewport or in a hidden document, and replays on re-entry. Static content stays readable without IntersectionObserver.

Hero demo photographs cycle every 5.2 seconds and process steps every 6.2 seconds while visible. Hover/focus prevents automatic selection changes. Uploaded media is never replaced by a demo frame. Muted inline uploaded video can autoplay in-view subject to browser policy. The preview dialog remains explicitly controlled.

The controller disconnects the observer and clears timers/listeners on unmount. `prefers-reduced-motion` changes are respected at runtime, as is the existing user motion toggle. No animation is a claim of AI editing or video generation.

The top ruler was removed from the JSX. Content uses shared safe gutters and smaller responsive type. The header now has a filled `В монтажную` button using the existing `onContinue` callback. The new minimal logo is a framed playhead, shared through `BrandMark.tsx` and matching public SVG files.

## Local browser checks

88 assertions passed in headless Chromium against a self-contained preview compiled from the exact changed TypeScript files:

- 34 layout assertions: runtime health, no horizontal page scrolling and key text/control bounds at widths 320, 360, 390, 650, 768, 950, 1024, 1190, 1366, 1440 and 1920 pixels; dark-theme switching.
- 32 motion assertions: in-view start, offscreen inactivity, hero cycling, process cycling, focus protection, keyboard navigation, re-entry, manual pause/resume, live reduced-motion updates, simulated document-visibility events and observer cleanup.
- 22 interaction assertions: editable brief, callback handoff, header CTA, manual scene/depth controls, image viewer and focus restoration, image attachment/removal, unsupported file error, FAQ, mobile navigation and static fallback without IntersectionObserver.

No remote page or network asset was loaded by the preview. Browser evaluation used the embedded React runtime supplied by the earlier preview (not the production React 19 bundle). The source was syntax-transpiled locally; the repository's existing GitHub Actions workflow separately performs the actual TypeScript/Vite build.

These checks do not cover the whole montage engine, MP4/audio export, backend authentication, persistence on a real user origin, or every native-video autoplay policy. None of those features is claimed as newly implemented here.
