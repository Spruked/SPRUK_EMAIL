import React, { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = (process.env.REACT_APP_API_BASE || '/api').replace(/\/$/, '');
const REVIEW_SEEN_KEY = 'viv_communications_contact_review_seen';
const LEGACY_REVIEW_SEEN_KEY = 'prime_mail_contact_review_seen';
const BUSINESS_SCOPE_KEY = 'viv_communications_business_scope';
const LEGACY_BUSINESS_SCOPE_KEY = 'prime_mail_business_scope';

function activeBusinessScope() {
  const scope = localStorage.getItem(BUSINESS_SCOPE_KEY) || localStorage.getItem(LEGACY_BUSINESS_SCOPE_KEY) || 'personal';
  return scope === 'all' ? 'personal' : scope;
}

export default function ContactReviewOverlay() {
  const [candidates, setCandidates] = useState([]);
  const [filtered, setFiltered] = useState(0);
  const [selected, setSelected] = useState({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/contact-candidates?limit=20`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || response.statusText);
      setCandidates(data.candidates || []);
      setFiltered(data.filtered_automated || 0);
    } catch (error) {
      setNotice(`Unknown-source review unavailable: ${error.message}`);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!candidates.length) return;
    if (sessionStorage.getItem(REVIEW_SEEN_KEY) === '1' || sessionStorage.getItem(LEGACY_REVIEW_SEEN_KEY) === '1') return;
    const timer = setTimeout(() => {
      setOpen(true);
      sessionStorage.setItem(REVIEW_SEEN_KEY, '1');
      sessionStorage.setItem(LEGACY_REVIEW_SEEN_KEY, '1');
    }, 1200);
    return () => clearTimeout(timer);
  }, [candidates]);

  const selectedCandidates = useMemo(
    () => candidates.filter(candidate => Boolean(selected[candidate.email])),
    [candidates, selected]
  );

  function toggle(email) {
    setSelected(current => ({ ...current, [email]: !current[email] }));
  }

  async function saveSelected() {
    if (!selectedCandidates.length) {
      setNotice('Select the people you want VIV to remember.');
      return;
    }
    setBusy(true);
    try {
      let linked = 0;
      let pending = 0;
      const businessScope = activeBusinessScope();
      for (const candidate of selectedCandidates) {
        const saveResponse = await fetch(`${API_BASE}/contacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: candidate.name,
            email: candidate.email,
            contact_type: 'contact',
            crm_stage: null,
            sync_crm: false
          })
        });
        const saved = await saveResponse.json().catch(() => ({}));
        if (!saveResponse.ok) throw new Error(saved.detail || `Could not save ${candidate.email}`);

        const promoteResponse = await fetch(`${API_BASE}/integrations/viv/promote-contact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: candidate.email, business_scope: businessScope })
        });
        const promoted = await promoteResponse.json().catch(() => ({}));
        if (!promoteResponse.ok) throw new Error(promoted.detail || `Could not link ${candidate.email} to VIV`);
        if (promoted.status === 'linked') linked += 1;
        else pending += 1;
      }
      setSelected({});
      setNotice(
        pending
          ? `${selectedCandidates.length} source${selectedCandidates.length === 1 ? '' : 's'} saved; ${linked} linked to canonical VIV dossiers and ${pending} awaiting bridge reconciliation.`
          : `${selectedCandidates.length} source${selectedCandidates.length === 1 ? '' : 's'} added to canonical VIV dossiers.`
      );
      await load();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function ignore(candidate) {
    try {
      await fetch(`${API_BASE}/contact-candidates/ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: candidate.email })
      });
      setSelected(current => {
        const next = { ...current };
        delete next[candidate.email];
        return next;
      });
      await load();
    } catch (error) {
      setNotice(error.message);
    }
  }

  if (!candidates.length && !notice) return null;

  return (
    <>
      {candidates.length > 0 && (
        <button className="contact-review-pill" onClick={() => setOpen(true)}>
          Unknown sources <strong>{candidates.length}</strong>
        </button>
      )}

      {open && (
        <div className="contact-review-backdrop" onMouseDown={() => setOpen(false)}>
          <section className="contact-review-modal" onMouseDown={event => event.stopPropagation()}>
            <header>
              <div>
                <h2>Review unknown sources</h2>
                <p>
                  VIV does not create dossiers automatically. Choose the people you want to remember; approved sources are reconciled into canonical VIV dossiers and linked to future communications.
                  {filtered > 0 ? ` ${filtered} obvious automated/bulk sender${filtered === 1 ? '' : 's'} filtered as noise.` : ''}
                </p>
              </div>
              <button className="contact-review-close" onClick={() => setOpen(false)}>×</button>
            </header>

            <div className="contact-review-list">
              {candidates.map(candidate => (
                <div className="contact-review-row" key={candidate.email}>
                  <label>
                    <input type="checkbox" checked={Boolean(selected[candidate.email])} onChange={() => toggle(candidate.email)} />
                    <span>
                      <strong>{candidate.name || candidate.email}</strong>
                      <small>{candidate.email}</small>
                      <em>{candidate.message_count} message{candidate.message_count === 1 ? '' : 's'} · {candidate.sample_subject || 'No subject'}</em>
                    </span>
                  </label>
                  <button onClick={() => ignore(candidate)}>Ignore</button>
                </div>
              ))}
            </div>

            <footer>
              <span>{selectedCandidates.length} selected</span>
              <div>
                <button onClick={() => setOpen(false)}>Not now</button>
                <button className="save" disabled={busy || !selectedCandidates.length} onClick={saveSelected}>
                  {busy ? 'Saving…' : 'Add to VIV'}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {notice && <div className="contact-review-notice" onClick={() => setNotice('')}>{notice}</div>}
    </>
  );
}
