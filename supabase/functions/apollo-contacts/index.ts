import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type PublicPerson = {
  apolloPersonId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  title: string;
  seniority: string;
  linkedinUrl: string;
  city: string;
  country: string;
  organizationId: string;
  organizationName: string;
  organizationDomain: string;
  organizationWebsite: string;
  organizationLinkedinUrl: string;
  organizationPhone: string;
  organizationCity: string;
  organizationState: string;
  organizationCountry: string;
  organizationEstimatedEmployees: number | null;
  organizationIndustries: string[];
  organizationKeywords: string[];
  organizationDescription: string;
  organizationAnnualRevenue: number | null;
  decisionScore: number;
  decisionReason: string;
};

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

function text(value: unknown, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function cleanDomain(value: unknown) {
  const raw = text(value, 300).toLowerCase();
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function textArray(value: unknown, maxItems = 20) {
  if (typeof value === 'string') return [text(value, 120)].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, 120)).filter(Boolean).slice(0, maxItems);
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function organizationOf(person: Record<string, unknown>) {
  return person.organization && typeof person.organization === 'object'
    ? person.organization as Record<string, unknown>
    : {};
}

function decisionFit(person: Record<string, unknown>) {
  const title = text(person.title).toLowerCase();
  const seniority = text(person.seniority).toLowerCase();
  if (/owner|founder|co-founder|chief executive|\bceo\b|prezes|właściciel|zarząd|managing director/.test(title) || ['owner', 'founder'].includes(seniority)) {
    return { score: 5, reason: 'Właściciel, założyciel lub osoba na najwyższym szczeblu zarządzania' };
  }
  if (['c_suite', 'partner', 'vp'].includes(seniority) || /chief |\bcoo\b|\bcto\b|\bcio\b|vice president|partner/.test(title)) {
    return { score: 5, reason: 'Osoba zarządzająca z wysokim wpływem na decyzje' };
  }
  if (['head', 'director'].includes(seniority) || /director|dyrektor|head of|kierownik działu/.test(title)) {
    return { score: 4, reason: 'Kieruje obszarem i może uczestniczyć w decyzji zakupowej' };
  }
  if (seniority === 'manager' || /manager|kierownik/.test(title)) {
    return { score: 3, reason: 'Możliwy użytkownik lub współdecydent rozwiązania' };
  }
  return { score: 2, reason: 'Rola wymaga potwierdzenia przed kontaktem' };
}

function publicPerson(value: unknown): PublicPerson {
  const person = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const organization = organizationOf(person);
  const fit = decisionFit(person);
  return {
    apolloPersonId: text(person.id, 100),
    firstName: text(person.first_name),
    lastName: text(person.last_name),
    fullName: text(person.name) || [text(person.first_name), text(person.last_name)].filter(Boolean).join(' '),
    title: text(person.title),
    seniority: text(person.seniority, 100),
    linkedinUrl: text(person.linkedin_url, 1000),
    city: text(person.city),
    country: text(person.country),
    organizationId: text(organization.id, 100),
    organizationName: text(organization.name),
    organizationDomain: cleanDomain(organization.primary_domain || organization.website_url),
    organizationWebsite: text(organization.website_url || organization.primary_domain, 1000),
    organizationLinkedinUrl: text(organization.linkedin_url, 1000),
    organizationPhone: text(organization.phone || organization.primary_phone, 100),
    organizationCity: text(organization.city),
    organizationState: text(organization.state),
    organizationCountry: text(organization.country),
    organizationEstimatedEmployees: numberOrNull(organization.estimated_num_employees),
    organizationIndustries: textArray(organization.industries),
    organizationKeywords: textArray(organization.keywords),
    organizationDescription: text(organization.short_description || organization.seo_description || organization.description, 1000),
    organizationAnnualRevenue: numberOrNull(organization.annual_revenue),
    decisionScore: fit.score,
    decisionReason: fit.reason,
  };
}

function cleanPhoneNumbers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((phone) => {
    const item = phone && typeof phone === 'object' ? phone as Record<string, unknown> : {};
    return {
      number: text(item.sanitized_number || item.raw_number, 100),
      rawNumber: text(item.raw_number || item.sanitized_number, 100),
      type: text(item.type_cd, 100),
      status: text(item.status_cd, 100),
      confidence: text(item.confidence_cd, 100),
    };
  }).filter((phone) => phone.number);
}

