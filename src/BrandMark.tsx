import type { SVGProps } from "react";

/** An open film frame around a playhead: an idea becoming editable footage. */
export default function BrandMark({ size = 36, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg {...props} width={size} height={size} viewBox="0 0 64 64" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill="#245CE0" />
      <path d="M23 18H19A3 3 0 0 0 16 21V43A3 3 0 0 0 19 46H23M41 18H45A3 3 0 0 1 48 21V43A3 3 0 0 1 45 46H41"
        stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M27 23L42 32L27 41V23Z" fill="white" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
