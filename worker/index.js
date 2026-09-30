// ============================================
// PRIME MAIL - Cloudflare Email Routing Worker
// Receives RFC email, preserves exact raw bytes, decodes MIME text/html parts,
// and forwards both custody bytes and derived bodies to the R: substrate.
// ============================================

function splitHeaderBody(raw = '') {
  const crlfIndex = raw.indexOf('\r\n\r\n');
  if (crlfIndex >= 0) {
    return { headersText: raw.slice(0, crlfIndex), body: raw.slice(crlfIndex + 4) };
  }
  const lfIndex = raw.indexOf('\n\n');
  if (lfIndex >= 0) {
    return { headersText: raw.slice(0, lfIndex), body: raw.slice(lfIndex + 2) };
  }
  return { headersText: raw, body: '' };
}

function parseHeaders(headersText = '') {
  const unfolded = headersText.replace(/\r?\n[ \t]+/g, ' ');
  const headers = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!headers[name]) headers[name] = value;
    else headers[name] += `, ${value}`;
  }
  return headers;
}

function parseHeaderWithParams(value = '') {
  const firstSeparator = value.indexOf(';');
  const type = (firstSeparator >= 0 ? value.slice(0, firstSeparator) : value).trim().toLowerCase();
  const params = {};
  const rest = firstSeparator >= 0 ? value.slice(firstSeparator + 1) : '';
  const paramRegex = /(?:^|;)\s*([^=;]+)\s*=\s*(?:"([^"]*)"|([^;]*))/g;
  let match;
  const source = `;${rest}`;
  while ((match = paramRegex.exec(source)) !== null) {
    const key = match[1].trim().toLowerCase();
    params[key] = (match[2] ?? match[3] ?? '').trim();
  }
  return { type, params };
}

function base64ToBytes(value = '') {
  const compact = value.replace(/\s+/g, '');
  if (!compact) return new Uint8Array();
  try {
    const binary = atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return new TextEncoder().encode(value);
  }
}

function bytesToBase64(bytes) {
  if (!bytes?.length) return '';
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function quotedPrintableToBytes(value = '', headerMode = false) {
  let input = value.replace(/=\r?\n/g, '');
  if (headerMode) input = input.replace(/_/g, ' ');
  const bytes = [];

  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === '=' && /^[0-9A-Fa-f]{2}$/.test(input.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(input.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }

    const code = input.charCodeAt(index);
    if (code <= 0xff) bytes.push(code);
    else bytes.push(...new TextEncoder().encode(input[index]));
  }

  return new Uint8Array(bytes);
}

function decodeBytes(bytes, charset = 'utf-8') {
  const candidates = [charset, 'utf-8', 'windows-1252'];
  for (const candidate of candidates) {
    try {
      return new TextDecoder(candidate || 'utf-8', { fatal: false }).decode(bytes);
    } catch {
      // Try the next decoder label.
    }
  }
  return new TextDecoder().decode(bytes);
}

function decodeMimeWords(value = '') {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_whole, charset, mode, encoded) => {
    const bytes = mode.toLowerCase() === 'b'
      ? base64ToBytes(encoded)
      : quotedPrintableToBytes(encoded, true);
    return decodeBytes(bytes, charset);
  });
}

function decodeBody(body, headers) {
  const transfer = (headers['content-transfer-encoding'] || '').trim().toLowerCase();
  const contentType = parseHeaderWithParams(headers['content-type'] || 'text/plain; charset=utf-8');
  const charset = contentType.params.charset || 'utf-8';

  if (transfer === 'base64') return decodeBytes(base64ToBytes(body), charset);
  if (transfer === 'quoted-printable') return decodeBytes(quotedPrintableToBytes(body), charset);
  return body;
}

