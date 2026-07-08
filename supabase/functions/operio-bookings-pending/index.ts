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

    const { data: caller, error: callerError } = await admin
      .from('organization_members')
      .select('id')
      .eq('user_id', authData.user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (callerError || !caller) return json({ error: 'Brak dostępu.' }, 403);

    const { data: pending, error: pendingError } = await admin
      .from('operio_bookings')
      .select('*')
      .is('imported_at', null)
      .order('created_at', { ascending: true })
      .limit(50);
    if (pendingError) throw pendingError;

    if (!pending || !pending.length) return json({ bookings: [] });

    const ids = pending.map((row) => row.id);
    const { error: updateError } = await admin
      .from('operio_bookings')
      .update({ imported_at: new Date().toISOString() })
      .in('id', ids);
    if (updateError) throw updateError;

    const bookings = pending.map((row) => ({
      id: row.id,
      name: row.name,
      company: row.company,
      email: row.email,
      phone: row.phone,
      position: row.position,
      problem: row.problem,
      date: row.booking_date,
      time: row.booking_time,
      timeEnd: row.booking_time_end,
      status: row.status,
      createdAt: row.created_at,
      source: 'operio_website',
    }));

    return json({ bookings });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Błąd pobierania rezerwacji.' }, 500);
  }
});
