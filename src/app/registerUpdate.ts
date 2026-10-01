import { registerSW } from 'virtual:pwa-register';

const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

/** Check for a new service worker on load, when the tab is shown, and hourly. */
export function registerAppUpdate(): void {
  const build = document.querySelector('#build-id');
  if (build) build.textContent = __APP_BUILD__;

  const toast = document.querySelector<HTMLElement>('#update-toast');
  const button = document.querySelector<HTMLButtonElement>('#update-reload');
  if (!toast || !button) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast.hidden = false;
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        void registration.update();
      };
      check();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.setInterval(check, UPDATE_INTERVAL_MS);
    },
  });

  button.addEventListener('click', () => {
    button.disabled = true;
    void updateSW(true);
  });
}
