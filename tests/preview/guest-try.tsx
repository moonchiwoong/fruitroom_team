import React from 'react';
import {createRoot} from 'react-dom/client';
import GuestTry from '../../components/guest-try';

// Browser-only fixture: no TeamAuth provider, credentials or customer records.
createRoot(document.getElementById('root')!).render(<GuestTry/>);
