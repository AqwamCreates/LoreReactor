// src/components/ToastContainer.tsx

import { useToast } from "../presentation/contexts/ToastContext";

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <span className="toast-message">{toast.message}</span>
          <button onClick={() => removeToast(toast.id)} className="toast-close">×</button>
        </div>
      ))}
    </div>
  );
}