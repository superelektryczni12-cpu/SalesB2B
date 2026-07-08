const { app } = require('electron');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILE = path.join(__dirname, 'supabase-config.json');
const CHAT_BUCKET = 'sales-b2b-chat-files';

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
    .select('id, organization_id, user_id, email, full_name, role, permissions, status, manager_member_id, monthly_goals, organizations(name)')
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
    managerMemberId: data.manager_member_id || null,
    monthlyGoals: data.monthly_goals || {},
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
  if (!['admin', 'manager'].includes(context.role)) {
    throw new Error('Brak dostepu do panelu zespolu.');
  }
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, user_id, email, full_name, role, permissions, status, manager_member_id, monthly_goals, created_at')
    .eq('organization_id', context.organizationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  if (context.role === 'manager') {
    return rows.filter(member => member.id === context.memberId || member.manager_member_id === context.memberId);
  }
  return rows;
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
    .select('id, user_id, email, full_name, role, permissions, status, manager_member_id, monthly_goals')
    .eq('organization_id', context.organizationId)
    .eq('status', 'active')
    .not('user_id', 'is', null)
    .order('created_at', { ascending: true });
  if (membersError) throw membersError;

  const visibleMembers = context.role === 'manager'
    ? (members || []).filter(member => member.id === context.memberId || member.manager_member_id === context.memberId)
    : (members || []);
  const userIds = visibleMembers.map(member => member.user_id).filter(Boolean);
  let rows = [];
  if (userIds.length) {
    const { data, error } = await supabase
      .from('user_app_data')
      .select('user_id, data_key, value')
      .in('user_id', userIds);
    if (error) throw error;
    rows = data || [];
  }

  return visibleMembers.map(member => ({
    memberId: member.id,
    userId: member.user_id,
    email: member.email,
    name: member.full_name || member.email,
    role: member.role,
    permissions: member.permissions || [],
    managerMemberId: member.manager_member_id || null,
    monthlyGoals: member.monthly_goals || {},
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
    .select('user_id, manager_member_id')
    .eq('organization_id', context.organizationId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error('Wybrane konto nie należy do tej organizacji.');
  if (context.role === 'manager' && target.user_id !== context.id && target.manager_member_id !== context.memberId) {
    throw new Error('Manager może edytować tylko dane swojego zespołu.');
  }

  const { error } = await supabase
    .from('user_app_data')
    .upsert({ user_id: userId, data_key: dataKey, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,data_key' });
  if (error) throw error;
  return true;
}

function cleanString(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function safeChatFileName(name) {
  const base = cleanString(name || 'plik', 180)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'plik';
}

function chatThreadRecipient(threadId) {
  const id = cleanString(threadId, 100);
  if (!id || id === 'team') return null;
  if (!id.startsWith('dm:')) throw new Error('Nieprawidlowy watek czatu.');
  return id.slice(3);
}

function memberName(member) {
  return member?.full_name || member?.email || 'Pracownik';
}

async function listChatMembers(supabase, organizationId) {
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, user_id, email, full_name, role, status')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function validateChatRecipient(supabase, context, memberId) {
  if (!memberId) return null;
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, organization_id, full_name, email, status')
    .eq('id', memberId)
    .eq('organization_id', context.organizationId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Ten pracownik nie nalezy do Twojej organizacji.');
  return data.id;
}

function messageBelongsToThread(message, context, threadId) {
  const recipient = chatThreadRecipient(threadId);
  if (!recipient) return !message.recipient_member_id;
  const a = message.sender_member_id;
  const b = message.recipient_member_id;
  return (a === context.memberId && b === recipient) || (a === recipient && b === context.memberId);
}

function publicChatMessage(message, membersById, context) {
  const sender = membersById.get(message.sender_member_id);
  return {
    id: message.id,
    threadId: message.recipient_member_id
      ? `dm:${message.sender_member_id === context.memberId ? message.recipient_member_id : message.sender_member_id}`
      : 'team',
    body: message.body || '',
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    createdAt: message.created_at,
    senderMemberId: message.sender_member_id,
    senderName: memberName(sender),
    own: message.sender_member_id === context.memberId,
    readBy: Array.isArray(message.read_by) ? message.read_by : [],
  };
}

async function listChatThreads() {
  const supabase = getClient();
  const context = await currentContext();
  const members = await listChatMembers(supabase, context.organizationId);
  const membersById = new Map(members.map(member => [member.id, member]));
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, sender_member_id, recipient_member_id, body, attachments, read_by, created_at')
    .eq('organization_id', context.organizationId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  const messages = data || [];
  const threadFor = (threadId) => messages.filter(message => messageBelongsToThread(message, context, threadId));
  const publicLast = (items) => items[0] ? publicChatMessage(items[0], membersById, context) : null;
  const unread = (items) => items.filter(message =>
    message.sender_member_id !== context.memberId &&
    !(Array.isArray(message.read_by) ? message.read_by : []).includes(context.memberId)
  ).length;

  const threads = [{
    id: 'team',
    type: 'team',
    name: 'Zespół',
    subtitle: `${members.length} osób`,
    memberId: null,
    lastMessage: publicLast(threadFor('team')),
    unreadCount: unread(threadFor('team')),
  }];

  for (const member of members) {
    if (member.id === context.memberId) continue;
    const threadId = `dm:${member.id}`;
    const items = threadFor(threadId);
    threads.push({
      id: threadId,
      type: 'direct',
      name: memberName(member),
      subtitle: member.role || member.email || '',
      memberId: member.id,
      lastMessage: publicLast(items),
      unreadCount: unread(items),
    });
  }

  return {
    currentMemberId: context.memberId,
    organizationId: context.organizationId,
    members: members.map(member => ({
      id: member.id,
      userId: member.user_id,
      name: memberName(member),
      email: member.email,
      role: member.role,
    })),
    threads,
  };
}

async function markChatThreadRead(supabase, context, messages) {
  const unread = messages.filter(message =>
    message.sender_member_id !== context.memberId &&
    !(Array.isArray(message.read_by) ? message.read_by : []).includes(context.memberId)
  );
  for (const message of unread.slice(-40)) {
    const readBy = [...new Set([...(Array.isArray(message.read_by) ? message.read_by : []), context.memberId])];
    await supabase.from('chat_messages').update({ read_by: readBy }).eq('id', message.id);
  }
}

async function listChatMessages(threadId = 'team') {
  const supabase = getClient();
  const context = await currentContext();
  const recipient = chatThreadRecipient(threadId);
  if (recipient) await validateChatRecipient(supabase, context, recipient);
  const members = await listChatMembers(supabase, context.organizationId);
  const membersById = new Map(members.map(member => [member.id, member]));
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, sender_member_id, recipient_member_id, body, attachments, read_by, created_at')
    .eq('organization_id', context.organizationId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  const messages = (data || [])
    .filter(message => messageBelongsToThread(message, context, threadId))
    .reverse()
    .slice(-120);
  await markChatThreadRead(supabase, context, messages);
  return {
    threadId: recipient ? `dm:${recipient}` : 'team',
    currentMemberId: context.memberId,
    messages: messages.map(message => publicChatMessage(message, membersById, context)),
  };
}

async function sendChatMessage(payload = {}) {
  const supabase = getClient();
  const context = await currentContext();
  const recipient = await validateChatRecipient(supabase, context, chatThreadRecipient(payload.threadId || 'team'));
  const body = cleanString(payload.body, 5000);
  const attachments = Array.isArray(payload.attachments) ? payload.attachments.slice(0, 8).map(file => ({
    path: cleanString(file?.path, 500),
    name: cleanString(file?.name || 'plik', 240),
    type: cleanString(file?.type, 120),
    size: Number(file?.size) || 0,
  })).filter(file => file.path && file.path.startsWith(`${context.organizationId}/`)) : [];
  if (!body && !attachments.length) throw new Error('Wpisz wiadomość albo dodaj plik.');

  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      organization_id: context.organizationId,
      sender_member_id: context.memberId,
      recipient_member_id: recipient,
      body,
      attachments,
      read_by: [context.memberId],
    })
    .select('id, sender_member_id, recipient_member_id, body, attachments, read_by, created_at')
    .single();
  if (error) throw error;
  const members = await listChatMembers(supabase, context.organizationId);
  return publicChatMessage(data, new Map(members.map(member => [member.id, member])), context);
}

async function uploadChatFile(file = {}) {
  const supabase = getClient();
  const context = await currentContext();
  const name = safeChatFileName(file.name);
  const size = Number(file.size) || 0;
  if (!file.dataBase64) throw new Error('Nie udało się odczytać pliku.');
  if (size > 10 * 1024 * 1024) throw new Error('Plik może mieć maksymalnie 10 MB.');
  const buffer = Buffer.from(String(file.dataBase64), 'base64');
  const filePath = `${context.organizationId}/${context.memberId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`;
  const { error } = await supabase.storage
    .from(CHAT_BUCKET)
    .upload(filePath, buffer, {
      contentType: cleanString(file.type, 120) || 'application/octet-stream',
      upsert: false,
    });
  if (error) throw error;
  return {
    path: filePath,
    name,
    type: cleanString(file.type, 120),
    size: buffer.length,
  };
}

async function createChatFileUrl(filePath) {
  const supabase = getClient();
  const context = await currentContext();
  const pathValue = cleanString(filePath, 500);
  if (!pathValue.startsWith(`${context.organizationId}/`)) throw new Error('Brak dostępu do tego pliku.');
  const { data, error } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(pathValue, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
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

async function syncOperioBookings() {
  const { data, error } = await getClient().functions.invoke('operio-bookings-pending', { body: {} });
  if (error) throw error;
  const pending = Array.isArray(data?.bookings) ? data.bookings : [];
  const added = [];
  for (const booking of pending) {
    added.push(await addBooking(booking));
  }
  return added;
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
  listChatThreads,
  listChatMessages,
  sendChatMessage,
  uploadChatFile,
  createChatFileUrl,
  generateSalesAI,
  apolloContacts,
  getSalesJourneyStats,
  getBookings,
  addBooking,
  updateBookingStatus,
  assignBooking,
  syncOperioBookings,
};
