// src/components/ToastContainer.tsx
import { useToast } from '../context/ToastContext';

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <span className="toast-message">{toast.message}</span>
          <button type="button" onClick={() => removeToast(toast.id)} className="toast-close">×</button>
        </div>
      ))}
    </div>
  );
}