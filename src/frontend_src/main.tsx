// frontend_src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/App'; 
import { ToastProvider } from './context/ToastContext';
import { ToastContainer } from './components/ToastContainer';
import { StandaloneOverlay } from './components/StandaloneOverlay';
import './main.css';

const isOverlayWindow = new URLSearchParams(window.location.search).get('overlay') === 'true';

const root = document.getElementById('root')

if (isOverlayWindow) {
  document.documentElement.classList.add('overlay-mode');
  document.body.classList.add('overlay-mode');
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';

  ReactDOM.createRoot(root!).render(
    <React.StrictMode>
      <StandaloneOverlay />
    </React.StrictMode>
  );
} else {
  ReactDOM.createRoot(root!).render(
    <React.StrictMode>
      <ToastProvider>
        <App />
        <ToastContainer />
      </ToastProvider>
    </React.StrictMode>
  );
}