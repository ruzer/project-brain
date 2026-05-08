export function canAccessVendorDashboard(user: { role: string } | null) {
  return user?.role === "VENDOR" || user?.role === "ADMIN";
}
