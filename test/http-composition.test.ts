import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import type { MobileBffConfig } from "../src/config.js";
import { HttpMobileComposition } from "../src/http-composition.js";

const config: MobileBffConfig = {
  NODE_ENV: "test",
  PORT: 3010,
  AUTH_JWKS_URL: "http://auth.internal/.well-known/jwks.json",
  JWT_ISSUER: "https://auth.parc.invalid",
  JWT_AUDIENCE: "mobile-bff",
  TENANT_ADMIN_URL: "http://tenant-admin.internal",
  LEDGER_URL: "http://ledger.internal",
  PAYMENT_URL: "http://payment.internal",
  LENDING_URL: "http://lending.internal",
  SAVINGS_URL: "http://savings.internal",
  AUTH_CUSTOMER_URL: "http://auth.internal",
  DOWNSTREAM_TIMEOUT_MS: 3000,
  AUTH_TOKEN_URL: "http://auth.internal/internal/v1/oauth/token",
  SERVICE_CLIENT_KEY_ID: "parc-mobile-bff-1",
  SERVICE_CLIENT_PRIVATE_KEY_BASE64: "unused-in-composition-tests",
};

type TokenRequest = {
  audience: string;
  scopes: readonly string[];
  tenantId: string | null;
  mode?: string;
  subjectToken?: string;
};
const authorization = jest.fn((request: TokenRequest) =>
  Promise.resolve(
    `Bearer ${request.subjectToken ? "delegated" : "service"}:${request.audience}`,
  ),
);
const tokens = { authorization };

