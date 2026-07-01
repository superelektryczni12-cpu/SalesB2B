import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const allowedRoles = ['manager', 'koordynator', 'handlowiec', 'specjalista'];

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function findAuthUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return null;
  return (data.users || []).find((user) => user.email?.toLowerCase() === email) || null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = request.headers.get('Authorization');

    if (!supabaseUrl || !serviceRoleKey || !authorization) {
      return response({ error: 'Brak autoryzacji.' }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authorization.replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = await admin.auth.getUser(token);

    if (authError || !authData.user) {
      return response({ error: 'Sesja wygasła.' }, 401);
    }

    const { data: caller, error: callerError } = await admin
      .from('organization_members')
      .select('organization_id, role, status')
      .eq('user_id', authData.user.id)
      .eq('status', 'active')
      .single();

    if (callerError || !caller || !['admin', 'manager'].includes(caller.role)) {
      return response({ error: 'Tylko administrator może zarządzać kontami pracowników.' }, 403);
    }

    const body = await request.json();
    const action = String(body.action || '');
    const email = String(body.email || '').trim().toLowerCase();
    const fullName = String(body.fullName || '').trim();
    const role = String(body.role || 'handlowiec');
    const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
    const password = String(body.password || '');

    if (action === 'create') {
      if (!email || !fullName || password.length < 8 || !allowedRoles.includes(role)) {
        return response({ error: 'Podaj imię, e-mail, rolę i hasło mające co najmniej 8 znaków.' }, 400);
      }

      const { data: existing } = await admin
        .from('organization_members')
        .select('id, user_id, status')
        .eq('organization_id', caller.organization_id)
        .ilike('email', email)
        .maybeSingle();

      if (existing?.status === 'active') {
        return response({ error: 'Konto z tym adresem e-mail już istnieje.' }, 400);
      }

      const pendingQuery = existing
        ? admin.from('organization_members').update({
            full_name: fullName,
            role,
            permissions,
            status: 'pending',
            updated_at: new Date().toISOString(),
          }).eq('id', existing.id)
        : admin.from('organization_members').insert({
            organization_id: caller.organization_id,
            email,
            full_name: fullName,
            role,
            permissions,
            status: 'pending',
          });

      const { data: pending, error: pendingError } = await pendingQuery
        .select('id')
        .single();

      if (pendingError) {
        return response({ error: pendingError.message }, 400);
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

      let authUser = created?.user || null;
      if (createError || !authUser) {
        authUser = await findAuthUserByEmail(admin, email);
        if (!authUser) {
          if (!existing) await admin.from('organization_members').delete().eq('id', pending.id);
          return response({ error: createError?.message || 'Nie udało się utworzyć konta.' }, 400);
        }
      }

      const { data: linkedMember, error: linkedError } = await admin
        .from('organization_members')
        .select('id, organization_id, status')
        .eq('user_id', authUser.id)
        .neq('id', pending.id)
        .maybeSingle();

      if (linkedError) {
        return response({ error: linkedError.message }, 400);
      }
      if (linkedMember && linkedMember.organization_id !== caller.organization_id) {
        return response({ error: 'Ten adres e-mail jest już przypisany do innej organizacji.' }, 400);
      }

      const { error: authUpdateError } = await admin.auth.admin.updateUserById(authUser.id, {
        email,
        email_confirm: true,
        password,
        user_metadata: { full_name: fullName },
      });

      if (authUpdateError) {
        return response({ error: authUpdateError.message }, 400);
      }

      const { data: member, error: memberError } = await admin
        .from('organization_members')
        .update({
          user_id: authUser.id,
          email,
          full_name: fullName,
          role,
          permissions,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', pending.id)
        .select('id, user_id, email, full_name, role, permissions, status, created_at')
        .single();

      if (memberError) {
        return response({ error: memberError.message }, 400);
      }
      return response({ employee: member });
    }

    const memberId = String(body.id || '');
    const { data: target, error: targetError } = await admin
      .from('organization_members')
      .select('id, user_id, role')
      .eq('id', memberId)
      .eq('organization_id', caller.organization_id)
      .single();

    if (targetError || !target || target.role === 'admin') {
      return response({ error: 'Nie znaleziono pracownika lub konto jest chronione.' }, 404);
    }

    if (action === 'update') {
      if (!email || !fullName || !allowedRoles.includes(role)) {
        return response({ error: 'Nieprawidłowe dane pracownika.' }, 400);
      }

      if (target.user_id) {
        const authUpdate: {
          email: string;
          email_confirm: boolean;
          user_metadata: { full_name: string };
          password?: string;
        } = {
          email,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        };
        if (password) {
          if (password.length < 8) {
            return response({ error: 'Nowe hasło musi mieć co najmniej 8 znaków.' }, 400);
          }
          authUpdate.password = password;
        }
        const { error } = await admin.auth.admin.updateUserById(target.user_id, authUpdate);
        if (error) return response({ error: error.message }, 400);
      }

      const { data: member, error } = await admin
        .from('organization_members')
        .update({ email, full_name: fullName, role, permissions, updated_at: new Date().toISOString() })
        .eq('id', memberId)
        .select('id, user_id, email, full_name, role, permissions, status, created_at')
        .single();
      if (error) return response({ error: error.message }, 400);
      return response({ employee: member });
    }

    if (action === 'delete') {
      const { error: memberDeleteError } = await admin
        .from('organization_members')
        .delete()
        .eq('id', memberId);
      if (memberDeleteError) return response({ error: memberDeleteError.message }, 400);

      if (target.user_id) {
        const { error: userDeleteError } = await admin.auth.admin.deleteUser(target.user_id);
        if (userDeleteError) return response({ error: userDeleteError.message }, 400);
      }
      return response({ success: true });
    }

    return response({ error: 'Nieznana operacja.' }, 400);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : 'Błąd serwera.' }, 500);
  }
});
