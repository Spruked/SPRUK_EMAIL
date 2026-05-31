// ============================================
// PRO PRIME SERIES MAIL - React Frontend
// Runs locally, connects to your R: drive backend
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import './App.css';

const API_BASE = (process.env.REACT_APP_API_BASE || '/api').replace(/\/$/, '');

function App() {
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [folders, setFolders] = useState([]);
  const [currentFolder, setCurrentFolder] = useState('inbox');
  const [accounts, setAccounts] = useState([]);
  const [currentAccount, setCurrentAccount] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
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
  const [integrationStatus, setIntegrationStatus] = useState(null);
  const [connectionMessage, setConnectionMessage] = useState('');

  const selectedAccountAddress = currentAccount === 'all'
    ? (accounts[0]?.email || '')
    : currentAccount;
  const inboxFolder = folders.find(folder => folder.folder === 'inbox');

  // Fetch emails
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

  // Fetch folders
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

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  // Fetch contacts
  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/contacts`);
      const data = await res.json();
      setContacts(data.contacts || []);
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
    }
  }, []);

  // Fetch accounts
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
      const data = await res.json();
      setIntegrationStatus(data);
    } catch (err) {
      console.error('Failed to fetch integration status:', err);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchEmails();
    fetchFolders();
    fetchStats();
    fetchContacts();
    fetchIntegrations();

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      fetchAccounts();
      fetchEmails();
      fetchFolders();
      fetchStats();
      fetchIntegrations();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchAccounts, fetchEmails, fetchFolders, fetchStats, fetchContacts, fetchIntegrations]);

  const changeAccount = (account, folder = currentFolder) => {
    setCurrentAccount(account);
    setCurrentFolder(folder);
    setSelectedEmail(null);
    setComposeData(prev => ({
      ...prev,
      from_address: account === 'all' ? (accounts[0]?.email || prev.from_address) : account
    }));
  };

  const openCompose = () => {
    const account = selectedAccountAddress;
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
    setComposeData(prev => ({
      ...prev,
      from_address: prev.from_address || account
    }));
    setShowCompose(true);
  };

  const saveDraft = useCallback(async () => {
    const account = composeData.from_address || selectedAccountAddress;
    if (!account || (!composeData.to && !composeData.subject && !composeData.text)) return;
    try {
      await fetch(`${API_BASE}/drafts/${encodeURIComponent(account)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account,
          to: composeData.to,
          subject: composeData.subject,
          text: composeData.text
        })
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
    let payload = { ...contact };
    // Parse extra JSON if provided
    if (payload.extra) {
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
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        alert(error.detail || 'Failed to save contact');
        return;
      }
      setContactForm({ name: '', email: '', phone: '', address: '', photo: '', extra: '' });
      fetchContacts();
      fetchIntegrations();
      if (res.status === 200) {
        const data = await res.json().catch(() => ({}));
        setConnectionMessage(data.crm_sync?.status === 'error'
          ? `Contact saved locally; CRM sync failed: ${data.crm_sync.detail}`
          : 'Contact saved');
      }
    } catch (err) {
      console.error('Failed to save contact:', err);
      alert('Failed to save contact');
    }
  };

  const syncEmailToCrm = async () => {
    setConnectionMessage('Syncing inbox to CRM...');
    try {
      const res = await fetch(`${API_BASE}/integrations/crm/sync-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: 'inbox', limit: 50, unread_only: false })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConnectionMessage(data.detail || 'CRM sync failed');
        return;
      }
      setConnectionMessage(`CRM sync processed ${data.processed || 0}; linked ${data.linked || 0}; created ${data.created_contacts || 0}`);
      fetchIntegrations();
    } catch (err) {
      console.error('Failed to sync CRM:', err);
      setConnectionMessage('CRM sync failed');
    }
  };

  const testOrbConnection = async () => {
    setConnectionMessage('Testing ORB...');
    try {
      const res = await fetch(`${API_BASE}/integrations/orb/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'status', context: { source: 'spruk_email' } })
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

  // Open email
  const openEmail = async (email) => {
    try {
      const res = await fetch(`${API_BASE}/emails/${email.id}`);
      const data = await res.json();
      setSelectedEmail(data);
      fetchFolders(); // Update unread counts
      fetchAccounts();
    } catch (err) {
      console.error('Failed to open email:', err);
    }
  };

  // Star email
  const toggleStar = async (e, emailId) => {
    e.stopPropagation();
    try {
      const email = emails.find(item => item.id === emailId) || selectedEmail;
      const nextStarred = !Boolean(email?.starred);
      await fetch(`${API_BASE}/emails/${emailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starred: nextStarred })
      });
      fetchEmails();
      fetchFolders();
      fetchAccounts();
    } catch (err) {
      console.error('Failed to star:', err);
    }
  };

  // Archive email
  const archiveEmail = async (e, emailId) => {
    e.stopPropagation();
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

  // Delete email
  const deleteEmail = async (e, emailId) => {
    e.stopPropagation();
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

  // Send email
  const sendEmail = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...composeData,
        from_address: composeData.from_address || selectedAccountAddress
      };
      const res = await fetch(`${API_BASE}/emails/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        if (payload.from_address) {
          await fetch(`${API_BASE}/drafts/${encodeURIComponent(payload.from_address)}`, { method: 'DELETE' });
        }
        setShowCompose(false);
        setComposeData({ from_address: payload.from_address, to: '', subject: '', text: '' });
        setDraftStatus('');
        alert('Email sent!');
      } else {
        const error = await res.json().catch(() => ({}));
        alert(error.detail || 'Failed to send email');
      }
    } catch (err) {
      console.error('Failed to send:', err);
      alert('Failed to send email');
    }
  };

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
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
    const decoded = decodeQuotedPrintable(input);
    return decoded
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/@media[\s\S]*?\}/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const sanitizedSelectedHtml = selectedEmail?.html_body
    ? DOMPurify.sanitize(selectedEmail.html_body)
    : '';
  const selectedTextBody = cleanEmailText(selectedEmail?.text_body || '');

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <button className="menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <img className="brand-logo" src="/primemail-logo.png" alt="PRIME MAIL logo" />
          <h1>PRIME MAIL</h1>
        </div>
        <div className="header-center">
          <input
            type="text"
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-box"
          />
        </div>
        <div className="header-right">
          <select
            className="account-select"
            value={currentAccount}
            onChange={(e) => changeAccount(e.target.value)}
          >
            <option value="all">All accounts</option>
            {accounts.map(account => (
              <option key={account.email} value={account.email}>{account.email}</option>
            ))}
          </select>
          <button className="compose-btn" onClick={openCompose}>+ Compose</button>
          <button className="header-btn" onClick={() => setShowContacts(true)}>Contacts</button>
          <button className="header-btn" onClick={() => { fetchIntegrations(); setShowConnections(true); }}>
            Connections
          </button>
          <div className="stats-badge">
            {stats.unread_emails > 0 && <span className="unread-dot">{stats.unread_emails}</span>}
          </div>
        </div>
      </header>

      <div className="main-container">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="mailbox-list">
              <div className="account-panel">
                <label>Inboxes</label>
                <strong>{currentAccount === 'all' ? 'All inboxes' : currentAccount}</strong>
              </div>
              <div
                className={`mailbox-item ${currentAccount === 'all' ? 'active' : ''}`}
                onClick={() => changeAccount('all', 'inbox')}
              >
                <span className="folder-icon">📬</span>
                <span className="mailbox-name">All inboxes</span>
                {inboxFolder?.unread > 0 && <span className="folder-unread">{inboxFolder.unread}</span>}
                <span className="folder-count">{inboxFolder?.count || 0}</span>
              </div>
              {accounts.map(account => (
                <div
                  key={account.email}
                  className={`mailbox-item ${currentAccount === account.email ? 'active' : ''}`}
                  onClick={() => changeAccount(account.email, 'inbox')}
                >
                  <span className="folder-icon">📥</span>
                  <span className="mailbox-name">{account.email}</span>
                  {account.unread_count > 0 && <span className="folder-unread">{account.unread_count}</span>}
                  <span className="folder-count">{account.inbox_count || 0}</span>
                </div>
              ))}
            </div>

            <div className="folder-list">
              {folders.map(folder => (
                <div
                  key={folder.folder}
                  className={`folder-item ${currentFolder === folder.folder ? 'active' : ''}`}
                  onClick={() => { setCurrentFolder(folder.folder); setSelectedEmail(null); }}
                >
                  <span className="folder-icon">
                    {folder.folder === 'inbox' && '📥'}
                    {folder.folder === 'sent' && '📤'}
                    {folder.folder === 'starred' && '⭐'}
                    {folder.folder === 'archive' && '📦'}
                    {folder.folder === 'trash' && '🗑️'}
                  </span>
                  <span className="folder-name">{folder.folder}</span>
                  {folder.unread > 0 && <span className="folder-unread">{folder.unread}</span>}
                  <span className="folder-count">{folder.count}</span>
                </div>
              ))}
            </div>

            <div className="contacts-section">
              <div className="section-title-row">
                <h3>Contacts</h3>
                <button type="button" onClick={() => setShowContacts(true)}>Open</button>
              </div>
              <div className="contacts-list compact">
                {contacts.slice(0, 5).map(contact => (
                  <div key={contact.email || contact.name} className="contact-item" onClick={() => setShowContacts(true)} style={{cursor:'pointer'}}>
                    <span className="contact-email">{contact.name || contact.email}</span>
                  </div>
                ))}
                {contacts.length > 5 && <div className="contact-item more" onClick={() => setShowContacts(true)} style={{cursor:'pointer',fontStyle:'italic'}}>More...</div>}
              </div>
            </div>

            <div className="storage-info">
              <small>💾 {stats.total_emails || 0} emails stored</small>
              <small>📁 {stats.storage_path || 'R:/email_client'}</small>
            </div>
          </aside>
        )}

        {/* Email List */}
        <main className={`email-list ${selectedEmail ? 'split' : ''}`}>
          {emails.map(email => (
            <div
              key={email.id}
              className={`email-item ${!email.read ? 'unread' : ''} ${selectedEmail?.id === email.id ? 'selected' : ''}`}
              onClick={() => openEmail(email)}
            >
              <div className="email-row">
                <span className="email-sender">{email.sender}</span>
                <span className="email-date">{formatDate(email.date)}</span>
              </div>
              <div className="email-recipient">{currentFolder === 'sent' ? `To: ${email.recipient}` : `To: ${email.recipient}`}</div>
              <div className="email-subject">{email.subject || '(No Subject)'}</div>
              {currentFolder === 'sent' && (
                <div className={`email-status ${(email.status || '').toLowerCase()}`}>
                  {(email.status || 'unknown').toUpperCase()}
                </div>
              )}
              <div className="email-preview">{cleanEmailText(email.text_body || '').substring(0, 100) || ''}...</div>
              <div className="email-actions">
                <button onClick={(e) => toggleStar(e, email.id)}>{email.starred ? '★' : '☆'}</button>
                <button onClick={(e) => archiveEmail(e, email.id)}>📦</button>
                <button onClick={(e) => deleteEmail(e, email.id)}>🗑️</button>
              </div>
            </div>
          ))}
          {emails.length === 0 && (
            <div className="empty-state">
              <p>No emails in {currentFolder}</p>
              <p className="empty-hint">Emails arrive via Cloudflare → your R: drive</p>
            </div>
          )}
        </main>

        {/* Email Detail */}
        {selectedEmail && (
          <aside className="email-detail">
            <div className="detail-header">
              <button className="close-btn" onClick={() => setSelectedEmail(null)}>✕</button>
              <h2>{selectedEmail.subject || '(No Subject)'}</h2>
              <div className="detail-meta">
                <span><strong>From:</strong> {selectedEmail.sender}</span>
                <span><strong>To:</strong> {selectedEmail.recipient}</span>
                <span><strong>Date:</strong> {formatDate(selectedEmail.date)}</span>
                {selectedEmail.folder === 'sent' && selectedEmail.status && (
                  <span><strong>Status:</strong> {selectedEmail.status}</span>
                )}
              </div>
            </div>
            <div className="detail-body">
              {selectedEmail.html_body ? (
                <div dangerouslySetInnerHTML={{ __html: sanitizedSelectedHtml }} />
              ) : (
                <pre>{selectedTextBody}</pre>
              )}
            </div>
            <div className="detail-actions">
              <button onClick={() => saveContact({
                name: selectedEmail.sender?.split('@')[0] || '',
                email: selectedEmail.sender
              })}>Add Contact</button>
              <button onClick={() => {
                setComposeData({
                  from_address: accounts.some(account => account.email === selectedEmail.recipient)
                    ? selectedEmail.recipient
                    : selectedAccountAddress,
                  to: selectedEmail.sender,
                  subject: `Re: ${selectedEmail.subject}`,
                  text: ''
                });
                setShowCompose(true);
              }}>Reply</button>
              <button onClick={() => archiveEmail({ stopPropagation: () => {} }, selectedEmail.id)}>Archive</button>
              <button onClick={() => deleteEmail({ stopPropagation: () => {} }, selectedEmail.id)}>Delete</button>
            </div>
          </aside>
        )}
      </div>

      {/* Compose Modal */}
      {showCompose && (
        <div className="modal-overlay">
          <div className="compose-modal">
            <div className="brand-strip">
              <img className="brand-logo" src="/primemail-logo.png" alt="PRIME MAIL logo" />
              <strong>PRIME MAIL</strong>
            </div>
            <h2>Compose Email</h2>
            <form onSubmit={sendEmail}>
              <select
                value={composeData.from_address || selectedAccountAddress}
                onChange={(e) => setComposeData({...composeData, from_address: e.target.value})}
                required
              >
                {accounts.map(account => (
                  <option key={account.email} value={account.email}>{account.email}</option>
                ))}
              </select>
              <input
                type="email"
                placeholder="To"
                value={composeData.to}
                onChange={(e) => setComposeData({...composeData, to: e.target.value})}
                required
              />
              <input
                type="text"
                placeholder="Subject"
                value={composeData.subject}
                onChange={(e) => setComposeData({...composeData, subject: e.target.value})}
                required
              />
              <textarea
                placeholder="Message..."
                rows={10}
                value={composeData.text}
                onChange={(e) => setComposeData({...composeData, text: e.target.value})}
                required
              />
              <div className="compose-actions">
                <span className="draft-status">{draftStatus}</span>
                <button type="button" onClick={saveDraft}>Save Draft</button>
                <button type="submit">Send</button>
                <button type="button" onClick={() => { saveDraft(); setShowCompose(false); }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showConnections && (
        <div className="modal-overlay">
          <div className="connections-modal">
            <div className="modal-header">
              <h2>Connections & Status</h2>
              <button className="close-btn" onClick={() => setShowConnections(false)}>x</button>
            </div>
            <div className="connections-status-list">
              {integrationStatus ? (
                <>
                  <div className="status-row">
                    <span className="status-label">Prime Mail API</span>
                    <span className={`status-indicator ${integrationStatus.primemail_api?.status === 'ok' ? 'ok' : 'error'}`}>{integrationStatus.primemail_api?.status || 'unknown'}</span>
                  </div>
                  <div className="status-row">
                    <span className="status-label">CALI CRM API</span>
                    <span className={`status-indicator ${integrationStatus.crm_api?.status === 'ok' ? 'ok' : 'error'}`}>{integrationStatus.crm_api?.status || 'unknown'}</span>
                  </div>
                  <div className="status-row">
                    <span className="status-label">Desktop ORB API</span>
                    <span className={`status-indicator ${integrationStatus.orb_api?.status === 'ok' ? 'ok' : 'error'}`}>{integrationStatus.orb_api?.status || 'unknown'}</span>
                  </div>
                  <div className="status-row">
                    <span className="status-label">CRM DB</span>
                    <span className={`status-indicator ${integrationStatus.crm_db?.status === 'ok' ? 'ok' : 'error'}`}>{integrationStatus.crm_db?.status || 'unknown'}</span>
                  </div>
                  <div className="status-row">
                    <span className="status-label">Email DB</span>
                    <span className={`status-indicator ${integrationStatus.email_db?.status === 'ok' ? 'ok' : 'error'}`}>{integrationStatus.email_db?.status || 'unknown'}</span>
                  </div>
                  <div className="status-row">
                    <span className="status-label">Mesh/API Manifest</span>
                    <span className={`status-indicator ${integrationStatus.mesh_manifest?.status === 'ok' ? 'ok' : 'error'}`}>{integrationStatus.mesh_manifest?.status || 'unknown'}</span>
                  </div>
                </>
              ) : (
                <div>Loading status...</div>
              )}
            </div>
            <div className="connections-actions">
              <button onClick={fetchIntegrations}>Refresh Status</button>
              <button onClick={testOrbConnection}>Test ORB</button>
              <button onClick={syncEmailToCrm}>Sync Email to CRM</button>
            </div>
            <div className="connections-message">
              {connectionMessage && <span>{connectionMessage}</span>}
            </div>
            <div className="ask-orb-panel">
              <h3>Ask ORB (Assistant)</h3>
              <input type="text" placeholder="Type a question for ORB... (coming soon)" disabled style={{width:'100%'}} />
            </div>
          </div>
        </div>
      )}

      {showContacts && (
        <div className="modal-overlay">
          <div className="contacts-modal">
            <div className="modal-header">
              <h2>Contacts</h2>
              <button className="close-btn" onClick={() => { setShowContacts(false); setSelectedContact(null); }}>x</button>
            </div>
            <div className="contacts-workspace">
              <div className="contacts-list-panel">
                <div className="contacts-list-header">
                  <strong>All Contacts</strong>
                  <button onClick={() => setSelectedContact({ name: '', email: '', phone: '', address: '', photo: '', extra: '' })}>+ Add</button>
                </div>
                <div className="contacts-list-full">
                  {contacts.length === 0 && <div className="empty">No contacts found.</div>}
                  {contacts.map(contact => (
                    <div
                      key={contact.email || contact.name}
                      className={`contact-list-item${selectedContact && (selectedContact.email === contact.email) ? ' selected' : ''}`}
                      onClick={() => setSelectedContact(contact)}
                    >
                      {contact.photo && <img src={contact.photo} alt="contact" className="contact-photo" style={{width:28,height:28,borderRadius:'50%',objectFit:'cover',marginRight:8}} />}
                      <span className="contact-name">{contact.name || contact.email}</span>
                      <span className="contact-email">{contact.email}</span>
                      {contact.email_count > 0 && <span className="contact-badge">{contact.email_count}</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="contact-detail-panel">
                {selectedContact ? (
                  <div className="contact-detail">
                    <h3>{selectedContact.name || selectedContact.email || 'New Contact'}</h3>
                    {selectedContact.photo && <img src={selectedContact.photo} alt="contact" className="contact-photo-large" style={{width:64,height:64,borderRadius:'50%',objectFit:'cover',marginBottom:8}} />}
                    <form
                      className="contact-detail-form"
                      onSubmit={e => { e.preventDefault(); saveContact(selectedContact); }}
                    >
                      <input
                        type="text"
                        placeholder="Name"
                        value={selectedContact.name || ''}
                        onChange={e => setSelectedContact({ ...selectedContact, name: e.target.value })}
                      />
                      <input
                        type="email"
                        placeholder="Email"
                        value={selectedContact.email || ''}
                        onChange={e => setSelectedContact({ ...selectedContact, email: e.target.value })}
                      />
                      <input
                        type="text"
                        placeholder="Phone"
                        value={selectedContact.phone || ''}
                        onChange={e => setSelectedContact({ ...selectedContact, phone: e.target.value })}
                      />
                      <input
                        type="text"
                        placeholder="Address"
                        value={selectedContact.address || ''}
                        onChange={e => setSelectedContact({ ...selectedContact, address: e.target.value })}
                      />
                      <input
                        type="text"
                        placeholder="Photo URL or base64"
                        value={selectedContact.photo || ''}
                        onChange={e => setSelectedContact({ ...selectedContact, photo: e.target.value })}
                      />
                      <textarea
                        placeholder="Extra fields (JSON)"
                        value={typeof selectedContact.extra === 'string' ? selectedContact.extra : JSON.stringify(selectedContact.extra || {}, null, 2)}
                        onChange={e => setSelectedContact({ ...selectedContact, extra: e.target.value })}
                        rows={2}
                      />
                      <div className="contact-detail-actions">
                        <button type="submit">Save</button>
                        <button type="button" onClick={() => setSelectedContact(null)}>Cancel</button>
                      </div>
                    </form>
                    {selectedContact.email && (
                      <div className="linked-emails-panel">
                        <h4>Linked Emails</h4>
                        <div className="linked-emails-list">
                          {emails.filter(email => email.sender === selectedContact.email || email.recipient === selectedContact.email).length === 0 && (
                            <div className="empty">No emails linked to this contact.</div>
                          )}
                          {emails.filter(email => email.sender === selectedContact.email || email.recipient === selectedContact.email).map(email => (
                            <div key={email.id} className="linked-email-item" onClick={() => { setShowContacts(false); setSelectedEmail(email); }}>
                              <span className="linked-email-subject">{email.subject || '(No Subject)'}</span>
                              <span className="linked-email-date">{formatDate(email.date)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="contact-detail-empty">Select a contact to view details.</div>
                )}
              </div>
            </div>
          </div>
        </div>
            </div>
            <form
              className="contact-form large"
              onSubmit={(e) => {
                e.preventDefault();
                saveContact();
              }}
            >
              <input
                type="text"
                placeholder="Name"
                value={contactForm.name}
                onChange={(e) => setContactForm({...contactForm, name: e.target.value})}
              />
              <input
                type="email"
                placeholder="email@example.com"
                value={contactForm.email}
                onChange={(e) => setContactForm({...contactForm, email: e.target.value})}
              />
              <input
                type="text"
                placeholder="Phone"
                value={contactForm.phone}
                onChange={(e) => setContactForm({...contactForm, phone: e.target.value})}
              />
              <input
                type="text"
                placeholder="Address"
                value={contactForm.address}
                onChange={(e) => setContactForm({...contactForm, address: e.target.value})}
              />
              <input
                type="text"
                placeholder="Photo URL or base64"
                value={contactForm.photo}
                onChange={(e) => setContactForm({...contactForm, photo: e.target.value})}
              />
              <textarea
                placeholder="Extra fields (JSON)"
                value={contactForm.extra}
                onChange={(e) => setContactForm({...contactForm, extra: e.target.value})}
                rows={2}
              />
              <button type="submit">Add Contact</button>
            </form>
            {connectionMessage && <div className="status-line">{connectionMessage}</div>}
            <div className="contacts-table">
              {contacts.map(contact => (
                <div key={contact.email || contact.name} className="contact-row" onClick={() => setSelectedContact(contact)} style={{cursor:'pointer'}}>
                  <div>
                    {contact.photo && <img src={contact.photo} alt="contact" className="contact-photo" style={{width:32,height:32,borderRadius:'50%',objectFit:'cover',marginRight:8}} />}
                    <strong>{contact.name || contact.email}</strong>
                    <span>{contact.email || <em>No email</em>}</span>
                    {contact.phone && <span className="contact-phone">{contact.phone}</span>}
                    {contact.address && <span className="contact-address">{contact.address}</span>}
                    {contact.extra && typeof contact.extra === 'object' && Object.keys(contact.extra).length > 0 && (
                      <span className="contact-extra">{Object.entries(contact.extra).map(([k,v]) => `${k}: ${v}`).join(', ')}</span>
                    )}
                  </div>
                  <span>{contact.email_count || 0}</span>
                </div>
              ))}
                    {/* Contact Detail Modal */}
                    {selectedContact && (
                      <div className="modal-overlay">
                        <div className="contacts-modal">
                          <div className="modal-header">
                            <h2>Contact Details</h2>
                            <button className="close-btn" onClick={() => setSelectedContact(null)}>x</button>
                          </div>
                          <div className="contact-detail-body">
                            {selectedContact.photo && <img src={selectedContact.photo} alt="contact" style={{width:64,height:64,borderRadius:'50%',objectFit:'cover',marginBottom:8}} />}
                            <div><strong>Name:</strong> {selectedContact.name || <em>(none)</em>}</div>
                            <div><strong>Email:</strong> {selectedContact.email || <em>(none)</em>}</div>
                            <div><strong>Phone:</strong> {selectedContact.phone || <em>(none)</em>}</div>
                            <div><strong>Address:</strong> {selectedContact.address || <em>(none)</em>}</div>
                            <div><strong>Email Count:</strong> {selectedContact.email_count || 0}</div>
                            {selectedContact.extra && typeof selectedContact.extra === 'object' && Object.keys(selectedContact.extra).length > 0 && (
                              <div><strong>Extra:</strong> <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(selectedContact.extra, null, 2)}</pre></div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
              {contacts.length === 0 && <div className="empty-state small">No contacts saved yet</div>}
            </div>
          </div>
        </div>
      )}

      {showConnections && (
        <div className="modal-overlay">
          <div className="connections-modal">
            <div className="modal-header">
              <h2>Connections</h2>
              <button className="close-btn" onClick={() => setShowConnections(false)}>x</button>
            </div>
            <div className="connection-grid">
              <div className="connection-panel">
                <img className="panel-logo" src="/primemail-logo.png" alt="PRIME MAIL logo" />
                <h3>Pro Prime Series Mail</h3>
                <span className="connection-state online">Online</span>
                <p>{integrationStatus?.email_api?.accounts?.length || accounts.length} inboxes on port {integrationStatus?.email_api?.port || '19000'}</p>
              </div>
              <div className="connection-panel">
                <h3>CRM</h3>
                <span className={`connection-state ${integrationStatus?.crm?.online ? 'online' : 'offline'}`}>
                  {integrationStatus?.crm?.online ? 'Online' : 'Offline'}
                </span>
                <p>{integrationStatus?.crm?.api_url || 'http://127.0.0.1:21000'}</p>
                <button type="button" onClick={syncEmailToCrm}>Sync Inbox to CRM</button>
              </div>
              <div className="connection-panel">
                <h3>Desktop ORB</h3>
                <span className={`connection-state ${integrationStatus?.orb?.online ? 'online' : 'offline'}`}>
                  {integrationStatus?.orb?.online ? 'Online' : 'Offline'}
                </span>
                <p>{integrationStatus?.orb?.api_url || 'http://127.0.0.1:8000/api/v1'}</p>
                <button type="button" onClick={testOrbConnection}>Test ORB</button>
              </div>
            </div>
            {connectionMessage && <div className="status-line">{connectionMessage}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
