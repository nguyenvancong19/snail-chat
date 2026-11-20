'use client';

import { ListPagination } from './list-pagination.jsx';

import { useDisplayLocale } from '../lib/display-locale.jsx';
import { Fragment, useEffect, useRef, useState } from 'react';
import { api, formatDate, orderGoodsTotal, orderLinesText } from '../lib/workspace.js';
import { Dialog } from './forms.jsx';
import { OrderPrint } from './order-print.jsx';
import { CreateOrder, GhnOrderActions, OrderAction, OrderMenu } from './order-actions.jsx';
import { BuyerVerification, CheckoutCases } from './order-verification.jsx';
import { Button, Empty, Field, MetricGrid, Title } from './ui.jsx';
import { chartDate, DonutChart, TimeChart } from './stat-charts.jsx';

const orderStatuses=['new','packing','shipping','delivered','cancelled'];
const transitions={new:['packing','cancelled'],packing:['shipping','cancelled'],shipping:['delivered','cancelled'],delivered:[],cancelled:[]};
const money=(value)=>value.toLocaleString('vi-VN')+'đ';

const carrierLabels={ghn:'Giao Hàng Nhanh (GHN)',ghtk:'Giao Hàng Tiết Kiệm (GHTK)'};

function carrierDate(value,intl) {
  return value.includes('T')&&Number.isFinite(Date.parse(value))?formatDate(Date.parse(value),intl):value;
}

function ShipmentInfo({ shipment,carrier,canSync=false }) {
  const {copy,intl}=useDisplayLocale();
  const date=(value)=>formatDate(value,intl);
  return <div className="notice">
    <strong>{carrierLabels[carrier]} · {copy(shipment.label)}</strong>
    <p>{copy("Mã vận đơn")} {shipment.code} {copy("· Đồng bộ lúc")} {date(shipment.syncedAt)}</p>
    {shipment.partial&&<p>{copy("Giao một phần")}{shipment.partialCode?copy(" · Mã hoàn ")+shipment.partialCode:''}</p>}
    {shipment.expected&&<p>{copy("Giao dự kiến")} {carrierDate(shipment.expected,intl)}</p>}
    {shipment.carrierUpdated&&<p>{copy("Hãng cập nhật")} {carrierDate(shipment.carrierUpdated,intl)}</p>}
    {shipment.cod!==null&&<p>{copy("Thu hộ (COD)")} {money(shipment.cod)}</p>}
    {shipment.fee!==null&&<p>{shipment.feePending?copy("Phí đã lưu lần trước"):shipment.feeKind==='base'?copy("Cước vận chuyển cơ bản"):copy("Phí vận chuyển")} {money(shipment.fee)}</p>}
    {!shipment.feePending&&shipment.feeKind==='base'&&<p>{copy("GHN chưa trả tổng phí gồm các khoản phát sinh.")}</p>}
    {shipment.feePending&&<p>{copy("GHN chưa trả phí hiện tại.")}{canSync?copy(" Bạn có thể chọn Đồng bộ GHN để kiểm tra lại."):''}</p>}
  </div>;
}

