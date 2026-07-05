import * as React from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import type { DeliveryStatus } from "../types.ts";
import { deliveryStatusLabel, deliveryStatusTone } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { portalContainerRef } from "../lib/portal-container.ts";
import { Button } from "./ui-bits.tsx";

/* ─── Spinner ───────────────────────────────────────────────────────────────── */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={cn("animate-spin", className)}
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="24"
        strokeDashoffset="12"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoadingRow({ label }: { label: string }) {
  return (
    <div className="mt-8 flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
      <Spinner />
      {label}
    </div>
  );
}

/* ─── DeliveryStatusBadge ───────────────────────────────────────────────────── */

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        deliveryStatusTone(status),
      )}
    >
      {deliveryStatusLabel(status)}
    </span>
  );
}

/* ─── Mono ──────────────────────────────────────────────────────────────────── */

/** Keys/ids render in JetBrains Mono per the design system. */
export function Mono({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("font-mono text-[12px] text-foreground", className)}>{children}</span>;
}

/* ─── PageHeader ────────────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/* ─── SectionCard ───────────────────────────────────────────────────────────── */

export function SectionCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

/* ─── ModalDialog ───────────────────────────────────────────────────────────── */

export function ModalDialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal container={portalContainerRef()}>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-card shadow-2xl outline-none",
            wide ? "max-w-2xl" : "max-w-md",
          )}
        >
          <div className="border-b border-border px-5 py-4">
            <Dialog.Title className="text-[15px] font-semibold text-foreground">
              {title}
            </Dialog.Title>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
            {children}
          </div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ─── ConfirmDialog ─────────────────────────────────────────────────────────── */

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  confirmLabel,
  danger,
  loading,
  children,
  confirmDisabled,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  confirmDisabled?: boolean;
}) {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={loading}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </ModalDialog>
  );
}

/* ─── EmptyCard ─────────────────────────────────────────────────────────────── */

export function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-card px-4 py-16 text-center">
      <p className="text-[13px] text-muted-foreground">{children}</p>
    </div>
  );
}

/** Shown by app-scoped views when no application exists/is selected yet. */
export function NoApplication() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <EmptyCard>
        No application selected. Create one from the application switcher in the top bar.
      </EmptyCard>
    </div>
  );
}
