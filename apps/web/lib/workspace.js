export const platformLabel = (value) => value === 'fb' ? 'Facebook Page' : 'Instagram';
export const channelIdentity = (channel) => channel.platform === 'fb' && /^\d+$/.test(channel.handle)
  ? 'Page ID · '+channel.handle : '@'+channel.handle;
export const activityLabels = { review:'Chờ xử lý', working:'Đang gửi', replied:'Đã trả lời', uncertain:'Cần đối chiếu', expired:'Quá 24 giờ' };
export const botLabels = { off:'Tắt', review:'Duyệt thủ công', auto:'Chỉ phản hồi khi khớp quy tắc' };
export const emptyWorkspace = { channels:[], users:[], stats:{}, meta:{} };

const shopKey='snailchat.activeShopId';

export function activeShop() {
  return typeof window==='undefined'?'':window.sessionStorage.getItem(shopKey)??'';
}

export function selectShop(id) {
  if(id) window.sessionStorage.setItem(shopKey,id);
  else window.sessionStorage.removeItem(shopKey);
}

const anonymous=new Set(['login','register','verify-email','resend-verification','forgot-password','reset-password','session','session/refresh']);
const cookieMutations=new Set(['login','logout','browser-accounts/switch','profile']);
let sessionRenewal;

function withSessionLock(work){
  const locks=globalThis.navigator?.locks;
  return locks?locks.request('snailchat-session-refresh',work):work();
}

export function ensureBrowserSession(minValidity=0){
  if(sessionRenewal)return sessionRenewal;
  async function renew(){
    const probe=await fetch('/api/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!probe.ok)throw new Error('Không kiểm tra được phiên SnailChat. Hãy thử lại.');
    const existing=await probe.json();
    if(existing.user&&(minValidity===0||existing.accessExpiresAt>Date.now()+minValidity))return true;
    const response=await fetch('/api/session/refresh',{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(response.status===401)return false;
    if(!response.ok)throw new Error('Chưa thể làm mới phiên SnailChat. Hãy thử lại.');
    return true;
  }
  // Recheck the shared cookie inside the lock: another tab may have rotated it already.
  sessionRenewal=withSessionLock(renew).finally(()=>{sessionRenewal=undefined;});
  return sessionRenewal;
}

export async function api(path, method='GET', body, signal, version) {
  try {
    const multipart=body instanceof FormData;
    const headers=new Headers();
    if(Number.isSafeInteger(version))headers.set('If-Match','"'+version+'"');
    const shop=activeShop();
    if(shop)headers.set('x-shop-id',shop);
    if(path==='bootstrap')headers.set('x-snailchat-account-list','paged');
    if(body&&!multipart)headers.set('Content-Type','application/json');
    const send=()=>fetch('/api/'+path, {
      method, headers,
      body: multipart?body:body?JSON.stringify(body):undefined,
      credentials:'same-origin', cache:'no-store', signal,
    });
    const request=()=>method==='POST'&&cookieMutations.has(path)?withSessionLock(send):send();
    let response=await request();
    let data;
    if(path==='bootstrap'&&response.ok&&response.headers.get('content-type')?.includes('application/json'))data=await response.json();
    if((response.status===401&&!anonymous.has(path)||path==='bootstrap'&&data&&!data.user)&&
      !signal?.aborted&&await ensureBrowserSession()){
      signal?.throwIfAborted();
      response=await request();
      data=undefined;
    }
    if(!response.headers.get('content-type')?.includes('application/json')){
      throw new Error('Chưa nhận được dữ liệu từ SnailChat. Hãy kiểm tra kết nối.');
    }
    data??=await response.json();
    if (!response.ok) {
      const error=new Error(data.error || 'Yêu cầu không thành công.');
      error.status=response.status;
      if(response.status===429)error.retryAfter=Number(response.headers.get('retry-after'))||null;
      throw error;
    }
    return data;
  } catch(error) {
    if(error.name==='TimeoutError')throw new Error('SnailChat chưa phản hồi kịp. Hãy thử lại.');
    if(error instanceof TypeError)throw new Error('Mất kết nối với SnailChat.');
    throw error;
  }
}

export const formatDate = (value,locale='vi-VN') => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale, {
    timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short',
  }) : '—';
};

export function orderLinesText(order){
  if(!order.items?.length)return order.quantity+' × '+(order.product_name??order.sku);
  return order.items.map((line)=>line.quantity+' × '+line.name+' ('+line.sku+')'+(line.color?' · màu '+line.color:'')+(line.size?' · size '+line.size:'')).join(', ');
}

export function orderGoodsTotal(order){
  return order.items?.length?order.items.reduce((sum,line)=>sum+line.quantity*line.unit_price,0):
    order.quantity*order.unit_price;
}

export function accountHome(user) {
  if(!user)return '/login';
  return user.isSuperAdmin===true?'/admin':'/dashboard';
}

export function workActorLabel(actor,copy) {
  return actor.role==='OWNER'?[copy('Chủ Shop'),actor.name].filter(Boolean).join(' · ')
    :[actor.name,actor.code].filter(Boolean).join(' · ');
}
