/**
 * [F-P3 2.6] Thunderbird cannot run in the tests, so the add-in's `Messenger`
 * interface (src/addin.ts) — which the tests stand in for — is checked here
 * against Thunderbird's own API, as its schemas describe it: each call the
 * add-in makes must take what the add-in passes and give what it expects.
 *
 *   npx tsc -p integrations/thunderbird/tsconfig.json
 */

import type { Messenger } from './src/addin.js';

declare const real: typeof messenger;
type Compose = Messenger['compose'];

export const listAttachments: Compose['listAttachments'] = real.compose.listAttachments;
export const getAttachmentFile: Compose['getAttachmentFile'] = real.compose.getAttachmentFile;
export const updateAttachment: Compose['updateAttachment'] = real.compose.updateAttachment;
export const setBadgeText: Messenger['composeAction']['setBadgeText'] = real.composeAction.setBadgeText;
export const openPopup: NonNullable<Messenger['composeAction']['openPopup']> = real.composeAction.openPopup;
export const create: Messenger['windows']['create'] = real.windows.create;
export const getUILanguage: Messenger['i18n']['getUILanguage'] = real.i18n.getUILanguage;

// What onBeforeSend hands its listener: a tab whose id and window the add-in reads.
type Listener = Parameters<typeof real.compose.onBeforeSend.addListener>[0];
export const tab = (given: Parameters<Listener>[0]): Parameters<Parameters<Compose['onBeforeSend']['addListener']>[0]>[0] => given;
// And what it may answer: { cancel: true } or nothing.
export const answers: Array<ReturnType<Listener>> = [{ cancel: true }, {}];

// The panel's two calls (src/popup.ts).
export const sendMessage: (message: unknown) => Promise<unknown> = real.runtime.sendMessage;
export const query: (query: { active: boolean; currentWindow: boolean }) => Promise<Array<{ id?: number }>> = real.tabs.query;