function GhnSettings({ connection, channel, close, refresh }) {
  const {copy}=useDisplayLocale();
  const saved=connection.auto_config;
  const [enabled,setEnabled]=useState(!!saved);
  return <Dialog title={copy("Tự tạo vận đơn GHN")} label={copy("Lưu cấu hình")} close={close} submit={async(form)=>{
    const options=enabled?{
      weight:Number(form.get('weight')),length:Number(form.get('length')),width:Number(form.get('width')),height:Number(form.get('height')),
      payment:Number(form.get('payment')),note:form.get('note'),cod:form.get('cod')==='cod',
    }:{};
    await api('orders/ghn/settings','POST',{channel,shop:connection.account_ref,enabled,...options});
    refresh();
  }}>
    <label className="check"><input type="checkbox" checked={enabled} onChange={(event)=>setEnabled(event.target.checked)}/>
      {copy("Tự gửi đơn mới đã chốt sang GHN")}</label>
    {enabled&&<>
      <p className="dim">{copy("GHN lấy hàng tại địa chỉ đã lưu của Shop ID")} {connection.account_ref}{copy(". Nhập thông số mặc định cho cả kiện hàng. Hiện hỗ trợ một kiện dưới 20 kg.")}</p>
      <div className="form-grid">
        {[['weight','Khối lượng (g)',19999],['length','Dài (cm)',200],['width','Rộng (cm)',200],['height','Cao (cm)',200]]
          .map(([key,label,max])=><Field key={key} label={label}><input name={key} type="number" min={1} max={max} required defaultValue={saved?.[key]}/></Field>)}
      </div>
      <Field label={copy("Bên trả phí vận chuyển")}><select name="payment" required defaultValue={saved?.payment??''}>
        <option value="">{copy("Chọn bên trả phí")}</option><option value="1">{copy("Shop trả")}</option><option value="2">{copy("Khách trả")}</option>
      </select></Field>
      <Field label={copy("Thu hộ tiền hàng")}><select name="cod" required defaultValue={saved?(saved.cod?'cod':'none'):''}>
        <option value="">{copy("Chọn cách thu hộ")}</option><option value="cod">{copy("COD bằng tiền hàng")}</option><option value="none">{copy("Không thu hộ")}</option>
      </select></Field>
      <Field label={copy("Đồng kiểm")}><select name="note" required defaultValue={saved?.note??''}>
        <option value="">{copy("Chọn quyền kiểm hàng")}</option><option value="KHONGCHOXEMHANG">{copy("Không xem hàng")}</option>
        <option value="CHOXEMHANGKHONGTHU">{copy("Xem hàng, không thử")}</option><option value="CHOTHUHANG">{copy("Xem và thử hàng")}</option>
      </select></Field>
      <p className="dim">{copy("Trong mẫu Hướng dẫn đặt hàng, yêu cầu khách ghi địa chỉ theo dạng số nhà/đường, phường/xã mới, tỉnh/thành phố. Đơn cũ chỉ gửi khi shop chọn gửi.")}</p>
    </>}
  </Dialog>;
}

const canPrint=(order)=>order.carrier==='ghn'&&!!order.tracking;

