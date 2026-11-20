import { checkSmtp, smtpErrorCode } from './email-verification.mjs';

try {
  const { host, port, mode } = await checkSmtp();
  console.log(`SnailChat SMTP OK — ${host}:${port} (${mode})`);
} catch (error) {
  console.error('SnailChat SMTP:', smtpErrorCode(error));
  process.exitCode = 1;
}
