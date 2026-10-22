import './brand.css';

/** Trusted, fixed vector geometry shared by React and the vanilla editor. */
export const BRAND_BODY = `<rect class="pk-brand-tile" x=".75" y=".75" width="62.5" height="62.5" rx="17.25" fill="var(--pk-logo-tile)" stroke="var(--pk-logo-border)" stroke-width="1.5"/>
<g class="pk-brand-back"><path d="M26 12h20a6 6 0 0 1 6 6v20" fill="none" stroke="var(--pk-logo-back)" stroke-width="3.5" stroke-linecap="round"/></g>
<g class="pk-brand-middle"><path d="M19 18h21a6 6 0 0 1 6 6v20" fill="none" stroke="var(--pk-logo-middle)" stroke-width="3.5" stroke-linecap="round"/></g>
<g class="pk-brand-front"><rect x="12" y="24" width="34" height="29" rx="7" fill="var(--pk-logo-front)"/><path d="M18 29h7" stroke="var(--pk-logo-highlight)" stroke-width="2" stroke-linecap="round"/>
<path class="pk-brand-play" d="M25 33.2c0-1 .9-1.5 1.7-1l9.6 5.5c.9.5.9 1.7 0 2.2l-9.6 5.5c-.8.5-1.7 0-1.7-1V33.2Z" fill="var(--pk-logo-play)"/></g>
<path class="pk-brand-glint" d="M3 21V18A15 15 0 0 1 18 3h10" fill="none" stroke="var(--pk-logo-highlight)" stroke-width="1.3" stroke-linecap="round" opacity="0"/>`;

export function brandSvg(size = 36, animated = false) {
  return `<svg class="pk-brand-mark${animated ? ' pk-brand-mark--animated' : ''}" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${BRAND_BODY}</svg>`;
}
