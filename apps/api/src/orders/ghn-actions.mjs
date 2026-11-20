import { get, run, transaction } from '../db/store.mjs';
import { AppError, choicesOf, ensure, string } from '../http/validation.mjs';
import { ghn, resolveGhnAddress } from './ghn-auto.mjs';
import { canonicalPhone } from './order-flow.mjs';
import { readShipment } from './shipping.mjs';

const printFormats={a5:'printA5',square:'print80x80',small:'print52x70'};
const statusPaths={cancel:'cancel',return:'return',redeliver:'storing'};
const inspection=['KHONGCHOXEMHANG','CHOXEMHANGKHONGTHU','CHOTHUHANG'];
const completed=new Set(['cancel','returned','delivered','lost','damage']);

export function recipient(body) {
  const customer=string(body.customer,100,{required:true,min:2});
  const phone=canonicalPhone(string(body.phone,30,{required:true}));
  const address=string(body.address,350,{required:true,min:8});
  ensure(phone,400,'Nhập số điện thoại nhận hàng hợp lệ.');
  return {customer,phone,address};
}

export async function ghnPrintUrl(connection,orderCodes,value){
  const format=choicesOf(value,Object.keys(printFormats));
  const printed=await ghn('v2/a5/gen-token',connection,{order_codes:orderCodes});
  ensure(typeof printed?.token==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(printed.token),502,'GHN chưa trả mã in.');
  const url=new URL('https://online-gateway.ghn.vn/a5/public-api/'+printFormats[format]);
  url.searchParams.set('token',printed.token);
  return url.href;
}

export async function manageGhnOrder(channelId,code,body) {
  const action=choicesOf(body.action,['print','edit','cod','cancel','redeliver','return','sync']);
  return transaction(async()=>{
    const order=ensure(await get(`SELECT * FROM shop_orders WHERE channel_id=$1 AND code=$2
      AND archived_at IS NULL AND carrier='ghn' AND tracking<>'' FOR UPDATE`,channelId,code),
    404,'Không tìm thấy vận đơn GHN.');
    ensure(action==='sync'||order.updated===body.updated,409,'Đơn vừa thay đổi. Hãy mở lại và thử lại.');
    const connection=ensure(await get(`SELECT * FROM shop_carriers WHERE channel_id=$1 AND carrier='ghn'
      AND ($2::text IS NULL OR account_ref=$2) FOR SHARE`,channelId,order.ghn_shop),409,'Cần kết nối Shop ID của vận đơn.');
    if(action==='print')return {url:await ghnPrintUrl(connection,[order.tracking],body.format)};
    const before=await readShipment(connection,order.tracking,{withFee:action==='sync'});

    let customer=order.customer,phone=order.phone,address=order.address;
    if(action==='edit'){
      const input=recipient(body);
      const fields={};
      if(input.customer!==customer)fields.to_name=input.customer;
      if(input.phone!==phone)fields.to_phone=input.phone;
      if(input.address!==address)Object.assign(fields,{to_address:input.address},await resolveGhnAddress(input.address,connection));
      if(body.note!==undefined)fields.note=string(body.note,500);
      if(body.inspection)fields.required_note=choicesOf(body.inspection,inspection);
      if(body.payment!==undefined)fields.payment_type_id=choicesOf(body.payment,[1,2]);
      for(const [key,max] of [['weight',19999],['length',200],['width',200],['height',200]]){
        const value=body[key];
        if(value===undefined)continue;
        ensure(Number.isInteger(value)&&value>=1&&value<=max,400,'Thông số kiện hàng không hợp lệ.');
        fields[key]=value;
      }
      ensure(Object.keys(fields).length,400,'Chưa có thông tin thay đổi.');
      await ghn('v2/shipping-order/update',connection,{order_code:order.tracking,...fields});
      ({customer,phone,address}=input);
    }else if(action==='cod'){
      ensure(Number.isInteger(body.amount)&&body.amount>=0&&body.amount<=50_000_000,400,'COD cần từ 0 đến 50 triệu đồng.');
      await ghn('v2/shipping-order/updateCOD',connection,{order_code:order.tracking,cod_amount:body.amount});
    }else if(Object.hasOwn(statusPaths,action)&&!(action==='cancel'&&before.status==='cancel')){
      const payload={order_codes:[order.tracking]};
      if(action==='cancel'){
        payload.reason_code=choicesOf(body.reasonCode,['GHN-CO001','GHN-CO002','GHN-CO003','GHN-CANCEL-OTHER']);
        payload.reason=string(body.reason,250);
      }
      const response=await ghn('v2/switch-status/'+statusPaths[action],connection,payload);
      ensure(Array.isArray(response)&&response.some((item)=>item.order_code===order.tracking&&item.result===true),
        409,'GHN từ chối thao tác ở trạng thái hiện tại.');
    }

    let shipment=before, pending=false;
    if(action!=='sync'){
      try{shipment=await readShipment(connection,order.tracking);}
      catch(error){
        if(!(error instanceof AppError))throw error;
        pending=true;
      }
    }
    if(action==='cod'&&!pending&&shipment.cod!==body.amount)pending=true;
    if(action==='cancel'&&shipment.status!=='cancel')pending=true;
    pending ||= !!shipment.feePending;
    if(shipment.feePending&&order.shipment?.fee>0){
      shipment.fee=order.shipment.fee;
      shipment.feeKind=order.shipment.feeKind;
    }
    shipment.expected||=order.shipment?.expected??'';
    const now=Math.max(Date.now(),order.updated+1);
    const next=shipment.status==='delivered'?'delivered':['cancel','returned'].includes(shipment.status)?'cancelled':order.status;
    await run(`UPDATE shop_orders SET customer=$3,phone=$4,address=$5,shipment=$6,ghn_shop=$7,
      ghn_next=$8,ghn_error=NULL,ghn_attempts=0,updated=$9,status=$10,
      history=CASE WHEN status<>$10 THEN history||jsonb_build_array(jsonb_build_object('status',$10::text,'at',$9::bigint)) ELSE history END
      WHERE channel_id=$1 AND code=$2`,channelId,code,customer,phone,address,JSON.stringify(shipment),connection.account_ref,
    pending?Date.now():completed.has(shipment.status)?null:Date.now()+5*60_000,now,next);
    return {ok:true,pending};
  });
}
