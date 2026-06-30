const { app } = require('electron');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'supabase-config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function isConfigured(config) {
  return Boolean(
    config.url &&
    config.anonKey &&
    !config.url.includes('TWOJ-PROJEKT') &&
    !config.anonKey.includes('WSTAW_TUTAJ')
  );
}

class FileAuthStorage {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'supabase-session.json');
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  getItem(key) {
    return this.read()[key] ?? null;
  }

  setItem(key, value) {
    const data = this.read();
    data[key] = value;
    fs.writeFileSync(this.file, JSON.stringify(data), 'utf8');
  }

  removeItem(key) {
    const data = this.read();
    delete data[key];
    fs.writeFileSync(this.file, JSON.stringify(data), 'utf8');
  }
}

let client;
const APP_DATA_KEYS = new Set([
  'settings', 'clients', 'projects', 'events', 'quotes', 'transactions',
  'companies', 'manual_meetings', 'bookings', 'sales_journey', 'seeded',
]);

function getClient() {
  const config = readConfig();
  if (!isConfigured(config)) {
    throw new Error('Supabase nie jest skonfigurowany. Uzupełnij plik supabase-config.json.');
  }
  if (!client) {
    client = createClient(config.url, config.anonKey, {
      auth: {
        storage: new FileAuthStorage(),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

function backendStatus() {
  const configured = isConfigured(readConfig());
  return {
    configured,
    message: configured
      ? 'Połączono z bazą kont.'
      : 'Najpierw uzupełnij supabase-config.json danymi projektu Supabase.',
  };
}

async function getContext(supabase, user) {
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, organization_id, user_id, email, full_name, role, permissions, status, organizations(name)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('To konto nie ma aktywnego dostępu do organizacji.');

  return {
    id: user.id,
    memberId: data.id,
    organizationId: data.organization_id,
    organizationName: data.organizations?.name || '',
    email: data.email || user.email,
    name: data.full_name || user.user_metadata?.full_name || user.email,
    role: data.role,
    permissions: data.permissions || [],
  };
}

async function restoreSession() {
  const status = backendStatus();
  if (!status.configured) return { user: null, ...status };
  const supabase = getClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.user) return { user: null, configured: true };
  return { user: await getContext(supabase, data.session.user), configured: true };
}

async function signIn(email, password) {
  const supabase = getClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { user: await getContext(supabase, data.user) };
}

async function signUp({ email, password, fullName, companyName }) {
  const supabase = getClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        company_name: companyName,
      },
    },
  });
  if (error) throw error;
  if (!data.session) {
    return { requiresConfirmation: true };
  }
  return { user: await getContext(supabase, data.user), requiresConfirmation: false };
}

async function signOut() {
  if (!backendStatus().configured) return true;
  const { error } = await getClient().auth.signOut();
  if (error) throw error;
  return true;
}

async function currentContext() {
  const supabase = getClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  return getContext(supabase, data.user);
}

async function currentUser() {
  const supabase = getClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  return data.user;
}

async function functionErrorMessage(error) {
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const body = await error.context.json();
      if (body?.error) return body.error;
    }
  } catch {}
  return error?.message || 'Błąd funkcji serwerowej.';
}

