'use client';

import { ListPagination, useListPage } from './list-pagination.jsx';

import { useDisplayLocale } from '../lib/display-locale.jsx';

import { useEffect, useState } from 'react';
import { catalogColumns, catalogProducts, csvProducts } from '../lib/catalog-import.js';
import { api } from '../lib/workspace.js';
import { Dialog } from './forms.jsx';
import { PageDocuments } from './page-documents.jsx';
import { Button, Empty, Field } from './ui.jsx';

const purposes={sales:'Bán hàng',news:'Tin tức',entertainment:'Giải trí'};
export function CatalogPage({ channel }) {
  const {copy,intl}=useDisplayLocale();
  const ai=channel.aiToolsEnabled===true;
  const [data,setData]=useState(null), [edit,setEdit]=useState(null), [error,setError]=useState('');
  const [busy,setBusy]=useState(false), [notice,setNotice]=useState('');
  const path='catalog?'+new URLSearchParams({channel:channel.id});
  useEffect(()=>{
    const controller=new AbortController();
    api(path,'GET',undefined,controller.signal).then(setData).catch((problem)=>{
      if(!controller.signal.aborted)setError(problem.message);
    });
    return ()=>controller.abort();
  },[path]);
  async function write(pathname,payload) {
    await api('catalog/'+pathname,'POST',{...payload,channel:channel.id});
    setData(await api(path));
    setNotice('Đã lưu.');
  }
  async function saveSettings(event) {
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try {await write('settings',{purpose:data.purpose,...(ai?{knowledge:data.knowledge??'',mode:data.purpose==='sales'?data.mode??'off':'off'}:{})});}
    catch(problem){setError(problem.message);}
    finally{setBusy(false);}
  }
  async function writeFiles(payload){
    const result=await api('catalog/files','POST',{channel:channel.id,...payload});
    setData((current)=>({...current,products:result.products,files:result.files}));
  }
  const money=new Intl.NumberFormat(intl,{style:'currency',currency:'VND'});
  const itemsOf=(file)=>data.products.filter((product)=>product.source_file_id===file.id);
  const update=(key,value)=>setData((current)=>({...current,[key]:value}));
  const products=useListPage(data?.products??[]);
  return <>
    {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    {notice&&<p className="notice" role="status">{copy(notice)}</p>}
    {data&&<>
      <section className="card bot-workspace-card"><h2>{ai?copy("Thông tin Page dùng cho AI"):copy("Thiết lập danh mục Page")}</h2>
        <form onSubmit={saveSettings}>
          <Field label={copy("Mục đích của Page")}><select value={data.purpose} onChange={(event)=>{
            const purpose=event.target.value;
            setData({...data,purpose,mode:purpose==='sales'?data.mode:'off'});
          }}>{Object.entries(purposes).map(([key,label])=><option key={key} value={key}>{copy(label)}</option>)}</select></Field>
          {ai&&<Field label={copy("Thông tin, chủ đề và chính sách")}><textarea rows={4} maxLength={5000} value={data.knowledge??''}
            onChange={(event)=>update('knowledge',event.target.value)}/></Field>}
          {ai&&channel.platform==='fb'&&data.purpose==='sales'&&<>
            <Field label={copy("Tra giá và tồn kho theo ảnh Messenger")}>
              <select value={data.mode??'off'} onChange={(event)=>update('mode',event.target.value)}>
                <option value="off">{copy("Tắt")}</option><option value="review">{copy("Chờ duyệt")}</option><option value="auto">{copy("Tự gửi khi nhận diện rõ")}</option>
              </select></Field>
            <p className="bot-hint">{copy("Tra ảnh cần bật bot Messenger theo quy tắc. SnailChat đối chiếu trực tiếp với ảnh trong danh mục. Ảnh cần truy cập được qua HTTPS.")}</p>
          </>}
          <Button variant="primary" type="submit" disabled={busy}>{copy("Lưu thông tin Page")}</Button>
        </form>
      </section>
      {data.purpose==='sales'&&<>
      <PageDocuments title="Tệp danh mục sản phẩm"
        hint="Chọn nhiều tệp Excel hoặc CSV và ghi nhóm sản phẩm của từng tệp. Sản phẩm từ tất cả tệp được đưa vào danh mục Page để Agent tra cứu."
        files={data.files} accept=".xlsx,.csv" fieldLabel="Nhóm sản phẩm" choose={readCatalogFile}
        upload={(files)=>writeFiles({files})} remove={(file)=>writeFiles({remove:file.id})}
        deleteNote="Xóa tệp sẽ gỡ các sản phẩm thuộc tệp này khỏi danh mục và dữ liệu Agent tra cứu."
        describe={(file)=><>{file.category} · {itemsOf(file).length.toLocaleString(intl)} {copy("sản phẩm")}</>}
        renderPreview={(file)=>itemsOf(file).length?<ul>{itemsOf(file).map((product)=><li key={product.sku}>
          <strong>{product.sku} · {product.name}</strong><div>{money.format(product.price)} · {product.in_stock?copy("Còn hàng"):copy("Hết hàng")}</div>
          {product.description&&<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{product.description}</p>}
        </li>)}</ul>:<p>{copy("Tệp không còn sản phẩm trong danh mục.")}</p>}/>
      <section className="card bot-workspace-card"><h2>{copy("Danh mục sản phẩm")}</h2>
        <p className="dim">{copy("Mỗi Page lưu tối đa 12 tệp và 60 sản phẩm. Đặt tên cột ở hàng đầu tiên của trang tính đầu tiên. Mỗi mã sản phẩm chỉ được dùng một lần trên Page.")}{ai&&copy(" AI agent dùng các sản phẩm đã nhập vào danh mục của Page.")}</p>
        <p><code>{catalogColumns.join(',')}</code></p>
        <a className="button" download="danh-muc-san-pham.csv"
          href={'data:text/csv;charset=utf-8,'+encodeURIComponent('\uFEFF'+catalogColumns.join(',')+'\r\n')}>{copy("Tải CSV mẫu")}</a><p className="dim">{copy("Tồn hàng nhập 1 hoặc 0. Giá nhập số nguyên VNĐ.")}</p>
        <Button onClick={()=>setEdit({})} disabled={busy}>{copy("Thêm sản phẩm")}</Button>
        {products.items.map((product)=><div className="bot-rule-summary" key={product.sku}>
          <div><strong>{product.sku} · {product.name}</strong>
            <small className="dim">{money.format(product.price)} · {product.in_stock?copy("Còn hàng"):copy("Hết hàng")}</small></div>
          <div className="faq-actions"><Button onClick={()=>setEdit(product)}>{copy("Sửa")}</Button>
            <Button variant="danger" onClick={()=>setEdit({...product,remove:true})}>{copy("Xóa")}</Button></div>
        </div>)}
        <ListPagination {...products.pagination}/>
      </section></>}
    </>}
    {edit&&<Dialog title={edit.remove?copy("Xóa sản phẩm"):copy("Sản phẩm")} close={()=>setEdit(null)}
      label={edit.remove?copy("Xóa"):copy("Lưu")} submit={async(form)=>{
        if(edit.remove)return write('products',{remove:edit.sku});
        return write('products',{items:[{sku:edit.sku??form.get('sku'),name:form.get('name'),
          price:Number(form.get('price')),in_stock:form.get('stock')==='1',image_url:form.get('image'),description:form.get('description'),
          detail_images:[1,2,3].map((i)=>String(form.get('detail-'+i)).trim()).filter(Boolean)}]});
      }}>
      {edit.remove?<p>{edit.name}</p>:<>
        <Field label={copy("Mã sản phẩm")}><input name="sku" required defaultValue={edit.sku} readOnly={!!edit.sku} maxLength={50}/></Field>
        <Field label={copy("Tên sản phẩm")}><input name="name" required defaultValue={edit.name} maxLength={140}/></Field>
        <Field label={copy("Giá bán (VNĐ)")}><input name="price" required type="number" min="0" step="1" defaultValue={edit.price}/></Field>
        <Field label={copy("Tồn hàng")}><select name="stock" defaultValue={edit.in_stock===false?'0':'1'}><option value="1">{copy("Còn hàng")}</option><option value="0">{copy("Hết hàng")}</option></select></Field>
        <Field label={copy("Mô tả chi tiết sản phẩm")}><textarea name="description" rows={3} maxLength={700} defaultValue={edit.description}/></Field>
        {[1,2,3].map((i)=><Field key={i} label={copy("Ảnh chi tiết ")+i}><input name={'detail-'+i}
          defaultValue={edit.detail_images?.[i-1]} maxLength={32767} placeholder={copy("URL HTTPS hoặc data:image")}/></Field>)}
        <Field label={copy("URL ảnh công khai")}><input name="image" required type="url" defaultValue={edit.image_url}/></Field>
      </>}
    </Dialog>}
  </>;
}


async function readCatalogFile(file,category){
  if(!category.trim())throw new Error('Nhập nhóm sản phẩm của tệp.');
  const extension=file.name.split('.').at(-1).toLowerCase();
  if(!['xlsx','csv'].includes(extension))throw new Error('Chọn tệp .xlsx hoặc .csv.');
  if(file.size>256*1024)throw new Error('Tệp danh mục tối đa 256 KB.');
  let items;
  if(extension==='xlsx'){
    const {readSheet}=await import('read-excel-file/browser');
    let rows;
    try{rows=await readSheet(file,1);}
    catch{throw new Error('Không đọc được tệp Excel. Kiểm tra tệp .xlsx và trang tính đầu tiên.');}
    items=catalogProducts(rows);
  }else{
    let content;
    try{content=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}
    catch{throw new Error('Tệp CSV cần dùng mã hóa UTF-8.');}
    items=csvProducts(content);
  }
  return {filename:file.name,category,items};
}
