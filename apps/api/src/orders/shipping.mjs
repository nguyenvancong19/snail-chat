import { unseal } from '../auth/crypto.mjs';
import { AppError, ensure } from '../http/validation.mjs';

const ghnStatuses={
  ready_to_pick:'Chờ lấy hàng',picking:'Đang lấy hàng',picked:'Đã lấy hàng',storing:'Đang lưu kho',
  transporting:'Đang vận chuyển',sorting:'Đang phân loại',delivering:'Đang giao',
  delivered:'Đã giao',delivery_fail:'Giao không thành công',waiting_to_return:'Chờ hoàn hàng',
  return:'Đang hoàn hàng',returned:'Đã hoàn hàng',cancel:'Đã hủy',lost:'Thất lạc',damage:'Hư hỏng',
};
const limited=(value)=>typeof value==='string'?value.trim().slice(0,120):'';
function amount(value){
  if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+$/.test(value)))return null;
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>=0?number:null;
}

async function currentGhnFee(headers, code){
  const url=new URL('https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/soc');
  url.searchParams.set('order_code',code);
  try{
    const response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(5_000)});
    if(!response.ok)return null;
    const payload=await response.json();
    const data=payload?.data;
    if(Number(payload?.code)!==200||data?.order_code!==code||
      !data.detail||typeof data.detail!=='object'||Array.isArray(data.detail))return null;
    const total=amount(data.detail.total);
    if(total!==null)return {fee:total};
    const base=amount(data.detail.main_service);
    return base>0?{fee:base,feeKind:'base'}:null;
  }catch{return null;}
}

export async function readShipment(connection,waybill,{withFee=true}={}){
  const ghn=connection.carrier==='ghn';
  const url=ghn
    ?new URL('https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/detail')
    :new URL('https://services.giaohangtietkiem.vn/services/shipment/v2/'+encodeURIComponent(waybill));
  if(ghn)url.searchParams.set('order_code',waybill);
  let token;
  try {token=unseal(connection.sealed_token);}
  catch {throw new AppError(502,'Không mở được token đã lưu. Hãy nhập lại token của hãng.');}
  const headers={Token:token};
  if(ghn)headers.ShopId=connection.account_ref;
  else if(connection.account_ref)headers['X-Client-Source']=connection.account_ref;
  let response;
  try {response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(10_000)});}
  catch {throw new AppError(502,'Không kết nối được hãng vận chuyển. Thử lại sau.');}
  if([401,403].includes(response.status))throw new AppError(502,'Hãng từ chối xác thực. Kiểm tra token và thông tin tài khoản.');
  if(response.status===404)throw new AppError(404,'Hãng không tìm thấy mã vận đơn.');
  ensure(response.ok,502,'Hãng chưa trả được thông tin vận đơn. Thử lại sau.');
  const payload=await response.json().catch(()=>null);
  const order=ghn?payload?.data:payload?.order;
  if(ghn&&[401,403].includes(Number(payload?.code)))throw new AppError(502,'GHN từ chối xác thực. Kiểm tra token và Shop ID.');
  ensure(ghn?Number(payload?.code)===200&&order:payload?.success===true&&order,
    422,'Hãng không xác nhận được vận đơn. Kiểm tra mã và tài khoản đã liên kết.');
  const code=limited(ghn?order.order_code:order.label_id);
  const sameCode=(value)=>typeof value==='string'&&value.toUpperCase()===waybill.toUpperCase();
  ensure(code&&(ghn?sameCode(code)&&String(order.shop_id)===connection.account_ref
    :sameCode(code)||sameCode(order.partner_id)),422,'Vận đơn trả về không khớp với mã hoặc tài khoản đã liên kết.');
  const status=limited(String(order.status??''));
  ensure(status,502,'Hãng chưa cung cấp trạng thái vận đơn.');
  const fees=ghn?(withFee?await currentGhnFee(headers,code):null):{fee:amount(order.ship_money)};
  return {
    code,status,label:ghn?(ghnStatuses[status]??status):(limited(order.status_text)||status),
    expected:limited(ghn?(order.leadtime||order.expected_delivery_time):order.deliver_date),
    carrierCreated:ghn?limited(order.created_date):'',
    carrierUpdated:limited(ghn?order.updated_date:order.modified),
    cod:amount(ghn?order.cod_amount:order.pick_money),
    ...(fees??{fee:null,feePending:true}),syncedAt:Date.now(),
    ...(ghn&&(order.is_partial_return===true||order.IsPartialReturn===true)?
      {partial:true,partialCode:limited(order.partial_return_code??order.PartialReturnCode)}:{}),
  };
}
