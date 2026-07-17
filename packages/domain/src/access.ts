export const ACTOR_ROLES = ["device", "superadmin"] as const;
export const PROFILE_STATUSES = ["active", "deletion_requested"] as const;
export const ACCESS_SCOPES = ["owner"] as const;

export type ActorRole = (typeof ACTOR_ROLES)[number];
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];
export type AccessScope = (typeof ACCESS_SCOPES)[number];

export function normalizeAlias(alias: string): string {
  if (!/^[A-Za-z0-9 _-]+$/.test(alias)) {
    throw new Error("invalid_alias");
  }

  const normalized = alias.trim().replace(/ +/g, " ").toLowerCase();

  if (!normalized) {
    throw new Error("invalid_alias");
  }

  return normalized;
}
