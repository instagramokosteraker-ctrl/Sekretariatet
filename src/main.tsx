import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
} else if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((reg) => reg.unregister())))
    .catch(() => {});
  if ('caches' in window) {
    void caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('workbox-') || k.startsWith('passersi-'))
            .map((k) => caches.delete(k)),
        ),
      )
      .catch(() => {});
  }
}

createRoot(document.getElementById('root')!).render(<App />);
