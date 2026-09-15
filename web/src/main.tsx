/**
 * Entry point.
 *
 * The theme follows the operating system rather than offering a switch. A
 * preference control would sit in the rail competing with the four things the
 * rail exists to show, and nobody opens a document register to choose a theme.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Session from './Session';
import './tokens.css';
import './app.css';

const el = document.getElementById('root');
if (!el) throw new Error('No #root element — index.html and main.tsx disagree');

if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.setAttribute('data-theme', 'dark');
}

createRoot(el).render(
  <StrictMode>
    <Session />
  </StrictMode>,
);
