// ============================================
// R-DRIVE EMAIL CLIENT - React Frontend
// Runs locally, connects to your R: drive backend
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

const API_BASE = 'http://localhost:8000/api';

function App() {
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [folders, setFolders] = useState([]);
  const [currentFolder, setCurrentFolder] = useState('inbox');
  const [searchQuery, setSearchQuery] = useState('');
  const [stats, setStats] = useState({});
  const [showCompose, setShowCompose] = useState(false);
  const [composeData, setComposeData] = useState({ to: '', subject: '', text: '' });
  const [contacts, setContacts] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Fetch emails
  const fetchEmails = useCallback(async () => {
    try {
      const params = new URLSearchParams({ folder: currentFolder, limit: '50' });
      if (searchQuery) params.append('search', searchQuery);
      const res = await fetch(`${API_BASE}/emails?${params}`);
      const data = await res.json();
      setEmails(data.emails || []);
    } catch (err) {
      console.error('Failed to fetch emails:', err);
    }
  }, [currentFolder, searchQuery]);

  // Fetch folders
  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/folders`);
      const data = await res.json();
      setFolders(data.folders || []);
    } catch (err) {
      console.error('Failed to fetch folders:', err);
    }
  }, []);

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

  useEffect(() => {
    fetchEmails();
    fetchFolders();
    fetchStats();
    fetchContacts();

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      fetchEmails();
      fetchFolders();
      fetchStats();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchEmails, fetchFolders, fetchStats, fetchContacts]);

  // Open email
  const openEmail = async (email) => {
    try {
      const res = await fetch(`${API_BASE}/emails/${email.id}`);
      const data = await res.json();
      setSelectedEmail(data);
      fetchFolders(); // Update unread counts
    } catch (err) {
      console.error('Failed to open email:', err);
    }
  };

  // Star email
  const toggleStar = async (e, emailId) => {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE}/emails/${emailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starred: true })
      });
      fetchEmails();
      fetchFolders();
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
      if (selectedEmail?.id === emailId) setSelectedEmail(null);
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  // Send email
  const sendEmail = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/emails/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(composeData)
      });
      if (res.ok) {
        setShowCompose(false);
        setComposeData({ to: '', subject: '', text: '' });
        alert('Email sent!');
      } else {
        alert('Failed to send email');
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

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <button className="menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <h1>📧 R-Drive Mail</h1>
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
          <button className="compose-btn" onClick={() => setShowCompose(true)}>+ Compose</button>
          <div className="stats-badge">
            {stats.unread_emails > 0 && <span className="unread-dot">{stats.unread_emails}</span>}
          </div>
        </div>
      </header>

      <div className="main-container">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="sidebar">
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
              <h3>Contacts</h3>
              <div className="contacts-list">
                {contacts.slice(0, 10).map(contact => (
                  <div key={contact.email} className="contact-item">
                    <span className="contact-email">{contact.email}</span>
                    <span className="contact-count">{contact.email_count}</span>
                  </div>
                ))}
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
              <div className="email-subject">{email.subject || '(No Subject)'}</div>
              <div className="email-preview">{email.text_body?.substring(0, 100) || ''}...</div>
              <div className="email-actions">
                <button onClick={(e) => toggleStar(e, email.id)}>⭐</button>
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
              </div>
            </div>
            <div className="detail-body">
              {selectedEmail.html_body ? (
                <div dangerouslySetInnerHTML={{ __html: selectedEmail.html_body }} />
              ) : (
                <pre>{selectedEmail.text_body}</pre>
              )}
            </div>
            <div className="detail-actions">
              <button onClick={() => setComposeData({
                to: selectedEmail.sender,
                subject: `Re: ${selectedEmail.subject}`,
                text: ''
              })}>Reply</button>
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
            <h2>Compose Email</h2>
            <form onSubmit={sendEmail}>
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
                <button type="submit">Send</button>
                <button type="button" onClick={() => setShowCompose(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
