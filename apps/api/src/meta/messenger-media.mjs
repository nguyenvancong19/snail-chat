import { ensure } from '../http/validation.mjs';

const mimeTypes={
  jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',
  mp4:'video/mp4',mov:'video/quicktime',
  pdf:'application/pdf',txt:'text/plain',csv:'text/csv',zip:'application/zip',
  doc:'application/msword',xls:'application/vnd.ms-excel',ppt:'application/vnd.ms-powerpoint',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const mib=1024*1024;
export const messengerUploadLimit=20*mib;

export async function messengerUpload(file) {
  ensure(file instanceof File&&file.size>0,400,'Hãy chọn tệp cần gửi.');
  const name=file.name.split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g,'').trim();
  const extension=name.includes('.')?name.split('.').at(-1).toLowerCase():'';
  const contentType=Object.hasOwn(mimeTypes,extension)&&mimeTypes[extension];
  ensure(name.length<=180&&contentType,415,'Định dạng hoặc tên tệp chưa được hỗ trợ.');
  const type=contentType.startsWith('image/')?'image':contentType.startsWith('video/')?'video':'file';
  ensure(file.size<=(type==='image'?8*mib:messengerUploadLimit),413,'Ảnh tối đa 8 MB. Video và tệp tối đa 20 MB.');
  return {type,name,size:file.size,contentType,data:Buffer.from(await file.arrayBuffer())};
}

export function receivedMessengerAttachments(attachments) {
  if(!Array.isArray(attachments))return [];
  return attachments.slice(0,10).filter((entry)=>entry&&typeof entry==='object').map(({type,payload})=>{
    let url=null;
    try{
      const parsed=new URL(payload?.url);
      const trusted=['fbcdn.net','fbsbx.com'].some((host)=>parsed.hostname===host||parsed.hostname.endsWith('.'+host));
      if(trusted&&parsed.protocol==='https:'&&!parsed.port&&!parsed.username&&!parsed.password)url=parsed.href;
    }catch{}
    const kind=['image','video','audio','file'].includes(type)?type:'file';
    const label={image:'Ảnh',video:'Video',audio:'Âm thanh',file:'Tệp đính kèm'}[kind];
    return {type:kind,name:label,url};
  });
}
