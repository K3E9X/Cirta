/**
 * [F-P2 2.7] Which files a folder contributes, the same in the terminal and
 * in the page: `ciirta inspect ./contrats` and a folder dropped on the site
 * take the same files and skip the same directories.
 */

export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pdf',
  '.pptx', '.docx', '.xlsx', '.pptm', '.docm', '.xlsm', '.dotm', '.potm', '.vsdx', '.vsdm',
  '.odt', '.ods', '.odp',
  // [F-2.2] Legacy Office, inspected only.
  '.doc', '.xls', '.ppt', '.dot', '.xlt', '.pot',
  '.svg', '.html', '.htm',
  '.md', '.markdown', '.mdx',
  '.jpg', '.jpeg', '.png',
  // [F-P2 2.2] WebP and GIF cleaned; TIFF, HEIC and AVIF inspected.
  '.webp', '.gif', '.tif', '.tiff', '.heic', '.heif', '.avif',
  // [F-P3 2.2] Video and audio.
  '.mp4', '.m4v', '.mov', '.m4a', '.3gp', '.3g2', '.mp3', '.wav',
  // [F-P3 2.2] Archives read, not rewritten.
  '.tar', '.tgz', '.gz', '.7z',
  '.zip', '.epub',
  // Plain text and source files. An invisible character in a .py or a .json
  // travels exactly as far as one in a .docx, and a bidi override in source is
  // the Trojan Source case — the reason those controls are called out at all.
  '.txt', '.text', '.log', '.csv', '.tsv',
  // Mail exports. The header block is the most talkative metadata this tool
  // reads, and a saved draft is exactly where it survives.
  '.eml', '.mbox', '.msg',
  '.json', '.yaml', '.yml', '.toml', '.ini',
  // [F-2.2] Jupyter notebooks: read as notebooks, not as JSON text.
  '.ipynb',
  // [F-P2 2.2]
  '.rtf', '.tex', '.ltx', '.sty', '.cls', '.bib', '.ics', '.ifb', '.vcf', '.vcard',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.rs', '.go', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh', '.sql',
  '.css', '.scss', '.xml', '.rst', '.adoc',
]);

/**
 * Dotfiles carrying secrets. A leading dot is not an extension, so these can
 * only be matched by name.
 */
export const SUPPORTED_NAMES: ReadonlySet<string> = new Set(['.env', '.env.local', '.env.production', '.npmrc', '.netrc']);

/**
 * Directories that are never the user's own content.
 *
 * Without this, `ciirta inspect .` on an ordinary project is mostly noise: on
 * this repository the walk returned 125 files, 118 of them inside
 * node_modules. A report nobody can read through is a report nobody reads.
 */
export const SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git', '.hg', '.svn',
  'node_modules', 'bower_components', 'vendor',
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'dist', 'build', 'out', 'target', '.next', '.nuxt', '.svelte-kit',
  '.cache', '.gradle', '.terraform', 'coverage', '.idea', '.vscode',
]);

const extension = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};

export const isSupportedFile = (name: string): boolean => SUPPORTED_NAMES.has(name.toLowerCase()) || SUPPORTED_EXTENSIONS.has(extension(name));

/** A directory a walk descends into: not a known build or tool directory, not hidden. */
export const isWalkedDirectory = (name: string, skip: ReadonlySet<string> = SKIP_DIRECTORIES): boolean => !skip.has(name) && !name.startsWith('.');
