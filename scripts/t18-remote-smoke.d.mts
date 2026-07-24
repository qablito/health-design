export interface T18RemoteEnvironment {
  readonly PRODUCTION_PROJECT_REF?: string;
  readonly SUPABASE_PROJECT_REF?: string;
  readonly SUPABASE_URL?: string;
}

export interface T18RemoteDryRun {
  readonly allowedEnvironment: {
    readonly projectRef: string;
    readonly url: string;
  };
  readonly forbiddenEnvironment: {
    readonly projectRef: string;
    readonly url: string;
  };
  readonly mode: "dry-run";
  readonly mutations: false;
  readonly network: false;
  readonly secretsRequired: false;
  readonly stages: readonly string[];
  readonly status: "T18_REMOTE_PREFLIGHT_READY";
}

export const T18_REMOTE_STAGES: readonly string[];

export function assertT18DevelopmentBoundary(environment?: T18RemoteEnvironment): void;

export function t18RemoteDryRun(environment?: T18RemoteEnvironment): T18RemoteDryRun;
