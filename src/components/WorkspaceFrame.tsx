"use client";

import { useId, useRef, type ReactNode } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import AppLogo from "@/components/AppLogo";
import { ThemeToggle } from "@/components/ThemeController";

export default function WorkspaceFrame({ label, home, navigation, children }: {
  label: string;
  home: string;
  navigation: (close?: () => void) => ReactNode;
  children: ReactNode;
}) {
  const contentId = useId();
  const dialogId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();

  return (
    <div className="workspace-frame">
      <a href={`#${contentId}`} className="skip-link" onClick={() => document.getElementById(contentId)?.focus()}>Skip to content</a>
      <div className="workspace-sidebar">
        <Link href={home} className="workspace-brand">
          <AppLogo alt="" className="workspace-mark" />
          <span><strong>LiBot</strong><small>{label}</small></span>
        </Link>
        <nav className="workspace-desktop-nav" aria-label={`${label} navigation`}>{navigation()}</nav>
        <div className="workspace-tools"><ThemeToggle showLabel /></div>
        <button type="button" className="workspace-menu-button" aria-haspopup="dialog" aria-controls={dialogId} onClick={() => dialog.current?.showModal()}>
          <Menu size={19} aria-hidden="true" /> Menu
        </button>
      </div>
      <dialog ref={dialog} id={dialogId} aria-label={`${label} navigation`} className="workspace-dialog" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div className="workspace-dialog-inner">
          <div className="workspace-dialog-heading">
            <strong>{label}</strong>
            <button type="button" aria-label="Close navigation" onClick={close} className="ui-icon-button"><X size={21} aria-hidden="true" /></button>
          </div>
          <nav aria-label={`${label} navigation`}>{navigation(close)}</nav>
          <div className="workspace-dialog-tools"><ThemeToggle showLabel /></div>
        </div>
      </dialog>
      <div className="workspace-content" id={contentId} tabIndex={-1}>{children}</div>
    </div>
  );
}
