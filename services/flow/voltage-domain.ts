import type { ScenarioInput } from "../../types/schema";

// Domain-family defaults used only when:
// 1) scenario.domainVoltage has no override for this domain, and
// 2) the domain string does not include an explicit value (ex: DC_24V).
export const DEFAULT_DC_DOMAIN_VOLTAGE = 12;
export const DEFAULT_AC_DOMAIN_VOLTAGE = 230;
export const DEFAULT_DOMAIN_VOLTAGE = DEFAULT_DC_DOMAIN_VOLTAGE;

const positiveNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

export const normalizeDomain = (domain: string | undefined) =>
  (domain ?? "").trim().toLowerCase();

export const isDCDomain = (domain: string | undefined) => {
  const normalized = normalizeDomain(domain);
  return normalized === "dc" || normalized.startsWith("dc_") || normalized.startsWith("dc-");
};

export const isACDomain = (domain: string | undefined) => {
  const normalized = normalizeDomain(domain);
  return normalized === "ac" || normalized.startsWith("ac_") || normalized.startsWith("ac-");
};

export const parseVoltageFromDomain = (
  domain: string | undefined,
  fallback = DEFAULT_DOMAIN_VOLTAGE
) => {
  if (!domain) return fallback;
  const match = domain.match(/(\d+(?:\.\d+)?)\s*V/i);
  if (match) return Number(match[1]);

  // These are pragmatic defaults, not hard-coded requirements.
  // Real projects should pass explicit domain labels (DC_24V, AC_120V) or use scenario overrides.
  if (isACDomain(domain)) return DEFAULT_AC_DOMAIN_VOLTAGE;
  if (isDCDomain(domain)) return DEFAULT_DC_DOMAIN_VOLTAGE;
  return fallback;
};

export const resolveVoltageForDomain = (
  domain: string | undefined,
  scenario: ScenarioInput | undefined,
  fallback = DEFAULT_DOMAIN_VOLTAGE
) => {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return fallback;

  // Scenario overrides are authoritative (project-level configuration).
  const domainVoltages = scenario?.domainVoltage;
  if (domainVoltages) {
    const exact = positiveNumber(domainVoltages[domain as keyof typeof domainVoltages]);
    if (exact) return exact;

    for (const [candidateDomain, candidateVoltage] of Object.entries(domainVoltages)) {
      if (normalizeDomain(candidateDomain) === normalizedDomain) {
        const resolved = positiveNumber(candidateVoltage);
        if (resolved) return resolved;
      }
    }
  }

  return parseVoltageFromDomain(domain, fallback);
};
