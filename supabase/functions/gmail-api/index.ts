import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GMAIL_BASE = 'https://www.googleapis.com/gmail/v1/users/me';

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

// ── base64 helpers ──

function toStandardBase64(urlSafe: string): string {
  let value = String(urlSafe || '').replace(/-/g, '+').replace(/_/g, '/');
  value += '='.repeat((4 - (value.length % 4)) % 4);
  return value;
}

function utf8Bytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
}

function base64UrlEncode(str: string): string {
  return btoa(bytesToBinaryString(utf8Bytes(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecodeToText(data: string): string {
  try {
    const binary = atob(toStandardBase64(data));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

// ── MIME header decoding (RFC 2047, e.g. polskie znaki w temacie) ──

function decodeMimeHeader(value: string): string {
  if (!value) return '';
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_match, charset, encoding, encoded) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        const binary = atob(encoded);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        return new TextDecoder(String(charset).toLowerCase()).decode(bytes);
      }
      const quoted = encoded.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      const bytes = Uint8Array.from(quoted, (c: string) => c.charCodeAt(0));
      return new TextDecoder(String(charset).toLowerCase()).decode(bytes);
    } catch {
      return encoded;
    }
  });
}

function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  const header = (headers || []).find((item) => (item.name || '').toLowerCase() === name.toLowerCase());
  return header ? decodeMimeHeader(header.value || '') : '';
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// ── message payload parsing ──

type ParsedAttachment = { attachmentId: string; filename: string; mimeType: string; size: number; dataBase64: string };

function walkParts(part: any, acc: { text: string; html: string; attachments: ParsedAttachment[] }) {
  if (!part) return;
  const mimeType = String(part.mimeType || '');
  const filename = String(part.filename || '');
  if (filename) {
    const hasAttachmentId = Boolean(part.body?.attachmentId);
    acc.attachments.push({
      attachmentId: part.body?.attachmentId || '',
      filename,
      mimeType,
      size: Number(part.body?.size) || 0,
      dataBase64: !hasAttachmentId && part.body?.data ? toStandardBase64(part.body.data) : '',
    });
  } else if (mimeType === 'text/plain' && part.body?.data && !acc.text) {
    acc.text = base64UrlDecodeToText(part.body.data);
  } else if (mimeType === 'text/html' && part.body?.data && !acc.html) {
    acc.html = base64UrlDecodeToText(part.body.data);
  }
  if (Array.isArray(part.parts)) part.parts.forEach((child: any) => walkParts(child, acc));
}

function extractBody(payload: any): { body: string; attachments: ParsedAttachment[] } {
  const acc = { text: '', html: '', attachments: [] as ParsedAttachment[] };
  walkParts(payload, acc);
  return { body: acc.text || stripHtml(acc.html), attachments: acc.attachments };
}

// ── Gmail token handling ──

async function refreshAccessToken(admin: ReturnType<typeof createClient>, userId: string, refreshToken: string) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Brak konfiguracji GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    if (data.error === 'invalid_grant') {
      await admin.from('gmail_accounts').delete().eq('user_id', userId);
      throw new Error('NOT_CONNECTED');
    }
    throw new Error(data.error_description || data.error || 'Nie udało się odświeżyć dostępu do Gmail.');
  }
  const accessToken = String(data.access_token);
  const expiresIn = Number(data.expires_in) || 3600;
  const accessTokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  await admin
    .from('gmail_accounts')
    .update({ access_token: accessToken, access_token_expires_at: accessTokenExpiresAt, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  return accessToken;
}

async function getValidAccessToken(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: account, error } = await admin
    .from('gmail_accounts')
    .select('email, access_token, refresh_token, access_token_expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!account) throw new Error('NOT_CONNECTED');

  const expiresAt = new Date(account.access_token_expires_at).getTime();
  if (expiresAt - Date.now() > 2 * 60 * 1000) {
    return { accessToken: account.access_token as string, email: account.email as string };
  }
  const accessToken = await refreshAccessToken(admin, userId, account.refresh_token as string);
  return { accessToken, email: account.email as string };
}

async function gmailFetch(accessToken: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Błąd Gmail API (${response.status}).`);
  return data;
}

// ── outgoing MIME message ──

function encodeHeaderValue(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${btoa(bytesToBinaryString(utf8Bytes(value)))}?=`;
}

type OutgoingAttachment = { name?: string; type?: string; dataBase64?: string };

function buildRawMessage(options: {
  from: string;
  to: string;
  subject: string;
  text: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments: OutgoingAttachment[];
}) {
  const { from, to, subject, text, inReplyTo, references, attachments } = options;
  const boundary = `----=_Part_${crypto.randomUUID().replace(/-/g, '')}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (inReplyTo || references) {
    const combined = [references, inReplyTo].filter(Boolean).join(' ');
    headers.push(`References: ${combined}`);
  }

  const textBase64 = btoa(bytesToBinaryString(utf8Bytes(text)));

  let message: string;
  if (attachments.length) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      textBase64,
    ];
    for (const file of attachments) {
      const safeName = String(file.name || 'zalacznik').replace(/"/g, '');
      parts.push(
        `--${boundary}`,
        `Content-Type: ${file.type || 'application/octet-stream'}; name="${safeName}"`,
        `Content-Disposition: attachment; filename="${safeName}"`,
        'Content-Transfer-Encoding: base64',
        '',
        String(file.dataBase64 || ''),
      );
    }
    parts.push(`--${boundary}--`, '');
    message = `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64');
    message = `${headers.join('\r\n')}\r\n\r\n${textBase64}`;
  }

  return base64UrlEncode(message);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Dozwolona jest tylko metoda POST.' }, 405);

  try {
    const { admin, userId } = await authenticatedContext(request);
    const body = await request.json();
    const action = String(body?.action || '');

    if (action === 'status') {
      const { data: account } = await admin.from('gmail_accounts').select('email').eq('user_id', userId).maybeSingle();
      return json({ connected: Boolean(account), email: account?.email || '' });
    }

    if (action === 'disconnect') {
      const { data: account } = await admin.from('gmail_accounts').select('refresh_token').eq('user_id', userId).maybeSingle();
      if (account?.refresh_token) {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(account.refresh_token as string)}`, { method: 'POST' }).catch(() => {});
      }
      await admin.from('gmail_accounts').delete().eq('user_id', userId);
      return json({ disconnected: true });
    }

    if (action === 'list_threads') {
      const { accessToken } = await getValidAccessToken(admin, userId);
      const pageToken = body?.pageToken ? String(body.pageToken) : '';
      const listParams = new URLSearchParams({ maxResults: '25', labelIds: 'INBOX' });
      if (pageToken) listParams.set('pageToken', pageToken);
      const listData = await gmailFetch(accessToken, `/threads?${listParams.toString()}`);
      const stubs = Array.isArray(listData.threads) ? listData.threads : [];
      const threads = await Promise.all(stubs.map(async (stub: any) => {
        const metaParams = new URLSearchParams({ format: 'metadata' });
        metaParams.append('metadataHeaders', 'Subject');
        metaParams.append('metadataHeaders', 'From');
        metaParams.append('metadataHeaders', 'Date');
        const detail = await gmailFetch(accessToken, `/threads/${stub.id}?${metaParams.toString()}`);
        const lastMessage = (detail.messages || [])[(detail.messages || []).length - 1] || {};
        const headers = lastMessage.payload?.headers;
        return {
          id: stub.id,
          subject: headerValue(headers, 'Subject') || '(bez tematu)',
          from: headerValue(headers, 'From'),
          date: headerValue(headers, 'Date'),
          snippet: stub.snippet || '',
          unread: (lastMessage.labelIds || []).includes('UNREAD'),
        };
      }));
      return json({ threads, nextPageToken: listData.nextPageToken || '' });
    }

    if (action === 'get_thread') {
      const threadId = String(body?.threadId || '').trim();
      if (!threadId) return json({ error: 'Brakuje identyfikatora wątku.' }, 400);
      const { accessToken } = await getValidAccessToken(admin, userId);
      const detail = await gmailFetch(accessToken, `/threads/${threadId}?format=full`);
      const messages = (detail.messages || []).map((message: any) => {
        const headers = message.payload?.headers;
        const { body: text, attachments } = extractBody(message.payload);
        return {
          id: message.id,
          messageIdHeader: headerValue(headers, 'Message-ID'),
          references: headerValue(headers, 'References'),
          from: headerValue(headers, 'From'),
          to: headerValue(headers, 'To'),
          subject: headerValue(headers, 'Subject'),
          date: headerValue(headers, 'Date'),
          unread: (message.labelIds || []).includes('UNREAD'),
          body: text,
          attachments,
        };
      });
      return json({ threadId, messages });
    }

    if (action === 'mark_read') {
      const threadId = String(body?.threadId || '').trim();
      if (!threadId) return json({ error: 'Brakuje identyfikatora wątku.' }, 400);
      const { accessToken } = await getValidAccessToken(admin, userId);
      await gmailFetch(accessToken, `/threads/${threadId}/modify`, {
        method: 'POST',
        body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
      });
      return json({ ok: true });
    }

    if (action === 'get_attachment') {
      const messageId = String(body?.messageId || '').trim();
      const attachmentId = String(body?.attachmentId || '').trim();
      const filename = String(body?.filename || 'zalacznik');
      const mimeType = String(body?.mimeType || 'application/octet-stream');
      if (!messageId || !attachmentId) return json({ error: 'Brakuje identyfikatora załącznika.' }, 400);
      const { accessToken } = await getValidAccessToken(admin, userId);
      const data = await gmailFetch(accessToken, `/messages/${messageId}/attachments/${attachmentId}`);
      return json({ filename, mimeType, dataBase64: toStandardBase64(data.data || '') });
    }

    if (action === 'send') {
      const { accessToken, email: fromEmail } = await getValidAccessToken(admin, userId);
      const to = String(body?.to || '').trim();
      const subject = String(body?.subject || '');
      const text = String(body?.body || '');
      const threadId = body?.threadId ? String(body.threadId) : '';
      const inReplyTo = body?.inReplyTo ? String(body.inReplyTo) : '';
      const references = body?.references ? String(body.references) : '';
      const attachments: OutgoingAttachment[] = Array.isArray(body?.attachments) ? body.attachments : [];

      if (!/.+@.+\..+/.test(to)) return json({ error: 'Nieprawidłowy adres odbiorcy.' }, 400);
      if (!subject && !text && !attachments.length) return json({ error: 'Wiadomość jest pusta.' }, 400);
      if (attachments.length > 5) return json({ error: 'Maksymalnie 5 załączników.' }, 400);
      const totalBytes = attachments.reduce((sum, file) => sum + Math.ceil(((file.dataBase64 || '').length * 3) / 4), 0);
      if (totalBytes > 20 * 1024 * 1024) return json({ error: 'Łączny rozmiar załączników przekracza 20 MB.' }, 400);

      const raw = buildRawMessage({ from: fromEmail, to, subject, text, inReplyTo, references, attachments });
      const sendBody: Record<string, unknown> = { raw };
      if (threadId) sendBody.threadId = threadId;
      const result = await gmailFetch(accessToken, '/messages/send', { method: 'POST', body: JSON.stringify(sendBody) });
      return json({ sent: true, id: result.id, threadId: result.threadId });
    }

    return json({ error: 'Nieznana operacja Gmail.' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Błąd integracji Gmail.';
    const status = message === 'NOT_CONNECTED'
      ? 409
      : /Sesja|autoryzacji/.test(message)
      ? 401
      : message.includes('aktywnego dostępu')
      ? 403
      : message.includes('GOOGLE_CLIENT')
      ? 503
      : 500;
    return json({ error: message === 'NOT_CONNECTED' ? 'Gmail nie jest podłączony.' : message }, status);
  }
});
