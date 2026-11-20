import { shopFeatures } from '../billing/plan-features.mjs';
import { activePage } from '../shops/tenant.mjs';
import { unseal } from '../auth/crypto.mjs';
import { get, run } from '../db/store.mjs';
import { AppError, ensure } from '../http/validation.mjs';
import { orderItems, orderTotal } from './order-flow.mjs';
import { readShipment } from './shipping.mjs';

const base='https://online-gateway.ghn.vn/shiip/public-api/';
const refreshInterval=5*60_000;
const terminal=new Set(['delivered','returned','cancel','lost','damage']);
const shipping=new Set(['picked','storing','transporting','sorting','delivering','delivery_fail','waiting_to_return','return']);
const catalogCache=new Map();

export async function ghn(path, connection, body) {
  const headers={Token:unseal(connection.sealed_token),ShopId:connection.account_ref};
  if(body)headers['Content-Type']='application/json';
  let response;
  try {
    response=await fetch(base+path,{headers,method:body?'POST':'GET',body:body&&JSON.stringify(body),
      redirect:'error',signal:AbortSignal.timeout(10_000)});
  }catch {throw new AppError(502,'Chưa có phản hồi từ GHN. Kiểm tra trạng thái vận đơn trước khi thao tác lại.');}
  const payload=await response.json().catch(()=>null);
  const code=Number(payload?.code)||response.status;
  if([401,403].includes(code))throw new AppError(502,'GHN từ chối xác thực. Kiểm tra API token và Shop ID.');
  ensure(response.ok&&code===200&&payload,502,
    'GHN chưa xác nhận yêu cầu (mã '+code+'). Kiểm tra kết nối và cấu hình giao hàng.');
  return payload.data;
}

async function locations(path, connection) {
  const cached=catalogCache.get(path);
  if(cached?.expires>Date.now())return cached.data;
  const data=await ghn(path,connection);
  ensure(Array.isArray(data),502,'GHN chưa trả danh mục địa chỉ.');
  catalogCache.set(path,{data,expires:Date.now()+6*60*60_000});
  return data;
}

const addressKey=(value)=>String(value??'').normalize('NFC').toLowerCase().trim()
  .replace(/^(?:thành phố|tp\.?|tỉnh|phường|xã|đặc khu|p\.)\s+/u,'').replace(/\s+/g,' ');
function matchedLocation(items, value) {
  const key=addressKey(value);
  const canonical=items.filter((item)=>Number(item.status)===1&&addressKey(item.name)===key);
  if(canonical.length)return canonical.length===1?canonical[0]:null;
  const aliases=items.filter((item)=>Number(item.status)===1&&Array.isArray(item.extension_names)&&
    item.extension_names.some((name)=>addressKey(name)===key));
  return aliases.length===1?aliases[0]:null;
}

export async function resolveGhnAddress(address, connection) {
  const parts=address.split(',').map((value)=>value.trim());
  const provinceInput=parts.pop(),wardInput=parts.pop();
  ensure(parts.some(Boolean)&&wardInput&&provinceInput,422,
    'Địa chỉ cần có số nhà/đường, phường/xã, tỉnh/thành, cách nhau bằng dấu phẩy.');
  ensure(!/^(quận|huyện|thị xã)\s/iu.test(wardInput),422,
    'Dùng địa chỉ 2 cấp gồm số nhà/đường, phường/xã mới, tỉnh/thành.');
  const provinces=await locations('v3/master-data/province/all?limit=200',connection);
  const province=matchedLocation(provinces,provinceInput);
  ensure(province&&Number.isSafeInteger(province._id),422,'Không tìm thấy tỉnh/thành theo danh mục GHN.');
  const wards=await locations('v3/master-data/ward/all-by-province-id?limit=200&province_id='+province._id,connection);
  const ward=matchedLocation(wards,wardInput);
  ensure(ward,422,'Không tìm thấy phường/xã trong tỉnh/thành đã nhập theo danh mục GHN.');
  return {to_ward_name:ward.name,to_province_name:province.name,is_new_to_address:true};
}

