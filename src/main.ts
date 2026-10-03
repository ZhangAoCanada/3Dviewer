import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/600.css';
import './styles.css';
import { registerAppUpdate } from './app/registerUpdate';
import { collectDiagnostics, formatReport } from './core/diagnostics';
import { classifyFailure } from './core/loadFailure';
import { isDesktopApp } from './desktop/runtime';
import { ViewerApp } from './app/ViewerApp';
import { renderProblem } from './ui/problem';

registerAppUpdate();

const loading = document.querySelector<HTMLElement>('#loading');

// The precache worker fetches the same sample URLs as boot(). On a cold load
// those two requests overlap and the sample body comes back short. Wait until
// the worker is active so the first fetch is served from the precache.
async function waitForServiceWorker(): Promise<void> {
  if (isDesktopApp() || !('serviceWorker' in navigator)) return;
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 8000);
    }),
  ]);
}

function renderStartupFailure(error: unknown): void {
  if (loading) loading.hidden = true;
  const root = document.querySelector<HTMLElement>('#problem');
  if (!root) return;
  document.body.classList.add('no-graphics');
  const failure = classifyFailure(error);
  renderProblem(root, failure, formatReport(collectDiagnostics(null, { error })), {
    retry: () => location.reload(),
    reinitGraphics: () => location.reload(),
    showBack: false,
  });
  root.hidden = false;
  document.querySelector('#empty')?.setAttribute('hidden', '');
}

try {
  const app = new ViewerApp();
  app.initGraphics();
  void waitForServiceWorker()
    .then(() => app.boot())
    .catch((error: unknown) => renderStartupFailure(error));
} catch (error) {
  renderStartupFailure(error);
}
