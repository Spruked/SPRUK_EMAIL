import React from 'react';
import ReactDOM from 'react-dom/client';
import VIVCommunications from './PrimeMailV4';
import ContactReviewOverlay from './ContactReviewOverlay';
import './ContactReviewOverlay.css';
import './VIVCommunicationsFixes.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <>
    <VIVCommunications />
    <ContactReviewOverlay />
  </>
);
