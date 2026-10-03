import type { Failure, FailureAction } from '../core/loadFailure';

export interface ProblemHandlers {
  retry?: () => void;
  retryLowerMemory?: () => void;
  chooseFile?: () => void;
  openFile?: () => void;
  downloadApp?: () => void;
  reinitGraphics?: () => void;
  formats?: () => void;
  back?: () => void;
  dismiss?: () => void;
  labels?: Partial<Record<FailureAction, string>>;
  showBack?: boolean;
  showDismiss?: boolean;
}

const FORMATS =
  'Splats: .ply .splat .spz .ksplat .sog .rad · Meshes: .glb .gltf .obj · Points: .ply';

const RUNNERS: Record<FailureAction, keyof ProblemHandlers> = {
  retry: 'retry',
  'retry-lower-memory': 'retryLowerMemory',
  'choose-file': 'chooseFile',
  'open-file': 'openFile',
  'download-app': 'downloadApp',
  'reinit-graphics': 'reinitGraphics',
  formats: 'formats',
};

/** Fill the problem card. Callers decide whether the section is visible. */
export function renderProblem(
  root: ParentNode,
  failure: Failure,
  report: string,
  handlers: ProblemHandlers,
): void {
  const title = root.querySelector('#problem-title');
  if (title) title.textContent = failure.title;
  const desc = root.querySelector('#problem-desc');
  if (desc) desc.textContent = failure.body;
  const icon = root.querySelector('#problem-icon');
  if (icon) {
    const alert = failure.kind === 'graphics' || failure.kind === 'memory' ? '#i-triangle-alert' : '#i-circle-alert';
    icon.setAttribute('href', alert);
  }
  const reportNode = root.querySelector('#problem-report');
  if (reportNode) reportNode.textContent = report;
  const actions = root.querySelector('#problem-actions');
  if (actions) {
    actions.replaceChildren(
      ...failure.actions.map((action, index) => actionButton(action, failure, handlers, index === 0)),
    );
  }
  const copy = root.querySelector<HTMLButtonElement>('#problem-copy');
  if (copy) {
    copy.textContent = 'Copy report';
    copy.onclick = () => {
      void copyReport(report, copy, root.querySelector('#problem-report'));
    };
  }
  const close = root.querySelector<HTMLButtonElement>('#problem-close');
  if (close) {
    const dismiss = handlers.showDismiss === true;
    const back = handlers.showBack === true && !dismiss;
    close.hidden = !dismiss && !back;
    close.textContent = dismiss ? 'Dismiss' : 'Back';
    close.onclick = () => {
      if (dismiss) handlers.dismiss?.();
      else handlers.back?.();
    };
  }
}

export function supportedFormats(): string {
  return FORMATS;
}

function actionButton(
  action: FailureAction,
  failure: Failure,
  handlers: ProblemHandlers,
  primary: boolean,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'btn btn-primary' : 'btn btn-secondary';
  button.dataset.action = action;
  button.textContent = actionLabel(action, failure, handlers.labels);
  button.addEventListener('click', () => {
    if (action === 'formats') revealFormats(button);
    const key = RUNNERS[action];
    const run = handlers[key];
    if (typeof run === 'function') run();
  });
  return button;
}

function actionLabel(
  action: FailureAction,
  failure: Failure,
  labels: Partial<Record<FailureAction, string>> | undefined,
): string {
  if (labels?.[action]) return labels[action];
  switch (action) {
    case 'retry':
    case 'reinit-graphics':
      return 'Try again';
    case 'retry-lower-memory':
      return 'Try again with lower memory';
    case 'choose-file':
      return 'Choose another file';
    case 'open-file':
      return 'Open a local file instead';
    case 'download-app':
      return failure.kind === 'memory' ? 'Get the desktop app' : 'Download desktop app';
    case 'formats':
      return 'Supported formats';
    default:
      return action;
  }
}

function revealFormats(button: HTMLButtonElement): void {
  const desc = button.closest('#problem')?.querySelector('#problem-desc');
  if (!desc || desc.textContent?.includes(FORMATS)) return;
  desc.textContent = `${desc.textContent ?? ''}\n\n${FORMATS}`;
}

async function copyReport(report: string, button: HTMLButtonElement, pre: Element | null): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(report);
    button.textContent = 'Copied';
  } catch {
    if (pre) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(pre);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    button.textContent = 'Press Ctrl+C to copy';
  }
}