describe("HTTP mobile composition", () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    authorization.mockClear();
    global.fetch = fetchMock;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("resolves the customer profile id instead of treating JWT subject as a profile id", async () => {
    const tenantId = randomUUID();
    const customerId = randomUUID();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: customerId, tenant_id: tenantId }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      new HttpMobileComposition(config, tokens).customerProfileId({
        tenantId,
        authorization: "Bearer customer-token",
        correlationId: randomUUID(),
      }),
    ).resolves.toBe(customerId);
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    if (!(url instanceof URL)) throw new Error("Expected a URL request");
    expect(url.pathname).toBe("/v1/customers/me");
    expect(new Headers(options?.headers).get("authorization")).toBe(
      "Bearer customer-token",
    );
  });

  it("rejects a customer profile returned for another tenant", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ id: randomUUID(), tenant_id: randomUUID() }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      new HttpMobileComposition(config, tokens).customerProfileId({
        tenantId: randomUUID(),
        authorization: "Bearer customer-token",
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("Customer profile tenant mismatch");
  });

  it("is not ready while the service token issuer is not ready", async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        new Response(null, {
          status: (input instanceof Request
            ? input.url
            : input.toString()
          ).startsWith("http://auth.internal/")
            ? 503
            : 200,
        }),
      ),
    );
    const composition = new HttpMobileComposition(config, tokens);
    await expect(composition.ready()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://auth.internal/ready"),
      expect.anything(),
    );
  });

  it("resolves bootstrap using authenticated private Tenant Admin headers", async () => {
    const tenantId = randomUUID();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          tenant_id: tenantId,
          minimum_supported_version: "1.0.0",
          maintenance: false,
          features: { savings: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      new HttpMobileComposition(config, tokens).bootstrap({
        tenantSlug: "demo-bank",
        appVersion: "1.1.0",
        platform: "android",
        correlationId: randomUUID(),
      }),
    ).resolves.toMatchObject({ tenant_id: tenantId });
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    if (!(url instanceof URL)) throw new Error("Expected a URL request");
    expect(url.href).toContain(
      "/internal/v1/mobile/bootstrap?tenant_slug=demo-bank&app_version=1.1.0&platform=android",
    );
    expect(new Headers(options?.headers).get("x-calling-service")).toBe(
      "parc-mobile-bff",
    );
    expect(new Headers(options?.headers).get("authorization")).toBe(
      "Bearer service:parc-tenant-admin",
    );
    expect(authorization).toHaveBeenCalledWith({
      audience: "parc-tenant-admin",
      scopes: ["tenant.mobile-bootstrap.read"],
      tenantId: null,
      mode: "service",
    });
    expect(
      new Headers(options?.headers).get("x-internal-service-token"),
    ).toBeNull();
  });

  it("returns only the authoritative available Ledger balance", async () => {
    const accountId = randomUUID();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          account_id: accountId,
          currency: "NGN",
          posted_balance_minor: "50000",
          held_balance_minor: "7500",
          available_balance_minor: "42500",
          version: 3,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const tenantId = randomUUID();
    const result = await new HttpMobileComposition(config, tokens).wallet({
      tenantId,
      customerId: randomUUID(),
      authorization: "Bearer customer-token",
      correlationId: randomUUID(),
    });
    expect(result).toEqual({
      source_account_id: accountId,
      available_balance: { amount_minor: "42500", currency: "NGN" },
    });
    const url = fetchMock.mock.calls[0]?.[0];
    if (!(url instanceof URL)) throw new Error("Expected a URL request");
    expect(url.href).toContain("/internal/v1/customers/");
    const ledgerHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(ledgerHeaders.get("authorization")).toBe(
      "Bearer delegated:parc-ledger",
    );
    expect(authorization).toHaveBeenCalledWith({
      audience: "parc-ledger",
      scopes: ["ledger.balances.read"],
      tenantId,
      subjectToken: "customer-token",
    });
    expect(ledgerHeaders.get("x-internal-service-token")).toBeNull();
  });

  it("surfaces Ledger's error code when the wallet balance call fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "CUSTOMER_WALLET_NOT_FOUND",
          message: "Customer wallet account not found",
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      new HttpMobileComposition(config, tokens).wallet({
        tenantId: randomUUID(),
        customerId: randomUUID(),
        authorization: "Bearer customer-token",
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      name: "DownstreamError",
      status: 404,
      code: "CUSTOMER_WALLET_NOT_FOUND",
    });
  });

  it("applies a per-route timeout to the downstream call", async () => {
    const timeout = jest.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(
      new Response("{}", {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    await new HttpMobileComposition(config, tokens).relay({
      service: "auth-customer",
      method: "POST",
      path: "/v1/onboarding/identity",
      query: new URLSearchParams(),
      body: {},
      tenantId: randomUUID(),
      authorization: "Bearer customer-token",
      correlationId: randomUUID(),
      timeoutMs: 50_000,
    });
    expect(timeout).toHaveBeenLastCalledWith(50_000);
    timeout.mockRestore();
  });

  it("relays an allowlisted command without leaking internal credentials", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    const tenantId = randomUUID();
    const result = await new HttpMobileComposition(config, tokens).relay({
      service: "payment",
      method: "POST",
      path: "/v1/bills",
      query: new URLSearchParams(),
      body: { quote_id: randomUUID() },
      tenantId,
      authorization: "Bearer customer-token",
      correlationId: randomUUID(),
      idempotencyKey: "bill-command-1",
    });
    expect(result).toMatchObject({ status: 202, body: { status: "accepted" } });
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    if (!(url instanceof URL)) throw new Error("Expected a URL request");
    expect(url.href).toBe("http://payment.internal/v1/bills");
    const headers = new Headers(options?.headers);
    // The customer's own token never reaches Payment; a delegated one does.
    expect(headers.get("authorization")).toBe("Bearer delegated:parc-payment");
    expect(authorization).toHaveBeenCalledWith({
      audience: "parc-payment",
      scopes: ["payment.customer.read", "payment.customer.write"],
      tenantId,
      subjectToken: "customer-token",
    });
    expect(headers.get("idempotency-key")).toBe("bill-command-1");
    expect(headers.get("x-internal-service-token")).toBeNull();
  });

  it("composes the loan summary from customer-scoped Lending APIs", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "product-1" }]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "loan-1" }]), { status: 200 }),
      );
    await expect(
      new HttpMobileComposition(config, tokens).loanSummary({
        tenantId: randomUUID(),
        authorization: "Bearer customer-token",
        correlationId: randomUUID(),
      }),
    ).resolves.toEqual({
      eligible_products: [{ id: "product-1" }],
      loans: [{ id: "loan-1" }],
    });
    const requestedPaths = fetchMock.mock.calls.map(([url]) =>
      url instanceof URL ? url.pathname : "",
    );
    expect(requestedPaths).toEqual([
      "/v1/customer/loan-products",
      "/v1/customer/loans",
    ]);
  });
});
