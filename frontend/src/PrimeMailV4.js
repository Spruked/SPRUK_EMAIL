import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import './PrimeMailV4.css';

const API_BASE = (process.env.REACT_APP_API_BASE || '/api').replace(/\/$/, '');
const CRM_UI = (process.env.REACT_APP_CRM_UI_URL || 'http://127.0.0.1:21010').replace(/\/$/, '');

const BUSINESS_OPTIONS = [
  ['all', 'All'],
  ['spruked', 'Spruked'],
  ['truemark_mint', 'TrueMark Mint'],
  ['certsig', 'CertSig'],
  ['alpha_certsig', 'Alpha CertSig'],
  ['personal', 'Personal']
];

const DEFAULT_FOLDERS = ['inbox', 'drafts', 'sent', 'starred', 'archive', 'spam', 'trash'];
const FOLDER_LABELS = {
  inbox: 'Signal Feed',
  drafts: 'Draft Holds',
  sent: 'Transmissions',
  starred: 'Star Marks',
  archive: 'Archive Custody',
  spam: 'Quarantine',
  trash: 'Tombstones',
  snoozed: 'Deferred Signals'
};

function folderLabel(name = '') {
  const key = String(name || '').toLowerCase();
  return FOLDER_LABELS[key] || key.replace(/(^|_)([a-z])/g, (_match, lead, char) => `${lead ? ' ' : ''}${char.toUpperCase()}`);
}

function extractEmail(value = '') {
  const match = String(value).match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim().toLowerCase();
  const plain = String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return (plain?.[0] || String(value)).trim().toLowerCase();
}

