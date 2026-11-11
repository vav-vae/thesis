export type AccountRole = "buyer" | "broker" | "admin";

export function roleHome(role: unknown): string {
  return role === "buyer" || role === "broker" || role === "admin" ? `/${role}` : "/login?reason=account-unavailable";
}

export function canAccessRole(required: AccountRole, account: { role?: unknown; accountStatus?: unknown }): boolean {
  return account.role === required && account.accountStatus !== "inactive";
}
