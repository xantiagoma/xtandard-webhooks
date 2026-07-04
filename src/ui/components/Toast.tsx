import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/utils.ts";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  detail?: string;
}

interface ToastState {
  toasts: Toast[];
}

type Action = { type: "add"; toast: Toast } | { type: "remove"; id: string };

function reducer(state: ToastState, action: Action): ToastState {
  switch (action.type) {
    case "add":
      return { toasts: [...state.toasts, action.toast] };
    case "remove":
      return { toasts: state.toasts.filter((t) => t.id !== action.id) };
    default:
      return state;
  }
}

interface ToastContextValue {
  add: (kind: ToastKind, message: string, detail?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const kindAccent: Record<ToastKind, string> = {
  success: "bg-success",
  error: "bg-destructive",
  warning: "bg-warning",
  info: "bg-accent",
};

const kindBorder: Record<ToastKind, string> = {
  success: "border-l-[var(--success)]",
  error: "border-l-[var(--destructive)]",
  warning: "border-l-[var(--warning)]",
  info: "border-l-[var(--accent)]",
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onRemove(toast.id), 4500);
    return () => clearTimeout(t);
  }, [toast.id, onRemove]);

  return (
    <div
      role="alert"
      className={cn(
        "flex min-w-[280px] max-w-sm items-start gap-2.5 rounded-lg border border-border bg-card px-3.5 py-3 shadow-lg",
        "border-l-[3px]",
        kindBorder[toast.kind],
      )}
      style={{
        animation: "toastIn 160ms ease-out",
      }}
    >
      <span
        className={cn("mt-1 size-2 shrink-0 rounded-full", kindAccent[toast.kind])}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <p className="m-0 text-[13px] font-medium text-foreground leading-snug">{toast.message}</p>
        {toast.detail && (
          <p className="mt-1 text-xs text-muted-foreground leading-snug">{toast.detail}</p>
        )}
      </div>
      <button
        aria-label="Dismiss"
        onClick={() => onRemove(toast.id)}
        className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none"
      >
        <X className="size-3.5" />
      </button>

      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { toasts: [] });

  const add = useCallback((kind: ToastKind, message: string, detail?: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    dispatch({ type: "add", toast: { id, kind, message, detail } });
  }, []);

  const remove = useCallback((id: string) => {
    dispatch({ type: "remove", id });
  }, []);

  return (
    <ToastContext.Provider value={{ add }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2"
      >
        {state.toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