async function createShipment(order) {
  const {length,width,height,weight,payment,note,cod}=order.ghn_config;
  const codAmount=cod?orderTotal(order):0;
  ensure(codAmount<=50_000_000,422,'Tiền thu hộ vượt giới hạn 50 triệu đồng của GHN.');
  const address=await resolveGhnAddress(order.address,order);
  const data=await ghn('v2/shipping-order/create',order,{
    client_order_code:'SC-'+order.code,to_name:order.customer,to_phone:order.phone,to_address:order.address,...address,
    weight,length,width,height,payment_type_id:payment,required_note:note,service_type_id:2,cod_amount:codAmount,
    content:orderItems(order).map((line)=>line.quantity+' × '+line.name+(line.size?' size '+line.size:'')).join(', ').slice(0,255),
  });
  const code=data?.order_code;
  ensure(typeof code==='string'&&/^[a-z0-9]{1,50}$/i.test(code),502,'GHN chưa trả mã vận đơn. Hệ thống sẽ thử lại cùng mã đơn.');
  return {code,status:'ready_to_pick',label:'Chờ lấy hàng',expected:typeof data.expected_delivery_time==='string'?data.expected_delivery_time:'',
    carrierCreated:typeof data.created_date==='string'?data.created_date:'',carrierUpdated:'',cod:codAmount,fee:Number.isSafeInteger(data.total_fee)?data.total_fee:null,syncedAt:Date.now()};
}

async function claimOrder() {
  const now=Date.now();
  return get(`WITH due AS (
    SELECT o.channel_id,o.code,c.sealed_token,c.account_ref,tenant.id AS shop_id FROM shop_orders o
    JOIN shop_carriers c ON c.channel_id=o.channel_id AND c.carrier='ghn' AND c.account_ref=o.ghn_shop
    JOIN channels p ON p.id=o.channel_id JOIN entitled_shop_channels entitlement ON entitlement.id=p.id JOIN shops tenant ON tenant.id=p.shop_id AND tenant.status='ACTIVE'
      AND (tenant.expired_at IS NULL OR tenant.expired_at>$1) JOIN users u ON u.id=tenant.owner_id AND u.active=1
    JOIN subscription_plans plan ON plan.code=tenant.subscription_plan AND COALESCE((plan.feature_flags->>'orders')::boolean,plan.order_management)
    WHERE o.archived_at IS NULL AND o.ghn_next<=$1 AND ((o.tracking='' AND c.auto_config IS NOT NULL AND o.status IN ('new','packing'))
      OR (o.tracking<>'' AND o.carrier='ghn'))
    ORDER BY o.ghn_next LIMIT 1 FOR UPDATE OF o SKIP LOCKED
  ) UPDATE shop_orders o SET ghn_next=$2 FROM due
    WHERE o.channel_id=due.channel_id AND o.code=due.code
    RETURNING o.*,due.sealed_token,due.account_ref,due.shop_id`,now,now+90_000);
}

export async function syncGhnOrders() {
  const order=await claimOrder();
  if(!order||!await activePage(order.channel_id)||!(await shopFeatures(order.shop_id))?.order_management)return;
  try{
    const shipment=order.tracking?await readShipment({...order,carrier:'ghn'},order.tracking):await createShipment(order);
    if(shipment.feePending&&order.shipment?.fee>0){
      shipment.fee=order.shipment.fee;
      shipment.feeKind=order.shipment.feeKind;
    }
    shipment.expected||=order.shipment?.expected??'';
    shipment.carrierCreated||=order.shipment?.carrierCreated??'';
    const next=terminal.has(shipment.status)&&!shipment.feePending?null:Date.now()+refreshInterval;
    const status=shipment.status==='delivered'?'delivered':['cancel','returned'].includes(shipment.status)?'cancelled':
      shipping.has(shipment.status)?'shipping':'';
    await run(`UPDATE shop_orders SET carrier='ghn',tracking=$4,shipment=$5,ghn_next=$6,ghn_attempts=0,ghn_error=NULL,
      updated=GREATEST(updated+1,$8),
      history=CASE WHEN $7<>'' AND status<>$7 THEN history||jsonb_build_array(jsonb_build_object('status',$7::text,'at',$8::bigint)) ELSE history END,
      status=CASE WHEN $7<>'' THEN $7 ELSE status END
      WHERE channel_id=$1 AND code=$2 AND ghn_next=$3`,
    order.channel_id,order.code,order.ghn_next,shipment.code,JSON.stringify(shipment),next,status,Date.now());
  }catch(error){
    const attempts=order.ghn_attempts+1;
    const next=error.status===422&&!order.tracking?null:Date.now()+Math.min(60,2**Math.min(attempts,6))*60_000;
    await run(`UPDATE shop_orders SET ghn_next=$4,ghn_attempts=$5,ghn_error=$6 WHERE channel_id=$1 AND code=$2 AND ghn_next=$3`,
      order.channel_id,order.code,order.ghn_next,next,attempts,
      error instanceof AppError?error.message:'Chưa kết nối được GHN. Hệ thống sẽ thử lại.');
  }
}
