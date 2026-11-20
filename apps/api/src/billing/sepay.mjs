import { createHmac } from 'node:crypto';
import { safeEqual } from '../auth/crypto.mjs';
import { ensure } from '../http/validation.mjs';

export function sepayAccount() {
  const bank=process.env.SEPAY_BANK_CODE?.trim()??'';
  const number=process.env.SEPAY_ACCOUNT_NUMBER?.trim()??'';
  const name=process.env.SEPAY_ACCOUNT_NAME?.trim()??'';
  if(!/^[a-z\d]{2,40}$/i.test(bank)||!/^\d{4,30}$/.test(number)||!name||name.length>120||
    !process.env.SEPAY_WEBHOOK_SECRET?.trim())return null;
  return {bank,number,name};
}

export function verifySePay(raw,timestamp,signature) {
  const secret=process.env.SEPAY_WEBHOOK_SECRET?.trim();
  ensure(secret,503,'Thanh toán SePay chưa được cấu hình.');
  ensure(/^\d{10}$/.test(timestamp??'')&&Math.abs(Date.now()-Number(timestamp)*1000)<=5*60_000&&
    /^sha256=[0-9a-f]{64}$/i.test(signature??''),401,'Chữ ký hoặc thời gian SePay không hợp lệ.');
  const digest=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex');
  ensure(safeEqual('sha256='+digest,signature.toLowerCase()),401,'Chữ ký SePay không hợp lệ.');
}

export function transferDetails(body) {
  if(body?.transferType!=='in')return null;
  const id=String(body.id??'');
  if((typeof body.id==='number'&&!Number.isSafeInteger(body.id))||!/^\d{1,24}$/.test(id)||
    !Number.isSafeInteger(body.transferAmount)||body.transferAmount<=0)return null;
  const values=[body.code,body.content].filter((value)=>typeof value==='string');
  const matches=new Set(values.flatMap((value)=>[...value.toUpperCase().matchAll(/(?<![A-Z0-9])S[CT][A-F0-9]{12}(?![A-Z0-9])/g)]
    .map(([code])=>code)));
  if(matches.size!==1)return null;
  const date=typeof body.transactionDate==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(body.transactionDate)
    ?Date.parse(body.transactionDate.replace(' ','T')+'+07:00'):NaN;
  return {id,orderId:[...matches][0],account:String(body.accountNumber??''),amount:body.transferAmount,date,
    reference:typeof body.referenceCode==='string'?body.referenceCode.slice(0,100):''};
}

export function paymentQr(order) {
  const params=new URLSearchParams({acc:order.account_number,bank:order.bank_code,
    amount:String(order.price_vnd),des:order.id});
  return 'https://vietqr.app/img?'+params;
}
