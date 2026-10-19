export const REQUIRED_FILES: string[];
export function releaseProblems(input: {
  tag?: string;
  pkg: { version: string; repository?: { url?: string }; publishConfig?: { provenance?: boolean } };
  changelog?: string;
  licence?: string;
  packed: string[];
}): string[];
