export const inboxWorkflowSchema=`
  ALTER TABLE comments ADD COLUMN handled_at BIGINT;
  ALTER TABLE messenger_contacts ADD COLUMN agent_resume_at BIGINT NOT NULL DEFAULT 0;

  CREATE TRIGGER snailchat_page_activity AFTER UPDATE OF agent_resume_at ON messenger_contacts
    FOR EACH ROW WHEN (OLD.agent_resume_at IS DISTINCT FROM NEW.agent_resume_at)
    EXECUTE FUNCTION notify_snailchat_page_activity();
`;
