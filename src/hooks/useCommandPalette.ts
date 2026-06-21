// =============================================================================
// code/useCommandPalette.ts  →  seekcode-gui/src/hooks/useCommandPalette.ts
// =============================================================================
// Hook that registers the Cmd+K keyboard shortcut and exposes open/close state.
// The actual palette UI lives in CommandPalette.tsx — this hook just manages
// the trigger and state.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store';

export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(o => !o), []);

  // Register global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K — toggle command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }

      // Cmd+B / Ctrl+B — toggle sidebar (bonus shortcut)
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }

      // Cmd+Shift+O — new chat
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'O') {
        e.preventDefault();
        useAppStore.getState().createSession();
      }

      // Escape — close palette (if open)
      if (e.key === 'Escape' && isOpen) {
        close();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle, toggleSidebar, close, isOpen]);

  return { isOpen, open, close, toggle };
}
