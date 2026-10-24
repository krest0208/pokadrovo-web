import * as React from 'react';

/** A coin stamped with the frame/play symbol of Pokadrovo. */
export default function CoinMark({size=24}:{size?:number}){
 return <svg className="pk-coin-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" style={{flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="10.5" fill="#F6C76F" stroke="#A56820"/><circle cx="12" cy="12" r="8" fill="#FFE8AF" stroke="#DDA64C"/><path d="M6.8 6.5A8 8 0 0 1 12 4" stroke="#FFF5D9" strokeWidth="1.5" strokeLinecap="round"/><rect x="7.5" y="7.5" width="9" height="9" rx="2" stroke="#805019" strokeWidth="1.4"/><path d="m10.8 9.5 3.8 2.5-3.8 2.5v-5Z" fill="#805019"/></svg>;
}
