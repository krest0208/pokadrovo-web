/** Model instructions and response validation share this whitelist. */
export const AI_OPERATIONS=Object.freeze({
 remove:['track','id'],split:['track','id','offset'],trim:['track','id','start','end'],
 speed:['track','id','value'],volume:['track','id','value','muted'],transform:['id','patch'],
 caption:['text','from','to','fontId'],ratio:['value'],audioAt:['id','at'],cutRange:['from','to'],
 reorder:['ids'],duplicate:['track','id'],layer:['id','layer','at'],fades:['track','id','fadeIn','fadeOut'],
 captionStyle:['id','patch'],captionStyled:['text','from','to','fontId','style'],captionEdit:['id','text','from','to'],master:['value']
});
export const TRANSFORM_FIELDS=['zoom','x','y','rotation','flip','brightness','contrast','saturation','opacity','visualIn','visualOut','scaleX','scaleY','shape','corner','cropLeft','cropRight','cropTop','cropBottom','fit'];
export const CAPTION_STYLE_FIELDS=['x','y','size','color','background','weight','italic','align'];
const guidance={
 remove:'Удалить существующий клип; track=video|audio|text.',
 split:'Разделить существующий клип: offset в секундах от его начала на таймлайне. Новую часть не адресовать в этом же плане.',
 trim:'Обрезать video|audio: start/end в секундах ИСХОДНИКА, 0 <= start < end <= duration.',
 speed:'Скорость существующего video|audio от 0.25 до 4. У фотографий скорость не менять.',
 volume:'Громкость существующего video|audio от 0 до 2, muted обязательно boolean.',
 transform:'Изображение существующего video|image: patch содержит только изменяемые свойства. x/y -100..100; zoom 0.25..4; scaleX/Y 0.05..8; rotation -180..180; brightness/contrast/saturation 0..2; opacity 0..1; visualIn/Out 0..5 секунд; cropLeft/Right/Top/Bottom 0..0.9, сумма противоположных сторон <=0.9; corner 0..0.5; shape=rect|round|ellipse; fit=contain|cover; flip=boolean.',
 caption:'Создать подпись: text, from/to в секундах проекта, fontId из fontIds. Новую подпись не адресовать другими действиями в этом плане.',
 captionStyled:'Создать оформленную подпись: text/from/to/fontId, плюс style с нужными полями: x/y 0..1, size 0.015..0.2 от высоты кадра, color=#RRGGBB, background/italic boolean, weight 100..900, align=left|center|right.',
 captionStyle:'Оформить СУЩЕСТВУЮЩУЮ подпись: patch с нужными полями x/y 0..1, size 0.015..0.2, color=#RRGGBB, background/italic boolean, weight 100..900, align=left|center|right.',
 captionEdit:'Изменить text и from/to существующей подписи.',
 ratio:'Формат проекта: value=16:9|9:16 для текущего пробного монтажа.',
 audioAt:'Передвинуть существующую аудиодорожку: at в секундах проекта >=0.',
 cutRange:'Сквозное вырезание времени проекта from..to со сдвигом всех дорожек. Только с подтверждёнными таймкодами.',
 reorder:'Переставить основное видео: ids перечисляет ВСЕ существующие клипы с layer=0, каждый ровно один раз. Слои поверх видео не включать.',
 duplicate:'Дублировать существующий video|audio|text. Не адресовать созданный дубль в этом же плане.',
 layer:'Поместить существующее изображение или видео поверх последовательности: layer целое 1..8, at >=0 секунд проекта. Это не добавление нового файла.',
 fades:'Затухание ЗВУКА video|audio: fadeIn/fadeOut 0..30 секунд, не больше длины клипа. Для картинки использовать transform.visualIn/visualOut.',
 master:'Общая громкость проекта: value 0..1.'
};
export function operationGuide(request){
 return Object.fromEntries(request.capabilities.map(type=>[type,{fields:['type',...AI_OPERATIONS[type]],description:guidance[type]}]));
}
