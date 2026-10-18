import React from 'react';
import {createRoot} from 'react-dom/client';
import PreviewStudio from './PreviewStudio';
const root=document.getElementById('pokadrovo-chat-preview');
if(root)createRoot(root).render(<PreviewStudio initialScreen={root.dataset.start==='ai'?'admin':'home'} adminView={root.dataset.start==='ai'?'api':'overview'}/>);
