/** Classify a bounded upstream error. Never return or persist raw messages, keys or request data. */
export async function providerFailure(response){
 let detail='';
 if(response.body){const reader=response.body.getReader();let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)break;chunks.push(value);}
   if(size<=16384){const value=JSON.parse(Buffer.concat(chunks).toString('utf8')),error=value?.error;detail=[error?.code,error?.type,error?.param,error?.message,error?.metadata?.raw].filter(x=>typeof x==='string'||typeof x==='number').join(' ');}
  }catch{}finally{await reader.cancel().catch(()=>{});}
 }
 const status=response.status;
 if(status===402)return {status:503,code:'balance',message:'На балансе сервиса обработки недостаточно средств. Обратитесь к администратору.'};
 if([401,403].includes(status))return {status:502,code:'access',message:'Провайдер отклонил ключ или доступ к модели. Обратитесь в поддержку сайта.'};
 if(status===429)return {status:429,code:'rate_limit',message:'Лимит провайдера исчерпан. Повторите позже.'};
 if(status===404)return {status:502,code:'model',message:'Выбранная модель сейчас недоступна. Обратитесь к администратору.'};
 if([400,422].includes(status)&&/schema|response_format|structured|anyof|oneof|additionalproperties/i.test(detail))return {status:502,code:'schema',message:'Провайдер не принял формат плана. Обратитесь в поддержку сайта: код AI_SCHEMA. Монтаж не изменён.'};
 if([400,415,422].includes(status)&&/audio|wav|image|media|modality|codec|base64/i.test(detail))return {status:502,code:'media',message:'Провайдер не принял подготовленный медиафайл. Попробуйте отдельный MP4 или WAV до 60 секунд. Код AI_MEDIA. Монтаж не изменён.'};
 return {status:502,code:status>=500?'unavailable':'request',message:status>=500?'Сервис ИИ временно недоступен. Повторите позже. Монтаж не изменён.':`Провайдер отклонил запрос (HTTP ${status}). Обратитесь в поддержку сайта. Монтаж не изменён.`};
}
