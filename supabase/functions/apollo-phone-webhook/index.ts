const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: corsHeaders });

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 250_000) return Response.json({ error: 'Payload too large.' }, { status: 413, headers: corsHeaders });
  try { await request.json(); } catch {}
  return Response.json({ received: true }, { headers: corsHeaders });
});
