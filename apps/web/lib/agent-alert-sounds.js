import { ensureBrowserSession } from './workspace.js';

export const agentSounds={
  order:{label:'Agent chốt đơn thành công', phrase:'Đã thành công chốt được 1 đơn hàng'},
  product:{label:'Cần xác minh sản phẩm', phrase:'Cần xác minh sản phẩm'},
  customer:{label:'Cần xác minh khách hàng', phrase:'Vui lòng xác minh khách trước'},
};

const root='/api/shop/alert-sounds';
const deviceKey=shop=>'snailchat.sound:'+shop;
let context;
let queue=Promise.resolve();

export function deviceSoundOn(shop){
  try{return localStorage.getItem(deviceKey(shop))==='on';}catch{return false;}
}
export function setDeviceSound(shop,on){
  localStorage.setItem(deviceKey(shop),on?'on':'off');
}
export function unlockAgentAudio(){
  try{
    const AudioContext=window.AudioContext??window.webkitAudioContext;
    if(AudioContext){
      context??=new AudioContext();
      if(context.state!=='running')void context.resume().catch(()=>{});
    }
  }catch{}
}

export async function soundRequest(shop,path='',options={}){
  const headers=new Headers(options.headers);
  headers.set('x-shop-id',shop);
  const send=()=>fetch(root+path,{...options,headers,cache:'no-store'});
  let response=await send();
  if(response.status===401&&await ensureBrowserSession()){
    options.signal?.throwIfAborted();
    response=await send();
  }
  if(!response.ok){
    const error=await response.json().catch(()=>null);
    throw Object.assign(new Error(error?.error||'Chưa thể tải hoặc lưu âm báo. Hãy thử lại.'),{status:response.status});
  }
  return response;
}

export async function claimAgentAlert(shop,id){
  const key='snailchat.sound.played:'+shop;
  function claim(){
    try{
      const played=JSON.parse(localStorage.getItem(key)??'[]');
      if(played.includes(id))return false;
      localStorage.setItem(key,JSON.stringify([...played.slice(-99),id]));
    }catch{}
    return true;
  }
  return navigator.locks?navigator.locks.request(key,claim):claim();
}

function waitForSound(start,signal){
  return new Promise((resolve,reject)=>{
    signal?.throwIfAborted();
    let stop;
    const done=error=>{
      signal?.removeEventListener('abort',cancel);
      if(error)reject(error);
      else resolve();
    };
    function cancel(){done(signal.reason);stop?.();}
    signal?.addEventListener('abort',cancel,{once:true});
    try{stop=start(done);}catch(error){done(error);}
  });
}

async function play(kind,url,signal){
  signal?.throwIfAborted();
  if(!url){
    const speech=window.speechSynthesis;
    const voice=speech?.getVoices().find(item=>/^vi\b/i.test(item.lang));
    if(voice){
      const line=new SpeechSynthesisUtterance(agentSounds[kind].phrase);
      line.voice=voice;
      line.lang='vi-VN';
      try{
        await waitForSound(done=>{
          line.onend=()=>done();
          line.onerror=()=>done(new Error('speech'));
          speech.speak(line);
          return ()=>speech.cancel();
        },signal);
        return;
      }catch{signal?.throwIfAborted();}
    }
  }
  const sourceUrl=url??'/alert-sounds/'+kind+'.mp3';
  if(context?.state==='running'){
    const data=await fetch(sourceUrl,{signal}).then(response=>{
      if(!response.ok)throw new Error('audio');
      return response.arrayBuffer();
    });
    const buffer=await context.decodeAudioData(data);
    await waitForSound(done=>{
      const source=context.createBufferSource();
      source.buffer=buffer;
      source.connect(context.destination);
      source.onended=()=>{source.disconnect();done();};
      source.start();
      return ()=>source.stop();
    },signal);
    return;
  }
  await waitForSound(done=>{
    const audio=new Audio(sourceUrl);
    audio.onended=()=>done();
    audio.onerror=()=>done(new Error('audio'));
    audio.play().catch(done);
    return ()=>audio.pause();
  },signal);
}

export function playAgentSound(shop,kind,{filename,signal,shouldPlay=()=>true}={}){
  const task=queue.then(async()=>{
    if(signal?.aborted||!shouldPlay())return;
    let url;
    try{
      if(filename){
        const response=await soundRequest(shop,'/'+kind+'/file',{signal});
        url=URL.createObjectURL(await response.blob());
      }
      if(shouldPlay())await play(kind,url,signal);
    }finally{
      if(url)URL.revokeObjectURL(url);
    }
  });
  queue=task.catch(()=>{});
  return task;
}
