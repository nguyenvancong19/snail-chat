const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export function verificationEmail(link) {
  return accountLinkEmail(link, {
    title: 'Xác minh địa chỉ email',
    body: 'Tài khoản SnailChat của bạn đã được tạo. Hãy xác minh email để hoàn tất đăng ký và đăng nhập.',
    action: 'Xác minh email',
    lifetime: '1 giờ',
    ignore: 'Nếu bạn không yêu cầu tạo tài khoản, hãy bỏ qua thư này.',
  });
}

export function passwordResetEmail(link) {
  return accountLinkEmail(link, {
    title: 'Đặt lại mật khẩu',
    body: 'SnailChat đã nhận yêu cầu đặt lại mật khẩu. Hãy mở liên kết để tạo mật khẩu mới.',
    action: 'Đặt lại mật khẩu',
    lifetime: '30 phút',
    ignore: 'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua thư này.',
  });
}

function accountLinkEmail(link, { title, body, action, lifetime, ignore }) {
  const url = escapeHtml(link);
  const subject = 'SnailChat | ' + title;
  const text = ['Chào bạn,', body, link, 'Liên kết có hiệu lực trong ' + lifetime + '.', ignore,
    'Đội ngũ SnailChat'].join('\n\n');
  const html = `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} SnailChat</title></head>
<body style="margin:0;padding:0;background:#f4f0fa;color:#23183c;font-family:Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0fa">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e9e2f3;border-radius:16px">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #eee8f6;color:#23183c;font-size:22px;font-weight:bold">
          <span style="display:inline-block;padding:6px 8px;background:#784ed0;color:#ffffff;border-radius:8px;font-size:15px" aria-hidden="true">&#9654;</span>
          &nbsp;SnailChat
        </td></tr>
        <tr><td style="padding:28px;color:#23183c;font-size:16px;line-height:1.6">
          <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2">${title}</h1>
          <p style="margin:0 0 20px">${body}</p>
          <table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#673ab7" style="border-radius:8px">
            <a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#673ab7;color:#ffffff;text-decoration:none;font-weight:bold">${action}</a>
          </td></tr></table>
          <p style="margin:18px 0 12px;color:#564a68;font-size:14px">Liên kết có hiệu lực trong ${lifetime}.</p>
          <p style="margin:0;color:#564a68;font-size:13px">Nếu nút không mở được, hãy sao chép liên kết này vào trình duyệt.</p>
          <p style="margin:4px 0 0;font-size:13px;word-break:break-all"><a href="${url}" style="color:#54279a">${url}</a></p>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eee8f6;color:#564a68;font-size:13px;line-height:1.6">
          ${ignore}<br>Đội ngũ SnailChat
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}
