import React from 'react';
import ReactDOM from 'react-dom/client';
import VIVCommunications from './PrimeMailV4';
import ContactReviewOverlay from './ContactReviewOverlay';
import './ContactReviewOverlay.css';
import './VIVCommunicationsFixes.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <>
    <VIVCommunications />
    <ContactReviewOverlay />
  </>
);