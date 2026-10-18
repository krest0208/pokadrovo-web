// Used only while bundling the self-contained chat preview.
// The live account API and owner role are never imported into that bundle.
export const storageScope=()=> 'chat-preview';
export const syncProject=()=>{};
