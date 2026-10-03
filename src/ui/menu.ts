/**
 * True when the event target is inside one of the roots.
 * A non-node target is not treated as outside, so a stray event does not dismiss.
 */
export function pointerInside(event: Event, roots: readonly Node[]): boolean {
  const target = event.target;
  if (!(target instanceof Node)) return true;
  return roots.some((root) => root.contains(target));
}

/** Button-controlled menu: click, arrows, Home/End, Escape, and outside pointer. */
export function bindMenu(button: HTMLButtonElement, menu: HTMLElement): { close(): void } {
  const items = () => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];

  const setExpanded = (open: boolean) => {
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };

  const close = () => setExpanded(false);

  const open = () => {
    setExpanded(true);
    items()[0]?.focus();
  };

  button.addEventListener('click', () => {
    if (menu.hidden) open();
    else close();
  });

  menu.addEventListener('keydown', (event) => {
    if (menu.hidden) return;
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      list[next]?.focus();
    };
    if (event.key === 'ArrowDown') move(index < 0 ? 0 : (index + 1) % list.length);
    else if (event.key === 'ArrowUp') move(index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(list.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      button.focus();
    } else if (event.key === 'Tab') close();
  });

  menu.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('[role="menuitem"]')) close();
  });

  document.addEventListener('pointerdown', (event) => {
    if (pointerInside(event, [button, menu])) return;
    close();
  });

  return { close };
}
