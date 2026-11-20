import { all, get, run, transaction, uid } from '../db/store.mjs';
import { choicesOf, ensure, string } from '../http/validation.mjs';

const purposes=['general','sales','policy','support','tone'];

export function agentDocuments(channelId, includeContent=false) {
  const columns=includeContent?'id,filename,purpose,content,created':'id,filename,purpose,created,char_length(content) AS characters';
  return all(`SELECT ${columns} FROM agent_documents WHERE channel_id=$1 ORDER BY created,id`,channelId);
}

export async function changeAgentDocuments(channelId, body) {
  const items=body.remove?null:body.items;
  if(items!==null)ensure(Array.isArray(items)&&items.length>0&&items.length<=8,400,'Chọn từ 1 đến 8 tệp hướng dẫn.');
  const documents=items?.map((item)=>{
    const filename=string(item?.filename,180,{required:true});
    ensure(/\.(md|markdown|txt)$/i.test(filename),400,'Chọn tệp Markdown (.md) hoặc văn bản (.txt).');
    const content=string(item.content,8000,{required:true});
    ensure(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/u.test(content),400,'Tệp hướng dẫn cần dùng văn bản UTF-8 hợp lệ.');
    return {filename,purpose:choicesOf(item.purpose,purposes),content};
  });
  return transaction(async()=>{
    ensure(await get('SELECT id FROM channels WHERE id=$1 FOR UPDATE',channelId),404,'Không tìm thấy Page.');
    if(body.remove){
      const result=await run('DELETE FROM agent_documents WHERE channel_id=$1 AND id=$2',channelId,string(body.remove,50,{required:true}));
      ensure(result.changes,404,'Không tìm thấy tệp.');
    }else{
      const {count,characters}=await get('SELECT count(*) AS count,COALESCE(sum(char_length(content)),0) AS characters FROM agent_documents WHERE channel_id=$1',channelId);
      ensure(count+documents.length<=8,400,'Mỗi Page lưu tối đa 8 tệp hướng dẫn.');
      ensure(characters+documents.reduce((sum,item)=>sum+item.content.length,0)<=24_000,400,'Tổng nội dung các tệp hướng dẫn tối đa 24.000 ký tự.');
      for(const item of documents){
        await run('INSERT INTO agent_documents(channel_id,id,filename,purpose,content,created) VALUES($1,$2,$3,$4,$5,$6)',
          channelId,uid(),item.filename,item.purpose,item.content,Date.now());
      }
    }
    await markAgentKnowledgeChanged(channelId);
  });
}

export function agentDocument(channelId,id) {
  return get('SELECT id,filename,purpose,content FROM agent_documents WHERE channel_id=$1 AND id=$2',channelId,id);
}

// Queued Agent replies compare the policy snapshot before sending.
export function markAgentKnowledgeChanged(channelId) {
  return run(`UPDATE channels SET message_bot_policy=jsonb_set(message_bot_policy,'{trainingRevision}',to_jsonb($2::text))
    WHERE id=$1 AND message_bot_policy->>'unifiedAgent'='true'`,channelId,uid());
}
