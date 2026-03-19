import { redirect } from "next/navigation";

import VendorSidebar from "@/app/components/vendor/VendorSidebar";
import { canAccessVendorDashboard } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

export default async function VendorLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (!canAccessVendorDashboard(user)) {
    redirect("/");
  }

  return (
    <div>
      <VendorSidebar />
      <main>{children}</main>
    </div>
  );
}
