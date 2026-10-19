# Pokadrovo Edit Plan v1

The web editor accepts an optional `AiProvider`. Owners now receive the `OmniAiProvider`
adapter, which is unavailable until its server settings are configured and explicitly enabled.
No key, paid request or media upload is configured by default. See [AI-OMNI-PILOT.md](AI-OMNI-PILOT.md).

## Connection

```ts
import { OmniAiProvider } from './editor/omni';

// Studio.tsx does this only for a server-authenticated owner:
new Editor(host, {
  ...existingOptions,
  aiProvider: new OmniAiProvider()
});
```

Keep model API keys on the server, never in `VITE_*`, browser storage or repository files.
The same-origin endpoint authenticates the owner, validates CSRF and quotas, limits body size,
and returns JSON, never executable code. The `AiRequest` document contains no video/audio
bytes, Blob URLs, credentials or thumbnails: only a prompt and versioned project snapshot.
The Omni HTTP envelope is `{request, media?, mediaConsent?, context?}`. `media` is a separately
selected MP4 or WAV sent only after explicit consent in the media section. Normal text requests
do not upload files. This first pilot accepts one complete source file up to 60 seconds / 12 MiB.

The metadata-only contract alone does not provide semantic video analysis. The Omni media path
sends the source video with its audio to Qwen and receives source-time scene/audio annotations.
Long-file analysis still requires segmentation, retained context and a job queue.
Treat filenames, captions and prompts as untrusted data when constructing model instructions.

## Request

`createAiRequest()` includes `version`, `requestId`, `projectId`, `revision`, `prompt`,
`project`, `cursor`, `selection`, `capabilities` and `fontIds`. The panel can download
this object for integration testing. `revision` is a change marker, NOT an authentication token.
Application compares the entire normalized snapshot as well as the marker.

## Response

Return only this envelope, echoing all three identifiers from the actual request:

```json
{
  "version": 1,
  "requestId": "COPY_FROM_REQUEST",
  "projectId": "COPY_FROM_REQUEST",
  "revision": "COPY_FROM_REQUEST",
  "summary": "Increase the selected video speed and add a title.",
  "operations": [
    {"type": "speed", "track": "video", "id": "EXISTING_CLIP_ID", "value": 1.5},
    {"type": "caption", "text": "My story", "from": 0, "to": 2, "fontId": "serif"}
  ]
}
```

Supported operations (exact fields; additional fields are rejected):

- `remove {track,id}`; `split {track,id,offset}`. Offset is project-time seconds relative to the clip.
- `trim {track,id,start,end}`. Limits refer to SOURCE seconds, not speed-adjusted duration.
- `speed {track,id,value}`; `volume {track,id,value,muted}`.
- `transform {id,patch}`. Allowlisted geometry, crop, shape and image adjustments only.
- `caption {text,from,to,fontId}`.
- `ratio {value}`; `audioAt {id,at}`; `cutRange {from,to}`.

`track` is video/audio/text where supported. Speed/volume/trim accept only video/audio.
Images cannot receive speed/audio edits. Ranges, IDs, shape values and fonts are validated.
Up to 100 operations and a 512 KB response are accepted. There are no URL, code, shell,
file-delete or arbitrary-property operations.

## Application and cancellation

1. Capture the current request snapshot.
2. Ask the configured provider or import a JSON plan explicitly.
3. Validate, then simulate ALL operations on a clone. Invalid batches never partly mutate the project.
4. Display the summary and action list for user confirmation.
5. Apply only if the project snapshot still matches. An asynchronous race also checks object identity.
6. Commit one history entry; Ctrl/Cmd+Z undoes the whole plan.

Provider calls support cancellation, a 60-second HTTP timeout and late-response suppression.
No automatic retry or background media upload occurs. Reject/close does not apply edits.

## Fonts

Six system-font presets are available. Platform fallback means they can look slightly different
on different devices. To add licensed custom fonts later:

```ts
import { registerEditorFont } from './editor/fonts';
registerEditorFont({
  id: 'brand-display',
  label: 'Our display font',
  family: 'PokadrovoDisplay',
  url: '/fonts/pokadrovo-display.woff2'
});
```

Place the licensed file in `public/fonts`, register it before creating the editor.
Only same-origin font paths and restricted family names are accepted. Preview and export await
font loading and use the same caption style. No font binaries are included in this update.
