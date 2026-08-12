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
  return String(value || '')
    .replace(/=\r?\n/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(value, compact = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (compact) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return date.toLocaleString([], { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' });
}

function safeHtmlDocument(html = '') {
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'style', 'class', 'id', 'role', 'aria-label'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus']
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html,body{margin:0;padding:0;background:#fff;color:#111827;font-family:Inter,Segoe UI,Arial,sans-serif;overflow-wrap:anywhere}body{padding:22px;line-height:1.48}img{max-width:100%;height:auto}table{max-width:100%}a{cursor:pointer;color:#2563eb}</style></head><body>${clean}</body></html>`;
}

function firstHttpLink(html = '') {
  if (!html || typeof document === 'undefined') return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const link = Array.from(doc.querySelectorAll('a[href]')).find(node => /^https?:/i.test(node.href));
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
    if (search.trim()) params.set('search', search.trim());
    if (currentAccount !== 'all') params.set('account', currentAccount);
    try {
      const data = await requestJson(`${API_BASE}/emails?${params}`);
      setEmails(data.emails || []);
    } catch (error) {
      setNotice(`Mail load failed: ${error.message}`);
    }
  }, [currentAccount, currentFolder, requestJson, search]);

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
      setNotice(`CALI dossier unavailable: ${error.message}`);
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
      setNotice(`Could not open message: ${error.message}`);
    }
  }

  async function patchEmail(id, payload) {
    await requestJson(`${API_BASE}/emails/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    await Promise.all([fetchEmails(), refreshChrome()]);
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
      setNotice('Message moved to Snoozed.');
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
      text: `\n\n---------- Forwarded message ----------\nFrom: ${selectedEmail.sender || ''}\nDate: ${selectedEmail.date || ''}\nSubject: ${selectedEmail.subject || ''}\n\n${cleanText(selectedEmail.text_body || '')}`
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
      setNotice('Message sent.');
      await fetchEmails();
    } catch (error) { setNotice(`Send failed: ${error.message}`); }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const result = await requestJson(`${API_BASE}/integrations/cali/retry-pending?limit=100`, { method: 'POST' });
      setNotice(result.attempted ? `CALI sync: ${result.delivered}/${result.attempted} handoffs delivered.` : 'Mail + CALI already synchronized.');
      await refreshChrome();
      if (selectedSenderEmail) await loadCaliDossier(selectedSenderEmail);
    } catch (error) { setNotice(`Sync failed: ${error.message}`); }
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
  const stage = legacyContact.crm_stage || primaryRole?.role || (caliParty ? 'Relationship' : 'Unlinked');
  const lastContact = legacyContact.last_contacted_at || caliDossier?.latest_message?.occurred_at || selectedEmail?.date;
  const nextAction = legacyContact.next_follow_up_at || '—';
  const verification = caliParty?.verification_state || identities.email?.[0]?.verification_state || 'unverified';

  return (
    <div className="pm4-app">
      <header className="pm4-topbar">
        <div className="pm4-brand"><div className="pm4-brandmark">P</div><strong>PRIME MAIL</strong></div>
        <div className="pm4-search-wrap"><span>⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search mail, people, attachments..." /></div>
        <select className="pm4-account-select" value={currentAccount} onChange={event => { setCurrentAccount(event.target.value); setSelectedEmail(null); }}>
          <option value="all">All accounts</option>
          {accounts.map(account => <option key={account.email} value={account.email}>{account.email}</option>)}
        </select>
        <button className="pm4-btn pm4-green" onClick={() => openCompose()}>Compose</button>
        <button className="pm4-btn pm4-blue" onClick={callOrb}>ORB</button>
        <button className="pm4-btn pm4-dark" onClick={() => openCrm('/contacts')}>CRM</button>
        <button className="pm4-btn pm4-dark" onClick={() => openCrm('/calendar')}>Calendar</button>
        <button className={`pm4-sync ${syncing ? 'busy' : ''}`} onClick={syncNow}><span />{syncing ? 'SYNCING' : 'SYNC'}</button>
      </header>

      <main className="pm4-shell">
        <aside className="pm4-sidebar">
          <button className="pm4-compose-wide" onClick={() => openCompose()}>＋ Compose</button>
          <div className="pm4-label">WORKSPACE</div>
          <div className="pm4-workspace"><button className="active">Mail</button><button onClick={() => openCrm('/contacts')}>CRM</button><button onClick={() => openCrm('/calendar')}>Cal</button></div>

          <div className="pm4-label">MAILBOX</div>
          <div className="pm4-mailbox-card"><span className="pm4-dot blue" /><div><strong>{selectedAccount || 'All accounts'}</strong><small>{stats.unread_emails ?? emails.filter(item => !item.read).length} unread · {currentAccount === 'all' ? 'All accounts' : 'This account'}</small></div></div>

          <div className="pm4-label">FOLDERS</div>
          <nav className="pm4-folders">
            {folderNames.map(name => <button key={name} className={currentFolder === name ? 'active' : ''} onClick={() => { setCurrentFolder(name); setSelectedEmail(null); }}><span className="pm4-radio" /><span>{name.charAt(0).toUpperCase() + name.slice(1)}</span>{folderCount(name) !== '' && <b>{folderCount(name)}</b>}</button>)}
          </nav>

          <div className="pm4-label">BUSINESS</div>
          <div className="pm4-business-card"><strong>{activeBusinessLabel}</strong><small>{businessScope === 'all' ? 'All relationship contexts' : businessScope.replaceAll('_', '.')}</small><select value={businessScope} onChange={event => changeBusiness(event.target.value)}>{BUSINESS_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>

          <div className="pm4-label">CONNECTED</div>
          <div className="pm4-connected"><div><span className={`pm4-dot ${crmOnline ? 'green' : 'amber'}`} />CRM<small>{crmOnline ? 'Connected' : 'Check'}</small></div><div><span className={`pm4-dot ${calendarOnline ? 'green' : 'amber'}`} />Calendar<small>{calendarOnline ? 'Connected' : 'Check'}</small></div><div><span className="pm4-dot green" />Sync<small>{syncing ? 'Working' : 'Ready'}</small></div></div>
          <div className="pm4-sidebar-footer"><button onClick={() => openCrm('/settings')}>⚙ Settings</button><button onClick={() => setNotice('Manage accounts from PRIME MAIL registry settings.')}>Manage accounts</button></div>
        </aside>

        <section className="pm4-list-panel">
          <div className="pm4-list-head"><div><h2>{currentFolder.charAt(0).toUpperCase() + currentFolder.slice(1)}</h2><span>{emails.length} messages</span></div><div><select value={sortOrder} onChange={event => setSortOrder(event.target.value)}><option value="desc">Newest ↓</option><option value="asc">Oldest ↑</option></select><button onClick={fetchEmails}>↻</button></div></div>
          <div className="pm4-message-scroll">
            {sortedEmails.map(email => <button key={email.id} className={`pm4-message ${selectedEmail?.id === email.id ? 'selected' : ''} ${!email.read ? 'unread' : ''}`} onClick={() => openEmail(email)}><div><strong>{displayName(email.sender)}</strong><time>{formatDate(email.date, true)}</time></div><h3>{email.subject || '(No subject)'}</h3><p>{cleanText(email.text_body || '').slice(0, 92) || 'HTML message'}</p><span>Inbox</span></button>)}
            {!sortedEmails.length && <div className="pm4-empty">No messages in this folder.</div>}
          </div>
        </section>

        <section className="pm4-reader">
          {selectedEmail ? <>
            <div className="pm4-reader-head"><h1>{selectedEmail.subject || '(No subject)'}</h1><div className="pm4-meta"><span>From</span><strong>{selectedEmail.sender}</strong><span>To</span><strong>{selectedEmail.recipient}</strong><time>{formatDate(selectedEmail.date)}</time></div></div>
            {actionLink && <div className="pm4-security"><div><strong>Identity verification detected</strong><small>Secure action link found in this message.</small></div><button onClick={() => window.open(actionLink, '_blank', 'noopener,noreferrer')}>Verify →</button></div>}
            <div className="pm4-reader-body">{selectedEmail.html_body ? <ReaderFrame html={selectedEmail.html_body} /> : <pre>{cleanText(selectedEmail.text_body || '')}</pre>}</div>
            <div className="pm4-reader-actions"><button onClick={reply}>Reply</button><button onClick={forward}>Forward</button><button onClick={archiveSelected}>Archive</button><button className="danger" onClick={deleteSelected}>Delete</button><button onClick={snoozeSelected}>Snooze</button><button className="event" onClick={createEvent}>＋ Event</button></div>
          </> : <div className="pm4-reader-empty"><div className="pm4-brandmark large">P</div><h2>PRIME MAIL</h2><p>Select a message to open the reader and relationship dossier.</p></div>}
        </section>

        <aside className="pm4-dossier">
          <div className="pm4-dossier-head"><div><strong>CONTACT DOSSIER</strong><span>{dossierLoading ? 'LOADING' : 'DOCKED'}</span></div><button onClick={() => openCrm('/contacts')}>↗</button></div>
          {selectedEmail ? <div className="pm4-dossier-scroll">
            <div className="pm4-person-card"><div className="pm4-avatar">{initials(senderName)}</div><div><h2>{senderName}</h2><p>{legacyContact.company_role || primaryRole?.role || (caliParty ? 'CALI relationship' : 'Mail correspondent')}</p><span className={caliParty ? 'linked' : 'unlinked'}>{caliParty ? 'CALI LINKED' : 'UNLINKED'}</span></div></div>

            <div className="pm4-dossier-label">CONTACT</div>
            <div className="pm4-dossier-card"><div><span>Email</span><strong>{primaryEmail || '—'}</strong></div><div><span>Phone</span><strong>{primaryPhone || '—'}</strong></div><div><span>Company</span><strong>{company || '—'}</strong></div></div>

            <div className="pm4-dossier-label">CRM STATUS</div>
            <div className="pm4-dossier-card"><div><span>Stage</span><strong>{stage}</strong></div><div><span>Last contact</span><strong>{formatDate(lastContact) || 'Current email'}</strong></div><div><span>Next action</span><strong>{nextAction}</strong></div><div><span>Identity</span><strong>{verification}</strong></div></div>

            <div className="pm4-dossier-label">RECENT ACTIVITY</div>
            <div className="pm4-activity-card">{recentTimeline.length ? recentTimeline.map((event, index) => <div key={event.message_id || index}><span className={`pm4-dot ${index === 0 ? 'green' : index === 1 ? 'blue' : 'purple'}`} /><div><strong>{event.title || `${event.direction || 'Email'} message`}</strong><small>{formatDate(event.occurred_at)} · {event.direction || 'email'}</small></div></div>) : <div><span className="pm4-dot blue" /><div><strong>{caliParty ? 'CALI contact linked' : 'No CALI history yet'}</strong><small>{caliParty ? 'Canonical identity resolved' : 'This sender will link when communication is ingested'}</small></div></div>}</div>

            <div className="pm4-dossier-label">QUICK ACTIONS</div>
            <div className="pm4-quick-actions"><button className="primary" onClick={() => openCrm('/contacts')}>Open CRM</button><button onClick={() => openCrm('/contacts')}>Add note</button><button onClick={createEvent}>Event</button></div>
            <div className="pm4-linked-banner">Mail + CRM + Calendar linked <span>{crmOnline ? 'SYNCED' : 'CHECK CRM'}</span></div>
          </div> : <div className="pm4-dossier-empty">Select a message to load its CALI relationship dossier.</div>}
        </aside>
      </main>

      {notice && <div className="pm4-notice" onClick={() => setNotice('')}>{notice}<button>×</button></div>}

      {composeOpen && <div className="pm4-modal-backdrop" onMouseDown={() => setComposeOpen(false)}><form className="pm4-compose-modal" onSubmit={sendCompose} onMouseDown={event => event.stopPropagation()}><div className="pm4-compose-title"><strong>New message</strong><button type="button" onClick={() => setComposeOpen(false)}>×</button></div><label>From<select value={compose.from_address} onChange={event => setCompose(prev => ({ ...prev, from_address: event.target.value }))}>{accounts.map(account => <option key={account.email} value={account.email}>{account.email}</option>)}</select></label><label>To<input required value={compose.to} onChange={event => setCompose(prev => ({ ...prev, to: event.target.value }))} /></label><label>Subject<input value={compose.subject} onChange={event => setCompose(prev => ({ ...prev, subject: event.target.value }))} /></label><textarea value={compose.text} onChange={event => setCompose(prev => ({ ...prev, text: event.target.value }))} placeholder="Write your message..." /><div className="pm4-compose-footer"><button type="button" onClick={() => setComposeOpen(false)}>Cancel</button><button type="submit" className="send">Send</button></div></form></div>}
    </div>
  );
}
