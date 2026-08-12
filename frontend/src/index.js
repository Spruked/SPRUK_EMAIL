import React from 'react';
import ReactDOM from 'react-dom/client';
import PrimeMailV4 from './PrimeMailV4';
import ContactReviewOverlay from './ContactReviewOverlay';
import './ContactReviewOverlay.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <>
    <PrimeMailV4 />
    <ContactReviewOverlay />
  </>
);
