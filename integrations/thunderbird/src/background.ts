/** [F-P3 2.6] The add-in's background page: the logic in addin.ts, given Thunderbird's API. */

import { createAddin, type Messenger } from './addin.js';

declare const messenger: Messenger;

createAddin(messenger);
