import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/600.css';
import './styles.css';
import { registerAppUpdate } from './app/registerUpdate';
import { ViewerApp } from './app/ViewerApp';

registerAppUpdate();

const empty = document.querySelector('#empty');
const loading = document.querySelector<HTMLElement>('#loading');

// The precache worker fetches the same sample URLs as boot(). On a cold load
// those two requests overlap and the sample body comes back short. Wait until
// the worker is active so the first fetch is served from the precache.
async function waitForServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 8000);
    }),
  ]);
}

void waitForServiceWorker().then(() => {
  try {
    new ViewerApp();
  } catch (error) {
    if (loading) loading.hidden = true;
    if (empty) empty.removeAttribute('hidden');
    const card = document.querySelector('.empty-card p');
    const message = error instanceof Error ? error.message : String(error);
    if (card) card.textContent = message;
  }
});
