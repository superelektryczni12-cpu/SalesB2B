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

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function customVariable(value: unknown, maxLength: number) {
  return cleanText(value, maxLength);
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
      .select('id')
      .eq('user_id', authData.user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (memberError || !member) return json({ error: 'Konto nie ma aktywnego dostępu.' }, 403);

    const instantlyKey = Deno.env.get('INSTANTLY_API_KEY');
    if (!instantlyKey) return json({ error: 'Brak sekretu INSTANTLY_API_KEY w funkcji instantly-push.' }, 503);

    const body = await request.json();
    const campaignId = cleanText(body?.campaignId, 100);
    const lead = body?.lead && typeof body.lead === 'object' ? body.lead as Record<string, unknown> : {};
    const email = cleanText(lead.email, 300);
    if (!campaignId) return json({ error: 'Brakuje campaignId. Ustaw ID kampanii Instantly w zakładce Cold Mailing.' }, 400);
    if (!email) return json({ error: 'Brakuje adresu e-mail leada.' }, 400);

    const rawVariables = body?.customVariables && typeof body.customVariables === 'object'
      ? body.customVariables as Record<string, unknown>
      : {};
    const customVariables = Object.fromEntries(
      ['subject1', 'body1', 'subject2', 'body2', 'subject3', 'body3']
        .map((key) => [key, customVariable(rawVariables[key], 6000)])
    );

    const instantlyBody = {
      campaign: campaignId,
      email,
      first_name: cleanText(lead.firstName, 100),
      last_name: cleanText(lead.lastName, 100),
      company_name: cleanText(lead.companyName, 200),
      job_title: cleanText(lead.jobTitle, 150),
      skip_if_in_campaign: true,
      custom_variables: customVariables,
    };

    const response = await fetch('https://api.instantly.ai/api/v2/leads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${instantlyKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(instantlyBody),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = cleanText(payload?.message || payload?.error, 500) || `Błąd Instantly (${response.status}).`;
      return json({ error: message }, 502);
    }

    return json({ success: true, instantlyLeadId: cleanText(payload?.id, 200) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Błąd wysyłki do Instantly.';
    return json({ error: message }, 500);
  }
});
