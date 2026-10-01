const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Check for a new service worker on load, when the tab is shown, and hourly.
 * The build id is part of the script URL so a deploy is a new worker even when
 * the browser would otherwise skip a same-URL update check.
 */
export function registerAppUpdate(): void {
  const build = document.querySelector('#build-id');
  if (build) build.textContent = __APP_BUILD__;

  const toast = document.querySelector<HTMLElement>('#update-toast');
  const button = document.querySelector<HTMLButtonElement>('#update-reload');
  if (!toast || !button || !('serviceWorker' in navigator)) return;

  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };

  button.addEventListener('click', () => {
    button.disabled = true;
    void navigator.serviceWorker.getRegistration().then((registration) => {
      registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!toast.hidden) reload();
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'UPDATE_AVAILABLE') return;
    event.ports[0]?.postMessage('HAS_TOAST');
  });

  const scope = import.meta.env.BASE_URL;
  const scriptUrl = `${scope}sw.js?${encodeURIComponent(__APP_BUILD__)}`;
  let listening = false;
  let checksStarted = false;

  const showIfUpdateWaiting = (registration: ServiceWorkerRegistration) => {
    if (registration.waiting && navigator.serviceWorker.controller) toast.hidden = false;
  };

  // Only the first install should claim on its own. An update already has an
  // active worker and stays waiting until Reload.
  const claimFirstInstall = (registration: ServiceWorkerRegistration) => {
    if (registration.active) return;
    (registration.waiting ?? registration.installing)?.postMessage({ type: 'SKIP_WAITING' });
  };

  const listen = (registration: ServiceWorkerRegistration) => {
    if (listening) return;
    listening = true;

    const track = (worker: ServiceWorker | null) => {
      worker?.addEventListener('statechange', () => {
        claimFirstInstall(registration);
        if (worker.state === 'installed') showIfUpdateWaiting(registration);
      });
    };

    track(registration.installing);
    track(registration.waiting);
    registration.addEventListener('updatefound', () => track(registration.installing));
    claimFirstInstall(registration);
    showIfUpdateWaiting(registration);

    const startChecks = () => {
      if (checksStarted || !registration.active) return;
      checksStarted = true;
      const check = () => {
        void registration.update();
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.setInterval(check, UPDATE_INTERVAL_MS);
    };

    if (registration.active) startChecks();
    else {
      const worker = registration.installing ?? registration.waiting;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'activated') startChecks();
      });
    }
  };

  void navigator.serviceWorker
    .getRegistration(scope)
    .then((existing) => {
      if (existing) listen(existing);
      return navigator.serviceWorker.register(scriptUrl, { scope, updateViaCache: 'none' });
    })
    .then((registration) => {
      if (!registration) return;
      listen(registration);
      claimFirstInstall(registration);
      showIfUpdateWaiting(registration);
    })
    .catch((error) => console.warn('Service worker registration failed', error));
}
