import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/App'; 
import { ToastProvider } from './context/ToastContext';
import { ToastContainer } from './components/ToastContainer';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
      <ToastContainer />
    </ToastProvider>
  </React.StrictMode>
);
