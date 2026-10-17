# Editor 0.5: scope and verification

Date: 2026-10-17. Base: main at 268b88b834cf0d2f8b74f7bbd4b7814126342848.

## Architecture and scope

The existing AiHome, BrandMark, viewport animations and asset credits are retained. Studio now mounts a modular TypeScript editor. React owns the shell; the editor owns the DOM inside its separately keyed host. Home/editor round trips dispose media, listeners and the old host without deleting newly mounted homepage content.

- `src/editor/model.ts`: schema 4, migration, source/output time mapping, range cuts, text, undo/redo.
- `src/editor/assets.ts`: metadata, local blobs, existing IndexedDB and localStorage keys.
- `src/editor/engine.ts`: shared canvas composition and Web Audio mixer for preview/export.
- `src/editor/editor.ts`, `editor.css`, `copy.ts`: minimal responsive editor and accessible controls.
- `HomeFormats.tsx`: portal into the existing homepage, destination presets only.

No dependency installation scripts, hosting calls, social publication, AI requests or Android edits are added. Media stays local. JSON files contain project instructions, not media bytes.

## Reproducible core checks

`node tools/test-editor.cjs` uses the project's installed TypeScript, strictly compiles all editor modules to a temporary CommonJS directory, runs `tests/editor-model.test.cjs` and removes only that temporary directory. No packages are fetched by this command.

120 model tests passed locally: speed mapping, split at non-unit speed, bounds, nonfinite inputs, ID validation, volume fades, output dimensions, legacy project migration, SRT parsing, ripple cuts across video/audio/text, undo/redo and 100 deterministic cut-duration invariants.

The actual React 19 application is separately checked by the existing TypeScript/Vite CI build. The model test step has been added to the same check-only workflow.

## Local browser checks

40 assertions passed in headless Chromium using a self-contained HTML preview made from these exact new TypeScript sources and the previous homepage preview bundle. This preview uses the already supplied React 16 runtime; it is NOT claimed to be an end-to-end browser test of the production React 19 build.

Checks cover six platform choices, a Reels project, decoding imported video, rendered source pixels, crop mode, 2x speed, source-time splitting, undo, detached audio and source mute, fades, audio duplication, music import/trim/offset, timed text, escaping caption HTML, foreground panel dialogs, Escape restoration, switching modes without losing tracks, playback/pause and a running audio context, a real exported file, ripple cutting all tracks, dark theme, home/editor round trips and no browser runtime exceptions.

Layout was checked for horizontal overflow at 320, 360, 390, 650, 760, 768, 950, 1024, 1366, 1440 and 1920 CSS pixels. Mobile uses panel tabs and a persistent timeline rather than overlapping desktop columns.

## Audio/export proof

A generated four-second H.264/AAC fixture with a 440 Hz audio tone was imported, changed to 2x, and its audio detached. An independent 880 Hz WAV fixture was mixed on a second track, with trim and start offset. The real export button produced a nonempty WebM containing VP9 video at 720x1280 and Opus 48 kHz audio. Decoding the audio showed nonzero RMS and both 440 Hz and 880 Hz spectral components. This verifies mixed output sound, not merely an empty audio track.

These are synthetic test fixtures using an existing credited homepage frame, not advertised AI-generated movies. MP4 was not exported in this test; it is offered only after native capability detection. Codecs still vary by browser.

## Known limitations and follow-up verification

- Only one sequential video track; independent audio clips and timed text. No picture-in-picture video layers, keyframes or complex transitions yet.
- Real-time browser recording is not deterministic offline frame rendering. Keep the tab visible. Long files, high memory use, background interruptions and real-device performance require further testing.
- Native autoplay, decoder and MP4 encoder behaviour on Safari, Firefox and physical phones is not fully verified.
- Browser policy in this test environment blocks file/HTTP navigation, so the preview was loaded with `set_content`. Persistence on a real user origin, quota behaviour and reload recovery were not end-to-end verified. The implementation retains old storage keys and surfaces storage errors.
- Detaching sound makes it independent; later video speed/order edits do not automatically relink that sound clip.
- A generic caption/safe-area guide does not guarantee compliance with every social platform's current upload rules.
- No real AI editing, automatic captions, noise removal, account system or payment processing is claimed.
