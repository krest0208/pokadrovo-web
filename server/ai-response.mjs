import {deny} from './http.mjs';
import {AI_OPERATIONS,TRANSFORM_FIELDS,CAPTION_STYLE_FIELDS} from './ai-contract.mjs';

/** The active Polza route rejects strict response schemas with HTTP 400.
 * JSON mode constrains syntax; the server and editor enforce the operation contract. */
export function editingResponseFormat(){return {type:'json_object'};}

export const EDITING_WIRE_GUIDE='Формат передачи operations: каждый элемент строго {"action":"имя команды","parameters":"JSON-строка с её аргументами без поля type"}. Например {"action":"speed","parameters":"{\\"track\\":\\"video\\",\\"id\\":\\"v1\\",\\"value\\":1.5}"}. Используй настоящие ID проекта. Не заполняй лишние аргументы и не добавляй null. allowedOperations описывает аргументы ПОСЛЕ декодирования parameters. Не более 30 действий за этап. analysis всегда объект со всеми полями; если файл не передан, верни пустые строки, events:[] и limitations:[], не выдумывай анализ.';

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