async function invokeEmployeeFunction(body) {
  const { data, error } = await getClient().functions.invoke('bright-processor', { body });
  if (error) throw new Error(await functionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

async function generateSalesAI(action, payload) {
  await currentUser();
  const body = {
    action,
    company: payload?.company || {},
    seller: payload?.seller || {},
    note: payload?.note || '',
  };
  const { data, error } = await getClient().functions.invoke('sales-ai', { body });
  if (error) throw new Error(await functionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

async function apolloContacts(action, payload) {
  await currentUser();
  const body = payload && typeof payload === 'object' ? { ...payload, action } : { action };
  const { data, error } = await getClient().functions.invoke('apollo-contacts', {
    body,
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

async function getSalesJourneyStats() {
  await currentUser();
  const { data, error } = await getClient().functions.invoke('sales-journey-stats', { body: {} });
  if (error) throw new Error(await functionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

async function listEmployees() {
  const supabase = getClient();
  const context = await currentContext();
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, user_id, email, full_name, role, permissions, status, created_at')
    .eq('organization_id', context.organizationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function saveEmployee(employee) {
  const result = await invokeEmployeeFunction({
    action: employee.id ? 'update' : 'create',
    ...employee,
  });
  return result.employee;
}

async function deleteEmployee(id) {
  const context = await currentContext();
  if (id === context.memberId) throw new Error('Nie możesz usunąć własnego konta.');
  await invokeEmployeeFunction({ action: 'delete', id });
  return true;
}

async function loadUserData() {
  const supabase = getClient();
  const user = await currentUser();
  const { data, error } = await supabase
    .from('user_app_data')
    .select('data_key, value')
    .eq('user_id', user.id);
  if (error) throw error;
  return Object.fromEntries((data || []).map(row => [row.data_key, row.value]));
}

async function saveUserData(dataKey, value) {
  const supabase = getClient();
  const user = await currentUser();
  const { error } = await supabase
    .from('user_app_data')
    .upsert({
      user_id: user.id,
      data_key: dataKey,
      value,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,data_key' });
  if (error) throw error;
  return true;
}

async function loadTeamData() {
  const supabase = getClient();
  const context = await currentContext();
  if (!['admin', 'manager'].includes(context.role)) throw new Error('Brak dostępu do paneli zespołu.');

  const { data: members, error: membersError } = await supabase
    .from('organization_members')
    .select('id, user_id, email, full_name, role, permissions, status')
    .eq('organization_id', context.organizationId)
    .eq('status', 'active')
    .not('user_id', 'is', null)
    .order('created_at', { ascending: true });
  if (membersError) throw membersError;

  const userIds = (members || []).map(member => member.user_id).filter(Boolean);
  let rows = [];
  if (userIds.length) {
    const { data, error } = await supabase
      .from('user_app_data')
      .select('user_id, data_key, value')
      .in('user_id', userIds);
    if (error) throw error;
    rows = data || [];
  }

  return (members || []).map(member => ({
    memberId: member.id,
    userId: member.user_id,
    email: member.email,
    name: member.full_name || member.email,
    role: member.role,
    permissions: member.permissions || [],
    data: Object.fromEntries(rows.filter(row => row.user_id === member.user_id).map(row => [row.data_key, row.value])),
  }));
}

async function saveTeamUserData(userId, dataKey, value) {
  if (!APP_DATA_KEYS.has(dataKey)) throw new Error('Nieobsługiwany typ danych aplikacji.');
  const supabase = getClient();
  const context = await currentContext();
  if (!['admin', 'manager'].includes(context.role)) throw new Error('Brak dostępu do paneli zespołu.');

  const { data: target, error: targetError } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', context.organizationId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error('Wybrane konto nie należy do tej organizacji.');

  const { error } = await supabase
    .from('user_app_data')
    .upsert({ user_id: userId, data_key: dataKey, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,data_key' });
  if (error) throw error;
  return true;
}

async function getBookings() {
  const data = await loadUserData();
  return Array.isArray(data.bookings) ? data.bookings : [];
}

async function addBooking(booking) {
  const bookings = await getBookings();
  bookings.unshift(booking);
  await saveUserData('bookings', bookings);
  return booking;
}

async function updateBookingStatus(id, status) {
  const bookings = await getBookings();
  const booking = bookings.find(item => item.id === id);
  if (booking) {
    booking.status = status;
    await saveUserData('bookings', bookings);
  }
  return true;
}

async function assignBooking(id, assignedTo) {
  const bookings = await getBookings();
  const booking = bookings.find(item => item.id === id);
  if (booking) {
    booking.assignedTo = assignedTo || null;
    await saveUserData('bookings', bookings);
  }
  return true;
}

module.exports = {
  backendStatus,
  restoreSession,
  signIn,
  signUp,
  signOut,
  listEmployees,
  saveEmployee,
  deleteEmployee,
  loadUserData,
  saveUserData,
  loadTeamData,
  saveTeamUserData,
  generateSalesAI,
  apolloContacts,
  getSalesJourneyStats,
  getBookings,
  addBooking,
  updateBookingStatus,
  assignBooking,
};
