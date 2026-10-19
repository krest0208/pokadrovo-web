import type { SVGProps } from "react";
import { BRAND_BODY } from './brand';

/** Three frames become one story. Motion is opt-in and respects system preferences. */
export default function BrandMark({ size = 36, animated = false, className = '', ...props }: SVGProps<SVGSVGElement> & { size?: number; animated?: boolean }) {
  return (
    <svg {...props} className={`pk-brand-mark${animated ? ' pk-brand-mark--animated' : ''} ${className}`.trim()}
      width={size} height={size} viewBox="0 0 64 64" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"
      dangerouslySetInnerHTML={{ __html: BRAND_BODY }} />
  );
}
