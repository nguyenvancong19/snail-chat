import { createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { get, run, transaction } from '../db/store.mjs';
import { ensure } from '../http/validation.mjs';
import { origin } from '../meta/meta.mjs';
import { verificationEmail } from './verification-email-template.mjs';

const host = process.env.SMTP_HOST?.trim();
const user = process.env.SMTP_USER?.trim();
const from = process.env.SMTP_FROM?.trim();
const smtpPort = process.env.SMTP_PORT;
const configuredPassword = process.env.SMTP_PASS ?? '';
const compactPassword = configuredPassword.replace(/\s+/g, '');
const isGmail = host?.toLowerCase() === 'smtp.gmail.com';
const pass = isGmail && /^[a-z]{16}$/i.test(compactPassword)
  ? compactPassword : configuredPassword;
const port = Number(smtpPort || 587);
const localMail = process.env.SMTP_LOCAL_TEST === '1' && host === 'mailpit' &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
const secure = process.env.SMTP_SECURE === '1' || port === 465;
const transport = host && from && Number.isInteger(port) && port > 0 && port <= 65535 &&
  (!isGmail || user) && (!!user === !!pass) && nodemailer.createTransport({
    host, port, secure, requireTLS: !localMail && !secure, ignoreTLS: localMail,
    auth: user ? { user, pass } : undefined,
    dnsTimeout: 8000, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000,
  });
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function requireMail() {
  ensure(transport, 503, 'Dịch vụ gửi email chưa được cấu hình. Vui lòng thử lại sau.');
}

export function smtpErrorCode(error) {
  if (error?.status === 503) return 'SMTP_CONFIG';
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'SMTP_ERROR';
  return Number.isInteger(error?.responseCode) ? code + ' (SMTP ' + error.responseCode + ')' : code;
}

export async function checkSmtp() {
  requireMail();
  await transport.verify();
  return { host, port, mode: secure ? 'TLS' : localMail ? 'Mailpit' : 'STARTTLS' };
}

export async function sendVerification(userId, email) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const issued = await transaction(async () => {
    const user = await get('SELECT email,active,email_verified_at FROM users WHERE id=$1 FOR UPDATE', userId);
    if (!user?.active || user.email !== email || user.email_verified_at !== null) return false;
    await run('INSERT INTO email_verifications(token_hash,user_id,email,expires) VALUES($1,$2,$3,$4)',
      tokenHash, userId, email, Date.now() + 60 * 60_000);
    return true;
  });
  if (!issued) return false;

  const link = origin + '/verify-email#' + token;
  return deliverAccountEmail(email, verificationEmail(link), 'verification');
}

export async function deliverAccountEmail(email, message, purpose) {
  requireMail();
  try {
    const sender = /^[^\s<>@]+@[^\s<>@]+$/.test(from) ? { name: 'SnailChat', address: from } : from;
    const delivered = await transport.sendMail({ from: sender, to: { name: '', address: email }, ...message });
    if (delivered.accepted.length > 0) return true;
    console.error('SnailChat SMTP '+purpose+' delivery: ENVELOPE_REJECTED');
  } catch (error) {
    // SMTP may accept a message before a connection drops.
    console.error('SnailChat SMTP '+purpose+' delivery:', smtpErrorCode(error));
  }
  return false;
}

export async function verifyEmail(value) {
  ensure(typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value),
    400, 'Liên kết xác minh không hợp lệ hoặc đã hết hạn.');
  return transaction(async () => {
    const tokenHash = hashToken(value);
    const pending = await get('SELECT user_id FROM email_verifications WHERE token_hash=$1 AND expires>$2', tokenHash, Date.now());
    ensure(pending, 400, 'Liên kết xác minh không hợp lệ hoặc đã hết hạn.');
    // Lock the account first, in the same order as issuance and account edits.
    const user = await get('SELECT email,active,email_verified_at FROM users WHERE id=$1 FOR UPDATE', pending.user_id);
    const request = await get('SELECT email FROM email_verifications WHERE token_hash=$1 AND expires>$2', tokenHash, Date.now());
    ensure(user?.active && user.email_verified_at === null && request?.email === user.email,
      400, 'Liên kết xác minh không hợp lệ hoặc đã hết hạn.');
    await run('UPDATE users SET email_verified_at=$1 WHERE id=$2', Date.now(), pending.user_id);
    await run('DELETE FROM email_verifications WHERE user_id=$1', pending.user_id);
  });
}
