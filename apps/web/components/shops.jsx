'use client';

import { ListPagination, useListPage } from './list-pagination.jsx';

import { useDisplayLocale } from '../lib/display-locale.jsx';

import { useEffect, useState } from 'react';
import { api, formatDate } from '../lib/workspace.js';
import { Dialog } from './forms.jsx';
import { Button, Chip, Empty, Field, MetricGrid, Title } from './ui.jsx';

const permissions=[['chat:read','Xem tin nhắn'],['chat:reply','Trả lời'],['order:manage','Xem đơn hàng']];
const statusLabels={ACTIVE:'Đang hoạt động',INVITED:'Chờ chấp nhận',SUSPENDED:'Tạm khóa'};

function PagePermissions({ channels, orders, initial=[] }) {
  const {copy}=useDisplayLocale();
  const [grants,setGrants]=useState(()=>Object.fromEntries(initial.map(({pageId,permissions})=>[pageId,permissions])));
  function toggle(id,permission,checked){
    setGrants((previous)=>{
      const next=new Set(previous[id]??[]);
      if(checked)next.add(permission);
      else next.delete(permission);
      if(permission==='chat:reply'&&checked)next.add('chat:read');
      if(permission==='chat:read'&&!checked)next.delete('chat:reply');
      return {...previous,[id]:[...next]};
    });
  }
  const pages=useListPage([...channels].sort((a,b)=>(b.createdAt??0)-(a.createdAt??0)));
  const value=channels.flatMap(({id})=>grants[id]?.length?[{pageId:id,permissions:grants[id]}]:[]);
  return <fieldset className="shop-page-permissions">
    <legend>{copy("Quyền theo Page")}</legend>
    <input type="hidden" name="grants" value={JSON.stringify(value)}/>
    {!channels.length&&<p className="dim">{copy("Shop chưa có Page để phân quyền.")}</p>}
    {pages.items.map((page)=><div className="shop-page-permission" key={page.id}>
      <strong>{page.name}</strong>
      <div>{permissions.filter(([key])=>key!=='order:manage'||orders).map(([key,label])=><label key={key}>
        <input type="checkbox" checked={grants[page.id]?.includes(key)??false}
          onChange={(event)=>toggle(page.id,key,event.target.checked)}/> {copy(label)}
      </label>)}</div>
    </div>)}
    <ListPagination {...pages.pagination}/>
  </fieldset>;
}

export function ShopMembers({ state }) {
  const {copy}=useDisplayLocale();
  const [items,setItems]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [dialog,setDialog]=useState(null),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    api('shop/members','GET',undefined,controller.signal).then(({items})=>{
      if(!controller.signal.aborted){setItems(items);setError('');}
    }).catch((error)=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[revision]);
  const members=useListPage(items??[]);
  const load=()=>setRevision((value)=>value+1);
  async function edit(form){
    const grants=JSON.parse(form.get('grants'));
    if(dialog.kind==='invite'){
      const {sent}=await api('shop/members','POST',{email:form.get('email'),grants});
      setNotice(sent?'Đã gửi lời mời.':'Đã lưu lời mời trong SnailChat. Email chưa được chuyển phát.');
    }else{
      await api('shop/members/'+encodeURIComponent(dialog.member.id),'PATCH',{grants});
      setNotice('Đã cập nhật quyền của nhân viên.');
    }
    load();
  }
  async function confirm(){
    const {member,kind}=dialog;
    const path='shop/members/'+encodeURIComponent(member.id);
    if(kind==='remove')await api(path,'DELETE');
    else await api(path,'PATCH',{status:member.status==='SUSPENDED'?'ACTIVE':'SUSPENDED'});
    load();
  }
  return <>
    <Title title={copy("Cài đặt nhân viên")} subtitle={copy("Mời thành viên và cấp quyền theo từng Page.")}
      action={<Button variant="primary" icon="user" onClick={()=>setDialog({kind:'invite'})}>{copy("Mời nhân viên")}</Button>}/>
    {error&&<p role="alert" className="notice">{copy(error)}</p>}
    {notice&&<p role="status" className="notice">{copy(notice)}</p>}
    {items&&<section className="card shop-table"><table>
      <thead><tr><th>{copy("Thành viên")}</th><th>{copy("Vai trò")}</th><th>{copy("Trạng thái")}</th><th>{copy("Page được gán")}</th><th>{copy("Thao tác")}</th></tr></thead>
      <tbody>{members.items.map((member)=><tr key={member.id}>
        <td><strong>{member.name}</strong><small className="dim">{member.email}</small></td>
        <td>{member.role==='OWNER'?copy("Chủ Shop"):copy("Nhân viên")}</td>
        <td><Chip status={member.status==='ACTIVE'?'replied':'review'}>{copy(statusLabels[member.status])}</Chip></td>
        <td>{member.role==='OWNER'?copy("Tất cả"):member.grants.length}</td>
        <td><div className="faq-actions">{member.role==='STAFF'&&<>
          {member.status!=='INVITED'&&<>
            <Button onClick={()=>setDialog({kind:'edit',member})}>{copy("Phân quyền")}</Button>
            <Button onClick={()=>setDialog({kind:'status',member})}>{member.status==='SUSPENDED'?copy("Mở khóa"):copy("Tạm khóa")}</Button>
          </>}
          <Button onClick={()=>setDialog({kind:'remove',member})}>{member.status==='INVITED'?copy("Hủy lời mời"):copy("Xóa")}</Button>
        </>}</div></td>
      </tr>)}</tbody>
    </table><ListPagination {...members.pagination}/></section>}
    {dialog&&['edit','invite'].includes(dialog.kind)&&<Dialog title={dialog.kind==='invite'?copy("Mời nhân viên"):copy("Phân quyền · ")+dialog.member.name}
      close={()=>setDialog(null)} submit={edit} label={dialog.kind==='invite'?copy("Gửi lời mời"):copy("Lưu quyền")}>
      {dialog.kind==='invite'&&<Field label={copy("Email nhân viên")}><input name="email" type="email" maxLength={254} required/></Field>}
      <PagePermissions channels={state.channels} orders={state.planFeatures?.order_management===true} initial={dialog.member?.grants}/>
    </Dialog>}
    {dialog&&['status','remove'].includes(dialog.kind)&&<Dialog title={dialog.kind==='remove'?copy("Xóa thành viên hoặc lời mời"):copy("Cập nhật trạng thái")}
      close={()=>setDialog(null)} submit={confirm} label={copy("Xác nhận")}>
      <p>{dialog.kind==='remove'?copy("Thu hồi quyền truy cập hoặc lời mời của"):dialog.member.status==='SUSPENDED'?copy("Mở khóa cho"):copy("Tạm khóa quyền truy cập của")} <strong>{dialog.member.email}</strong> {copy("trong Shop này?")}</p>
    </Dialog>}
  </>;
}

