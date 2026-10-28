import {deny} from './http.mjs';
import {editingResponseFormat,editingOutputGuide} from './ai-response.mjs';

export const POLZA_ENDPOINT='https://polza.ai/api/v1';
export const POLZA_MODEL='google/gemini-2.5-flash';
export const PREPARED_MEDIA='application/x-pokadrovo-av';
export function validatePolzaEndpoint(value){
 let url;try{url=new URL(value);}catch{deny(400,'Укажите Base URL Polza.ai.');}
 if(url.protocol!=='https:'||url.hostname!=='polza.ai'||url.port||url.username||url.password||url.search||url.hash||!/^\/api\/v1\/?$/.test(url.pathname))deny(400,'Разрешён только https://polza.ai/api/v1.');
 return POLZA_ENDPOINT;
}
export function preparePolza(config,system,input,media,secret){
 const content=[{type:'text',text:JSON.stringify(input)}];
 if(media?.mime===PREPARED_MEDIA){
  content.push({type:'text',text:'Далее идут отдельные кадры, снятые с указанным шагом, и полная аудиодорожка. Между кадрами изображение неизвестно. Не выдумывай события между выборками; укажи это ограничение. Таймкоды относятся к исходному файлу.'});
  for(const frame of media.frames){content.push({type:'text',text:`Кадр: ${frame.at.toFixed(3)} с.`},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+frame.data}});}
 }
 if(media?.audioPresent===false)content.push({type:'text',text:'В MP4 нет звуковой дорожки. Переданы только кадры. Не придумывай речь, музыку и звуки; укажи отсутствие звука в limitations.'});
 else if(media)content.push({type:'input_audio',input_audio:{data:media.data,format:'wav'}});
 return {url:POLZA_ENDPOINT+'/chat/completions',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json',Accept:'application/json'},payload:{model:POLZA_MODEL,messages:[{role:'system',content:system+'\nСохраняй формат проекта 9:16 или 16:9 и итоговую длительность не более 60 секунд.\n'+editingOutputGuide(input.request)},{role:'user',content}],response_format:editingResponseFormat(),reasoning:{effort:'none'},provider:{allow_fallbacks:false},stream:false,max_tokens:4096}};
}
