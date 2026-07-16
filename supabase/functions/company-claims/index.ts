import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const IDENTITY_TYPES = ['domain', 'phone', 'name_city'];

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
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
    .select('id, organization_id, role')
    .eq('user_id', authData.user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (memberError || !member) throw new Error('Konto nie ma aktywnego dostępu.');

  return { admin, userId: authData.user.id, organizationId: member.organization_id as string, role: member.role as string };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Dozwolona jest tylko metoda POST.' }, 405);

  try {
    const { admin, userId, organizationId, role } = await authenticatedContext(request);
    const body = await request.json();
    const action = String(body?.action || '');

    if (action === 'list') {
      const { data, error } = await admin
        .from('company_claims')
        .select('identity_key, identity_type, company_name, claimed_by_user_id, claimed_by_name, updated_at')
        .eq('organization_id', organizationId);
      if (error) return json({ error: error.message }, 400);
      return json({ claims: data || [] });
    }

    if (action === 'claim') {
      const identityKey = cleanText(body?.identityKey, 300);
      const identityType = cleanText(body?.identityType, 30);
      const companyName = cleanText(body?.companyName, 300);
      const forUserId = body?.forUserId ? cleanText(body.forUserId, 100) : '';

      if (!identityKey || !IDENTITY_TYPES.includes(identityType)) return json({ error: 'Nieprawidłowa tożsamość firmy.' }, 400);
      if (!companyName) return json({ error: 'Brakuje nazwy firmy.' }, 400);

      let targetUserId = userId;
      if (forUserId && forUserId !== userId) {
        if (!['admin', 'manager'].includes(role)) {
          return json({ error: 'Tylko administrator lub manager może przypisać firmę innemu pracownikowi.' }, 403);
        }
        targetUserId = forUserId;
      }

      const { data: target, error: targetError } = await admin
        .from('organization_members')
        .select('full_name')
        .eq('user_id', targetUserId)
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .maybeSingle();
      if (targetError) return json({ error: targetError.message }, 400);
      if (!target) return json({ error: 'Nie znaleziono pracownika, dla którego ma być zapisane przypisanie.' }, 404);

      const { data: claim, error: upsertError } = await admin
        .from('company_claims')
        .upsert({
          organization_id: organizationId,
          identity_key: identityKey,
          identity_type: identityType,
          company_name: companyName,
          claimed_by_user_id: targetUserId,
          claimed_by_name: target.full_name || '',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,identity_key' })
        .select('identity_key, identity_type, company_name, claimed_by_user_id, claimed_by_name, updated_at')
        .single();
      if (upsertError) return json({ error: upsertError.message }, 400);
      return json({ claim });
    }

    if (action === 'release') {
      const identityKey = cleanText(body?.identityKey, 300);
      if (!identityKey) return json({ error: 'Brakuje tożsamości firmy.' }, 400);

      const { data: existing, error: existingError } = await admin
        .from('company_claims')
        .select('claimed_by_user_id')
        .eq('organization_id', organizationId)
        .eq('identity_key', identityKey)
        .maybeSingle();
      if (existingError) return json({ error: existingError.message }, 400);
      if (!existing) return json({ success: true });

      if (existing.claimed_by_user_id !== userId && !['admin', 'manager'].includes(role)) {
        return json({ error: 'Nie możesz zwolnić firmy przypisanej do innego pracownika.' }, 403);
      }

      const { error: deleteError } = await admin
        .from('company_claims')
        .delete()
        .eq('organization_id', organizationId)
        .eq('identity_key', identityKey);
      if (deleteError) return json({ error: deleteError.message }, 400);
      return json({ success: true });
    }

    return json({ error: 'Nieznana operacja.' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Błąd serwera.';
    const status = /Sesja|autoryzacji/.test(message) ? 401 : message.includes('aktywnego dostępu') ? 403 : 500;
    return json({ error: message }, status);
  }
});
