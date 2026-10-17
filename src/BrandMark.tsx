import type { SVGProps } from "react";

/** A frame and a playhead: the AI's working canvas, not a separate magic button. */
export default function BrandMark({ size = 36, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg {...props} width={size} height={size} viewBox="0 0 64 64" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <rect width="64" height="64" rx="17" fill="#2563EB" />
    <path d="M25 16H16V25M39 48H48V39" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M27 23L43 32L27 41V23Z" fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" />
  </svg>;
}
