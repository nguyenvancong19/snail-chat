'use client';

import { ListPagination, useListPage } from './list-pagination.jsx';

import { useEffect, useRef, useState } from 'react';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { api } from '../lib/workspace.js';
import { Dialog } from './forms.jsx';
import { Button, Field } from './ui.jsx';

export function PageDocuments({title,hint,accept,fieldLabel,files,choices,choose,upload,remove,loadPreview,renderPreview,describe,deleteNote,loadError}){
  const {copy}=useDisplayLocale();
  const picker=useRef(null);
  const [pending,setPending]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false),[detail,setDetail]=useState(null),[deleting,setDeleting]=useState(null);
  const [failedFile,setFailedFile]=useState(null);

  const list=useListPage([...(files??[])].sort((a,b)=>b.created-a.created||b.id.localeCompare(a.id)));
  function select(event){
    const items=Array.from(event.target.files??[]);
    event.target.value='';
    if(!items.length)return;
    setError('');setNotice('');setFailedFile(null);
    setPending(items.map((file,index)=>({file,value:choices?.[0][0]??'',key:index})));
  }
  async function submit(event){
    event.preventDefault();
    setBusy(true);setError('');setNotice('');setFailedFile(null);
    try{
      const items=[];
      for(const {file,value} of pending){
        try{items.push(await choose(file,value));}
        catch(problem){setFailedFile({name:file.name,row:problem.row});throw problem;}
      }
      await upload(items);
      setPending([]);
      setNotice('Đã lưu các tệp.');
    }catch(problem){setError(problem.message);}
    finally{setBusy(false);}
  }
  async function preview(file){
    setError('');setFailedFile(null);setBusy(true);
    try{setDetail({file,content:loadPreview?await loadPreview(file):null});}
    catch(problem){setError(problem.message);}
    finally{setBusy(false);}
  }
  return <section className="card bot-workspace-card">
    <h2>{copy(title)}</h2>
    <p className="bot-hint">{copy(hint)}</p>
    {loadError&&<p className="formerror" role="alert">{copy(loadError)}</p>}
    {error&&<p className="formerror" role="alert">{failedFile&&<><strong>{failedFile.name}</strong>{failedFile.row&&<> · {copy("Dòng")} {failedFile.row}</>} · </>}{copy(error)}</p>}
    {notice&&<p className="notice" role="status">{copy(notice)}</p>}
    <form onSubmit={submit}>
      <div className="action-row">
        <Button disabled={busy||!files} onClick={()=>picker.current?.click()}>{copy("Chọn nhiều tệp")}</Button>
        <input ref={picker} hidden type="file" accept={accept} multiple onChange={select}/>
      </div>
      {pending.map(({file,value,key})=><div className="bot-rule-summary" key={key}>
        <strong style={{overflowWrap:'anywhere'}}>{file.name}</strong>
        <Field label={copy(fieldLabel)}>
          {choices?<select value={value} disabled={busy} onChange={(event)=>{
            const next=event.target.value;
            setPending((items)=>items.map((item)=>item.key===key?{...item,value:next}:item));
          }}>{choices.map(([id,label])=><option key={id} value={id}>{copy(label)}</option>)}</select>:
          <input required maxLength={80} value={value} disabled={busy} onChange={(event)=>{
            const next=event.target.value;
            setPending((items)=>items.map((item)=>item.key===key?{...item,value:next}:item));
          }}/>}
        </Field>
        <Button disabled={busy} onClick={()=>setPending((items)=>items.filter((item)=>item.key!==key))}>{copy("Bỏ tệp đã chọn")}</Button>
      </div>)}
      {!!pending.length&&<div className="action-row">
        <Button type="submit" variant="primary" disabled={busy}>{busy?copy("Đang xử lý…"):copy("Lưu các tệp")}</Button>
      </div>}
    </form>
    {files&&<h3>{copy("Tệp đã lưu")}</h3>}
    {files?.length===0&&<p className="dim">{copy("Chưa có tệp nào.")}</p>}
    {list.items.map((file)=><div className="bot-rule-summary" key={file.id}>
      <div style={{minWidth:0}}><strong style={{overflowWrap:'anywhere'}}>{file.filename}</strong><small className="dim">{describe(file)}</small></div>
      <div className="faq-actions">
        <Button disabled={busy} onClick={()=>preview(file)}>{copy("Xem nội dung")}</Button>
        <Button disabled={busy} variant="danger" onClick={()=>setDeleting(file)}>{copy("Xóa")}</Button>
      </div>
    </div>)}
    <ListPagination {...list.pagination}/>
    {detail&&<Dialog title={copy("Nội dung tệp")} close={()=>setDetail(null)}>
      <p style={{overflowWrap:'anywhere'}}>{detail.file.filename} · {describe(detail.file)}</p>
      {renderPreview(detail.file,detail.content)}
    </Dialog>}
    {deleting&&<Dialog title={copy("Xóa tệp")} label={copy("Xóa")} close={()=>setDeleting(null)} submit={async()=>{
      await remove(deleting);
      setNotice('Đã xóa tệp.');
    }}>
      <p style={{overflowWrap:'anywhere'}}><strong>{deleting.filename}</strong></p>
      <p>{copy(typeof deleteNote==='function'?deleteNote(deleting):deleteNote)}</p>
    </Dialog>}
  </section>;
}

