import React, { useEffect, useState } from 'react';

const THEME_KEY = 'theme-preference';
const ANIMATION_KEY = 'animations-enabled';

const options = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function Theme() {
  const [theme, setTheme] = useState('light');
  const [animationsEnabled, setAnimationsEnabled] = useState(true);

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_KEY);
    const storedAnimation = localStorage.getItem(ANIMATION_KEY);

    if (storedTheme && options.some((o) => o.value === storedTheme)) {
      setTheme(storedTheme);
    }

    if (storedAnimation !== null) {
      setAnimationsEnabled(storedAnimation === 'true');
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(ANIMATION_KEY, animationsEnabled ? 'true' : 'false');
    document.body.classList.toggle('animations-disabled', !animationsEnabled);
  }, [animationsEnabled]);

  return (
    <div className="theme-page">
      <header>
        <h1>Theme &amp; Animation Preferences</h1>
        <p>Customize how the site looks and feels on this device.</p>
      </header>

      <section className="theme-section">
        <h2>Theme</h2>
        <div className="theme-options">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              className={`theme-option ${theme === opt.value ? 'active' : ''}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="hint">Your preference is saved to localStorage.</p>
      </section>

      <section className="animation-section">
        <h2>Animations</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={animationsEnabled}
            onChange={(e) => setAnimationsEnabled(e.target.checked)}
          />
          <span>Enable animations</span>
        </label>
        {!animationsEnabled && (
          <p className="hint">Motion effects are disabled to reduce distractions.</p>
        )}
      </section>
    </div>
  );
}
