import { vendorNavSections } from "./vendorNavConfig";

export default function VendorSidebar() {
  return (
    <aside>
      {vendorNavSections.map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          <ul>
            {section.items.map((item) => (
              <li key={item.href}>{item.label}</li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
