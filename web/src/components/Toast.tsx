import { useEffect, useState } from 'react';
import './Toast.css';

export type ToastType = 'success' | 'error';

interface ToastMessage {
  id: number;
  type: ToastType;
  text: string;
}

type ToastListener = (toast: ToastMessage) => void;

let listener: ToastListener | null = null;
let nextId = 1;

export function showToast(text: string, type: ToastType = 'success'): void {
  listener?.({ id: nextId++, type, text });
}

const TOAST_DURATION_MS = 4000;

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    listener = (toast) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, TOAST_DURATION_MS);
    };
    return () => {
      listener = null;
    };
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
