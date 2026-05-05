# ============================================
# R-DRIVE EMAIL CLIENT - Setup Guide
# Bypass Google/Microsoft - Self-Hosted Email
# ============================================

## ARCHITECTURE OVERVIEW

```
SENDER
   │
   ▼
Cloudflare Email Routing (catches mail for your domain)
   │
   ▼
Cloudflare Worker (parses email, forwards via webhook)
   │
   ▼ (HTTPS webhook)
Your Computer / R: Drive Server (FastAPI + SQLite)
   │
   ▼
React Frontend (local browser UI)
```

**What this means:**
- ✅ NO Gmail, NO Outlook, NO Yahoo servers touch your data
- ✅ Cloudflare only ROUTES the email bytes (doesn't store them)
- ✅ ALL emails stored locally on YOUR R: drive
- ✅ You own 100% of your data

## PREREQUISITES

1. **Domain name** (e.g., yourdomain.com) with DNS on Cloudflare
2. **Cloudflare account** (free tier works)
3. **Python 3.10+** installed
4. **Node.js 18+** installed
5. **R: drive** mapped and accessible (or change path in .env)

## STEP 1: Cloudflare Setup

### 1.1 Enable Email Routing
1. Go to Cloudflare Dashboard → your domain → Email Routing
2. Click "Onboard Domain"
3. Add MX records automatically
4. Wait 5-15 minutes for DNS propagation

### 1.2 Create the Worker
1. Go to Workers & Pages → Create Worker
2. Name it `rdrive-email-receiver`
3. Replace default code with `worker/index.js` from this project
4. Deploy

### 1.3 Set Worker Secrets
```bash
wrangler secret put RDRIVE_WEBHOOK_URL
# Enter: https://your-public-ip-or-ngrok:8000/api/emails/receive

wrangler secret put WEBHOOK_SECRET
# Enter: your-super-secret-key (same as backend .env)
```

### 1.4 Bind Email Routing to Worker
1. Go to Email Routing → Routing Rules
2. Create catch-all rule: `*@yourdomain.com` → Send to Worker → `rdrive-email-receiver`
3. Or create specific addresses: `me@yourdomain.com`, `contact@yourdomain.com`

### 1.5 Get API Token for Sending
1. Go to My Profile → API Tokens → Create Token
2. Use "Custom token" with these permissions:
   - Zone:Read (for your domain)
   - Email Sending:Edit
3. Copy the token for your .env file

### 1.6 Get Account ID
1. Go to any domain in Cloudflare
2. Account ID is in the right sidebar
3. Copy for your .env file

## STEP 2: Backend Setup (R: Drive)

### 2.1 Install Dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2.2 Configure Environment
```bash
cp .env.example .env
# Edit .env with your actual values:
# - WEBHOOK_SECRET (same as Worker)
# - CF_API_TOKEN (from step 1.5)
# - CF_ACCOUNT_ID (from step 1.6)
# - SENDER_DOMAIN (yourdomain.com)
```

### 2.3 Run the Server
```bash
python main.py
# Server starts on http://localhost:8000
```

**For external access** (so Cloudflare Worker can reach you):
- Option A: Use ngrok: `ngrok http 8000`
- Option B: Port forward 8000 on your router
- Option C: Run on a VPS with public IP

## STEP 3: Frontend Setup

```bash
cd frontend
npm install
npm start
# Opens at http://localhost:3000
```

## STEP 4: Test Everything

1. Send an email to `me@yourdomain.com` from any email account
2. Check Cloudflare Worker logs (should show "forwarded to R: drive")
3. Check your React app - email should appear in inbox
4. Try composing and sending from the UI

## SECURITY NOTES

- **Webhook Secret**: Must match between Worker and backend. This prevents spoofing.
- **HTTPS Only**: Never use HTTP for the webhook in production.
- **Firewall**: Only allow Cloudflare IPs to reach your backend webhook.
- **Backups**: Regularly backup `R:/email_client/emails.db`

## TROUBLESHOOTING

### Emails not arriving
1. Check Cloudflare Email Routing analytics
2. Check Worker logs for errors
3. Verify webhook URL is accessible from internet
4. Check backend console for incoming requests

### Can't send emails
1. Verify CF_API_TOKEN has Email Sending permission
2. Check account ID is correct
3. Verify sender domain matches your domain
4. Check Cloudflare Email Service limits

### Database locked
- SQLite doesn't handle concurrent writes well
- For heavy use, consider migrating to PostgreSQL

## FILE LOCATIONS

```
R:/email_client/
├── emails.db              # SQLite database (your emails)
├── attachments/           # Email attachments
└── backups/              # (create manually)
```

## UPGRADING

### Add PostgreSQL instead of SQLite
Edit `main.py`:
```python
# Replace sqlite3 imports with asyncpg
# Change DB_PATH to DATABASE_URL
# Use async/await for all DB operations
```

### Add Multiple Mailboxes
The backend already supports multiple `to` addresses. Just add more routing rules in Cloudflare.

### Add Encryption
For extra privacy, encrypt the SQLite database at rest using SQLCipher.
