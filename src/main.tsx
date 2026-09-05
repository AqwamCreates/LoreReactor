import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/App'; 
import { ToastContainer } from './components/ToastContainer';
import './index.css';
import { ToastProvider } from './presentation/contexts/ToastContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
      <ToastContainer />
    </ToastProvider>
  </React.StrictMode>
);
