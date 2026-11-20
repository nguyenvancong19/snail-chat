import { proxy } from '../../../lib/proxy.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function forward(request, { params }) {
  const { path } = await params;
  if (path.some((segment) => segment === '.' || segment === '..')) {
    return Response.json({ error: 'Đường dẫn không hợp lệ.' }, { status: 400 });
  }
  return proxy(request, '/api/' + path.map(encodeURIComponent).join('/'));
}

export { forward as GET, forward as HEAD, forward as POST, forward as PATCH, forward as DELETE };
