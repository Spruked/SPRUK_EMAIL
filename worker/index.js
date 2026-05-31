// ============================================
// R-DRIVE EMAIL CLIENT - Cloudflare Worker
// Receives emails from Cloudflare Email Routing
// Forwards to your R: drive server via webhook
// ============================================

export default {
  async email(message, env, ctx) {
    try {
      // Parse the incoming email
      const rawEmail = await new Response(message.raw).text();
      const subject = message.headers.get('subject') || 'No Subject';
      const from = message.from || 'Unknown';
      const to = message.to || 'Unknown';
      const date = message.headers.get('date') || new Date().toISOString();
      const messageId = message.headers.get('message-id') || `msg_${Date.now()}`;

      // Extract text body from raw email (simple parser)
      let textBody = '';
      let htmlBody = '';

      // Simple MIME parsing - split headers from body
      const parts = rawEmail.split('\r\n\r\n');
      if (parts.length >= 2) {
        const bodySection = parts.slice(1).join('\r\n\r\n');

        // Check for multipart
        const contentType = message.headers.get('content-type') || '';

        if (contentType.includes('multipart')) {
          // Extract text part from multipart
          const boundaryMatch = contentType.match(/boundary="?([^"\s;]+)"?/);
          if (boundaryMatch) {
            const boundary = boundaryMatch[1];
            const sections = bodySection.split(`--${boundary}`);
            for (const section of sections) {
              if (section.includes('text/plain')) {
                textBody = section.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
              }
              if (section.includes('text/html')) {
                htmlBody = section.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
              }
            }
          }
        } else if (contentType.includes('text/html')) {
          htmlBody = bodySection.trim();
        } else {
          textBody = bodySection.trim();
        }
      }

      // Build payload for your R: drive server
      const payload = {
        message_id: messageId,
        from: from,
        to: to,
        subject: subject,
        date: date,
        raw_email: rawEmail,
        text_body: textBody,
        html_body: htmlBody,
        received_at: new Date().toISOString(),
        read: false,
        source: 'cloudflare_routing'
      };

      // Forward to your R: drive webhook endpoint
      // CHANGE THIS to your actual R: drive server URL
      const webhookUrl = env.RDRIVE_WEBHOOK_URL;
      if (!webhookUrl) {
        throw new Error('Missing RDRIVE_WEBHOOK_URL secret');
      }

      const webhookSecret = env.WEBHOOK_SECRET;
      if (!webhookSecret) {
        throw new Error('Missing WEBHOOK_SECRET secret');
      }

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
        // Store in D1 as fallback if configured
        if (env.D1_FALLBACK) {
          await env.D1_FALLBACK.prepare(`
            INSERT INTO email_fallback (message_id, sender, subject, body, received_at, forwarded)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(messageId, from, subject, rawEmail, new Date().toISOString(), false).run();
        }
        throw new Error(`Webhook forward failed with ${response.status}`);
      } else {
        console.log(`Email from ${from} forwarded to R: drive successfully`);
      }

    } catch (error) {
      console.error('Worker error:', error);
      throw error;
    }
  },

  // Health check endpoint
  async fetch(request, env, ctx) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        worker: 'r-drive-email-receiver',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('Not Found', { status: 404 });
  }
};
