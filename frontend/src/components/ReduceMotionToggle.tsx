import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'ui:disableAnimations';
const STYLE_ID = 'reduce-motion-style';

function persistPreference(disableAnimations: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(disableAnimations));
  } catch {}
}

function readPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw != null) {
      return JSON.parse(raw);
    }
  } catch {}
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function applyPreference(disableAnimations: boolean) {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_ID);
  if (disableAnimations) {
    if (!existing) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.innerHTML = `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0s !important;
          scroll-behavior: auto !important;
        }
      `;
      document.head.appendChild(style);
    }
    document.documentElement.dataset.reduceMotion = 'true';
  } else {
    existing?.remove();
    delete document.documentElement.dataset.reduceMotion;
  }
}

export default function ReduceMotionToggle() {
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    setDisabled(readPreference());
  }, []);

  useEffect(() => {
    applyPreference(disabled);
    persistPreference(disabled);
  }, [disabled]);

  const label = useMemo(
    () => (disabled ? 'Animations disabled' : 'Animations enabled'),
    [disabled]
  );

  return (
    <label className="reduce-motion-toggle">
      <input
        type="checkbox"
        checked={disabled}
        onChange={(e) => setDisabled(e.target.checked)}
        aria-label="Disable animations"
      />
      <span>{label}</span>
    </label>
  );
}
