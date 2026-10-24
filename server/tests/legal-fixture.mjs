// Synthetic details are used only by isolated test databases, never production.
import {createLegal,legalVersion} from '../legal.mjs';
export const legalTestConfig={published:true,operatorType:'npd',operatorName:'Тестовый оператор',inn:'123456789012',ogrn:'',address:'Синтетический адрес теста',email:'support@example.test',phone:'+70000000000',hosting:'Тестовая база и копии, РФ; удаление по тестовому регламенту.',processors:'Тестовые обработчики; внешние вызовы подменены fixture.',rknNotice:'Синтетические сведения для теста, не реальная регистрация.',identityConfirmed:true,hostingConfirmed:true,processingReviewed:true,crossBorderReviewed:true,documentsApproved:true};
export const legalAcceptance={acceptPrivacy:true,acceptTerms:true,adultConfirmed:true,legalVersion:legalVersion(legalTestConfig)};
export function prepareLegal(app){return createLegal({store:app.store,now:Date.now,origin:app.origin,session:()=>null,sameOrigin:()=>{}}).save(legalTestConfig);}
