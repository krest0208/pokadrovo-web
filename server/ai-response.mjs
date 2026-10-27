import {deny} from './http.mjs';
import {AI_OPERATIONS,TRANSFORM_FIELDS,CAPTION_STYLE_FIELDS} from './ai-contract.mjs';

const string={type:'string'},boolean={type:'boolean'},number={type:'number'};
const enumeration=values=>({type:'string',enum:values});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const nullable=schema=>({...schema,type:[schema.type,'null'],...(schema.enum?{enum:[...schema.enum,null]}:{})});
const transformPatch=object(Object.fromEntries(TRANSFORM_FIELDS.map(key=>[key,nullable(key==='flip'?boolean:key==='shape'?enumeration(['rect','round','ellipse']):key==='fit'?enumeration(['contain','cover']):number)])));
const captionPatch=object(Object.fromEntries(CAPTION_STYLE_FIELDS.map(key=>[key,nullable(['background','italic'].includes(key)?boolean:key==='align'?enumeration(['left','center','right']):key==='color'?string:number)])));

/** Strict response shape is built from the same operation whitelist as the server. */
export function editingResponseFormat(request,hasMedia){
 const operations=request.capabilities.map(type=>{
  const properties={type:enumeration([type])};
  for(const field of AI_OPERATIONS[type]){
   properties[field]=field==='track'?enumeration(['trim','speed','volume','fades'].includes(type)?['video','audio']:['video','audio','text']):
    field==='id'||field==='text'?string:field==='fontId'?enumeration(request.fontIds):
    field==='ids'?{type:'array',items:string}:field==='muted'?boolean:
    field==='patch'?(type==='transform'?transformPatch:captionPatch):field==='style'?captionPatch:
    field==='value'&&type==='ratio'?enumeration(['16:9','9:16']):field==='layer'?{type:'integer'}:number;
  }
  return object(properties);
 });
 const analysis=object({summary:string,speech:string,audio:string,events:{type:'array',maxItems:12,items:object({from:number,to:number,visual:string,audio:string,speech:string})},limitations:{type:'array',maxItems:12,items:string}});
 return {type:'json_schema',json_schema:{name:'pokadrovo_edit',strict:true,schema:object({analysis:hasMedia?analysis:{type:'null'},summary:string,operations:{type:'array',maxItems:100,items:operations.length?{anyOf:operations}:object({type:enumeration(['none'])}),...(operations.length?{}:{maxItems:0})}})}};
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
 return value;
}
