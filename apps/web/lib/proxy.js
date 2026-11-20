const hopByHop = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding',
  'upgrade', 'te', 'trailer', 'proxy-authenticate', 'proxy-authorization'];

function forwardable(source) {
  const headers = new Headers(source);
  for (const name of [...hopByHop, ...(headers.get('connection') ?? '').split(',')]) {
    if (name.trim()) headers.delete(name.trim());
  }
  return headers;
}

export async function proxy(request, pathname) {
  const base = new URL(process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000');
  // The downstream host is configured by the operator, never supplied by the browser.
  base.pathname = pathname;
  base.search = new URL(request.url).search;
  const headers = forwardable(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  headers.set('accept-encoding', 'identity');
  const method = request.method;
  try {
    const upstream = await fetch(base, {
      method, headers, redirect: 'manual', cache: 'no-store',
      body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
      duplex: 'half', signal: AbortSignal.any([request.signal,AbortSignal.timeout(120_000)]),
    });
    const outgoing = forwardable(upstream.headers);
    if (outgoing.has('content-encoding')) {
      outgoing.delete('content-encoding');
      outgoing.delete('content-length');
    }
    outgoing.delete('set-cookie');
    for (const cookie of upstream.headers.getSetCookie()) outgoing.append('set-cookie', cookie);
    return new Response(method === 'HEAD' ? null : upstream.body, {
      status: upstream.status, headers: outgoing,
    });
  } catch (error) {
    const timeout = error.name === 'TimeoutError';
    return Response.json({ error: timeout ? 'Máy chủ xử lý quá lâu.' : 'Không kết nối được máy chủ SnailChat.' },
      { status: timeout ? 504 : 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
