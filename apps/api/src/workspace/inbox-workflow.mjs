import { access, get, run, transaction } from '../db/store.mjs';
import { agentIncluded, requirePlanFeature } from '../billing/plan-features.mjs';
import { ensure, string } from '../http/validation.mjs';

export const agentTakeoverNote='Nhân viên đang tiếp quản hội thoại.';

export function agentCanAnswer(created,resumeAt,now=Date.now()) {
  return (resumeAt??0)<=now&&created>(resumeAt??0);
}

export async function setCommentHandled(user,id,handled) {
  ensure(typeof handled==='boolean',400,'Trạng thái xử lý không hợp lệ.');
  await requirePlanFeature(user.currentShop.id,'comments');
  const comment=ensure(await get(`SELECT m.channel_id FROM comments m JOIN channels c ON c.id=m.channel_id
    WHERE m.id=$1 AND c.shop_id=$2`,id,user.currentShop.id),404,'Không tìm thấy bình luận.');
  await access(user,comment.channel_id,'chat:reply');
  const updated=await get(`UPDATE comments SET handled_at=CASE WHEN $3::boolean THEN COALESCE(handled_at,$4) ELSE NULL END,
    private_ai_job=CASE WHEN $3 THEN NULL ELSE private_ai_job END
    WHERE id=$1 AND channel_id=$2 AND status='review' RETURNING handled_at`,
    id,comment.channel_id,handled,Date.now());
  return ensure(updated,409,'Trạng thái bình luận vừa thay đổi. Hãy tải lại và thử lại.');
}

export async function setConversationTakeover(user,body) {
  const channelId=string(body.channel,50,{required:true});
  const sender=string(body.sender,40,{required:true});
  const minutes=body.minutes;
  ensure(/^\d+$/.test(sender)&&[0,15,30,60,120].includes(minutes),400,'Thời gian tiếp quản hoặc hội thoại không hợp lệ.');
  const plan=await requirePlanFeature(user.currentShop.id,'messages');
  ensure(agentIncluded(plan),403,'Gói hiện tại không hỗ trợ Agent.');
  const channel=await access(user,channelId,'chat:reply');
  ensure(channel.platform==='fb'&&channel.messenger,409,'Kênh chưa bật Messenger.');

  return transaction(async()=>{
    const last=ensure(await get(`SELECT created FROM inbox_messages WHERE channel_id=$1 AND sender_id=$2
      ORDER BY created DESC LIMIT 1`,channel.id,sender),404,'Không tìm thấy hội thoại.');
    // The worker locks the same contact before starting an automatic send.
    await run(`INSERT INTO messenger_contacts(channel_id,sender_id,last_inbound)
      VALUES($1,$2,$3) ON CONFLICT (channel_id,sender_id) DO NOTHING`,channel.id,sender,last.created);
    const contact=await get(`SELECT agent_resume_at FROM messenger_contacts
      WHERE channel_id=$1 AND sender_id=$2 FOR UPDATE`,channel.id,sender);
    const now=Date.now();
    const resumeAt=minutes?now+minutes*60_000:Math.min(contact.agent_resume_at,now);
    if(resumeAt!==contact.agent_resume_at){
      await run(`UPDATE messenger_contacts SET agent_resume_at=$3
        WHERE channel_id=$1 AND sender_id=$2`,channel.id,sender,resumeAt);
    }
    if(minutes){
      await run(`UPDATE inbox_messages SET status='review',reply=NULL,automatic=0,automatic_ack=0,bot_category=$3
        WHERE channel_id=$1 AND sender_id=$2 AND status='queued' AND automatic=1`,channel.id,sender,agentTakeoverNote);
    }
    return {agentResumeAt:resumeAt};
  });
}
