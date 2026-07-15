import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function authenticatedContext(request: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!supabaseUrl || !serviceRoleKey || !authorization) throw new Error('Brak autoryzacji.');

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.replace(/^Bearer\s+/i, '');
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) throw new Error('Sesja wygasła.');
  const { data: member, error: memberError } = await admin
    .from('organization_members')
    .select('id')
    .eq('user_id', authData.user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (memberError || !member) throw new Error('Konto nie ma aktywnego dostępu.');
  return { admin, userId: authData.user.id };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Dozwolona jest tylko metoda POST.' }, 405);

  try {
    const { admin, userId } = await authenticatedContext(request);

    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) return json({ error: 'Brak konfiguracji GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.' }, 503);

    const body = await request.json();
    const code = String(body?.code || '').trim();
    const redirectUri = String(body?.redirectUri || '').trim();
    if (!code || !redirectUri) return json({ error: 'Brakuje kodu autoryzacji Google.' }, 400);

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) {
      return json({ error: tokenData.error_description || tokenData.error || 'Nie udało się wymienić kodu autoryzacji Google.' }, 400);
    }

    const accessToken = String(tokenData.access_token);
    const refreshToken = tokenData.refresh_token ? String(tokenData.refresh_token) : '';
    const expiresIn = Number(tokenData.expires_in) || 3600;
    const accessTokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userInfo = await userInfoResponse.json().catch(() => ({}));
    const email = String(userInfo.email || '').trim();
    if (!userInfoResponse.ok || !email) return json({ error: 'Nie udało się pobrać adresu e-mail z Google.' }, 400);

    const { data: existing } = await admin
      .from('gmail_accounts')
      .select('refresh_token')
      .eq('user_id', userId)
      .maybeSingle();

    const finalRefreshToken = refreshToken || existing?.refresh_token || '';
    if (!finalRefreshToken) {
      return json({ error: 'Google nie zwrócił tokena odświeżania. Spróbuj połączyć ponownie.' }, 400);
    }

    const { error: upsertError } = await admin
      .from('gmail_accounts')
      .upsert({
        user_id: userId,
        email,
        access_token: accessToken,
        refresh_token: finalRefreshToken,
        access_token_expires_at: accessTokenExpiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (upsertError) return json({ error: upsertError.message }, 400);

    return json({ connected: true, email });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Błąd łączenia z Gmail.';
    const status = /Sesja|autoryzacji/.test(message) ? 401 : message.includes('aktywnego dostępu') ? 403 : 500;
    return json({ error: message }, status);
  }
});
