import React, { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = (process.env.REACT_APP_API_BASE || '/api').replace(/\/$/, '');

const STANDARD_FOLDER_ORDER = ['inbox', 'sent', 'drafts', 'starred', 'archive', 'spam', 'trash'];
const FOLDER_GLYPHS = {
  inbox: '●',
  sent: '→',
  drafts: '✎',
  starred: '★',
  archive: '▣',
  spam: '!',
  trash: '×'
};

function businessLabel(value) {
  if (!value) return 'Unassigned';
  return String(value)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function MailRegistryPanel({
  accounts,
  folders,
  currentAccount,
  currentFolder,
  onSelectMailbox,
  onRegistryChanged,
  businessScope,
  onBusinessScopeChange
}) {
  const [domains, setDomains] = useState([]);
  const [registryFolders, setRegistryFolders] = useState([]);
  const [collapsedDomains, setCollapsedDomains] = useState({});
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [accountDraft, setAccountDraft] = useState({ email: '', display_name: '' });
  const [folderDraft, setFolderDraft] = useState('');
  const [message, setMessage] = useState('');

  const fetchRegistry = useCallback(async () => {
    try {
      const [domainsRes, foldersRes] = await Promise.all([
        fetch(`${API_BASE}/registry/domains`),
        fetch(`${API_BASE}/registry/folders`)
      ]);
      const domainsData = await domainsRes.json();
      const foldersData = await foldersRes.json();
      if (!domainsRes.ok) throw new Error(domainsData.detail || 'Failed to load mail domains');
      if (!foldersRes.ok) throw new Error(foldersData.detail || 'Failed to load mail folders');
      setDomains(domainsData.domains || []);
      setRegistryFolders(foldersData.folders || []);
    } catch (error) {
      console.error('Failed to load mail registry:', error);
      setMessage('Mail registry unavailable');
    }
  }, []);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  const businessOptions = useMemo(() => {
    const values = new Map();
    for (const domain of domains) {
      if (domain.business_scope) values.set(domain.business_scope, businessLabel(domain.business_scope));
    }
    return Array.from(values.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [domains]);

  const visibleDomains = useMemo(() => {
    if (!businessScope || businessScope === 'all') return domains;
    return domains.filter(domain => domain.business_scope === businessScope);
  }, [domains, businessScope]);

  const folderCounts = useMemo(() => {
    const result = new Map();
    for (const folder of folders || []) {
      result.set(String(folder.folder || '').toLowerCase(), folder);
    }
    return result;
  }, [folders]);

  const foldersForCurrentAccount = useMemo(() => {
    if (currentAccount === 'all') {
      const names = new Map();
      for (const item of registryFolders) {
        const key = String(item.name || '').toLowerCase();
        if (!names.has(key)) names.set(key, item);
      }
      return Array.from(names.values());
    }
    return registryFolders.filter(item => String(item.account_email || '').toLowerCase() === String(currentAccount).toLowerCase());
  }, [registryFolders, currentAccount]);

  const orderedFolders = useMemo(() => {
    return [...foldersForCurrentAccount].sort((a, b) => {
      const aName = String(a.name || '').toLowerCase();
      const bName = String(b.name || '').toLowerCase();
      const aStandard = STANDARD_FOLDER_ORDER.indexOf(aName);
      const bStandard = STANDARD_FOLDER_ORDER.indexOf(bName);
      if (aStandard >= 0 || bStandard >= 0) {
        if (aStandard < 0) return 1;
        if (bStandard < 0) return -1;
        return aStandard - bStandard;
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [foldersForCurrentAccount]);

  const addAccount = async event => {
    event.preventDefault();
    if (!accountDraft.email.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/registry/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: accountDraft.email.trim(),
          display_name: accountDraft.display_name.trim() || undefined,
          business_scope: businessScope !== 'all' ? businessScope : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Unable to add mailbox');
      setAccountDraft({ email: '', display_name: '' });
      setShowAddAccount(false);
      setMessage(`${data.email} added`);
      await fetchRegistry();
      if (onRegistryChanged) await onRegistryChanged();
    } catch (error) {
      setMessage(error.message || 'Unable to add mailbox');
    }
  };

  const addFolder = async event => {
    event.preventDefault();
    if (!folderDraft.trim()) return;
    const accountEmail = currentAccount === 'all' ? accounts[0]?.email : currentAccount;
    if (!accountEmail) {
      setMessage('Select a mailbox before creating a folder');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/registry/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderDraft.trim(), account_email: accountEmail })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Unable to create folder');
      setFolderDraft('');
      setShowAddFolder(false);
      setMessage(`${data.name} created`);
      await fetchRegistry();
      if (onRegistryChanged) await onRegistryChanged();
    } catch (error) {
      setMessage(error.message || 'Unable to create folder');
    }
  };

  return (
    <>
      <div className="sidebar-section business-context-section">
        <div className="sidebar-label">CONTEXT</div>
        <select
          className="sidebar-business-select"
          value={businessScope || 'all'}
          onChange={event => onBusinessScopeChange?.(event.target.value)}
        >
          <option value="all">All businesses</option>
          {businessOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div className="sidebar-section domain-section">
        <div className="sidebar-title-row">
          <div className="sidebar-label">MAIL DOMAINS</div>
          <button type="button" className="sidebar-mini-action" onClick={() => setShowAddAccount(value => !value)}>+ Add</button>
        </div>

        <button
          type="button"
          className={`domain-all-row ${currentAccount === 'all' ? 'active' : ''}`}
          onClick={() => onSelectMailbox?.('all', 'inbox')}
        >
          <span>All inboxes</span>
          <strong>{accounts.reduce((sum, account) => sum + Number(account.unread_count || 0), 0)}</strong>
        </button>

        {showAddAccount && (
          <form className="sidebar-inline-form" onSubmit={addAccount}>
            <input
              type="email"
              value={accountDraft.email}
              onChange={event => setAccountDraft({ ...accountDraft, email: event.target.value })}
              placeholder="mailbox@domain.com"
              required
            />
            <input
              value={accountDraft.display_name}
              onChange={event => setAccountDraft({ ...accountDraft, display_name: event.target.value })}
              placeholder="Display name (optional)"
            />
            <div className="sidebar-inline-actions">
              <button type="button" onClick={() => setShowAddAccount(false)}>Cancel</button>
              <button type="submit" className="primary">Add</button>
            </div>
          </form>
        )}

        <div className="domain-tree">
          {visibleDomains.map(domain => {
            const collapsed = Boolean(collapsedDomains[domain.domain_id]);
            const domainAccounts = (domain.accounts || []).map(registryAccount => {
              const live = accounts.find(account => String(account.email).toLowerCase() === String(registryAccount.email).toLowerCase());
              return { ...registryAccount, ...live };
            });
            const unread = domainAccounts.reduce((sum, account) => sum + Number(account.unread_count || 0), 0);
            return (
              <div key={domain.domain_id} className="domain-group">
                <button
                  type="button"
                  className="domain-heading"
                  onClick={() => setCollapsedDomains(prev => ({ ...prev, [domain.domain_id]: !collapsed }))}
                >
                  <span className="domain-chevron">{collapsed ? '›' : '⌄'}</span>
                  <span className="domain-name">{domain.domain}</span>
                  {unread > 0 && <span className="folder-unread">{unread}</span>}
                </button>
                {!collapsed && (
                  <div className="domain-mailboxes">
                    {domainAccounts.map(account => (
                      <button
                        type="button"
                        key={account.account_id || account.email}
                        className={`mailbox-tree-row ${currentAccount === account.email ? 'active' : ''}`}
                        onClick={() => onSelectMailbox?.(account.email, 'inbox')}
                        title={account.email}
                      >
                        <span className="mailbox-tree-dot" />
                        <span className="mailbox-tree-address">{account.local_part || String(account.email).split('@')[0]}</span>
                        {Number(account.unread_count || 0) > 0 && <span className="folder-unread">{account.unread_count}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar-section registry-folders-section">
        <div className="sidebar-title-row">
          <div className="sidebar-label">FOLDERS</div>
          <button type="button" className="sidebar-mini-action" onClick={() => setShowAddFolder(value => !value)}>+ New</button>
        </div>

        {showAddFolder && (
          <form className="sidebar-inline-form compact" onSubmit={addFolder}>
            <input value={folderDraft} onChange={event => setFolderDraft(event.target.value)} placeholder="Folder name" required />
            <div className="sidebar-inline-actions">
              <button type="button" onClick={() => setShowAddFolder(false)}>Cancel</button>
              <button type="submit" className="primary">Create</button>
            </div>
          </form>
        )}

        <div className="folder-list">
          {orderedFolders.map(folder => {
            const folderName = String(folder.name || '').toLowerCase();
            const count = folderCounts.get(folderName);
            return (
              <button
                type="button"
                key={`${folder.account_id || 'all'}:${folder.mailbox_id || folderName}`}
                className={`folder-item ${String(currentFolder).toLowerCase() === folderName ? 'active' : ''}`}
                onClick={() => onSelectMailbox?.(currentAccount, folderName)}
              >
                <span className="folder-glyph">{FOLDER_GLYPHS[folderName] || '○'}</span>
                <span className="folder-name">{folder.name}</span>
                {Number(count?.unread || 0) > 0 && <span className="folder-unread">{count.unread}</span>}
                <span className="folder-count">{count?.count || 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {message && <div className="sidebar-registry-message" title={message}>{message}</div>}
    </>
  );
}

export default MailRegistryPanel;
