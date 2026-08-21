import { useEffect, useState } from 'react';
import './Toast.css';

export type ToastType = 'success' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastMessage {
  id: number;
  type: ToastType;
  text: string;
  action?: ToastAction;
  durationMs: number;
}

type ToastListener = (toast: ToastMessage) => void;

let listener: ToastListener | null = null;
let nextId = 1;

const DEFAULT_TOAST_DURATION_MS = 4000;
// Uma confirmação com "desfazer" precisa ficar visível tempo suficiente
// pra pessoa perceber o que mudou e decidir se quer reverter — mais do
// que o padrão de uma confirmação sem ação nenhuma.
const UNDO_TOAST_DURATION_MS = 7000;

export function showToast(text: string, type: ToastType = 'success', action?: ToastAction): void {
  const durationMs = action ? UNDO_TOAST_DURATION_MS : DEFAULT_TOAST_DURATION_MS;
  listener?.({ id: nextId++, type, text, action, durationMs });
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    listener = (toast) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, toast.durationMs);
    };
    return () => {
      listener = null;
    };
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
