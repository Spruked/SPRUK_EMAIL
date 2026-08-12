import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import MailRegistryPanel from './MailRegistryPanel';
import './App.css';
import './MailRegistryPanel.css';

const API_BASE = (process.env.REACT_APP_API_BASE || '/api').replace(/\/$/, '');

function extractEmail(value = '') {
  const match = String(value).match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim().toLowerCase();
  const plain = String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return (plain?.[0] || String(value)).trim().toLowerCase();
}

function displayName(value = '') {
  const text = String(value).trim();
  if (!text) return 'Unknown contact';
  if (text.includes('<')) return text.split('<')[0].replace(/["']/g, '').trim() || extractEmail(text);
  if (text.includes('@')) return text.split('@')[0].replace(/[._-]+/g, ' ');
  return text;
}

function normaliseExtra(extra) {
  if (!extra) return {};
  if (typeof extra === 'object') return extra;
  try {
    return JSON.parse(extra);
  } catch {
    return {};
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildSafeEmailDocument(html = '') {
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'style', 'class', 'id', 'role', 'aria-label'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus']
  });

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<base target="_blank" />
<style>
html,body{margin:0;padding:0;background:#fff;color:#111827;font-family:Arial,Helvetica,sans-serif;overflow-wrap:anywhere}
body{padding:20px;line-height:1.45}img{max-width:100%;height:auto}table{max-width:100%}a{cursor:pointer}
</style>
</head><body>${clean}</body></html>`;
}

function extractFirstHttpLink(html = '') {
  if (!html || typeof document === 'undefined') return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const link = Array.from(doc.querySelectorAll('a[href]')).find(anchor => /^https?:/i.test(anchor.href));
    return link?.href || '';
  } catch {
    return '';
  }
}

function EmailHtmlFrame({ html }) {
  const srcDoc = useMemo(() => buildSafeEmailDocument(html), [html]);
  return (
    <iframe
      className="email-html-frame"
      title="Rendered email"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
    />
  );
}

function App() {
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [folders, setFolders] = useState([]);
  const [currentFolder, setCurrentFolder] = useState('inbox');
  const [accounts, setAccounts] = useState([]);
  const [currentAccount, setCurrentAccount] = useState('all');
  const [businessScope, setBusinessScope] = useState(() => localStorage.getItem('prime_mail_business_scope') || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [stats, setStats] = useState({});
  const [showCompose, setShowCompose] = useState(false);
  const [composeData, setComposeData] = useState({ from_address: '', to: '', subject: '', text: '' });
  const [draftStatus, setDraftStatus] = useState('');
  const [contacts, setContacts] = useState([]);
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '', address: '', photo: '', extra: '' });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showContacts, setShowContacts] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showConnections, setShowConnections] = useState(false);
  const [showDossier, setShowDossier] = useState(true);
  const [integrationStatus, setIntegrationStatus] = useState(null);
  const [connectionMessage, setConnectionMessage] = useState('');

  const selectedAccountAddress = currentAccount === 'all' ? (accounts[0]?.email || '') : currentAccount;

  const crmUrl = integrationStatus?.crm?.api_url
    || integrationStatus?.crm_api?.api_url
    || 'http://127.0.0.1:21000';

  const crmOnline = Boolean(
    integrationStatus?.crm?.online
    || integrationStatus?.crm_api?.status === 'ok'
    || integrationStatus?.crm_db?.status === 'ok'
  );

  const calendarOnline = integrationStatus?.calendar?.online
    ?? (integrationStatus?.calendar_api?.status === 'ok' ? true : crmOnline);

  const fetchEmails = useCallback(async () => {
    try {
      const params = new URLSearchParams({ folder: currentFolder, limit: '50' });
      if (searchQuery) params.append('search', searchQuery);
      if (currentAccount !== 'all') params.append('account', currentAccount);
      const res = await fetch(`${API_BASE}/emails?${params}`);
      const data = await res.json();
      setEmails(data.emails || []);
    } catch (err) {
      console.error('Failed to fetch emails:', err);
    }
  }, [currentFolder, searchQuery, currentAccount]);

  const fetchFolders = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (currentAccount !== 'all') params.append('account', currentAccount);
      const query = params.toString();
      const res = await fetch(`${API_BASE}/folders${query ? `?${query}` : ''}`);
      const data = await res.json();
      setFolders(data.folders || []);
    } catch (err) {
      console.error('Failed to fetch folders:', err);
    }
  }, [currentAccount]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      setStats(await res.json());
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/contacts`);
      const data = await res.json();
      setContacts(data.contacts || []);
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/accounts`);
      const data = await res.json();
      setAccounts(data.accounts || []);
      setComposeData(prev => ({
        ...prev,
        from_address: prev.from_address || data.default_account || data.accounts?.[0]?.email || ''
      }));
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
  }, []);

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/integrations/status`);
      setIntegrationStatus(await res.json());
    } catch (err) {
      console.error('Failed to fetch integration status:', err);
    }
  }, []);

  const refreshMailRegistry = useCallback(async () => {
    await Promise.all([fetchAccounts(), fetchFolders(), fetchEmails()]);
  }, [fetchAccounts, fetchFolders, fetchEmails]);

  useEffect(() => {
    fetchAccounts();
    fetchEmails();
    fetchFolders();
    fetchStats();
    fetchContacts();
    fetchIntegrations();

    const interval = setInterval(() => {
      fetchAccounts();
      fetchEmails();
      fetchFolders();
      fetchStats();
      fetchIntegrations();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchAccounts, fetchEmails, fetchFolders, fetchStats, fetchContacts, fetchIntegrations]);

  const sortedEmails = useMemo(() => {
    const next = [...emails];
    next.sort((a, b) => {
      const aTime = new Date(a.date || 0).getTime();
      const bTime = new Date(b.date || 0).getTime();
      return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
    });
    return next;
  }, [emails, sortOrder]);

  const selectedSenderEmail = extractEmail(selectedEmail?.sender || '');
  const selectedContactFromEmail = useMemo(() => {
    if (!selectedEmail) return null;
    const match = contacts.find(contact => extractEmail(contact.email || '') === selectedSenderEmail);
    if (match) return match;
    return {
      name: displayName(selectedEmail.sender),
      email: selectedSenderEmail,
      phone: '',
      address: '',
      extra: {}
    };
  }, [contacts, selectedEmail, selectedSenderEmail]);

  const dossierExtra = normaliseExtra(selectedContactFromEmail?.extra);
  const sanitizedSelectedHtml = selectedEmail?.html_body
    ? DOMPurify.sanitize(selectedEmail.html_body, { ADD_ATTR: ['target', 'style', 'class', 'id'] })
    : '';
  const firstActionLink = useMemo(() => extractFirstHttpLink(sanitizedSelectedHtml), [sanitizedSelectedHtml]);

  const changeAccount = (account, folder = currentFolder) => {
    setCurrentAccount(account);
    setCurrentFolder(String(folder || 'inbox').toLowerCase());
    setSelectedEmail(null);
    setComposeData(prev => ({
      ...prev,
      from_address: account === 'all' ? (accounts[0]?.email || prev.from_address) : account
    }));
  };

  const changeBusinessScope = scope => {
    const next = scope || 'all';
    setBusinessScope(next);
    localStorage.setItem('prime_mail_business_scope', next);
  };

  const openCompose = () => {
    const account = selectedAccountAddress;
    if (account) {
      fetch(`${API_BASE}/drafts/${encodeURIComponent(account)}`)
        .then(res => res.json())
        .then(draft => {
          setComposeData(prev => ({
            from_address: account,
            to: draft.to || prev.to || '',
            subject: draft.subject || prev.subject || '',
            text: draft.text || prev.text || ''
          }));
        })
        .catch(() => {});
    }
    setComposeData(prev => ({ ...prev, from_address: prev.from_address || account }));
    setShowCompose(true);
  };

  const saveDraft = useCallback(async () => {
    const account = composeData.from_address || selectedAccountAddress;
    if (!account || (!composeData.to && !composeData.subject && !composeData.text)) return;
    try {
      await fetch(`${API_BASE}/drafts/${encodeURIComponent(account)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, to: composeData.to, subject: composeData.subject, text: composeData.text })
      });
      setDraftStatus('Draft saved');
    } catch (err) {
      console.error('Failed to save draft:', err);
      setDraftStatus('Draft save failed');
    }
  }, [composeData, selectedAccountAddress]);

  useEffect(() => {
    if (!showCompose) return undefined;
    const timer = setInterval(saveDraft, 7000);
    return () => clearInterval(timer);
  }, [showCompose, saveDraft]);

  const saveContact = async (contact = contactForm) => {
    if (!contact.email && !contact.name) {
      alert('Please provide at least a name or email.');
      return;
    }
    const payload = { ...contact };
    if (payload.extra && typeof payload.extra === 'string') {
      try {
        payload.extra = JSON.parse(payload.extra);
      } catch {
        alert('Extra fields must be valid JSON.');
        return;
      }
    }
    try {
      const res = await fetch(`${API_BASE}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.detail || 'Failed to save contact');
        return;
      }
      setContactForm({ name: '', email: '', phone: '', address: '', photo: '', extra: '' });
      setConnectionMessage(data.crm_sync?.status === 'error'
        ? `Contact saved locally; CALI sync failed: ${data.crm_sync.detail}`
        : 'Contact saved');
      fetchContacts();
      fetchIntegrations();
    } catch (err) {
      console.error('Failed to save contact:', err);
      alert('Failed to save contact');
    }
  };

  const syncEmailToCrm = async () => {
    setConnectionMessage('Syncing mail to CALI...');
    try {
      const res = await fetch(`${API_BASE}/integrations/crm/sync-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: 'inbox', limit: 50, unread_only: false })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConnectionMessage(data.detail || 'CALI sync failed');
        return;
      }
      setConnectionMessage(`CALI sync processed ${data.processed || 0}; linked ${data.linked || 0}; created ${data.created_contacts || 0}`);
      fetchContacts();
      fetchIntegrations();
    } catch (err) {
      console.error('Failed to sync CALI:', err);
      setConnectionMessage('CALI sync failed');
    }
  };

  const testOrbConnection = async () => {
    setConnectionMessage('Testing ORB...');
    try {
      const res = await fetch(`${API_BASE}/integrations/orb/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'status',
          context: {
            source: 'prime_mail',
            business_scope: businessScope,
            selected_email_id: selectedEmail?.id || null,
            selected_contact: selectedContactFromEmail?.email || null
          }
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConnectionMessage(data.detail || 'ORB test failed');
        return;
      }
      setConnectionMessage(data.response || 'ORB connection ok');
    } catch (err) {
      console.error('Failed to test ORB:', err);
      setConnectionMessage('ORB test failed');
    }
  };

  const openEmail = async email => {
    try {
      const res = await fetch(`${API_BASE}/emails/${email.id}`);
      const data = await res.json();
      setSelectedEmail(data);
      setShowDossier(true);
      fetchFolders();
      fetchAccounts();
    } catch (err) {
      console.error('Failed to open email:', err);
    }
  };

  const toggleStar = async (event, emailId) => {
    event.stopPropagation();
    try {
      const email = emails.find(item => item.id === emailId) || selectedEmail;
      await fetch(`${API_BASE}/emails/${emailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starred: !Boolean(email?.starred) })
      });
      fetchEmails();
      fetchFolders();
    } catch (err) {
      console.error('Failed to star:', err);
    }
  };

  const archiveEmail = async (event, emailId) => {
    event.stopPropagation();
    try {
      await fetch(`${API_BASE}/emails/${emailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true, folder: 'archive' })
      });
      fetchEmails();
      fetchFolders();
      fetchAccounts();
      if (selectedEmail?.id === emailId) setSelectedEmail(null);
    } catch (err) {
      console.error('Failed to archive:', err);
    }
  };

  const moveEmail = async (emailId, folderName) => {
    const folder = String(folderName || '').trim().toLowerCase();
    if (!folder) return;
    try {
      const res = await fetch(`${API_BASE}/emails/${emailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, archived: folder === 'archive' })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Move failed');
      }
      setConnectionMessage(`Message moved to ${folder}`);
      setSelectedEmail(null);
      await refreshMailRegistry();
    } catch (err) {
      console.error('Failed to move email:', err);
      setConnectionMessage(err.message || 'Move failed');
    }
  };

  const promptMoveSelected = () => {
    if (!selectedEmail) return;
    const destination = window.prompt('Move this message to which folder?');
    if (destination) moveEmail(selectedEmail.id, destination);
  };

  const deleteEmail = async (event, emailId) => {
    event.stopPropagation();
    try {
      await fetch(`${API_BASE}/emails/${emailId}`, { method: 'DELETE' });
      fetchEmails();
      fetchFolders();
      fetchAccounts();
      if (selectedEmail?.id === emailId) setSelectedEmail(null);
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const sendEmail = async event => {
    event.preventDefault();
    try {
      const payload = { ...composeData, from_address: composeData.from_address || selectedAccountAddress };
      const res = await fetch(`${API_BASE}/emails/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.detail || 'Failed to send email');
        return;
      }
      if (payload.from_address) {
        await fetch(`${API_BASE}/drafts/${encodeURIComponent(payload.from_address)}`, { method: 'DELETE' });
      }
      setShowCompose(false);
      setComposeData({ from_address: payload.from_address, to: '', subject: '', text: '' });
      setDraftStatus('');
      fetchEmails();
      alert('Email sent!');
    } catch (err) {
      console.error('Failed to send:', err);
      alert('Failed to send email');
    }
  };

  const formatDate = dateStr => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return String(dateStr);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const decodeQuotedPrintable = (input = '') => {
    if (!input) return '';
    const softBreakFixed = input.replace(/=\r?\n/g, '');
    return softBreakFixed.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isNaN(code) ? `=${hex}` : String.fromCharCode(code);
    });
  };

  const cleanEmailText = (input = '') => {
    if (!input) return '';
    return decodeQuotedPrintable(input)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/@media[\s\S]*?\}/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const selectedTextBody = cleanEmailText(selectedEmail?.text_body || '');

  const openCrm = (path = '') => {
    const root = String(crmUrl || '').replace(/\/$/, '');
    const separator = path.includes('?') ? '&' : '?';
    const scopedPath = businessScope && businessScope !== 'all'
      ? `${path}${separator}business_scope=${encodeURIComponent(businessScope)}`
      : path;
    window.open(`${root}${scopedPath}`, '_blank', 'noopener,noreferrer');
  };

  const openDossierPopout = () => {
    if (!selectedContactFromEmail) return;
    const contact = selectedContactFromEmail;
    const extra = normaliseExtra(contact.extra);
    const popup = window.open('', 'prime_mail_contact_dossier', 'width=520,height=860,resizable=yes,scrollbars=yes');
    if (!popup) {
      alert('Pop-up blocked. Allow pop-ups for PRIME MAIL to detach the dossier.');
      return;
    }
    popup.document.write(`<!doctype html><html><head><title>${escapeHtml(contact.name || contact.email)} — Dossier</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b1220;color:#e5e7eb;font-family:Segoe UI,Arial,sans-serif}.bar{height:62px;padding:19px 22px;background:#111a2e;border-bottom:1px solid #26344f;font-weight:700;letter-spacing:.08em}.wrap{padding:18px}.card{background:#111a2e;border:1px solid #26344f;border-radius:12px;padding:16px;margin-bottom:14px}.name{font-size:25px;font-weight:750;color:#fff;margin-bottom:4px}.muted{color:#91a2bd;font-size:13px}.label{font-size:10px;color:#78a6ff;letter-spacing:.1em;margin:18px 2px 8px}.row{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #1d2a43;font-size:13px}.row:last-child{border-bottom:0}.key{color:#91a2bd}.value{color:#fff;overflow-wrap:anywhere}.footer{font-size:12px;color:#73e5aa;margin-top:16px}</style></head><body>
<div class="bar">RELATIONSHIP DOSSIER · PRIME MAIL</div><div class="wrap"><div class="card"><div class="name">${escapeHtml(contact.name || displayName(contact.email))}</div><div class="muted">${escapeHtml(extra.title || 'Contact')}${extra.company ? ` · ${escapeHtml(extra.company)}` : ''}</div></div>
<div class="label">IDENTITY</div><div class="card"><div class="row"><span class="key">Email</span><span class="value">${escapeHtml(contact.email || '')}</span></div><div class="row"><span class="key">Phone</span><span class="value">${escapeHtml(contact.phone || '—')}</span></div><div class="row"><span class="key">Organization</span><span class="value">${escapeHtml(extra.company || '—')}</span></div></div>
<div class="label">RELATIONSHIP CONTEXT</div><div class="card"><div class="row"><span class="key">Context</span><span class="value">${escapeHtml(businessScope || 'all')}</span></div><div class="row"><span class="key">Last contact</span><span class="value">${escapeHtml(extra.last_contact || 'Current email')}</span></div><div class="row"><span class="key">Next action</span><span class="value">${escapeHtml(extra.next_action || '—')}</span></div></div>
<div class="label">CURRENT THREAD</div><div class="card"><div class="row"><span class="key">Email</span><span class="value">${escapeHtml(selectedEmail?.subject || '—')}</span></div><div class="row"><span class="key">Date</span><span class="value">${escapeHtml(formatDate(selectedEmail?.date))}</span></div></div>
<div class="footer">Identity + communications + CALI context linked through PRIME MAIL</div></div></body></html>`);
    popup.document.close();
  };

  const openContactWorkspace = contact => {
    setSelectedContact(contact || selectedContactFromEmail || null);
    setShowContacts(true);
  };

  const replyToSelected = () => {
    if (!selectedEmail) return;
    setComposeData({
      from_address: accounts.some(account => account.email === selectedEmail.recipient)
        ? selectedEmail.recipient
        : selectedAccountAddress,
      to: extractEmail(selectedEmail.sender),
      subject: `Re: ${selectedEmail.subject || ''}`,
      text: ''
    });
    setShowCompose(true);
  };

  const renderStatus = (label, ok, detail) => (
    <div className="connection-status-row" key={label}>
      <span className={`status-dot ${ok ? 'online' : 'offline'}`} />
      <span>{label}</span>
      <strong>{detail || (ok ? 'Connected' : 'Unavailable')}</strong>
    </div>
  );

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <button className="menu-btn" onClick={() => setSidebarOpen(value => !value)} aria-label="Toggle sidebar">☰</button>
          <img className="brand-logo" src="/primemail-logo.png" alt="PRIME MAIL logo" />
          <div className="brand-copy"><h1>PRIME MAIL</h1><span>Pro Prime Series</span></div>
        </div>
        <div className="header-center">
          <span className="search-icon">⌕</span>
          <input type="text" placeholder="Search mail, people, attachments..." value={searchQuery} onChange={event => setSearchQuery(event.target.value)} className="search-box" />
        </div>
        <div className="header-right">
          <select className="account-select" value={currentAccount} onChange={event => changeAccount(event.target.value)}>
            <option value="all">All accounts</option>
            {accounts.map(account => <option key={account.email} value={account.email}>{account.email}</option>)}
          </select>
          <button className="compose-btn" onClick={openCompose}>Compose</button>
          <button className="header-btn" onClick={() => openContactWorkspace(selectedContactFromEmail)}>People</button>
          <button className="orb-btn" onClick={() => { setShowConnections(true); testOrbConnection(); }}>ORB</button>
          <button className="header-btn icon-only" onClick={() => { fetchIntegrations(); setShowConnections(true); }} aria-label="Connections">●</button>
        </div>
      </header>

      <div className={`main-container ${sidebarOpen ? '' : 'sidebar-closed'} ${selectedEmail ? 'has-reader' : 'no-reader'} ${selectedEmail && showDossier ? 'has-dossier' : ''}`}>
        {sidebarOpen && (
          <aside className="sidebar registry-sidebar">
            <button className="sidebar-compose" onClick={openCompose}>+ Compose</button>
            <div className="sidebar-section">
              <div className="sidebar-label">WORKSPACE</div>
              <div className="workspace-switcher">
                <button className="active">Mail</button>
                <button onClick={() => openCrm('/contacts')}>CALI</button>
                <button onClick={() => openCrm('/calendar')}>Calendar</button>
              </div>
            </div>

            <MailRegistryPanel
              accounts={accounts}
              folders={folders}
              currentAccount={currentAccount}
              currentFolder={currentFolder}
              businessScope={businessScope}
              onBusinessScopeChange={changeBusinessScope}
              onSelectMailbox={changeAccount}
              onRegistryChanged={refreshMailRegistry}
            />

            <div className="sidebar-section">
              <div className="sidebar-label">PERSON</div>
              <button className="dossier-launch" onClick={() => openContactWorkspace(selectedContactFromEmail)}>
                <span>Relationship dossier</span>
                <strong>{selectedContactFromEmail?.name || 'Open people'}</strong>
              </button>
            </div>
            <div className="sidebar-section connected-section">
              <div className="sidebar-label">CONNECTED</div>
              <div className="connected-row"><span className={`status-dot ${crmOnline ? 'online' : 'offline'}`} />CALI <em>{crmOnline ? 'Connected' : 'Check'}</em></div>
              <div className="connected-row"><span className={`status-dot ${calendarOnline ? 'online' : 'offline'}`} />Calendar <em>{calendarOnline ? 'Connected' : 'Check'}</em></div>
              <div className="connected-row"><span className="status-dot online" />Mail <em>Active</em></div>
            </div>
            <div className="sidebar-footer">
              <button onClick={() => setShowConnections(true)}>Settings</button>
              <span>{stats.total_emails || 0} stored</span>
            </div>
          </aside>
        )}

        <section className="mail-list-panel">
          <div className="mail-list-toolbar">
            <div><h2>{currentFolder.charAt(0).toUpperCase() + currentFolder.slice(1)}</h2><span>{emails.length} messages · {businessScope === 'all' ? 'all contexts' : businessScope.replaceAll('_', ' ')}</span></div>
            <div className="list-controls">
              <select value={sortOrder} onChange={event => setSortOrder(event.target.value)} aria-label="Sort order"><option value="desc">Newest first</option><option value="asc">Oldest first</option></select>
              <button onClick={fetchEmails} aria-label="Refresh">↻</button>
            </div>
          </div>
          <div className="mail-scroll">
            {sortedEmails.map(email => (
              <article key={email.id} className={`email-item ${!email.read ? 'unread' : ''} ${selectedEmail?.id === email.id ? 'selected' : ''}`} onClick={() => openEmail(email)}>
                <div className="email-row"><span className="email-sender">{displayName(email.sender)}</span><span className="email-date">{formatDate(email.date)}</span></div>
                <div className="email-subject">{email.subject || '(No Subject)'}</div>
                <div className="email-preview">{cleanEmailText(email.text_body || '').substring(0, 120) || 'HTML message'}{cleanEmailText(email.text_body || '').length > 120 ? '…' : ''}</div>
                <div className="email-meta-line"><span>{currentFolder === 'sent' ? `To ${email.recipient}` : (email.recipient || currentAccount)}</span>{currentFolder === 'sent' && email.status && <span className={`email-status ${(email.status || '').toLowerCase()}`}>{email.status}</span>}</div>
                <div className="email-actions"><button onClick={event => toggleStar(event, email.id)}>{email.starred ? '★' : '☆'}</button><button onClick={event => archiveEmail(event, email.id)}>Archive</button><button onClick={event => deleteEmail(event, email.id)}>Delete</button></div>
              </article>
            ))}
            {emails.length === 0 && <div className="empty-state"><strong>No mail here</strong><span>PRIME MAIL is connected to {stats.storage_path || 'R:/email_client'}.</span></div>}
          </div>
        </section>

        {selectedEmail ? (
          <section className="email-detail">
            <div className="detail-header">
              <div className="detail-title-row"><h2>{selectedEmail.subject || '(No Subject)'}</h2><button className="close-btn" onClick={() => setSelectedEmail(null)}>×</button></div>
              <div className="detail-meta"><div><span>From</span><strong>{selectedEmail.sender}</strong></div><div><span>To</span><strong>{selectedEmail.recipient}</strong></div><div><span>Date</span><strong>{formatDate(selectedEmail.date)}</strong></div></div>
              <div className="detail-context-actions"><button className={showDossier ? 'active' : ''} onClick={() => setShowDossier(value => !value)}>Dossier</button><button onClick={() => openCrm('/contacts')}>Open CALI</button><button onClick={() => openCrm('/calendar')}>Calendar</button></div>
            </div>
            {firstActionLink && <div className="action-card"><div><strong>Action link detected</strong><span>This message contains an external action or verification link.</span></div><button onClick={() => window.open(firstActionLink, '_blank', 'noopener,noreferrer')}>Open action →</button></div>}
            <div className="detail-body">{selectedEmail.html_body ? <EmailHtmlFrame html={selectedEmail.html_body} /> : <pre>{selectedTextBody}</pre>}</div>
            <div className="detail-actions">
              <button onClick={replyToSelected}>Reply</button>
              <button onClick={() => archiveEmail({ stopPropagation: () => {} }, selectedEmail.id)}>Archive</button>
              <button onClick={promptMoveSelected}>Move</button>
              <button onClick={() => openContactWorkspace(selectedContactFromEmail)}>Person</button>
              <button className="danger" onClick={() => deleteEmail({ stopPropagation: () => {} }, selectedEmail.id)}>Delete</button>
              <span className="render-state">{selectedEmail.html_body ? 'Rendered HTML' : 'Plain text'}</span>
            </div>
          </section>
        ) : (
          <section className="reader-empty"><div className="reader-empty-mark">P</div><h2>PRIME MAIL</h2><p>Select a message to open the reader and its linked relationship dossier.</p></section>
        )}

        {selectedEmail && showDossier && selectedContactFromEmail && (
          <aside className="contact-dossier">
            <div className="dossier-header"><div><span>RELATIONSHIP DOSSIER</span><small>Mail ↔ CALI context</small></div><div><button onClick={openDossierPopout} title="Pop out dossier">↗</button><button onClick={() => setShowDossier(false)} title="Close dossier">×</button></div></div>
            <div className="dossier-scroll">
              <div className="dossier-identity"><div className="avatar">{(selectedContactFromEmail.name || selectedContactFromEmail.email || '?').charAt(0).toUpperCase()}</div><div><h3>{selectedContactFromEmail.name || displayName(selectedContactFromEmail.email)}</h3><p>{dossierExtra.title || 'Contact'}{dossierExtra.company ? ` · ${dossierExtra.company}` : ''}</p><span className="lead-tag">{String(dossierExtra.relationship || dossierExtra.type || 'CONTACT').toUpperCase()}</span></div></div>
              <div className="dossier-section-title">IDENTITY</div>
              <div className="dossier-card"><div className="dossier-row"><span>Email</span><strong>{selectedContactFromEmail.email || '—'}</strong></div><div className="dossier-row"><span>Phone</span><strong>{selectedContactFromEmail.phone || '—'}</strong></div><div className="dossier-row"><span>Organization</span><strong>{dossierExtra.company || '—'}</strong></div></div>
              <div className="dossier-section-title">RELATIONSHIP CONTEXT</div>
              <div className="dossier-card"><div className="dossier-row"><span>Business</span><strong>{businessScope === 'all' ? 'All contexts' : businessScope.replaceAll('_', ' ')}</strong></div><div className="dossier-row"><span>Last contact</span><strong>{dossierExtra.last_contact || 'Current email'}</strong></div><div className="dossier-row"><span>Next action</span><strong>{dossierExtra.next_action || '—'}</strong></div></div>
              <div className="dossier-section-title">CURRENT THREAD</div>
              <div className="dossier-card thread-card"><strong>{selectedEmail.subject || '(No Subject)'}</strong><span>{formatDate(selectedEmail.date)}</span><p>{cleanEmailText(selectedEmail.text_body || '').substring(0, 130) || 'HTML message'}</p></div>
              <div className="dossier-section-title">QUICK ACTIONS</div>
              <div className="dossier-actions"><button className="primary" onClick={() => openCrm('/contacts')}>Open CALI</button><button onClick={() => openContactWorkspace(selectedContactFromEmail)}>{contacts.some(contact => extractEmail(contact.email) === selectedSenderEmail) ? 'Update person' : 'Add person'}</button><button onClick={() => openCrm('/calendar')}>Create event</button></div>
            </div>
            <div className="dossier-footer"><span className={`status-dot ${crmOnline ? 'online' : 'offline'}`} /><span>Mail + CALI + Calendar</span><strong>{crmOnline ? 'LINKED' : 'CHECK CALI'}</strong></div>
          </aside>
        )}
      </div>

      {showCompose && (
        <div className="modal-overlay"><div className="compose-modal">
          <div className="modal-header"><div><span className="eyebrow">PRIME MAIL</span><h2>Compose</h2></div><button className="close-btn" onClick={() => { saveDraft(); setShowCompose(false); }}>×</button></div>
          <form onSubmit={sendEmail}>
            <label>From</label><select value={composeData.from_address || selectedAccountAddress} onChange={event => setComposeData({ ...composeData, from_address: event.target.value })} required>{accounts.map(account => <option key={account.email} value={account.email}>{account.email}</option>)}</select>
            <label>To</label><input type="email" value={composeData.to} onChange={event => setComposeData({ ...composeData, to: event.target.value })} required />
            <label>Subject</label><input type="text" value={composeData.subject} onChange={event => setComposeData({ ...composeData, subject: event.target.value })} required />
            <textarea rows={12} placeholder="Message..." value={composeData.text} onChange={event => setComposeData({ ...composeData, text: event.target.value })} required />
            <div className="compose-actions"><span className="draft-status">{draftStatus}</span><button type="button" onClick={saveDraft}>Save draft</button><button type="button" onClick={() => { saveDraft(); setShowCompose(false); }}>Cancel</button><button className="primary" type="submit">Send</button></div>
          </form>
        </div></div>
      )}

      {showContacts && (
        <div className="modal-overlay"><div className="contacts-modal dossier-modal">
          <div className="modal-header dark"><div><span className="eyebrow">CALI RELATIONSHIP SYSTEM</span><h2>People & Dossiers</h2></div><button className="close-btn" onClick={() => { setShowContacts(false); setSelectedContact(null); }}>×</button></div>
          <div className="contacts-workspace">
            <div className="contacts-list-panel"><div className="contacts-list-header"><strong>People</strong><button onClick={() => setSelectedContact({ name: '', email: '', phone: '', address: '', photo: '', extra: {} })}>+ Add</button></div><div className="contacts-list-full">
              {contacts.map(contact => <button key={contact.email || contact.name} className={`contact-list-item ${selectedContact?.email === contact.email ? 'selected' : ''}`} onClick={() => setSelectedContact(contact)}><span className="mini-avatar">{(contact.name || contact.email || '?').charAt(0).toUpperCase()}</span><span><strong>{contact.name || displayName(contact.email)}</strong><small>{contact.email}</small></span>{contact.email_count > 0 && <em>{contact.email_count}</em>}</button>)}
              {contacts.length === 0 && <div className="empty-state small">No people saved yet.</div>}
            </div></div>
            <div className="contact-detail-panel">{selectedContact ? (
              <form className="contact-detail-form" onSubmit={event => { event.preventDefault(); saveContact(selectedContact); }}>
                <div className="contact-detail-heading"><div className="avatar large">{(selectedContact.name || selectedContact.email || '?').charAt(0).toUpperCase()}</div><div><h3>{selectedContact.name || selectedContact.email || 'New contact'}</h3><span>PRIME MAIL / CALI shared relationship dossier</span></div></div>
                <label>Name</label><input value={selectedContact.name || ''} onChange={event => setSelectedContact({ ...selectedContact, name: event.target.value })} />
                <label>Email</label><input type="email" value={selectedContact.email || ''} onChange={event => setSelectedContact({ ...selectedContact, email: event.target.value })} />
                <div className="form-grid-2"><div><label>Phone</label><input value={selectedContact.phone || ''} onChange={event => setSelectedContact({ ...selectedContact, phone: event.target.value })} /></div><div><label>Address</label><input value={selectedContact.address || ''} onChange={event => setSelectedContact({ ...selectedContact, address: event.target.value })} /></div></div>
                <label>Dossier metadata (JSON)</label><textarea rows={7} value={typeof selectedContact.extra === 'string' ? selectedContact.extra : JSON.stringify(selectedContact.extra || {}, null, 2)} onChange={event => setSelectedContact({ ...selectedContact, extra: event.target.value })} />
                <div className="contact-detail-actions"><button type="button" onClick={() => openCrm('/contacts')}>Open in CALI</button><button type="button" onClick={() => openCrm('/calendar')}>Calendar</button><button className="primary" type="submit">Save dossier</button></div>
              </form>
            ) : <div className="contact-detail-empty"><strong>Select a person</strong><span>PRIME MAIL uses the same relationship identity as CALI.</span></div>}</div>
          </div>
          {connectionMessage && <div className="modal-status-line">{connectionMessage}</div>}
        </div></div>
      )}

      {showConnections && (
        <div className="modal-overlay"><div className="connections-modal">
          <div className="modal-header dark"><div><span className="eyebrow">PRO PRIME SYSTEM</span><h2>Connections</h2></div><button className="close-btn" onClick={() => setShowConnections(false)}>×</button></div>
          <div className="connection-status-list">{renderStatus('PRIME MAIL', true, `${accounts.length} accounts`)}{renderStatus('CALI', crmOnline, crmOnline ? 'Connected' : crmUrl)}{renderStatus('Calendar', Boolean(calendarOnline), calendarOnline ? 'Available through CALI' : 'Check CALI')}{renderStatus('Desktop ORB', Boolean(integrationStatus?.orb?.online || integrationStatus?.orb_api?.status === 'ok'), integrationStatus?.orb?.online ? 'Connected' : 'Check runtime')}{renderStatus('R: substrate', Boolean(integrationStatus?.email_db?.status === 'ok' || stats.storage_path), stats.storage_path || 'R:/email_client')}</div>
          <div className="connections-actions"><button onClick={fetchIntegrations}>Refresh</button><button onClick={syncEmailToCrm}>Sync Mail → CALI</button><button className="orb-btn" onClick={testOrbConnection}>Test ORB</button></div>
          {connectionMessage && <div className="modal-status-line">{connectionMessage}</div>}
        </div></div>
      )}
    </div>
  );
}

export default App;
