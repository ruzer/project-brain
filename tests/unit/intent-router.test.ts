import { describe, expect, it } from "vitest";

import { routeIntent } from "../../core/intent_router";

describe("routeIntent", () => {
  it("preserves advisory-specific security intent as a security-advisory trigger", () => {
    const advisory = routeIntent("prioriza este security advisory y las CVEs activas");

    expect(advisory.trigger).toBe("security-advisory");
  });

  it("keeps generic security asks on the broader security-audit trigger", () => {
    const security = routeIntent("haz una auditoria de seguridad del repositorio");

    expect(security.trigger).toBe("security-audit");
  });
});
