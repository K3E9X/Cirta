export const LEFT_OUT: string[];
export const POLICY: string;
export function extensionManifest(version: string): Record<string, unknown> & {
  manifest_version: number;
  version: string;
  permissions?: string[];
  host_permissions?: string[];
  background: { service_worker: string; scripts: string[] };
  content_security_policy: { extension_pages: string };
  browser_specific_settings: { gecko: { id: string; strict_min_version: string } };
};
export function extensionPage(html: string): { page: string; script: string };
