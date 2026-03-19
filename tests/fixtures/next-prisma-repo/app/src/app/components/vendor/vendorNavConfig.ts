export const vendorNavSections = [
  {
    title: "Workspace",
    items: [
      { href: "/dashboard/vendor", label: "Overview" },
      { href: "/dashboard/vendor/orders", label: "Orders" }
    ]
  },
  {
    title: "Settings",
    items: [{ href: "/dashboard/vendor/profile", label: "Profile" }]
  }
];

export const vendorNavLinks = vendorNavSections.flatMap((section) => section.items);