function OrderList({ channel, pendingVerifications=0, refreshWorkspace, owner, activityVersion, activityTarget }) {
  const {copy,t,intl}=useDisplayLocale();
  const orderDay=new Intl.DateTimeFormat(intl,{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'full'});
  const money=(value)=>new Intl.NumberFormat(intl,{style:'currency',currency:'VND'}).format(value);
  const dateTime=(value)=>formatDate(value,intl);
  const [result,setResult]=useState(null),[status,setStatus]=useState(''),[code,setCode]=useState(activityTarget?.kind==='orders'?activityTarget.source:''),[search,setSearch]=useState(activityTarget?.kind==='orders'?activityTarget.source:'');
  const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[error,setError]=useState('');
  const [archived,setArchived]=useState(false),[createOpen,setCreateOpen]=useState(false),[action,setAction]=useState(null);
  const [feedback,setFeedback]=useState(null),[day,setDay]=useState('');
  const [panel,setPanel]=useState(owner&&activityTarget?.kind==='verification'?'buyers':null),[detail,setDetail]=useState(null);
  const [picked,setPicked]=useState(()=>new Set()),[printOrders,setPrintOrders]=useState(null);
  const [edit,setEdit]=useState(null),[busy,setBusy]=useState(false);
  const [carriers,setCarriers]=useState([]),[connection,setConnection]=useState(null),[shipmentOrder,setShipmentOrder]=useState(null);
  const [ghnSettings,setGhnSettings]=useState(null),[ghnOrder,setGhnOrder]=useState(null);
  const checkoutEnabled=owner&&channel.aiToolsEnabled===true&&!channel.messageBotPolicy?.unifiedAgent;
  const ghn=carriers.find((item)=>item.carrier==='ghn');
  const [checkoutCases,setCheckoutCases]=useState(null);
  const [carrierError,setCarrierError]=useState(''),[carrierRevision,setCarrierRevision]=useState(0);
  const carrierPath='orders/carriers?'+new URLSearchParams({channel:channel.id});
  useEffect(()=>{
    if(!owner)return;
    const controller=new AbortController();
    setCarrierError('');
    api(carrierPath,'GET',undefined,controller.signal).then(({items})=>{
      if(!controller.signal.aborted)setCarriers(items);
    }).catch((problem)=>{if(!controller.signal.aborted)setCarrierError(problem.message);});
    return ()=>controller.abort();
  },[owner,carrierPath,carrierRevision]);
  const query=new URLSearchParams({channel:channel.id,status,code:search,day,page,archived:archived?'1':'0'});
  const path='orders?'+query;
  useEffect(()=>{setPicked(new Set());setResult(null);},[path]);
  useEffect(()=>{
    const controller=new AbortController();
    setError('');
    let loading=false;
    async function load(){
      if(loading)return;
      loading=true;
      try{
        const data=await api(path,'GET',undefined,controller.signal);
        if(!controller.signal.aborted){setResult(data);setError('');}
      }catch(problem){
        if(!controller.signal.aborted)setError(problem.message);
      }finally{loading=false;}
    }
    load();
    const interval=setInterval(load,8000);
    return ()=>{controller.abort();clearInterval(interval);};
  },[path,revision,activityVersion]);
  const openedAlert=useRef(false);
  useEffect(()=>{
    if(openedAlert.current||activityTarget?.kind!=='orders'||!result)return;
    const order=result.items.find(item=>item.code===activityTarget.source);
    if(order){openedAlert.current=true;setDetail(order);}
  },[activityTarget,result]);
  const printable=owner?(result?.items??[]).filter(canPrint):[];
  const selected=printable.filter((order)=>picked.has(order.code));
  function togglePicked(code,checked){
    setPicked((previous)=>{
      const next=new Set(previous);
      if(checked)next.add(code);else next.delete(code);
      return next;
    });
  }
  function complete(message,url){
    setFeedback({message,url});
    if(!url)setRevision((value)=>value+1);
  }
  async function toggle() {
    setBusy(true);setError('');
    try {
      await api('orders/settings','POST',{channel:channel.id,enabled:!result.enabled});
      setRevision((value)=>value+1);
    }catch(problem){setError(problem.message);}
    finally{setBusy(false);}
  }
  return <>
    {owner&&<div className="toolbar order-tools" aria-label={copy("Thiết lập đơn hàng")}>
      {channel.purpose==='sales'&&<>
        {checkoutEnabled&&<Button aria-expanded={panel==='bot'} onClick={()=>setPanel(panel==='bot'?null:'bot')}>{copy("Chốt đơn tự động")}</Button>}
        <Button aria-expanded={panel==='buyers'} onClick={()=>setPanel(panel==='buyers'?null:'buyers')}>{copy("Khách chờ xác minh")} {pendingVerifications>0&&<span className="work-count">{pendingVerifications}</span>}</Button>
      </>}
      {owner&&<Button aria-expanded={panel==='carriers'} onClick={()=>setPanel(panel==='carriers'?null:'carriers')}>{t('carriers')}</Button>}
    </div>}
    {panel==='bot'&&checkoutEnabled&&<>
    <section className="card bot-workspace-card">
      <h2>{copy("Chốt đơn qua Messenger")}</h2>
      <p className="dim">{copy("Khách gửi")} <strong>MUA AO001 x2</strong> {copy("với mã sản phẩm trong Danh mục Page. Bot hướng dẫn điền thông tin và xác nhận. Khách mua lần đầu cần shop duyệt thông tin. Khách dùng")} <strong>{copy("TRA ĐƠN")}</strong> {copy("kèm mã để xem tiến độ.")}</p>
      <Button variant={result?.enabled?'':'primary'} disabled={busy||!result} onClick={toggle}>
        {result?.enabled?copy("Tắt chốt đơn tự động"):copy("Bật chốt đơn tự động")}
      </Button>
      {result?.enabled&&<span className="dim"> {copy("Đang bật")}</span>}
    </section>
    {channel.purpose==='sales'&&<div className="toolbar">
      <Button icon="bot" variant="primary" disabled={!result} onClick={()=>setCheckoutCases(result)}>{copy("Cấu hình bot chốt đơn")}</Button>
    </div>}
    </>}
    {panel==='buyers'&&<BuyerVerification channel={channel.id} refreshOrders={()=>{setRevision((value)=>value+1);refreshWorkspace?.().catch(()=>{});}}/>}
    {checkoutEnabled&&checkoutCases&&<CheckoutCases channel={channel.id} saved={checkoutCases} close={()=>setCheckoutCases(null)}
      refresh={()=>setRevision((value)=>value+1)}/>}
    {panel==='carriers'&&<section className="card bot-workspace-card">
      <h2>{t('carriers')}</h2>
      <p className="dim">{copy("Lưu API token theo từng Page để lấy thông tin vận đơn.")}</p>
      {Object.entries(carrierLabels).map(([carrier,label])=>{
        const saved=carriers.find((item)=>item.carrier===carrier);
        return <div className="bot-rule-summary" key={carrier}>
          <div><strong>{label}</strong><small className="dim">{saved?copy("Đã lưu API token"):copy("Chưa lưu API token")}</small></div>
          <div className="faq-actions">
            <Button onClick={()=>setConnection({carrier,saved})}>{saved?copy("Sửa kết nối"):copy("Kết nối bằng API token")}</Button>
            {saved&&carrier==='ghn'&&channel.purpose==='sales'&&<Button onClick={()=>setGhnSettings(saved)}>
              {saved.auto_config?copy("Tự tạo vận đơn · Đang bật"):copy("Cài tự tạo vận đơn")}
            </Button>}
            {saved&&<Button variant="subtle"  onClick={()=>setConnection({carrier,remove:true})}>{copy("Gỡ kết nối")}</Button>}
          </div>
        </div>;
      })}
      {carrierError&&<p className="formerror" role="alert">{copy(carrierError)}</p>}
    </section>}
    <form className="toolbar order-filters" onSubmit={(event)=>{event.preventDefault();setSearch(code.trim());setPage(1);}}>
      <label htmlFor="order-day">{t('filterDate')}</label>
      <input id="order-day" type="date" value={day} onChange={(event)=>{setDay(event.target.value);setPage(1);}}/>
      {day&&<Button onClick={()=>{setDay('');setPage(1);}}>{t('clearDate')}</Button>}
      <label htmlFor="order-code">{t('id')}</label>
      <input id="order-code" value={code} maxLength={16} onChange={(event)=>setCode(event.target.value)}/>
      <Button type="submit">{t('findOrder')}</Button>
      <Button aria-pressed={archived} onClick={()=>{setArchived(!archived);setPage(1);}}>{t('hiddenOrders')}</Button>
      {owner&&channel.purpose==='sales'&&<Button variant="primary" onClick={()=>setCreateOpen(true)}>{t('create')}</Button>}
      <Button onClick={()=>setRevision((value)=>value+1)}>{t('refresh')}</Button>
    </form>
    <div className="order-status-bar" role="group" aria-label={t('orderFilter')}>
      {['',...orderStatuses].map((value)=><button type="button" key={value}
        aria-pressed={status===value} onClick={()=>{setStatus(value);setPage(1);}}>{t(value||'all')}</button>)}
    </div>
    {!archived&&selected.length>0&&<div className="toolbar">
      <Button variant="primary" onClick={()=>setPrintOrders(selected)}>{copy("In đơn đã chọn (")}{selected.length})</Button>
      <Button onClick={()=>setPicked(new Set())}>{copy("Bỏ chọn")}</Button>
    </div>}
    {feedback&&<p className="notice" role="status">{feedback.message}
      {feedback.url&&<> <a className="button primary" href={feedback.url} target="_blank" rel="noreferrer">{copy("Mở nhãn in GHN")}</a></>}
    </p>}
    {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    {!result&&!error&&<Empty>{t('loadingOrders')}</Empty>}
    {result&&!result.items.length&&<Empty>{t('noOrders')}</Empty>}
    {!!result?.items.length&&<div className="card order-table-wrap" tabIndex={0} role="region" aria-label={t('orderList')}
      onScroll={(event)=>{event.currentTarget.querySelector('details[open]')?.removeAttribute('open');}}>
      <table className="order-table">
        <thead><tr>
          {owner&&<th scope="col" className="order-select">{!archived&&printable.length>0&&
            <input type="checkbox" aria-label={copy("Chọn tất cả vận đơn GHN trên trang")} checked={selected.length===printable.length}
              onChange={(event)=>setPicked(event.target.checked?new Set(printable.map((order)=>order.code)):new Set())}/>}</th>}
          <th scope="col">{t('orders')}</th><th scope="col">{t('filterDate')}</th><th scope="col">{t('expected')}</th><th scope="col">{t('recipient')}</th><th scope="col">{t('address')}</th>
          <th scope="col">{t('items')}</th><th scope="col" className="order-amount">{t('cod')}</th>
          <th scope="col" className="order-amount">{t('shippingFee')}</th>{owner&&<th scope="col" className="order-table-actions">{t('actions')}</th>}
        </tr></thead>
        <tbody>{result.items.map((order,index)=>{
          const shipment=order.shipment;
          const date=orderDay.format(order.created);
          const startsDay=!index||date!==orderDay.format(result.items[index-1].created);
          return <Fragment key={order.code}>
            {startsDay&&<tr className="order-day-row"><td colSpan={owner?10:8}>{date}</td></tr>}
            <tr>
              {owner&&<td className="order-select">{!archived&&canPrint(order)&&<input type="checkbox"
                aria-label={copy("Chọn in đơn ")+order.code} checked={picked.has(order.code)}
                onChange={(event)=>togglePicked(order.code,event.target.checked)}/>}</td>}
              <th scope="row">
                <button type="button" className="order-code-link" onClick={()=>setDetail(order)}>{order.tracking||order.code}</button>
                {order.tracking&&<small className="dim">{order.code}</small>}
                <span className="order-state" data-status={order.status}>{(shipment?.label&&copy(shipment.label))||t(order.status)}</span>
                {order.ghn_error&&<small className="order-row-warning">{copy("Cần kiểm tra GHN")}</small>}
                {!order.ghn_error&&order.ghn_shop&&!order.tracking&&order.ghn_next&&<small className="dim">{copy("Chờ tạo vận đơn GHN")}</small>}
                {shipment?.partial&&<small className="dim">{copy("Giao một phần")}</small>}
              </th>
              <td className="order-dates">{shipment?.carrierCreated?carrierDate(shipment.carrierCreated,intl):dateTime(order.created)}
                <small className="dim">{shipment?.carrierCreated?'GHN':'SnailChat'}</small></td>
              <td className="order-dates">{shipment?.expected?carrierDate(shipment.expected,intl):'—'}</td>
              <td>{order.customer}<small className="dim">{order.phone}</small></td>
              <td className="order-address">{order.address}</td>
              <td className="order-product">{orderLinesText(order)}
                <small className="dim">{money(orderGoodsTotal(order))}</small></td>
              <td className="order-amount">{shipment?.cod!=null?money(shipment.cod):'—'}</td>
              <td className="order-amount">
                {shipment?.fee!=null?<strong>{money(shipment.fee)}</strong>:'—'}
                {shipment?.feePending?<small className="dim">{t('awaitSync')}</small>:
                  shipment?.feeKind==='base'?<small className="dim">{t('baseFee')}</small>:null}
              </td>
              {owner&&<td className="order-table-actions"><div className="order-row-actions">
                {!archived&&canPrint(order)&&<Button onClick={()=>setPrintOrders([order])}>{t('printLabel')}</Button>}
                <OrderMenu code={order.code}>
                  {archived?<Button onClick={()=>setAction({order,kind:'restore'})}>{copy("Khôi phục")}</Button>:<>
                  {order.carrier==='ghn'&&order.tracking&&<GhnOrderActions order={order} includePrint={false} open={(kind)=>setAction({order,kind})}/>}
                  {order.carrier!=='ghn'&&<Button onClick={()=>setEdit(order)}>{copy("Xem và cập nhật")}</Button>}
                  {!order.tracking&&!order.ghn_next&&['new','packing'].includes(order.status)&&
                    <Button onClick={()=>setAction({order,kind:'edit'})}>{copy("Sửa người nhận")}</Button>}
                  {!order.ghn_next&&(!order.tracking||['cancelled','delivered'].includes(order.status))&&
                    <Button onClick={()=>setAction({order,kind:'archive'})}>{copy("Ẩn đơn")}</Button>}
                  {!order.ghn_shop&&order.carrier!=='ghn'&&<Button disabled={!carriers.length} onClick={()=>setShipmentOrder(order)}>
                    {order.shipment?copy("Đồng bộ vận đơn"):copy("Gắn vận đơn")}
                  </Button>}
                  {ghn?.auto_config&&!order.tracking&&!order.ghn_next&&['new','packing'].includes(order.status)&&
                    (!order.ghn_shop||order.ghn_shop===ghn.account_ref)&&<Button onClick={()=>setGhnOrder(order)}>
                      {order.ghn_error?copy("Sửa địa chỉ / gửi lại"):copy("Gửi sang GHN")}
                    </Button>}
                  </>}
                </OrderMenu>
              </div></td>}
            </tr>
          </Fragment>;
        })}</tbody>
      </table>
    </div>}
    {result&&<ListPagination page={result.page??page} total={result.total} onChange={setPage}/>}
    {detail&&<Dialog title={copy("Chi tiết đơn ")+detail.code} close={()=>setDetail(null)}>
      <p><strong>{detail.customer}</strong> · {detail.phone}<br/>{detail.address}</p>
      <p>{orderLinesText(detail)} · {money(orderGoodsTotal(detail))}</p>
      <p className="dim">{copy("Ngày tạo")} {dateTime(detail.created)}</p>
      {detail.ghn_error&&<p className="formerror" role="status">{detail.ghn_error}</p>}
      {detail.shipment&&<ShipmentInfo shipment={detail.shipment} carrier={detail.carrier} canSync={owner}/>}
    </Dialog>}
    {printOrders&&<OrderPrint channel={channel.id} orders={printOrders} close={()=>setPrintOrders(null)}/>}
    {createOpen&&<CreateOrder channel={channel.id} ghn={!!ghn?.auto_config} close={()=>setCreateOpen(false)} complete={complete}/>}
    {action&&<OrderAction order={action.order} action={action.kind} channel={channel.id} close={()=>setAction(null)} complete={complete}/>}
    {ghnSettings&&<GhnSettings connection={ghnSettings} channel={channel.id} close={()=>setGhnSettings(null)}
      refresh={()=>setCarrierRevision((value)=>value+1)}/>}
    {ghnOrder&&<Dialog title={copy("Gửi đơn ")+ghnOrder.code+' sang GHN'} close={()=>setGhnOrder(null)} label={copy("Gửi tạo vận đơn")} submit={async(form)=>{
      await api('orders/ghn/submit','POST',{channel:channel.id,code:ghnOrder.code,updated:ghnOrder.updated,address:form.get('address')});
      setRevision((value)=>value+1);
    }}>
      <Field label={copy("Địa chỉ nhận hàng")}><textarea name="address" required minLength={8} maxLength={350} defaultValue={ghnOrder.address}/></Field>
      <p className="dim">{copy("Nhập số nhà/đường, phường/xã mới, tỉnh/thành phố, cách nhau bằng dấu phẩy.")}</p>
    </Dialog>}
    {connection&&<Dialog title={(connection.remove?copy("Gỡ "):copy("Kết nối "))+carrierLabels[connection.carrier]}
      close={()=>setConnection(null)} label={connection.remove?copy("Gỡ kết nối"):copy("Lưu kết nối")} submit={async(form)=>{
        const credentials=connection.remove?{remove:true}:{token:form.get('token'),accountRef:form.get('accountRef')};
        await api('orders/carriers','POST',{channel:channel.id,carrier:connection.carrier,...credentials});
        setCarrierRevision((value)=>value+1);
      }}>
      {connection.remove?<p>{copy("SnailChat sẽ dừng lấy dữ liệu mới từ tài khoản này.")}</p>:<>
        <Field label="API token"><input name="token" type="password" required={!connection.saved}
          autoComplete="new-password" maxLength={500}/></Field>
        {connection.saved&&<p className="dim">{copy("Để trống nếu muốn giữ token đã lưu.")}</p>}
        <Field label={connection.carrier==='ghn'?'Shop ID GHN':copy("Mã đối tác GHTK (tùy chọn)")}>
          <input name="accountRef" defaultValue={connection.saved?.account_ref??''} required={connection.carrier==='ghn'}
            inputMode={connection.carrier==='ghn'?'numeric':undefined} maxLength={connection.carrier==='ghn'?13:80}
            pattern={connection.carrier==='ghn'?'[1-9][0-9]{0,12}':undefined}/>
        </Field>
      </>}
    </Dialog>}
    {shipmentOrder&&<Dialog title={copy("Vận đơn của ")+shipmentOrder.code} close={()=>setShipmentOrder(null)} label={copy("Lấy thông tin từ hãng")} submit={async(form)=>{
      await api('orders/shipment','POST',{channel:channel.id,code:shipmentOrder.code,updated:shipmentOrder.updated,
        carrier:form.get('carrier'),tracking:form.get('tracking')},AbortSignal.timeout(15_000));
      setRevision((value)=>value+1);
    }}>
      <Field label={copy("Hãng vận chuyển")}><select name="carrier" defaultValue={carriers.find((item)=>item.carrier===shipmentOrder.carrier)?.carrier??carriers[0]?.carrier} required>
        {carriers.map(({carrier})=><option key={carrier} value={carrier}>{carrierLabels[carrier]}</option>)}
      </select></Field>
      <Field label={copy("Mã vận đơn")}><input name="tracking" maxLength={100} defaultValue={shipmentOrder.tracking} required/></Field>
      {shipmentOrder.shipment&&<ShipmentInfo shipment={shipmentOrder.shipment} carrier={shipmentOrder.carrier} canSync/>}
    </Dialog>}
    {edit&&<Dialog title={copy("Đơn ")+edit.code} close={()=>setEdit(null)} label={copy("Lưu cập nhật")} submit={async(form)=>{
      await api('orders/status','POST',{channel:channel.id,code:edit.code,previous:edit.status,updated:edit.updated,
        status:form.get('status'),tracking:form.get('tracking')});
      setRevision((value)=>value+1);
    }}>
      <p>{orderLinesText(edit)} {copy("· Tiền hàng")} {money(orderGoodsTotal(edit))}</p>
      <p><strong>{t('recipient')}</strong> {edit.customer} · {edit.phone}<br/>{edit.address}</p>
      <Field label={copy("Trạng thái đơn")}><select name="status" defaultValue={edit.status}>
        {[edit.status,...transitions[edit.status].filter((status)=>!edit.ghn_shop||status!=='cancelled'||(!edit.tracking&&!edit.ghn_next))].map((value)=><option key={value} value={value}>{t(value)}</option>)}
      </select></Field>
      <Field label={copy("Mã vận đơn")}><input name="tracking" readOnly={!!edit.ghn_shop} maxLength={100} defaultValue={edit.tracking}/></Field>
      <h3>{copy("Lịch sử trạng thái")}</h3>
      <ol>{edit.history.map((item)=><li key={item.at}>{dateTime(item.at)} · {t(item.status)}</li>)}</ol>
    </Dialog>}
  </>;
}