function repairHtmlQuotedPrintableArtifacts(html = '') {
  return String(html || '')
    .replace(/\b(href|src|action)\s*=\s*3D(["'])/gi, '$1=$2')
    .replace(/\b(href|src|action)\s*=\s*3D(&quot;|&#34;)/gi, '$1=$2')
    .replace(/\b(href|src)\s*=\s*(["'])3D\2(https?:\/\/[^"'\s>]+)/gi, '$1=$2$3$2')
    .replace(/\b(href|src)\s*=\s*(["'])3D(https?:\/\/[^"'\s>]+)\2/gi, '$1=$2$3$2');
}

function splitMultipart(body = '', boundary = '') {
  if (!boundary) return [];
  const normalized = body.replace(/\r\n/g, '\n');
  const marker = `--${boundary}`;
  const chunks = normalized.split(marker).slice(1);
  const parts = [];

  for (let chunk of chunks) {
    if (chunk.startsWith('--')) break;
    chunk = chunk.replace(/^\n/, '').replace(/\n$/, '');
    if (chunk.trim()) parts.push(chunk.replace(/\n/g, '\r\n'));
  }
  return parts;
}

function parseMimeEntity(raw = '', depth = 0) {
  if (!raw || depth > 12) return { textParts: [], htmlParts: [] };

  const { headersText, body } = splitHeaderBody(raw);
  const headers = parseHeaders(headersText);
  const contentType = parseHeaderWithParams(headers['content-type'] || 'text/plain; charset=utf-8');
  const disposition = parseHeaderWithParams(headers['content-disposition'] || 'inline');
  const isAttachment = disposition.type === 'attachment';

  if (contentType.type.startsWith('multipart/')) {
    const boundary = contentType.params.boundary;
    const result = { textParts: [], htmlParts: [] };
    for (const child of splitMultipart(body, boundary)) {
      const parsed = parseMimeEntity(child, depth + 1);
      result.textParts.push(...parsed.textParts);
      result.htmlParts.push(...parsed.htmlParts);
    }
    return result;
  }

  if (contentType.type === 'message/rfc822') {
    return parseMimeEntity(decodeBody(body, headers), depth + 1);
  }

  if (isAttachment) return { textParts: [], htmlParts: [] };

  const decoded = decodeBody(body, headers).trim();
  if (!decoded) return { textParts: [], htmlParts: [] };

  if (contentType.type === 'text/html') return { textParts: [], htmlParts: [repairHtmlQuotedPrintableArtifacts(decoded)] };
  if (contentType.type === 'text/plain') return { textParts: [decoded], htmlParts: [] };

  return { textParts: [], htmlParts: [] };
}

function parseRawEmail(rawEmail = '') {
  const { headersText } = splitHeaderBody(rawEmail);
  const headers = parseHeaders(headersText);
  const parsed = parseMimeEntity(rawEmail);

  return {
    headers,
    textBody: parsed.textParts.find(Boolean) || '',
    htmlBody: parsed.htmlParts.find(Boolean) || ''
  };
}

export default {
  async email(message, env, ctx) {
    try {
      // Read the stream once. The byte copy is the custody object; the decoded
      // string is only a derived representation used by the MIME parser.
      const rawBuffer = await new Response(message.raw).arrayBuffer();
      const rawBytes = new Uint8Array(rawBuffer);
      const rawEmail = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes);
      const rawEmailBase64 = bytesToBase64(rawBytes);
      const parsed = parseRawEmail(rawEmail);

      const subject = decodeMimeWords(parsed.headers.subject || message.headers.get('subject') || 'No Subject');
      const from = decodeMimeWords(parsed.headers.from || message.from || 'Unknown');
      const to = decodeMimeWords(parsed.headers.to || message.to || 'Unknown');
      const date = parsed.headers.date || message.headers.get('date') || new Date().toISOString();
      const messageId = parsed.headers['message-id'] || message.headers.get('message-id') || `msg_${Date.now()}`;

      const payload = {
        message_id: messageId,
        from,
        to,
        subject,
        date,
        raw_email: rawEmail,
        raw_email_base64: rawEmailBase64,
        text_body: parsed.textBody,
        html_body: parsed.htmlBody,
        received_at: new Date().toISOString(),
        read: false,
        source: 'cloudflare_routing'
      };

      const webhookUrl = env.RDRIVE_WEBHOOK_URL;
      if (!webhookUrl) throw new Error('Missing RDRIVE_WEBHOOK_URL secret');

      const webhookSecret = env.WEBHOOK_SECRET;
      if (!webhookSecret) throw new Error('Missing WEBHOOK_SECRET secret');

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Email-Secret': webhookSecret
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to forward to R: drive: ${response.status} ${errorText}`);

        if (env.D1_FALLBACK) {
          await env.D1_FALLBACK.prepare(`
            INSERT INTO email_fallback (message_id, sender, subject, body, received_at, forwarded)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(messageId, from, subject, rawEmail, new Date().toISOString(), false).run();
        }

        throw new Error(`Webhook forward failed with ${response.status}`);
      }

      console.log(`Email from ${from} preserved, decoded, and forwarded to R: drive successfully`);
    } catch (error) {
      console.error('Worker error:', error);
      throw error;
    }
  },

  async fetch(request, env, ctx) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        worker: 'rdrive-email-worker',
        mime_decoder: 'v3',
        raw_custody: 'base64-bytes',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('Not Found', { status: 404 });
  }
};
