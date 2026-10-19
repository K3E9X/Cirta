/**
 * [F-P3 2.6] The compose button's panel: what the background page found in
 * the attachments, and the two choices. Everything shown that came from a
 * document is set as text, never as markup.
 */

import type { View } from './addin.js';

declare const messenger: {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  tabs: { query(query: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number }>> };
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (node instanceof HTMLButtonElement) node.type = 'button';
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function tabId(): Promise<number | undefined> {
  // Opened as a window when the panel could not be: the tab is in the address.
  const given = Number(new URLSearchParams(location.search).get('tab'));
  if (given) return given;
  const [tab] = await messenger.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function render(view: View, tab: number): void {
  document.documentElement.lang = view.lang;
  const root = document.querySelector('#root')!;
  const items = view.items.map((item) => {
    const card = el('section', `item is-${item.status}`);
    card.append(el('h2', 'name', item.name));
    if (item.lines.length) {
      const list = el('ul', 'lines');
      for (const line of item.lines) {
        const row = el('li', `line is-${line.level}`);
        row.append(el('span', 'level', line.levelText), el('span', 'label', line.label), el('span', 'value', line.value));
        list.append(row);
      }
      card.append(list);
    }
    if (item.note) card.append(el('p', 'note', item.note));
    if (item.clean) {
      const button = el('button', 'button', item.clean);
      button.addEventListener('click', () => act(button, { type: 'clean', tabId: tab, attachmentId: item.id }, tab));
      card.append(button);
    }
    return card;
  });
  const explanation = el('p', view.held ? 'explanation is-held' : 'explanation', view.explanation);
  explanation.setAttribute('role', 'status');
  const head: HTMLElement[] = [el('h1', undefined, view.title), explanation];
  if (view.sendAsIs) {
    const button = el('button', 'button button-quiet', view.sendAsIs);
    button.addEventListener('click', () => act(button, { type: 'allow', tabId: tab }, tab));
    head.push(button);
  }
  root.replaceChildren(...head, ...items, el('p', 'scope', view.scope));
}

async function act(button: HTMLButtonElement, message: unknown, tab: number): Promise<void> {
  button.disabled = true;
  render((await messenger.runtime.sendMessage(message)) as View, tab);
}

void (async () => {
  const tab = await tabId();
  if (tab === undefined) return;
  render((await messenger.runtime.sendMessage({ type: 'report', tabId: tab })) as View, tab);
})();