async function apolloRequest(path: string, options: RequestInit = {}) {
  const apiKey = Deno.env.get('APOLLO_API_KEY');
  if (!apiKey) throw new Error('Brak sekretu APOLLO_API_KEY w Supabase.');
  const response = await fetch(`https://api.apollo.io${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': apiKey,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function addQueryValues(params: URLSearchParams, name: string, values: unknown, maxItems = 40) {
  const list = Array.isArray(values) ? values : [values];
  list.map((item) => text(item, 200)).filter(Boolean).slice(0, maxItems)
    .forEach((item) => params.append(`${name}[]`, item));
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

async function searchApolloPeople(params: URLSearchParams) {
  const query = params.toString();
  const { response, payload } = await apolloRequest(`/api/v1/mixed_people/api_search${query ? `?${query}` : ''}`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error(text(payload?.message || payload?.error || `Apollo Search: ${response.status}`, 800));
  const people: unknown[] = Array.isArray(payload?.people) ? payload.people : [];
  return people.map(publicPerson).filter((person) => person.apolloPersonId && person.fullName);
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

async function searchPeople(domain: string) {
  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('per_page', '20');
  addQueryValues(params, 'q_organization_domains_list', [domain]);
  addQueryValues(params, 'person_seniorities', ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director', 'manager']);
  params.set('include_similar_titles', 'true');
  return (await searchApolloPeople(params))
    .sort((a, b) => b.decisionScore - a.decisionScore);
}

function companyKey(person: PublicPerson) {
  return person.organizationDomain || person.organizationId || person.organizationName.toLowerCase();
}

function companyFromPeople(people: PublicPerson[]) {
  const sorted = [...people].sort((a, b) => b.decisionScore - a.decisionScore);
  const best = sorted[0];
  return {
    apolloOrganizationId: best.organizationId,
    name: best.organizationName || best.organizationDomain || best.organizationWebsite,
    domain: best.organizationDomain,
    website: best.organizationWebsite || best.organizationDomain,
    linkedinUrl: best.organizationLinkedinUrl,
    phone: best.organizationPhone,
    city: best.organizationCity || best.city,
    state: best.organizationState,
    country: best.organizationCountry || best.country,
    estimatedEmployees: best.organizationEstimatedEmployees,
    annualRevenue: best.organizationAnnualRevenue,
    industries: best.organizationIndustries,
    keywords: best.organizationKeywords,
    description: best.organizationDescription,
    contacts: sorted.slice(0, 8),
    bestContactId: best.apolloPersonId,
    bestDecisionScore: best.decisionScore,
    bestDecisionReason: best.decisionReason,
  };
}

async function searchCompanies(body: Record<string, unknown>) {
  const params = new URLSearchParams();
  const limit = clampInt(body.limit, 5, 50, 20);
  params.set('page', String(clampInt(body.page, 1, 20, 1)));
  params.set('per_page', String(Math.min(100, Math.max(20, limit * 4))));
  const keywords = text(body.keywords || body.industryQuery, 300);
  if (keywords) params.set('q_keywords', keywords);
  addQueryValues(params, 'person_seniorities', Array.isArray(body.seniorities) ? body.seniorities : ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director']);
  addQueryValues(params, 'person_titles', body.titles);
  addQueryValues(params, 'organization_locations', body.locations);
  addQueryValues(params, 'organization_num_employees_ranges', body.employeeRanges);
  params.set('include_similar_titles', 'true');

  const people = await searchApolloPeople(params);
  const groups = new Map<string, PublicPerson[]>();
  for (const person of people) {
    const key = companyKey(person);
    if (!key || !person.organizationName) continue;
    const current = groups.get(key) || [];
    current.push(person);
    groups.set(key, current);
  }
  const companies = [...groups.values()]
    .map(companyFromPeople)
    .filter((company) => company.name)
    .sort((a, b) => b.bestDecisionScore - a.bestDecisionScore)
    .slice(0, limit);
  return companies;
}

async function enrichPerson(personId: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const webhookUrl = `${supabaseUrl}/functions/v1/apollo-phone-webhook`;
  const { response, payload } = await apolloRequest('/api/v1/people/match', {
    method: 'POST',
    body: JSON.stringify({
      id: personId,
      reveal_personal_emails: false,
      reveal_phone_number: true,
      webhook_url: webhookUrl,
    }),
  });
  if (!response.ok) throw new Error(text(payload?.message || payload?.error || `Apollo Enrichment: ${response.status}`, 800));
  const person = payload?.person && typeof payload.person === 'object' ? payload.person as Record<string, unknown> : {};
  return {
    email: text(person.email, 500),
    emailStatus: text(person.email_status, 100),
    requestId: text(payload?.request_id, 100),
    phoneStatus: payload?.request_id ? 'pending' : 'unavailable',
  };
}

async function contactBelongsToUser(admin: any, userId: string, personId: string, requestId = '') {
  const { data, error } = await admin
    .from('user_app_data')
    .select('value')
    .eq('user_id', userId)
    .eq('data_key', 'companies')
    .maybeSingle();
  if (error) throw error;
  const row = data as { value?: unknown } | null;
  const companies = Array.isArray(row?.value) ? row.value as Array<Record<string, unknown>> : [];
  return companies.some((company) => Array.isArray(company.apolloContacts) && company.apolloContacts.some((contact) => {
    const item = contact && typeof contact === 'object' ? contact as Record<string, unknown> : {};
    const personMatches = text(item.apolloPersonId, 100) === personId;
    return personMatches && (!requestId || text(item.apolloPhoneRequestId, 100) === requestId);
  }));
}

async function pollPhone(requestId: string, personId: string) {
  const { response, payload } = await apolloRequest(`/api/v1/webhook_result/${encodeURIComponent(requestId)}`, { method: 'GET' });
  if (response.status === 404) return { pending: true, phoneNumbers: [] };
  if (!response.ok) throw new Error(text(payload?.message || payload?.error || `Apollo Phone Poll: ${response.status}`, 800));
  const people: unknown[] = Array.isArray(payload?.people) ? payload.people : [];
  const personValue = people.find((item) => text((item as Record<string, unknown> | undefined)?.id, 100) === personId) || people[0] || {};
  const person = personValue as Record<string, unknown>;
  const phoneNumbers = cleanPhoneNumbers(person.phone_numbers);
  return { pending: false, phoneNumbers };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Dozwolona jest tylko metoda POST.' }, 405);

  try {
    const { admin, userId } = await authenticatedContext(request);
    const body = await request.json();
    const action = text(body?.action, 30);

    if (action === 'search') {
      const domain = cleanDomain(body?.domain);
      if (!domain) return json({ error: 'Firma nie ma poprawnej domeny internetowej.' }, 400);
      return json({ contacts: await searchPeople(domain), source: 'Apollo', domain });
    }

    if (action === 'search_companies') {
      return json({ companies: await searchCompanies(body), source: 'Apollo' });
    }

    if (action === 'enrich') {
      const personId = text(body?.personId, 100);
      if (!personId) return json({ error: 'Brakuje identyfikatora osoby Apollo.' }, 400);
      if (!await contactBelongsToUser(admin, userId, personId)) return json({ error: 'Najpierw zapisz tę osobę przy firmie.' }, 403);
      return json(await enrichPerson(personId));
    }

    if (action === 'poll_phone') {
      const requestId = text(body?.requestId, 100);
      const personId = text(body?.personId, 100);
      if (!/^-?\d{1,30}$/.test(requestId) || !personId) return json({ error: 'Nieprawidłowe żądanie telefonu.' }, 400);
      if (!await contactBelongsToUser(admin, userId, personId, requestId)) return json({ error: 'Brak dostępu do tego wyniku.' }, 403);
      return json(await pollPhone(requestId, personId));
    }

    return json({ error: 'Nieznana operacja Apollo.' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Błąd integracji Apollo.';
    const status = /Sesja|autoryzacji/.test(message) ? 401 : message.includes('aktywnego dostępu') ? 403 : message.includes('APOLLO_API_KEY') ? 503 : 500;
    return json({ error: message }, status);
  }
});
