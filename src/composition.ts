export interface Money {
  amount_minor: string;
  currency: "NGN";
}
export interface WalletSummary {
  source_account_id: string;
  available_balance: Money;
}
export interface BootstrapResult {
  tenant_id: string;
  minimum_supported_version: string;
  maintenance: boolean;
  features: Record<string, boolean>;
}
export interface OnboardingReferenceData {
  consent_documents: Array<{
    id: string;
    tenant_id: string;
    consent_type: string;
    document_version: string;
    title?: string | undefined;
    purpose?: string | undefined;
    channel?: string | undefined;
    policy_uri?: string | undefined;
    evidence_digest?: string | undefined;
    required_at_registration?: boolean | undefined;
  }>;
  states: Array<{ code: string; name: string; lgas: string[] }>;
  occupations: string[];
  annual_income_bands: Array<{ code: string; label: string }>;
}
export interface RelayRequest {
  service:
    | "auth-customer"
    | "payment"
    | "lending"
    | "savings"
    | "ledger"
    | "tenant-admin";
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query: URLSearchParams;
  body?: unknown;
  tenantId: string;
  authorization?: string;
  correlationId: string;
  idempotencyKey?: string;
  internal?: boolean;
}
export interface RelayResponse {
  status: number;
  body: unknown;
  contentType?: string;
}
export interface MobileComposition {
  customerProfileId(input: {
    tenantId: string;
    authorization: string;
    correlationId: string;
  }): Promise<string>;
  bootstrap(input: {
    tenantSlug: string;
    appVersion: string;
    platform: "android" | "ios";
    correlationId: string;
  }): Promise<BootstrapResult>;
  onboardingReferenceData(input: {
    tenantId: string;
    correlationId: string;
  }): Promise<OnboardingReferenceData>;
  wallet(input: {
    tenantId: string;
    customerId: string;
    authorization: string;
    correlationId: string;
  }): Promise<WalletSummary>;
  section(input: {
    name: "loans" | "savings";
    tenantId: string;
    customerId: string;
    authorization: string;
    correlationId: string;
  }): Promise<void>;
  relay(input: RelayRequest): Promise<RelayResponse>;
  loanSummary(input: {
    tenantId: string;
    authorization: string;
    correlationId: string;
  }): Promise<{ eligible_products: unknown; loans: unknown }>;
  ready(): Promise<boolean>;
}
