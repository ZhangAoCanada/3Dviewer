import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './styles.css';
import { registerAppUpdate } from './app/registerUpdate';
import { ViewerApp } from './app/ViewerApp';

registerAppUpdate();

const empty = document.querySelector('#empty');
const loading = document.querySelector<HTMLElement>('#loading');

try {
  new ViewerApp();
} catch (error) {
  if (loading) loading.hidden = true;
  if (empty) empty.removeAttribute('hidden');
  const card = document.querySelector('.empty-card p');
  const message = error instanceof Error ? error.message : String(error);
  if (card) card.textContent = message;
}
