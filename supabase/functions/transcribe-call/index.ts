import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'sales-b2b-call-recordings';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Dozwolona jest tylko metoda POST.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = request.headers.get('Authorization');
    if (!supabaseUrl || !serviceRoleKey || !authorization) return json({ error: 'Brak autoryzacji.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authorization.replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: 'Sesja wygasła.' }, 401);

    const { data: member, error: memberError } = await admin
      .from('organization_members')
      .select('id, organization_id')
      .eq('user_id', authData.user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (memberError || !member) return json({ error: 'Konto nie ma aktywnego dostępu.' }, 403);

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return json({ error: 'Brak sekretu OPENAI_API_KEY w funkcji transcribe-call.' }, 503);

    const body = await request.json();
    const path = cleanText(body?.path, 500);
    if (!path) return json({ error: 'Brakuje ścieżki do nagrania.' }, 400);
    if (!path.startsWith(`${member.organization_id}/`)) return json({ error: 'Brak dostępu do tego pliku.' }, 403);

    const { data: file, error: downloadError } = await admin.storage.from(BUCKET).download(path);
    if (downloadError || !file) return json({ error: 'Nie udało się pobrać nagrania ze Storage.' }, 404);

    const form = new FormData();
    form.append('file', file, path.split('/').pop() || 'recording.m4a');
    form.append('model', 'whisper-1');
    form.append('language', 'pl');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json();
    if (!response.ok) {
      const message = cleanText(payload?.error?.message, 600) || `Błąd transkrypcji (${response.status}).`;
      throw new Error(message);
    }

    const transcript = cleanText(payload?.text, 30000);
    return json({ transcript });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Błąd transkrypcji nagrania.';
    return json({ error: message }, message.includes('OPENAI_API_KEY') ? 503 : 500);
  }
});
