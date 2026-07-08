import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function text(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Dozwolona jest tylko metoda POST.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Brak konfiguracji serwera.' }, 500);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'Nieprawidlowe dane.' }, 400);

    const booking = {
      name: text(body.name, 200),
      company: text(body.company, 200),
      email: text(body.email, 200),
      phone: text(body.phone, 50),
      position: text(body.position, 200),
      problem: text(body.problem, 4000),
      booking_date: text(body.date, 10),
      booking_time: text(body.time, 5),
      booking_time_end: text(body.timeEnd, 5),
    };

    if (!booking.name || !booking.company || !booking.email || !booking.problem) {
      return json({ error: 'Uzupelnij wymagane pola.' }, 400);
    }
    if (!EMAIL_RE.test(booking.email)) return json({ error: 'Nieprawidlowy adres e-mail.' }, 400);
    if (!DATE_RE.test(booking.booking_date)) return json({ error: 'Nieprawidlowa data.' }, 400);
    if (!TIME_RE.test(booking.booking_time) || !TIME_RE.test(booking.booking_time_end)) {
      return json({ error: 'Nieprawidlowa godzina.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin
      .from('operio_bookings')
      .insert(booking)
      .select('id')
      .single();
    if (error) throw error;

    return json({ success: true, id: data.id });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Blad zapisu rezerwacji.' }, 500);
  }
});
