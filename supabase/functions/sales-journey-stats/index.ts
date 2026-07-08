import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const legacyStages = [
  { id: 'cold_call', label: 'Cold call', group: 'new' },
  { id: 'small_audit', label: 'Mały audyt', group: 'new' },
  { id: 'offer_meeting', label: 'Spotkanie ofertowe', group: 'new' },
  { id: 'big_audit', label: 'Duży audyt', group: 'new' },
  { id: 'sale', label: 'Sprzedaż', group: 'new' },
  ...Array.from({ length: 12 }, (_, index) => ({ id: `month_${index + 1}`, label: `Mies. ${index + 1}`, group: 'client' })),
];

const stages = [
  { id: 'cold_call', label: 'Cold call', group: 'new' },
  { id: 'discovery', label: 'Discovery', group: 'new' },
  { id: 'analysis', label: 'Analiza ROI', group: 'new' },
  { id: 'offer', label: 'Oferta', group: 'new' },
  { id: 'negotiation', label: 'Negocjacje', group: 'new' },
  { id: 'sale', label: 'Umowa / zaliczka', group: 'new' },
  { id: 'delivery', label: 'Realizacja', group: 'new' },
  ...Array.from({ length: 12 }, (_, index) => ({ id: `month_${index + 1}`, label: `Mies. ${index + 1}`, group: 'client' })),
];

const stageAliases: Record<string, string> = {
  small_audit: 'discovery',
  offer_meeting: 'offer',
  big_audit: 'analysis',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function text(value: unknown, maxLength = 100) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function stageId(value: unknown) {
  const id = text(value);
  return stageAliases[id] || id;
}

function parseDate(value: unknown) {
  const timestamp = Date.parse(text(value, 50));
  return Number.isFinite(timestamp) ? timestamp : null;
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
      .select('organization_id, role, status')
      .eq('user_id', authData.user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (callerError || !caller || !['admin', 'manager'].includes(caller.role)) {
      return json({ error: 'Statystyki zbiorcze są dostępne wyłącznie dla administratora.' }, 403);
    }

    const { data: members, error: membersError } = await admin
      .from('organization_members')
      .select('user_id, role, permissions')
      .eq('organization_id', caller.organization_id)
      .eq('status', 'active')
      .not('user_id', 'is', null);
    if (membersError) throw membersError;
    const userIds = (members || [])
      .filter((member) => {
        const permissions = Array.isArray(member.permissions) ? member.permissions : [];
        return ['admin', 'manager', 'handlowiec'].includes(member.role)
          || permissions.includes('all')
          || permissions.includes('droga_sprzedazy');
      })
      .map((member) => member.user_id)
      .filter(Boolean);

    let rows: Array<{ value: unknown }> = [];
    if (userIds.length) {
      const { data, error } = await admin
        .from('user_app_data')
        .select('value')
        .eq('data_key', 'sales_journey')
        .in('user_id', userIds);
      if (error) throw error;
      rows = (data || []) as Array<{ value: unknown }>;
    }

    const metrics = Object.fromEntries(stages.map((stage) => [stage.id, {
      ...stage,
      entered: 0,
      progressed: 0,
      lost: 0,
      active: 0,
      completedDurationMs: 0,
      completedDurationCount: 0,
      lossReasons: {} as Record<string, number>,
    }]));
    let totalLeads = 0;
    let completedClients = 0;

    for (const row of rows) {
      const journey = row.value && typeof row.value === 'object' ? row.value as Record<string, unknown> : {};
      const leads = Array.isArray(journey.leads) ? journey.leads : [];
      for (const leadValue of leads) {
        const lead = leadValue && typeof leadValue === 'object' ? leadValue as Record<string, unknown> : {};
        totalLeads += 1;
        if (lead.status === 'completed') completedClients += 1;
        const history = Array.isArray(lead.stageHistory) ? lead.stageHistory : [];
        for (const eventValue of history) {
          const event = eventValue && typeof eventValue === 'object' ? eventValue as Record<string, unknown> : {};
          const id = stageId(event.stage);
          const metric = metrics[id];
          if (!metric) continue;
          metric.entered += 1;
          if (event.outcome === 'progressed') metric.progressed += 1;
          if (event.outcome === 'lost') {
            metric.lost += 1;
            const reason = text(event.lossReason) || 'Nie podano';
            metric.lossReasons[reason] = (metric.lossReasons[reason] || 0) + 1;
          }
          const enteredAt = parseDate(event.enteredAt);
          const exitedAt = parseDate(event.exitedAt);
          if (enteredAt !== null && exitedAt !== null && exitedAt >= enteredAt) {
            metric.completedDurationMs += exitedAt - enteredAt;
            metric.completedDurationCount += 1;
          }
        }
        if (lead.status === 'active') {
          const id = stageId(lead.currentStage);
          if (metrics[id]) metrics[id].active += 1;
        }
      }
    }

    const output = stages.map((stage) => {
      const metric = metrics[stage.id];
      const resolved = metric.progressed + metric.lost;
      const avgDays = metric.completedDurationCount
        ? Math.round((metric.completedDurationMs / metric.completedDurationCount / 86_400_000) * 10) / 10
        : null;
      return {
        id: stage.id,
        label: stage.label,
        group: stage.group,
        entered: metric.entered,
        progressed: metric.progressed,
        lost: metric.lost,
        active: metric.active,
        conversionRate: resolved ? Math.round((metric.progressed / resolved) * 1000) / 10 : null,
        dropOffRate: resolved ? Math.round((metric.lost / resolved) * 1000) / 10 : null,
        avgDays,
        lossReasons: Object.entries(metric.lossReasons)
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count),
      };
    });

    return json({
      stages: output,
      totalLeads,
      completedClients,
      activeUsers: userIds.length,
      includesCaller: userIds.includes(authData.user.id),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Błąd statystyk Drogi Sprzedaży.' }, 500);
  }
});
