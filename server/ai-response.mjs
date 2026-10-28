import {deny} from './http.mjs';
import {AI_OPERATIONS,TRANSFORM_FIELDS,CAPTION_STYLE_FIELDS} from './ai-contract.mjs';

/** The active Polza route rejects strict response schemas with HTTP 400.
 * JSON mode constrains syntax; the server and editor enforce the operation contract. */
export function editingResponseFormat(){return {type:'json_object'};}

export function editingOutputGuide(request){
 const examples=[],clip=request.project.clips.find(c=>c.kind==='video'),audio=clip||request.project.audio[0],font=request.fontIds.includes('system')?'system':request.fontIds[0];
 if(audio&&request.capabilities.includes('speed'))examples.push({type:'speed',track:clip?'video':'audio',id:audio.id,value:1.25});
 if(audio&&request.capabilities.includes('volume'))examples.push({type:'volume',track:clip?'video':'audio',id:audio.id,value:.4,muted:audio.muted===true});
 if(clip&&request.capabilities.includes('transform'))examples.push({type:'transform',id:clip.id,patch:{visualIn:.2}});
 if(font&&request.capabilities.includes('caption'))examples.push({type:'caption',text:'Заголовок',from:0,to:2,fontId:font});
 return 'Формат operations: обычные JSON-объекты с type и аргументами из allowedOperations, БЕЗ action, parameters, arguments и вызовов инструментов. Все обязательные поля должны присутствовать. У volume обязательно muted: сохрани текущее значение, если пользователь не просил включать или выключать звук. У caption/captionStyled обязательно fontId из fontIds. Примеры СИНТАКСИСА (это не задание; выполняй только запрошенные изменения): '+JSON.stringify(examples)+'. Не более 30 действий за этап. Если файл передан, analysis ОБЯЗАТЕЛЬНО содержит summary (непустое описание), speech (строка услышанных слов), audio (строка описания звука), events (массив), limitations (массив строк). В каждом событии обязательны from, to, visual, audio, speech. Неизвестный текст/звук обозначай пустой строкой, неизвестные события не создавай. Если файл не передан, analysis=null; используй previousAnalysis, только если он есть.';
}

const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
/** Omitted non-editing details stay unknown; an omitted edit flag preserves existing state.
 * Never invent IDs, timing, numeric edits or commands and never discard unknown fields. */
export function modelDefaults(value,request){
 if(plain(value.analysis)){
  const a=value.analysis={...value.analysis};
  for(const key of ['speech','audio'])if(a[key]==null)a[key]='';
  for(const key of ['events','limitations'])if(a[key]==null)a[key]=[];
  if(Array.isArray(a.events))a.events=a.events.map(event=>{
   if(!plain(event))return event;const result={...event};
   for(const key of ['visual','audio','speech'])if(result[key]==null)result[key]='';return result;
  });
 }
 if(Array.isArray(value.operations))value.operations=value.operations.map(operation=>{
  if(!plain(operation)||!Object.hasOwn(AI_OPERATIONS,operation.type))return operation;
  const op={...operation},fields=AI_OPERATIONS[op.type],matches=['video','audio','text'].flatMap(track=>(request.project[track==='video'?'clips':track==='audio'?'audio':'texts']||[]).filter(item=>item.id===op.id).map(item=>({track,item})));
  if(fields.includes('track')&&!Object.hasOwn(op,'track')&&matches.length===1)op.track=matches[0].track;
  if(op.type==='volume'&&!Object.hasOwn(op,'muted')&&matches.length===1&&matches[0].track===op.track&&op.track!=='text')op.muted=matches[0].item.muted===true;
  if(['caption','captionStyled'].includes(op.type)&&!Object.hasOwn(op,'fontId')&&request.fontIds.length)op.fontId=request.fontIds.includes('system')?'system':request.fontIds[0];
  return op;
 });
 return value;
}

/** Accept an intact JSON document or one whole Markdown fence; never complete broken edits. */
export function parseModelMessage(choice,structured=false){
 if(choice?.finish_reason==='length')deny(502,'Ответ ИИ достиг лимита длины. Разделите задание на несколько этапов. Монтаж не изменён, автоматического повтора не было.');
 if(choice?.finish_reason!=='stop'||typeof choice?.message?.content!=='string')deny(502,'Модель не завершила ответ. Монтаж не изменён. Автоматического повтора не было.');
 let text=choice.message.content.trim();
 const fence=text.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);if(fence)text=fence[1].trim();
 let value;try{value=JSON.parse(text);}catch{deny(502,'ИИ вернул повреждённый ответ. Монтаж не изменён. Попробуйте более короткое задание; автоматического повтора не было.');}
 if(!value||typeof value!=='object'||Array.isArray(value))deny(502,'ИИ вернул неверный формат плана. Монтаж не изменён.');
 if(structured&&Array.isArray(value.operations))for(const op of value.operations){
  if(!op||typeof op!=='object')continue;
  const key=op.type==='transform'||op.type==='captionStyle'?'patch':op.type==='captionStyled'?'style':null;
  const fields=op.type==='transform'?TRANSFORM_FIELDS:CAPTION_STYLE_FIELDS;
  if(key&&op[key]&&typeof op[key]==='object'&&!Array.isArray(op[key]))for(const field of fields)if(op[key][field]===null)delete op[key][field];
 }
 if(structured&&Array.isArray(value.operations))value.operations=value.operations.map(op=>{
  if(!op||typeof op!=='object'||!Object.hasOwn(op,'action'))return op; // Older in-flight responses still use the editor shape.
  if(Object.keys(op).some(k=>!['action','parameters'].includes(k))||!Object.hasOwn(AI_OPERATIONS,op.action)||typeof op.parameters!=='string'||op.parameters.length>16000)deny(502,'ИИ вернул неверные аргументы команды. Монтаж не изменён.');
  let args;try{args=JSON.parse(op.parameters);}catch{deny(502,'ИИ вернул повреждённые аргументы команды. Монтаж не изменён.');}
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!AI_OPERATIONS[op.action].includes(k)))deny(502,'ИИ вернул недоступные аргументы команды. Монтаж не изменён.');
  return {type:op.action,...args};
 });
 return value;
}
