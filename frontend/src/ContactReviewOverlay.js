import React, { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = (process.env.REACT_APP_API_BASE || '/api').replace(/\/$/, '');

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
      setNotice(`Contact review unavailable: ${error.message}`);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!candidates.length) return;
    if (sessionStorage.getItem('prime_mail_contact_review_seen') === '1') return;
    const timer = setTimeout(() => {
      setOpen(true);
      sessionStorage.setItem('prime_mail_contact_review_seen', '1');
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
      setNotice('Select the people you actually want to save.');
      return;
    }
    setBusy(true);
    try {
      for (const candidate of selectedCandidates) {
        const response = await fetch(`${API_BASE}/contacts`, {
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
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || `Could not save ${candidate.email}`);
      }
      setSelected({});
      setNotice(`${selectedCandidates.length} contact${selectedCandidates.length === 1 ? '' : 's'} saved.`);
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
          Review people <strong>{candidates.length}</strong>
        </button>
      )}

      {open && (
        <div className="contact-review-backdrop" onMouseDown={() => setOpen(false)}>
          <section className="contact-review-modal" onMouseDown={event => event.stopPropagation()}>
            <header>
              <div>
                <h2>Save new people?</h2>
                <p>
                  Mail does not create contacts automatically. Choose only the people you want to keep.
                  {filtered > 0 ? ` ${filtered} obvious automated/bulk sender${filtered === 1 ? '' : 's'} filtered out.` : ''}
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
                  {busy ? 'Saving…' : 'Save selected'}
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