export function Orders({ state,selectedChannel,setSelectedChannel,refreshWorkspace,activityVersion,activityTarget }) {
  const {t}=useDisplayLocale();
  const channels=state.channels.filter((item)=>item.platform==='fb'&&item.permissions.includes('order:manage'));
  const channel=channels.find((item)=>item.id===selectedChannel)??channels.find((item)=>item.purpose==='sales')??channels[0];
  return <>
    <Title title={t('orders')} subtitle={t(state.memberRole==='OWNER'?'managedOrders':'staffOrders')}/>
    {channel?<><div className="toolbar"><label htmlFor="orders-page">{t('page')}</label>
      <select id="orders-page" value={channel.id} onChange={(event)=>setSelectedChannel(event.target.value)}>
        {channels.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select></div><OrderList key={channel.id+':'+state.memberRole+':'+channel.aiToolsEnabled} channel={channel} pendingVerifications={state.stats?.[channel.id]?.pending_verifications}
      refreshWorkspace={refreshWorkspace} activityVersion={activityVersion} activityTarget={activityTarget?.pageId===channel.id?activityTarget:null} owner={state.memberRole==='OWNER'}/></>:<Empty>{t('noOrderPage')}</Empty>}
  </>;
}

export function OrderOverview({ state,go,setSelectedChannel }) {
  const {t,intl}=useDisplayLocale();
  const [selected,setSelected]=useState('');
  const pages=state.channels.filter((item)=>item.purpose==='sales'&&item.permissions.includes('order:manage'));
  if(!pages.length||!state.orders)return null;
  const channel=pages.some((item)=>item.id===selected)?selected:'';
  const filtered=(rows)=>rows.filter((row)=>!channel||row.channel_id===channel);
  const counts=filtered(state.orders.counts);
  const sum=(rows,key)=>rows.reduce((total,row)=>total+row[key],0);
  const weekly=sum(counts,'count');
  const daily=sum(counts.filter((row)=>row.day===state.orders.today),'count');
  const conversion=filtered(state.orders.conversion);
  const bought=sum(conversion,'bought'), asked=sum(conversion,'asked'), automatic=sum(counts,'automatic');
  const agent=state.planFeatures?.agent_enabled===true;
  const rows=state.orders.days.map((date)=>{
    const day=Date.parse(date)/86_400_000;
    return {label:chartDate(date,intl), values:{orders:sum(counts.filter((row)=>row.day===day),'count')}};
  });
  return <div className="bot-section">
    <div className="toolbar"><label htmlFor="overview-order-page">{t('ordersByPage')}</label>
      <select id="overview-order-page" value={channel} onChange={(event)=>setSelected(event.target.value)}>
        <option value="">{t('allSalesPages')}</option>
        {pages.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <Button onClick={()=>{setSelectedChannel(channel);go('orders');}}>{t('viewOrders')}</Button>
    </div>
    <MetricGrid metrics={[
      [t('sevenDays'),weekly,t('orders'),'document'],
      [t('day'),daily,t('vietnamTime'),'document'],
      [t('conversion'),asked?Math.round(bought/asked*100)+'%':'—',bought+'/'+asked,'chat','mint'],
      ...(agent?[[t('botOrders'),weekly?Math.round(automatic/weekly*100)+'%':'—',automatic+'/'+weekly,'bot']]:[]),
    ]}/>
    <TimeChart key={channel} title={t('orderChart')} subtitle={t('sevenDays')+' · '+t('vietnamTime')}
      type="column" rows={rows} series={[{key:'orders',name:t('orderCount'),color:'primary'}]}/>
    <div className="analytics-grid stat-order-breakdown">
      <DonutChart title={t('conversion')} subtitle={t('inquiriesPerPage')}
        segments={[{label:t('bought'),value:bought},{label:t('notBought'),value:asked-bought}]}/>
      {agent&&<DonutChart title={t('botOrders')} subtitle={t('botRatio')}
        segments={[{label:'Bot',value:automatic},{label:t('staff'),value:weekly-automatic}]}/>}
    </div>
  </div>;
}
