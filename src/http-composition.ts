import { z } from "zod";
import type { MobileBffConfig } from "./config.js";
import type { ParcTokenClient } from "./security/parc-service-auth.js";
import {
  DownstreamError,
  type BootstrapResult,
  type MobileComposition,
  type Money,
  type OnboardingReferenceData,
  type RelayRequest,
  type RelayResponse,
} from "./composition.js";

const bootstrap = z.object({
  tenant_id: z.string().uuid(),
  minimum_supported_version: z.string(),
  maintenance: z.boolean(),
  features: z.record(z.boolean()),
});
const balance = z.object({
  account_id: z.string().uuid(),
  available_balance_minor: z.string().regex(/^-?(0|[1-9][0-9]*)$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
const customerProfile = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
});
const onboardingReferenceData = z
  .object({
    consent_documents: z.array(
      z
        .object({
          id: z.string().uuid(),
          tenant_id: z.string().uuid(),
          consent_type: z.string(),
          document_version: z.string().min(1),
          title: z.string().optional(),
          purpose: z.string().optional(),
          channel: z.string().optional(),
          policy_uri: z.string().url().optional(),
          evidence_digest: z.string().optional(),
          required_at_registration: z.boolean().optional(),
        })
        .strict(),
    ),
    states: z.array(
      z
        .object({
          code: z.string().min(2).max(10),
          name: z.string().min(1),
          lgas: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    occupations: z.array(z.string().min(1)).min(1),
    annual_income_bands: z
      .array(
        z
          .object({ code: z.string().min(1), label: z.string().min(1) })
          .strict(),
      )
      .min(1),
  })
  .strict();

type Downstream = "payment" | "lending" | "savings" | "ledger" | "tenant-admin";

/** Delegated scopes requested for customer calls relayed to each service. */
const relayScopes: Record<Downstream, readonly string[]> = {
  payment: ["payment.customer.read", "payment.customer.write"],
  lending: ["lending.customer.read", "lending.customer.write"],
  savings: ["savings.customer.read", "savings.customer.write"],
  ledger: ["ledger.statements"],
  "tenant-admin": [
    "tenant.customer-support.read",
    "tenant.customer-support.write",
  ],
};

/**
 * Downstream calls never forward the customer's access token or a shared
 * secret. Customer calls exchange the validated user token for a short-lived
 * delegated token bound to the target service; pre-login calls use service-only
 * tokens. Auth's own customer endpoints, as the session authority, still
 * receive the user token directly.
 */
export class HttpMobileComposition implements MobileComposition {
  public constructor(
    private readonly config: MobileBffConfig,
    private readonly tokens: Pick<ParcTokenClient, "authorization">,
  ) {}

  private delegated(
    audience: string,
    scopes: readonly string[],
    tenantId: string,
    authorization: string,
  ): Promise<string> {
    return this.tokens.authorization({
      audience,
      scopes,
      tenantId,
      subjectToken: authorization.replace(/^Bearer /, ""),
    });
  }

  public async customerProfileId(input: {
    tenantId: string;
    authorization: string;
    correlationId: string;
  }): Promise<string> {
    const profile = customerProfile.parse(
      await this.request(
        new URL("/v1/customers/me", this.config.AUTH_CUSTOMER_URL),
        {
          authorization: input.authorization,
          "x-tenant-id": input.tenantId,
          "x-correlation-id": input.correlationId,
        },
      ),
    );
    if (profile.tenant_id !== input.tenantId)
      throw new Error("Customer profile tenant mismatch");
    return profile.id;
  }

  public async bootstrap(input: {
    tenantSlug: string;
    appVersion: string;
    platform: "android" | "ios";
    correlationId: string;
  }): Promise<BootstrapResult> {
    const url = new URL(
      "/internal/v1/mobile/bootstrap",
      this.config.TENANT_ADMIN_URL,
    );
    url.searchParams.set("tenant_slug", input.tenantSlug);
    url.searchParams.set("app_version", input.appVersion);
    url.searchParams.set("platform", input.platform);
    return bootstrap.parse(
      await this.request(url, {
        "x-correlation-id": input.correlationId,
        // Pre-login: no tenant context exists yet, so a platform service token.
        authorization: await this.tokens.authorization({
          audience: "parc-tenant-admin",
          scopes: ["tenant.mobile-bootstrap.read"],
          tenantId: null,
          mode: "service",
        }),
        "x-calling-service": "parc-mobile-bff",
      }),
    );
  }

  public async onboardingReferenceData(input: {
    tenantId: string;
    correlationId: string;
  }): Promise<OnboardingReferenceData> {
    const url = new URL(
      `/internal/v1/tenants/${encodeURIComponent(input.tenantId)}/onboarding-reference-data`,
      this.config.TENANT_ADMIN_URL,
    );
    const result = onboardingReferenceData.parse(
      await this.request(url, {
        "x-tenant-id": input.tenantId,
        "x-correlation-id": input.correlationId,
        authorization: await this.tokens.authorization({
          audience: "parc-tenant-admin",
          scopes: ["tenant.onboarding-reference.read"],
          tenantId: input.tenantId,
          mode: "service",
        }),
        "x-calling-service": "parc-mobile-bff",
      }),
    );
    if (
      result.consent_documents.some(
        (document) => document.tenant_id !== input.tenantId,
      )
    )
      throw new Error("Onboarding reference data tenant mismatch");
    return result;
  }

  public async wallet(input: {
    tenantId: string;
    customerId: string;
    authorization: string;
    correlationId: string;
  }): Promise<{
    source_account_id: string;
    available_balance: Money;
  }> {
    const url = new URL(
      `/internal/v1/customers/${encodeURIComponent(input.customerId)}/wallet-balance`,
      this.config.LEDGER_URL,
    );
    url.searchParams.set("currency", "NGN");
    const parsed = balance.parse(
      await this.request(url, {
        "x-tenant-id": input.tenantId,
        "x-correlation-id": input.correlationId,
        authorization: await this.delegated(
          "parc-ledger",
          ["ledger.balances.read"],
          input.tenantId,
          input.authorization,
        ),
        "x-calling-service": "parc-mobile-bff",
      }),
    );
    return {
      source_account_id: parsed.account_id,
      available_balance: {
        amount_minor: parsed.available_balance_minor,
        currency: "NGN",
      },
    };
  }

  public async section(input: {
    name: "loans" | "savings";
    tenantId: string;
    customerId: string;
    authorization: string;
    correlationId: string;
  }): Promise<void> {
    const target =
      input.name === "loans"
        ? new URL("/v1/customer/loans", this.config.LENDING_URL)
        : new URL("/v1/customer/savings-summary", this.config.SAVINGS_URL);
    await this.request(target, {
      authorization: await this.delegated(
        input.name === "loans" ? "parc-lending" : "parc-savings",
        [
          input.name === "loans"
            ? "lending.customer.read"
            : "savings.customer.read",
        ],
        input.tenantId,
        input.authorization,
      ),
      "x-tenant-id": input.tenantId,
      "x-correlation-id": input.correlationId,
    });
  }

  public async relayPaystackWebhook(input: {
    body: Buffer;
    signature: string;
  }): Promise<{ status: number; body: unknown }> {
    const response = await fetch(
      new URL("/v1/webhooks/paystack", this.config.PAYMENT_URL),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-paystack-signature": input.signature,
        },
        body: new Uint8Array(input.body),
        signal: AbortSignal.timeout(this.config.DOWNSTREAM_TIMEOUT_MS * 3),
      },
    );
    return {
      status: response.status,
      body: await response.json().catch(() => ({})),
    };
  }

  public async relay(input: RelayRequest): Promise<RelayResponse> {
    const origins = {
      "auth-customer": this.config.AUTH_CUSTOMER_URL,
      payment: this.config.PAYMENT_URL,
      lending: this.config.LENDING_URL,
      savings: this.config.SAVINGS_URL,
      ledger: this.config.LEDGER_URL,
      "tenant-admin": this.config.TENANT_ADMIN_URL,
    } as const;
    const url = new URL(input.path, origins[input.service]);
    input.query.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
    const serializedBody =
      input.method === "GET" || input.body === undefined
        ? undefined
        : JSON.stringify(input.body);
    const authorization =
      input.authorization === undefined
        ? undefined
        : input.service === "auth-customer"
          ? input.authorization
          : await this.delegated(
              `parc-${input.service}`,
              relayScopes[input.service],
              input.tenantId,
              input.authorization,
            );
    const response = await fetch(url, {
      method: input.method,
      headers: {
        accept: "application/json",
        ...(authorization ? { authorization } : {}),
        "content-type": "application/json",
        "x-tenant-id": input.tenantId,
        "x-correlation-id": input.correlationId,
        ...(input.idempotencyKey
          ? { "idempotency-key": input.idempotencyKey }
          : {}),
        ...(input.internal ? { "x-calling-service": "parc-mobile-bff" } : {}),
      },
      ...(serializedBody === undefined ? {} : { body: serializedBody }),
      signal: AbortSignal.timeout(
        input.timeoutMs ?? this.config.DOWNSTREAM_TIMEOUT_MS,
      ),
    });
    const contentType = response.headers.get("content-type") ?? undefined;
    const body: unknown = contentType?.includes("application/json")
      ? await response.json()
      : await response.text();
    return {
      status: response.status,
      body,
      ...(contentType ? { contentType } : {}),
    };
  }

  public async loanSummary(input: {
    tenantId: string;
    authorization: string;
    correlationId: string;
  }): Promise<{ eligible_products: unknown; loans: unknown }> {
    const headers = {
      authorization: await this.delegated(
        "parc-lending",
        ["lending.customer.read"],
        input.tenantId,
        input.authorization,
      ),
      "x-tenant-id": input.tenantId,
      "x-correlation-id": input.correlationId,
    };
    const [eligibleProducts, loans] = await Promise.all([
      this.request(
        new URL("/v1/customer/loan-products", this.config.LENDING_URL),
        headers,
      ),
      this.request(
        new URL("/v1/customer/loans", this.config.LENDING_URL),
        headers,
      ),
    ]);
    return { eligible_products: eligibleProducts, loans };
  }

  public async ready(): Promise<boolean> {
    const probes = [
      new URL("/health", this.config.TENANT_ADMIN_URL),
      new URL("/health", this.config.LEDGER_URL),
      new URL("/health", this.config.LENDING_URL),
      new URL("/health", this.config.SAVINGS_URL),
      // Every downstream call needs a service token, so the issuer's own
      // readiness (database and a writable Redis) gates ours.
      new URL("/ready", this.config.AUTH_CUSTOMER_URL),
    ];
    const results = await Promise.allSettled(
      probes.map((url) => this.request(url, {})),
    );
    return results.every((result) => result.status === "fulfilled");
  }

  private async request(
    url: URL,
    headers: Record<string, string>,
  ): Promise<unknown> {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", ...headers },
      signal: AbortSignal.timeout(this.config.DOWNSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const code = z.object({ code: z.string() }).safeParse(body);
      throw new DownstreamError(
        `GET ${url.host}${url.pathname}`,
        response.status,
        code.success ? code.data.code : null,
      );
    }
    return response.json();
  }
}