export function ShopInvitations({ state, onAcceptInvitation }){
  const {copy}=useDisplayLocale();
  const [pending,setPending]=useState(''),[error,setError]=useState('');
  const invitations=useListPage(state.invitations??[]);
  async function accept(id){
    setPending(id);setError('');
    try{
      const {shopId}=await api('shop/invitations/'+encodeURIComponent(id)+'/accept','POST',{});
      await onAcceptInvitation(shopId);
    }catch(error){setError(error.message);}
    finally{setPending('');}
  }
  return <>
    <Title title={copy("Lời mời tham gia Shop")} subtitle={copy("Chấp nhận lời mời bằng tài khoản nhận email.")}/>
    {error&&<p role="alert" className="notice">{copy(error)}</p>}
    {state.invitations?.length?<section className="card shop-invitations">
      {invitations.items.map(({id,name})=><div key={id}><strong>{name}</strong>
        <Button variant="primary" disabled={!!pending} onClick={()=>accept(id)}>{copy("Chấp nhận")}</Button></div>)}
      <ListPagination {...invitations.pagination}/>
    </section>:<Empty>{copy("Không có lời mời đang chờ.")}</Empty>}
  </>;
}

export function AdminShops(){
  const {intl,copy}=useDisplayLocale();
  const [renameOpen,setRenameOpen]=useState(false);
  const [page,setPage]=useState(1),[search,setSearch]=useState(''),[revision,setRevision]=useState(0);
  const [data,setData]=useState(null),[error,setError]=useState(''),[selected,setSelected]=useState(null),[subscription,setSubscription]=useState(null),[planCode,setPlanCode]=useState('FREE');
  useEffect(()=>{
    const controller=new AbortController();
    api('admin/shops?'+new URLSearchParams({page,q:search.trim()}),'GET',undefined,controller.signal).then((data)=>{
      if(!controller.signal.aborted)setData(data);
    }).catch((error)=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[page,search,revision]);
  async function update(){
    const status=selected.status==='ACTIVE'?'SUSPENDED':'ACTIVE';
    const updated=await api('admin/shops/'+encodeURIComponent(selected.id)+'/status','PATCH',{status},undefined,selected.version);
    setData((previous)=>({...previous,shops:previous.shops.map((row)=>row.id===selected.id?{...row,...updated}:row)}));
  }
  const totals=data?.totals;
  async function changeSubscription(form) {
    const result=await api('admin/shops/'+encodeURIComponent(subscription.id)+'/subscription','PATCH',{
      plan:planCode,days:planCode==='FREE'?null:Number(form.get('days')),
    },undefined,subscription.version);
    setData((previous)=>({...previous,shops:previous.shops.map((row)=>row.id===subscription.id?{...row,...result}:row)}));
  }
  return <>
    <Title title={copy("Quản lý Shop")} subtitle={copy("Theo dõi gói thuê và trạng thái hoạt động của từng Shop.")}
      action={<div className="rowactions">{data?.rename&&<Button icon="settings" onClick={()=>setRenameOpen(data.rename)}>{copy("Giới hạn đổi tên")}</Button>}
        <Button onClick={()=>setRevision(value=>value+1)}>{copy('Tải lại')}</Button></div>}/>
    {error&&<p role="alert" className="notice">{copy(error)}</p>}
    {totals&&<MetricGrid metrics={[
      [copy("Tổng số Shop"),totals.shops,null,'grid'],[copy("Tổng số Page"),totals.pages,null,'channels'],[copy("Tổng số tin nhắn"),totals.messages,null,'chat'],
    ]}/>}
    <div className="toolbar"><input aria-label={copy('Tìm Shop')} value={search} maxLength={150}
      placeholder={copy('Tìm theo tên Shop hoặc email…')} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></div>
    {data&&<section className="card shop-table"><table>
      <thead><tr><th>Shop</th><th>Page</th><th>{copy("Nhân viên")}</th><th>{copy("Gói thuê")}</th><th>{copy("Ngày hết hạn")}</th><th>{copy("Trạng thái")}</th><th>{copy("Thao tác")}</th></tr></thead>
      <tbody>{!data.shops.length&&<tr><td colSpan={7}><Empty>{copy("Không tìm thấy Shop phù hợp.")}</Empty></td></tr>}{data.shops.map((shop)=><tr key={shop.id}>
        <td><strong>{shop.name}</strong><small className="dim">{shop.ownerEmail}</small></td>
        <td>{shop.pageCount}</td><td>{shop.staffCount}</td><td>{data.plans.find(({code})=>code===shop.subscriptionPlan)?.name??shop.subscriptionPlan}</td>
        <td>{shop.expiredAt===null?copy("Không thời hạn"):formatDate(shop.expiredAt,intl)}</td>
        <td><Chip status={shop.status==='ACTIVE'?'replied':'review'}>{shop.status==='ACTIVE'&&shop.expiredAt!==null&&shop.expiredAt<=Date.now()?copy("Hết hạn"):statusLabels[shop.status]}</Chip></td>
        <td><div className="rowactions">
          <Button onClick={()=>{setPlanCode(data.plans.some((plan)=>plan.code===shop.subscriptionPlan&&!plan.archived_at)?shop.subscriptionPlan:'');setSubscription(shop);}}>{copy("Đổi gói")}</Button>
          <Button onClick={()=>setSelected(shop)}>{shop.status==='ACTIVE'?copy("Khóa Shop"):copy("Mở khóa Shop")}</Button>
        </div></td>
      </tr>)}</tbody>
    </table>{data.shopsPage&&<ListPagination {...data.shopsPage} onChange={setPage}/>}</section>}
    {renameOpen&&<Dialog title={copy("Giới hạn đổi tên Shop")} close={()=>setRenameOpen(false)} submit={async(form)=>{
      const rename=await api('admin/shops/rename-settings','PATCH',{cooldownDays:Number(form.get('cooldownDays'))},undefined,renameOpen.version);
      setData((previous)=>({...previous,rename}));
    }}>
      <Field label={copy("Số ngày tối thiểu giữa hai lần đổi tên")}><input type="number" name="cooldownDays" min={0} max={365}
        step={1} defaultValue={renameOpen.cooldownDays} required/></Field>
      <p className="dim">{copy("Áp dụng cho tất cả Shop, tính từ lần đổi tên gần nhất. Nhập 0 để bỏ thời gian chờ.")}</p>
    </Dialog>}
    {subscription&&<Dialog title={copy("Đổi gói · ")+subscription.name} close={()=>setSubscription(null)} submit={changeSubscription} label={copy("Áp dụng")}>
      <Field label={copy("Gói áp dụng")}><select required value={planCode} onChange={(event)=>setPlanCode(event.target.value)}>
        <option value="" disabled>{copy("Chọn gói áp dụng")}</option>
        {data.plans.filter((plan)=>!plan.archived_at).map((plan)=><option key={plan.code} value={plan.code}>{plan.code==='FREE'?copy("Miễn phí · Hủy gói thuê"):plan.name}</option>)}
      </select></Field>
      {planCode&&planCode!=='FREE'&&<Field label={planCode===subscription.subscriptionPlan?copy("Số ngày gia hạn"):copy("Số ngày của kỳ mới")}>
        <input key={planCode} type="number" name="days" min={1} max={365} required defaultValue={data.plans.find(({code})=>code===planCode)?.duration_days}/>
      </Field>}
      <p className="notice">{copy("Áp dụng ngay. Mã QR chờ thanh toán sẽ bị hủy. Đơn đổi gói đã trả tiền đang chờ hiệu lực sẽ chuyển sang đối soát.")}</p>
    </Dialog>}
    {selected&&<Dialog title={selected.status==='ACTIVE'?copy("Khóa Shop"):copy("Mở khóa Shop")}
      close={()=>setSelected(null)} submit={update} label={copy("Xác nhận")}>
      <p>{selected.status==='ACTIVE'?copy("Tạm dừng truy cập và xử lý sự kiện cho"):copy("Khôi phục quyền truy cập của")} <strong>{selected.name}</strong>.</p>
    </Dialog>}
  </>;
}