const agentPurposes=Object.entries({
  general:'Hướng dẫn chung',sales:'Tư vấn và bán hàng',policy:'Chính sách cửa hàng',
  support:'Chăm sóc sau bán',tone:'Phong cách giao tiếp',
});

export function AgentDocuments({channel,onFilesChange,hasLegacyGuide=false}){
  const {copy,intl}=useDisplayLocale();
  const [files,setFiles]=useState(null),[loadError,setLoadError]=useState('');
  const endpoint='bots/agent/documents';
  const query=endpoint+'?'+new URLSearchParams({channel:channel.id});
  useEffect(()=>{
    const controller=new AbortController();
    api(query,'GET',undefined,controller.signal).then((result)=>{
      if(controller.signal.aborted)return;
      setFiles(result.files);
      onFilesChange?.(result.files);
    }).catch((error)=>{
      if(!controller.signal.aborted)setLoadError(error.message);
    });
    return ()=>controller.abort();
  },[query,onFilesChange]);
  async function write(body){
    const result=await api(endpoint,'POST',{channel:channel.id,...body});
    setFiles(result.files);
    onFilesChange?.(result.files);
  }
  return <PageDocuments title="Tệp hướng dẫn Agent"
    hint="Tải lên tối đa 8 tệp Markdown hoặc TXT UTF-8. Mỗi tệp tối đa 8.000 ký tự, tổng cộng tối đa 24.000 ký tự. Chọn công việc cho từng tệp để Agent dùng đúng ngữ cảnh."
    accept=".md,.markdown,.txt" fieldLabel="Công việc của Agent" files={files} loadError={loadError} choices={agentPurposes}
    choose={async(file,purpose)=>{
      if(!/\.(md|markdown|txt)$/i.test(file.name))throw new Error('Chọn tệp Markdown (.md) hoặc văn bản (.txt).');
      if(file.size>32_000)throw new Error('Tệp hướng dẫn tối đa 8.000 ký tự.');
      let text;
      try{text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}
      catch{throw new Error('Tệp hướng dẫn cần dùng văn bản UTF-8 hợp lệ.');}
      const content=text.trim();
      if(!content)throw new Error('Tệp hướng dẫn không có nội dung.');
      if(content.length>8000)throw new Error('Tệp hướng dẫn tối đa 8.000 ký tự.');
      return {filename:file.name,purpose,content};
    }}
    upload={(items)=>write({items})} remove={(file)=>write({remove:file.id})}
    deleteNote={(file)=>hasLegacyGuide&&file.purpose==='general'&&files?.filter(({purpose})=>purpose==='general').length===1
      ?"Nếu xóa tệp Hướng dẫn chung cuối cùng, Agent sẽ quay lại dùng hướng dẫn cũ của Page."
      :"Agent sẽ ngừng dùng tài liệu này cho các phản hồi mới."}
    describe={(file)=><>{copy(agentPurposes.find(([id])=>id===file.purpose)?.[1])} · {file.characters.toLocaleString(intl)} {copy("ký tự")}</>}
    loadPreview={(file)=>api(query+'&'+new URLSearchParams({file:file.id}))}
    renderPreview={(_,document)=><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{document.content}</pre>}/>;
}
