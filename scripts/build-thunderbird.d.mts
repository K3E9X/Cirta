export const POLICY: string;
export function thunderbirdManifest(version: string): Record<string, unknown> & {
  manifest_version: number;
  name: string;
  description: string;
  version: string;
  permissions: string[];
  host_permissions?: string[];
  compose_action: { default_title: string; default_popup: string };
  content_security_policy: string;
  browser_specific_settings: { gecko: { id: string; strict_min_version: string } };
};
export function buildThunderbird(out?: string): Promise<{ out: string; xpi: string; names: string[] }>;
