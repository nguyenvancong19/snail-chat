import './globals.css';
import './stat-charts.css';
import './appearance.css';

export const metadata = {
  title: 'SnailChat — Quản lý tương tác',
  description: 'Quản lý bình luận, tin nhắn Facebook Page và thống kê bài đăng trên Facebook và Instagram.',
};

export default function RootLayout({ children }) {
  return <html lang="vi"><body>{children}</body></html>;
}