function displayName(value = '') {
  const text = String(value || '').trim();
  if (!text) return 'Unknown';
  if (text.includes('<')) return text.split('<')[0].replace(/["']/g, '').trim() || extractEmail(text);
  if (text.includes('@')) return text.split('@')[0].replace(/[._-]+/g, ' ');
  return text;
}

function initials(value = '') {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase();
}

function cleanText(value = '') {
  return decodeQuotedPrintableArtifacts(value)
    .replace(/=\r?\n/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeQuotedPrintableArtifacts(value = '') {
  const input = String(value || '');
  if (!/(=\r?\n|=[0-9A-Fa-f]{2})/.test(input)) return input;
  const source = input.replace(/=\r?\n/g, '');
  const bytes = [];
  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '=' && /^[0-9A-Fa-f]{2}$/.test(source.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(source.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    if (encoder) bytes.push(...encoder.encode(source[index]));
    else bytes.push(source.charCodeAt(index));
  }
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    return source.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
}

function normalizeEmailHtml(html = '') {
  return decodeQuotedPrintableArtifacts(html)
    .replace(/\b(href|src|action)\s*=\s*3D(["'])/gi, '$1=$2')
    .replace(/\b(href|src|action)\s*=\s*3D(&quot;|&#34;)/gi, '$1=$2')
    .replace(/\b(href|src)\s*=\s*(["'])3D\2(https?:\/\/[^"'\s>]+)/gi, '$1=$2$3$2')
    .replace(/\b(href|src)\s*=\s*(["'])3D(https?:\/\/[^"'\s>]+)\2/gi, '$1=$2$3$2');
}

function formatDate(value, compact = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (compact) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return date.toLocaleString([], { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' });
}

function safeHtmlDocument(html = '') {
  const clean = DOMPurify.sanitize(normalizeEmailHtml(html), {
    ADD_ATTR: ['target', 'rel', 'style', 'class', 'id', 'role', 'aria-label', 'type'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus']
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html,body{margin:0;padding:0;background:#fff;color:#111827;font-family:Inter,Segoe UI,Arial,sans-serif;overflow-wrap:anywhere}body{padding:22px;line-height:1.48}img{max-width:100%;height:auto}table{max-width:100%}a{cursor:pointer;color:#2563eb}a[style],button[style]{max-width:100%}button{font:inherit}</style></head><body>${clean}</body></html>`;
}

function firstHttpLink(html = '') {
  if (!html || typeof document === 'undefined') return '';
  try {
    const doc = new DOMParser().parseFromString(normalizeEmailHtml(html), 'text/html');
    const link = Array.from(doc.querySelectorAll('a[href]')).find(node => /^https?:/i.test(node.getAttribute('href') || node.href));
    return link?.href || '';
  } catch {
    return '';
  }
}

function ReaderFrame({ html }) {
  const srcDoc = useMemo(() => safeHtmlDocument(html), [html]);
  return <iframe className="pm4-html-frame" title="Rendered email" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={srcDoc} />;
}

export default function PrimeMailV4() {
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [folders, setFolders] = useState([]);
  const [stats, setStats] = useState({});
  const [integrations, setIntegrations] = useState({});
  const [currentAccount, setCurrentAccount] = useState('all');
  const [currentFolder, setCurrentFolder] = useState('inbox');
  const [businessScope, setBusinessScope] = useState(() => localStorage.getItem('prime_mail_business_scope') || 'spruked');
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState({ from_address: '', to: '', subject: '', text: '' });
  const [notice, setNotice] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [caliParty, setCaliParty] = useState(null);
  const [caliDossier, setCaliDossier] = useState(null);
  const [caliTimeline, setCaliTimeline] = useState([]);
  const [dossierLoading, setDossierLoading] = useState(false);

  const selectedAccount = currentAccount === 'all' ? (accounts[0]?.email || '') : currentAccount;
  const crmOnline = Boolean(integrations?.crm?.online || integrations?.crm_api?.status === 'ok' || integrations?.crm_db?.status === 'ok');
  const calendarOnline = integrations?.calendar?.online ?? crmOnline;
  const selectedSenderEmail = extractEmail(selectedEmail?.sender || '');
  const senderName = caliDossier?.party?.display_name || caliParty?.display_name || displayName(selectedEmail?.sender || '');
  const legacyContact = caliDossier?.legacy_contact || {};
  const identities = caliDossier?.identities || {};
  const primaryPhone = identities.phone?.[0]?.value_raw || legacyContact.phone || '';
  const primaryEmail = identities.email?.[0]?.value_raw || selectedSenderEmail;
  const primaryRole = caliDossier?.roles?.[0] || null;
  const company = legacyContact.company_role || primaryRole?.business_label || '';
  const actionLink = useMemo(() => firstHttpLink(selectedEmail?.html_body || ''), [selectedEmail]);

  const requestJson = useCallback(async (url, options = {}) => {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `${response.status} ${response.statusText}`);
    return data;
  }, []);

  const fetchEmails = useCallback(async () => {
    const params = new URLSearchParams({ folder: currentFolder, limit: '100' });
    params.set('order', sortOrder === 'asc' ? 'asc' : 'desc');
    if (search.trim()) params.set('search', search.trim());
    if (currentAccount !== 'all') params.set('account', currentAccount);
    try {
      const data = await requestJson(`${API_BASE}/emails?${params}`);
      setEmails(data.emails || []);
    } catch (error) {
      setNotice(`Signal feed failed: ${error.message}`);
    }
  }, [currentAccount, currentFolder, requestJson, search, sortOrder]);

  const refreshChrome = useCallback(async () => {
    const accountCall = requestJson(`${API_BASE}/accounts`).catch(() => ({ accounts: [] }));
    const folderCall = requestJson(`${API_BASE}/folders${currentAccount !== 'all' ? `?account=${encodeURIComponent(currentAccount)}` : ''}`).catch(() => ({ folders: [] }));
    const statsCall = requestJson(`${API_BASE}/stats`).catch(() => ({}));
    const integrationCall = requestJson(`${API_BASE}/integrations/status`).catch(() => ({}));
    const [accountData, folderData, statsData, integrationData] = await Promise.all([accountCall, folderCall, statsCall, integrationCall]);
    setAccounts(accountData.accounts || []);
    setFolders(folderData.folders || []);
    setStats(statsData || {});
    setIntegrations(integrationData || {});
    setCompose(prev => ({ ...prev, from_address: prev.from_address || accountData.default_account || accountData.accounts?.[0]?.email || '' }));
  }, [currentAccount, requestJson]);

  useEffect(() => {
    fetchEmails();
    refreshChrome();
  }, [fetchEmails, refreshChrome]);

  useEffect(() => {
    const timer = setInterval(() => {
      fetchEmails();
      refreshChrome();
    }, 30000);
    return () => clearInterval(timer);
  }, [fetchEmails, refreshChrome]);

  const sortedEmails = useMemo(() => {
    return [...emails].sort((a, b) => {
      const left = new Date(a.date || 0).getTime();
      const right = new Date(b.date || 0).getTime();
      return sortOrder === 'asc' ? left - right : right - left;
    });
  }, [emails, sortOrder]);

  const loadCaliDossier = useCallback(async (email) => {
    const normalized = extractEmail(email);
    setCaliParty(null);
    setCaliDossier(null);
    setCaliTimeline([]);
    if (!normalized) return;
    setDossierLoading(true);
    try {
      const resolved = await requestJson(`${API_BASE}/integrations/cali/resolve?email=${encodeURIComponent(normalized)}`);
      const party = resolved?.party || null;
      setCaliParty(party);
      if (!resolved?.found || !party?.party_id) return;
      const encodedParty = encodeURIComponent(party.party_id);
      const scope = encodeURIComponent(businessScope || 'all');
      const [dossier, timeline] = await Promise.all([
        requestJson(`${API_BASE}/integrations/cali/parties/${encodedParty}/dossier?business_scope=${scope}`).catch(() => null),
        requestJson(`${API_BASE}/integrations/cali/parties/${encodedParty}/timeline?business_scope=${scope}&channel=email&limit=12`).catch(() => ({ events: [] }))
      ]);
      setCaliDossier(dossier);
      setCaliTimeline(timeline?.events || []);
    } catch (error) {
      setNotice(`VIV dossier unavailable: ${error.message}`);
    } finally {
      setDossierLoading(false);
    }
  }, [businessScope, requestJson]);

  useEffect(() => {
    if (selectedSenderEmail) loadCaliDossier(selectedSenderEmail);
  }, [loadCaliDossier, selectedSenderEmail]);

  async function openEmail(email) {
    try {
      const data = await requestJson(`${API_BASE}/emails/${email.id}`);
      setSelectedEmail(data);
    } catch (error) {
      setNotice(`Could not open signal: ${error.message}`);
    }
  }

  async function patchEmail(id, payload) {
    await requestJson(`${API_BASE}/emails/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    await Promise.all([fetchEmails(), refreshChrome()]);
  }

  async function toggleStar(event, email) {
    event.stopPropagation();
    try {
      await patchEmail(email.id, { starred: !email.starred });
      if (selectedEmail?.id === email.id) {
        setSelectedEmail(prev => prev ? { ...prev, starred: !prev.starred } : prev);
      }
    } catch (error) { setNotice(error.message); }
  }

  async function archiveSelected() {
    if (!selectedEmail) return;
    try {
      await patchEmail(selectedEmail.id, { archived: true, folder: 'archive' });
      setSelectedEmail(null);
    } catch (error) { setNotice(error.message); }
  }

  async function snoozeSelected() {
    if (!selectedEmail) return;
    try {
      await patchEmail(selectedEmail.id, { folder: 'snoozed' });
      setNotice('Signal moved to Deferred Signals.');
      setSelectedEmail(null);
    } catch (error) { setNotice(error.message); }
  }

  async function deleteSelected() {
    if (!selectedEmail) return;
    try {
      await requestJson(`${API_BASE}/emails/${selectedEmail.id}`, { method: 'DELETE' });
      setSelectedEmail(null);
      await Promise.all([fetchEmails(), refreshChrome()]);
    } catch (error) { setNotice(error.message); }
  }

  function openCompose(seed = {}) {
    setCompose(prev => ({
      from_address: seed.from_address || prev.from_address || selectedAccount,
      to: seed.to ?? '', subject: seed.subject ?? '', text: seed.text ?? ''
    }));
    setComposeOpen(true);
  }

  function reply() {
    if (!selectedEmail) return;
    openCompose({
      from_address: selectedEmail.recipient || selectedAccount,
      to: extractEmail(selectedEmail.sender),
      subject: `Re: ${selectedEmail.subject || ''}`,
      text: ''
    });
  }

  function forward() {
    if (!selectedEmail) return;
    openCompose({
      subject: `Fwd: ${selectedEmail.subject || ''}`,
      text: `\n\n---------- Relay Forward ----------\nOrigin Signature: ${selectedEmail.sender || ''}\nTimestamp: ${selectedEmail.date || ''}\nBrief: ${selectedEmail.subject || ''}\n\n${cleanText(selectedEmail.text_body || '')}`
    });
  }

  async function sendCompose(event) {
    event.preventDefault();
    try {
      await requestJson(`${API_BASE}/emails/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(compose)
      });
      setComposeOpen(false);
      setCompose(prev => ({ ...prev, to: '', subject: '', text: '' }));
      setNotice('Transmission executed.');
      await fetchEmails();
    } catch (error) { setNotice(`Transmission failed: ${error.message}`); }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const result = await requestJson(`${API_BASE}/integrations/cali/retry-pending?limit=100`, { method: 'POST' });
      setNotice(result.attempted ? `Durable handoff: ${result.delivered}/${result.attempted} signals delivered.` : 'Signal bridge already synchronized.');
      await refreshChrome();
      if (selectedSenderEmail) await loadCaliDossier(selectedSenderEmail);
    } catch (error) { setNotice(`Bridge sync failed: ${error.message}`); }
    finally { setSyncing(false); }
  }

  function openCrm(path = '/contacts') {
    const params = new URLSearchParams();
    if (caliParty?.party_id) params.set('party_id', caliParty.party_id);
    if (businessScope && businessScope !== 'all') params.set('business_scope', businessScope);
    window.open(`${CRM_UI}${path}${params.toString() ? `?${params}` : ''}`, '_blank', 'noopener,noreferrer');
  }

  function createEvent() {
    const params = new URLSearchParams();
    if (caliParty?.party_id) params.set('party_id', caliParty.party_id);
    if (senderName) params.set('contact', senderName);
    if (selectedEmail?.subject) params.set('subject', selectedEmail.subject);
    if (businessScope && businessScope !== 'all') params.set('business_scope', businessScope);
    window.open(`${CRM_UI}/calendar?${params}`, '_blank', 'noopener,noreferrer');
  }

  async function callOrb() {
    try {
      const data = await requestJson(`${API_BASE}/integrations/orb/query`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'status', context: { source: 'prime_mail', selected_email_id: selectedEmail?.id || null, party_id: caliParty?.party_id || null, business_scope: businessScope } })
      });
      setNotice(data.response || 'ORB connected.');
    } catch (error) { setNotice(`ORB unavailable: ${error.message}`); }
  }

  function changeBusiness(value) {
    setBusinessScope(value);
    localStorage.setItem('prime_mail_business_scope', value);
  }

  const folderNames = useMemo(() => {
    const dynamic = folders.map(item => String(item.name || item.folder || item).toLowerCase()).filter(Boolean);
    return Array.from(new Set([...DEFAULT_FOLDERS, ...dynamic]));
  }, [folders]);

  function folderCount(name) {
    const item = folders.find(row => String(row.name || row.folder || row).toLowerCase() === name);
    return item?.unread ?? item?.count ?? (name === 'inbox' ? emails.filter(item => !item.read).length : '');
  }

  const activeBusinessLabel = BUSINESS_OPTIONS.find(([id]) => id === businessScope)?.[1] || businessScope;
  const recentTimeline = caliTimeline.slice(0, 3);
  const stage = legacyContact.crm_stage || primaryRole?.role || (caliParty ? 'Known Link' : 'Unlinked');
  const lastContact = legacyContact.last_contacted_at || caliDossier?.latest_message?.occurred_at || selectedEmail?.date;
  const nextAction = legacyContact.next_follow_up_at || '-';
  const verification = caliParty?.verification_state || identities.email?.[0]?.verification_state || 'unverified';

  return (
    <div className="pm4-app">
      <header className="pm4-topbar">
        <div className="pm4-brand"><img className="pm4-brand-logo" src="/VIVLOGO.png" alt="VIV" /><strong>VIV</strong></div>
        <div className="pm4-search-wrap"><span>Scan</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Signal scan: subject, origin, body..." /></div>
        <select className="pm4-account-select" value={currentAccount} onChange={event => { setCurrentAccount(event.target.value); setSelectedEmail(null); }}>
          <option value="all">All Field Units</option>
          {accounts.map(account => <option key={account.email} value={account.email}>{account.email}</option>)}
        </select>
        <button className="pm4-btn pm4-green" onClick={() => openCompose()}>Compose Transmission</button>
        <button className="pm4-btn pm4-blue" onClick={callOrb}>ORB</button>
        <button className="pm4-btn pm4-dark" onClick={() => openCrm('/contacts')}>Dossiers</button>
        <button className="pm4-btn pm4-dark" onClick={() => openCrm('/calendar')}>Event Grid</button>
        <button className={`pm4-sync ${syncing ? 'busy' : ''}`} onClick={syncNow}><span />{syncing ? 'BRIDGING' : 'BRIDGE'}</button>
      </header>

      <main className="pm4-shell">
        <aside className="pm4-sidebar">
          <button className="pm4-compose-wide" onClick={() => openCompose()}>+ Compose Transmission</button>
          <div className="pm4-label">COMMAND DECK</div>
          <div className="pm4-workspace"><button className="active">Signals</button><button onClick={() => openCrm('/contacts')}>Dossiers</button><button onClick={() => openCrm('/calendar')}>Events</button></div>

          <div className="pm4-label">OPS CHANNEL</div>
          <div className="pm4-mailbox-card"><span className="pm4-dot blue" /><div><strong>{selectedAccount || 'All Field Units'}</strong><small>{stats.unread_emails ?? emails.filter(item => !item.read).length} unread signals - {currentAccount === 'all' ? 'All field units' : 'Active field unit'}</small></div></div>

          <div className="pm4-label">SIGNAL VAULTS</div>
          <nav className="pm4-folders">
            {folderNames.map(name => <button key={name} className={currentFolder === name ? 'active' : ''} onClick={() => { setCurrentFolder(name); setSelectedEmail(null); }}><img className="pm4-folder-logo" src={name === 'starred' ? '/redVIVlogo.png' : '/VIVLOGO.png'} alt="" /><span>{folderLabel(name)}</span>{folderCount(name) !== '' && <b>{folderCount(name)}</b>}</button>)}
          </nav>

          <div className="pm4-label">COMPARTMENT</div>
          <div className="pm4-business-card"><strong>{activeBusinessLabel}</strong><small>{businessScope === 'all' ? 'All compartment scopes' : businessScope.replaceAll('_', '.')}</small><select value={businessScope} onChange={event => changeBusiness(event.target.value)}>{BUSINESS_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>

          <div className="pm4-label">BRIDGES</div>
          <div className="pm4-connected"><div><span className={`pm4-dot ${crmOnline ? 'green' : 'amber'}`} />VIV<small>{crmOnline ? 'Linked' : 'Check'}</small></div><div><span className={`pm4-dot ${calendarOnline ? 'green' : 'amber'}`} />Event Grid<small>{calendarOnline ? 'Linked' : 'Check'}</small></div><div><span className="pm4-dot green" />Custody<small>{syncing ? 'Working' : 'Ready'}</small></div></div>
          <div className="pm4-sidebar-footer"><button onClick={() => openCrm('/settings')}>Cipher</button><button onClick={() => setNotice('Manage field units from VIV registry settings.')}>Field units</button></div>
        </aside>

        <section className="pm4-list-panel">
          <div className="pm4-list-head"><div><h2>{folderLabel(currentFolder)}</h2><span>{emails.length} signals</span></div><div><select value={sortOrder} onChange={event => setSortOrder(event.target.value)}><option value="desc">Chrono Sort: Newest First</option><option value="asc">Chrono Sort: Oldest First</option></select><button onClick={fetchEmails}>Scan</button></div></div>
          <div className="pm4-message-scroll">
            {sortedEmails.map(email => <article key={email.id} className={`pm4-message ${selectedEmail?.id === email.id ? 'selected' : ''} ${!email.read ? 'unread' : ''}`} onClick={() => openEmail(email)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') openEmail(email); }}><div><strong>{displayName(email.sender)}</strong><time>{formatDate(email.date, true)}</time></div><h3>{email.subject || '(No subject)'}</h3><p>{cleanText(email.text_body || email.html_body || '').slice(0, 92) || 'HTML message'}</p><div className="pm4-message-foot"><span>{email.folder || currentFolder}</span>{!String(email.id).startsWith('sent_') && <button className={email.starred ? 'pm4-star starred' : 'pm4-star'} onClick={event => toggleStar(event, email)} aria-label={email.starred ? 'Clear importance mark' : 'Mark important'}>{email.starred ? <img className="pm4-importance-logo" src="/redVIVlogo.png" alt="" /> : <span className="pm4-star-empty" />}</button>}</div></article>)}
            {!sortedEmails.length && <div className="pm4-empty">No signals in this vault.</div>}
          </div>
        </section>

        <section className="pm4-reader">
          {selectedEmail ? <>
            <div className="pm4-reader-head"><h1>{selectedEmail.subject || '(No brief)'}</h1><div className="pm4-meta"><span>Origin</span><strong>{selectedEmail.sender}</strong><span>Target</span><strong>{selectedEmail.recipient}</strong><time>{formatDate(selectedEmail.date)}</time></div></div>
            {actionLink && <div className="pm4-security"><div><strong>Verification protocol detected</strong><small>External identity-confirmation link found in this signal.</small></div><button onClick={() => window.open(actionLink, '_blank', 'noopener,noreferrer')}>Execute -></button></div>}
            <div className="pm4-reader-body">{selectedEmail.html_body ? <ReaderFrame html={selectedEmail.html_body} /> : <pre>{cleanText(selectedEmail.text_body || '')}</pre>}</div>
            <div className="pm4-reader-actions"><button onClick={reply}>Intercept</button><button onClick={forward}>Relay Forward</button><button onClick={archiveSelected}>Archive Custody</button><button onClick={event => toggleStar(event, selectedEmail)}>{selectedEmail.starred ? 'Clear Star Mark' : 'Star Mark'}</button><button className="danger" onClick={deleteSelected}>Tombstone</button><button onClick={snoozeSelected}>Defer</button><button className="event" onClick={createEvent}>+ Event</button></div>
          </> : <div className="pm4-reader-empty"><img className="pm4-reader-logo" src="/VIVLOGO.png" alt="VIV" /><h2>VIV</h2><p>Select a signal to open the reader and docked dossier.</p></div>}
        </section>

        <aside className="pm4-dossier">
          <div className="pm4-dossier-head"><div><strong>DOCKED DOSSIER</strong><span>{dossierLoading ? 'RESOLVING' : 'DOCKED'}</span></div><button onClick={() => openCrm('/contacts')}>Open</button></div>
          {selectedEmail ? <div className="pm4-dossier-scroll">
            <div className="pm4-person-card"><div className="pm4-avatar">{initials(senderName)}</div><div><h2>{senderName}</h2><p>{legacyContact.company_role || primaryRole?.role || (caliParty ? 'Known subject' : 'Unresolved origin')}</p><span className={caliParty ? 'linked' : 'unlinked'}>{caliParty ? 'IDENTITY RESOLVED' : 'UNRESOLVED'}</span></div></div>

            <div className="pm4-dossier-label">CANONICAL IDENTITY</div>
            <div className="pm4-dossier-card"><div><span>Origin</span><strong>{primaryEmail || '-'}</strong></div><div><span>Line</span><strong>{primaryPhone || '-'}</strong></div><div><span>Affiliation</span><strong>{company || '-'}</strong></div></div>

            <div className="pm4-dossier-label">INTELLIGENCE STATE</div>
            <div className="pm4-dossier-card"><div><span>Escalation</span><strong>{stage}</strong></div><div><span>Last signal</span><strong>{formatDate(lastContact) || 'Current signal'}</strong></div><div><span>Next command</span><strong>{nextAction}</strong></div><div><span>Verification</span><strong>{verification}</strong></div></div>

            <div className="pm4-dossier-label">EVENT TIMELINE</div>
            <div className="pm4-activity-card">{recentTimeline.length ? recentTimeline.map((event, index) => <div key={event.message_id || index}><span className={`pm4-dot ${index === 0 ? 'green' : index === 1 ? 'blue' : 'purple'}`} /><div><strong>{event.title || `${event.direction || 'Signal'} event`}</strong><small>{formatDate(event.occurred_at)} - {event.direction || 'signal'}</small></div></div>) : <div><span className="pm4-dot blue" /><div><strong>{caliParty ? 'Canonical identity linked' : 'No event timeline yet'}</strong><small>{caliParty ? 'Subject resolved through VIV' : 'This origin will link when the signal is ingested'}</small></div></div>}</div>

            <div className="pm4-dossier-label">COMMANDS</div>
            <div className="pm4-quick-actions"><button className="primary" onClick={() => openCrm('/contacts')}>Open Dossier</button><button onClick={() => openCrm('/contacts')}>Add Claim</button><button onClick={createEvent}>Event</button></div>
            <div className="pm4-linked-banner">Signals + Dossiers + Event Grid linked <span>{crmOnline ? 'BRIDGED' : 'CHECK BRIDGE'}</span></div>
          </div> : <div className="pm4-dossier-empty">Select a signal to load its VIV dossier.</div>}
        </aside>
      </main>

      {notice && <div className="pm4-notice" onClick={() => setNotice('')}>{notice}<button>x</button></div>}

      {composeOpen && <div className="pm4-modal-backdrop" onMouseDown={() => setComposeOpen(false)}><form className="pm4-compose-modal" onSubmit={sendCompose} onMouseDown={event => event.stopPropagation()}><div className="pm4-compose-title"><strong>Compose Transmission</strong><button type="button" onClick={() => setComposeOpen(false)}>x</button></div><label>Origin<select value={compose.from_address} onChange={event => setCompose(prev => ({ ...prev, from_address: event.target.value }))}>{accounts.map(account => <option key={account.email} value={account.email}>{account.email}</option>)}</select></label><label>Target<input required value={compose.to} onChange={event => setCompose(prev => ({ ...prev, to: event.target.value }))} /></label><label>Brief<input value={compose.subject} onChange={event => setCompose(prev => ({ ...prev, subject: event.target.value }))} /></label><textarea value={compose.text} onChange={event => setCompose(prev => ({ ...prev, text: event.target.value }))} placeholder="Draft transmission..." /><div className="pm4-compose-footer"><button type="button" onClick={() => setComposeOpen(false)}>Stand Down</button><button type="submit" className="send">Execute Send</button></div></form></div>}
    </div>
  );
}
