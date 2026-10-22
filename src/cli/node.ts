/**
 * [F-P2 2.5] `import { nodeXrayEngine, nodeImageCodec } from 'ciirta/node'`:
 * what the core needs from Node to render PDF pages (hidden text, burning
 * redactions) and to rebuild pictures — the same engines the command line
 * uses. Both resolve to undefined where the optional native canvas is
 * missing, and the core then says what it could not check.
 */

export { nodeXrayEngine } from './xray-engine.js';
export { nodeImageCodec } from './image-codec.js';
