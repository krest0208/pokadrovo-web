# Demo image credits

The photo series is demonstration material, not footage edited by an AI and not a claim of endorsement by any depicted person or organization. It is reused from the supplied Pokadrovo layered-home archive, resized and compressed as WebP for this homepage.

- Launch: SpaceX, bundled as `rocket.jpg` in scikit-image sample data. The package identifies it as a public-domain photograph. Original: https://www.flickr.com/photos/spacexphotos/16511594820/
- Astronaut portrait: NASA, bundled as `astronaut.png` in scikit-image sample data. The package identifies it as public domain / no known copyright restrictions. A monochrome treatment is applied. Original: https://flic.kr/p/r9qvLn
- Deep field: NASA, bundled as `hubble_deep_field.jpg` in scikit-image sample data. Original: https://hubblesite.org/contents/media/images/2012/37/3057-Image.html

No font files are included or redistributed in this change. Production continues to use the project's already-configured font packages. The separately supplied standalone preview uses installed system fonts.

The standalone HTML preview, which is not the production application, reuses React 16.0.0 / ReactDOM 16.0.1 UMD runtimes from the supplied preview archive. These runtimes use the MIT license and retain their original license headers. This does not alter the production React 19 dependencies.

## React MIT license

Copyright (c) 2013-present, Facebook, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


## Homepage redesign, October 2026

- `src/home/assets/coastal-story.webp`: six original illustrative travel stills generated with the built-in imagegen tool. Not real customer footage or proof of an AI-generated video. The full original prompt and design notes are in `docs/HOMEPAGE-REDESIGN.md`. Stored as WebP for delivery; the generated composition is unchanged.
- Brand silhouettes in `src/PlatformIcon.tsx` are canonical SVG paths from Simple Icons, CC0-1.0: https://github.com/simple-icons/simple-icons/tree/develop/icons (`instagram.svg`, `tiktok.svg`, `youtube.svg`, `vk.svg`, `telegram.svg`). These identify output platforms, not Pokadrovo social accounts or partners.


## Three-story homepage illustrations

- `src/home/assets/coffee-story.webp`: six original illustrative stills of a coffee ritual, generated with the built-in imagegen tool for this site.
- `src/home/assets/city-story.webp`: six original illustrative stills of a blue-hour city vlog, generated with the built-in imagegen tool for this site.
- Both are synthetic demonstration series without third-party logos, customer footage or implied endorsement. UI text, captions and timeline diagrams are rendered in code. Production uses the 1536×1024 WebP atlases; `src/preview/media/` contains lighter derivatives for the self-contained chat preview. No external image service or paid subscription is required to view these assets.
