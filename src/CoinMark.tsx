import * as React from 'react';

/** A coin stamped with the frame/play symbol of Pokadrovo. */
export default function CoinMark({size=24}:{size?:number}){
 return <svg className="pk-coin-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" style={{flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="10.5" fill="currentColor" fillOpacity=".04" stroke="currentColor" strokeOpacity=".28"/><circle cx="12" cy="12" r="8" stroke="currentColor" strokeOpacity=".1"/><rect x="7.5" y="7.5" width="9" height="9" rx="2" stroke="currentColor" strokeOpacity=".72" strokeWidth="1.2"/><path d="m10.8 9.5 3.8 2.5-3.8 2.5v-5Z" fill="currentColor" fillOpacity=".72"/></svg>;
}
