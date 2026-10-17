import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { CustomerAuthenticator } from "../src/authenticator.js";
import {
  DownstreamError,
  type MobileComposition,
  type RelayRequest,
} from "../src/composition.js";

const tenantId = randomUUID();
const customerId = randomUUID();
const walletAccountId = randomUUID();
const authenticate = jest.fn(() =>
  Promise.resolve({ tenantId, customerId, sessionId: randomUUID() }),
);
const authenticator: CustomerAuthenticator = {
  authenticate,
};
const bootstrap = jest.fn<MobileComposition["bootstrap"]>(() =>
  Promise.resolve({
    tenant_id: tenantId,
    minimum_supported_version: "1.0.0",
    maintenance: false,
    features: { savings: true },
  }),
);
const composition: MobileComposition = {
  customerProfileId: jest.fn(() => Promise.resolve(customerId)),
  ready: jest.fn(() => Promise.resolve(true)),
  bootstrap,
  onboardingReferenceData: jest.fn(() =>
    Promise.resolve({
      consent_documents: [],
      states: [{ code: "LA", name: "Lagos", lgas: ["Ikeja"] }],
      occupations: ["EMPLOYED_PRIVATE_SECTOR"],
      annual_income_bands: [{ code: "BELOW_500K", label: "Below ₦500,000" }],
    }),
  ),
  wallet: () =>
    Promise.resolve({
      source_account_id: walletAccountId,
      available_balance: { amount_minor: "50000", currency: "NGN" },
    }),
  section: () => Promise.resolve(),
  relay: jest.fn(() =>
    Promise.resolve({
      status: 200,
      body: { banks: [] },
      contentType: "application/json",
    }),
  ),
  loanSummary: jest.fn(() =>
    Promise.resolve({ eligible_products: [], loans: [] }),
  ),
};

describe("Mobile BFF foundation", () => {
  const app = createApp(authenticator, composition);

  it("serves public bootstrap without authenticating", async () => {
    const response = await request(app)
      .get("/v1/bootstrap?app_version=1.0.0&platform=android")
      .set("x-tenant-slug", "demo-bank");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      tenant_id: tenantId,
      maintenance: false,
    });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it.each([
    [404, "TENANT_NOT_FOUND"],
    [426, "APP_UPGRADE_REQUIRED"],
  ])(
    "passes Tenant Admin's %i %s bootstrap verdict through as non-retryable",
    async (status, code) => {
      bootstrap.mockRejectedValueOnce(
        new DownstreamError(
          "GET tenant-admin/internal/v1/mobile/bootstrap",
          status,
          code,
        ),
      );
      const response = await request(app)
        .get("/v1/bootstrap?app_version=1.0.0&platform=android")
        .set("x-tenant-slug", "demo-bank");
      expect(response.status).toBe(status);
      expect(response.body).toMatchObject({ code, retryable: false });
    },
  );

  it("keeps other bootstrap failures as a retryable 502", async () => {
    bootstrap.mockRejectedValueOnce(
      new Error("Service token request failed (500 server_error)"),
    );
    const response = await request(app)
      .get("/v1/bootstrap?app_version=1.0.0&platform=android")
      .set("x-tenant-slug", "demo-bank");
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      retryable: true,
    });
  });

  it("serves onboarding reference data without a customer session", async () => {
    const response = await request(app)
      .get("/v1/onboarding/reference-data")
      .set("x-tenant-id", tenantId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      states: [{ code: "LA", lgas: ["Ikeja"] }],
      annual_income_bands: [{ code: "BELOW_500K" }],
    });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects a tenant header that differs from the signed claim", async () => {
    const response = await request(app)
      .get("/v1/dashboard")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", randomUUID());
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: "TENANT_MISMATCH",
      retryable: false,
    });
  });

  it("composes a contract-shaped dashboard with optional-section isolation", async () => {
    const isolated: MobileComposition = {
      ...composition,
      section: (input) =>
        input.name === "loans"
          ? Promise.reject(new Error("down"))
          : Promise.resolve(),
    };
    const response = await request(createApp(authenticator, isolated))
      .get("/v1/dashboard")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      wallet: {
        source_account_id: walletAccountId,
        available_balance: { amount_minor: "50000", currency: "NGN" },
      },
      sections: {
        loans: { available: false, error_code: "DEPENDENCY_UNAVAILABLE" },
        savings: { available: true },
      },
    });
  });

  it("reports a wallet Ledger hasn't provisioned yet as retryable WALLET_NOT_PROVISIONED", async () => {
    const log = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const unprovisioned: MobileComposition = {
      ...composition,
      wallet: () =>
        Promise.reject(
          new DownstreamError(
            "GET ledger/internal/v1/customers/x/wallet-balance",
            404,
            "CUSTOMER_WALLET_NOT_FOUND",
          ),
        ),
    };
    const response = await request(createApp(authenticator, unprovisioned))
      .get("/v1/dashboard")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId);
    const logged = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<
      string,
      unknown
    >;
    log.mockRestore();
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: "WALLET_NOT_PROVISIONED",
      retryable: true,
    });
    expect(logged).toMatchObject({
      path: "/v1/dashboard",
      downstream_status: 404,
      downstream_code: "CUSTOMER_WALLET_NOT_FOUND",
    });
  });

  it("logs the cause behind a generic dependency failure", async () => {
    const log = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const failing: MobileComposition = {
      ...composition,
      wallet: () =>
        Promise.reject(new DownstreamError("GET ledger/x", 500, null)),
    };
    const response = await request(createApp(authenticator, failing))
      .get("/v1/dashboard")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId);
    const logged = String(log.mock.calls[0]?.[0]);
    log.mockRestore();
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(logged).toContain('"downstream_status":500');
  });

  it("opens the account number against the wallet resolved server side", async () => {
    const relay = jest.fn(() =>
      Promise.resolve({ status: 202, body: { status: "PENDING" } }),
    );
    const response = await request(
      createApp(authenticator, { ...composition, relay }),
    )
      .post("/v1/wallet/virtual-account")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId)
      .set("idempotency-key", "va-1")
      .send({
        bvn: "22222222222",
        bank_code: "058",
        account_number: "0123456789",
      });
    expect(response.status).toBe(202);
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "payment",
        method: "POST",
        path: "/v1/wallet/virtual-account",
        idempotencyKey: "va-1",
        body: {
          bvn: "22222222222",
          bank_code: "058",
          account_number: "0123456789",
          ledger_account_id: walletAccountId,
        },
      }),
    );
  });

  it("refuses a client-supplied wallet on the account-number request", async () => {
    const relay = jest.fn(() => Promise.resolve({ status: 202, body: {} }));
    const response = await request(
      createApp(authenticator, { ...composition, relay }),
    )
      .post("/v1/wallet/virtual-account")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId)
      .set("idempotency-key", "va-2")
      .send({
        bvn: "22222222222",
        bank_code: "058",
        account_number: "0123456789",
        ledger_account_id: randomUUID(),
      });
    expect(response.status).toBe(422);
    expect(relay).not.toHaveBeenCalled();
  });

  it("relays Paystack webhooks to Payment byte-for-byte without customer auth", async () => {
    const relayPaystackWebhook = jest.fn(() =>
      Promise.resolve({ status: 202, body: { webhook_id: "w-1" } }),
    );
    const raw = '{"event":"charge.success",  "data":{"amount":250000}}';
    const response = await request(
      createApp(authenticator, { ...composition, relayPaystackWebhook }),
    )
      .post("/v1/webhooks/paystack")
      .set("content-type", "application/json")
      .set("x-paystack-signature", "f".repeat(128))
      .send(raw);
    expect(response.status).toBe(202);
    const forwarded = relayPaystackWebhook.mock.calls[0] as unknown as [
      { body: Buffer; signature: string },
    ];
    // Exact bytes, including the double space: the HMAC is over the raw body.
    expect(forwarded[0].body.toString("utf8")).toBe(raw);
    expect(forwarded[0].signature).toBe("f".repeat(128));
  });

  it("rejects an unsigned Paystack webhook before relaying it", async () => {
    const relayPaystackWebhook = jest.fn(() =>
      Promise.resolve({ status: 202, body: {} }),
    );
    const response = await request(
      createApp(authenticator, { ...composition, relayPaystackWebhook }),
    )
      .post("/v1/webhooks/paystack")
      .set("content-type", "application/json")
      .send("{}");
    expect(response.status).toBe(400);
    expect(relayPaystackWebhook).not.toHaveBeenCalled();
  });

  it("returns the authenticated customer's Ledger wallet source account", async () => {
    const response = await request(app)
      .get("/v1/wallet/source-account")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      source_account_id: walletAccountId,
      available_balance: { amount_minor: "50000", currency: "NGN" },
    });
  });

  it("requires authentication on all non-bootstrap v1 routes", async () => {
    const response = await request(app)
      .get("/v1/dashboard")
      .set("x-tenant-id", tenantId);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("relays phone-first onboarding before authentication", async () => {
    const authenticationCallsBefore = authenticate.mock.calls.length;
    const relay = jest.fn(() =>
      Promise.resolve({
        status: 201,
        body: { current_step: "PHONE_VERIFICATION" },
      }),
    );
    const response = await request(
      createApp(authenticator, { ...composition, relay }),
    )
      .post("/v1/onboarding/registrations")
      .set("x-tenant-id", tenantId)
      .set("idempotency-key", "onboarding-1")
      .send({ phone_number: "+2348012345678", consent_ids: [randomUUID()] });
    expect(response.status).toBe(201);
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "auth-customer",
        method: "POST",
        path: "/v1/onboarding/registrations",
        tenantId,
        idempotencyKey: "onboarding-1",
      }),
    );
    expect(authenticate).toHaveBeenCalledTimes(authenticationCallsBefore);
  });

  it("requires a verified customer token for profile-enrichment steps", async () => {
    const response = await request(app)
      .put("/v1/onboarding/address")
      .set("x-tenant-id", tenantId)
      .set("idempotency-key", "address-1")
      .send({});
    expect(response.status).toBe(401);
  });

  it("relays only an explicit contract route and preserves command context", async () => {
    const relay = jest.fn(() =>
      Promise.resolve({ status: 201, body: { status: "accepted" } }),
    );
    const response = await request(
      createApp(authenticator, { ...composition, relay }),
    )
      .post("/v1/bills")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId)
      .set("idempotency-key", "mobile-bill-1")
      .send({ quote_id: randomUUID() });
    expect(response.status).toBe(201);
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "payment",
        method: "POST",
        path: "/v1/bills",
        tenantId,
        authorization: "Bearer test",
        idempotencyKey: "mobile-bill-1",
      }),
    );
  });

  it("gives KYC onboarding steps a longer downstream timeout and room for a selfie", async () => {
    const relay = jest.fn((_input: RelayRequest) =>
      Promise.resolve({ status: 202, body: { status: "accepted" } }),
    );
    const app = createApp(authenticator, { ...composition, relay });
    const selfie = "/9j/" + "A".repeat(1_400_000);
    const face = await request(app)
      .post("/v1/onboarding/face-verification")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId)
      .set("idempotency-key", "face-1")
      .send({
        identity_type: "NIN",
        identity_value: "10000000001",
        selfie_image: selfie,
        consent_id: randomUUID(),
      });
    expect(face.status).toBe(202);
    const faceRelay = relay.mock.calls.at(-1)?.[0];
    expect(faceRelay).toMatchObject({
      path: "/v1/onboarding/face-verification",
      idempotencyKey: "face-1",
      timeoutMs: 50_000,
    });
    expect((faceRelay?.body as { selfie_image?: string }).selfie_image).toBe(
      selfie,
    );
    await request(app)
      .put("/v1/onboarding/address")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId)
      .set("idempotency-key", "address-1")
      .send({});
    const addressRelay = relay.mock.calls.at(
      -1,
    )?.[0] as unknown as RelayRequest;
    expect(addressRelay.path).toBe("/v1/onboarding/address");
    expect(addressRelay.timeoutMs).toBeUndefined();
  });

  it("exposes the authenticated customer's money-movement source account", async () => {
    const paymentAccountId = randomUUID();
    const sourceAccountId = randomUUID();
    const relay = jest.fn(() =>
      Promise.resolve({
        status: 200,
        body: {
          id: paymentAccountId,
          source_account_id: sourceAccountId,
          account_number: "0123456789",
          account_name: "Test Customer",
          bank_code: "999",
          bank_name: "Test Bank",
          currency: "NGN",
        },
        contentType: "application/json",
      }),
    );
    const response = await request(
      createApp(authenticator, { ...composition, relay }),
    )
      .get("/v1/wallet/funding-details")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({ source_account_id: sourceAccountId }),
    );
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "payment",
        method: "GET",
        path: "/v1/wallet/funding-details",
        tenantId,
        authorization: "Bearer test",
      }),
    );
  });

  it("relays beneficiary listing with its filter", async () => {
    const relay = jest.fn(() =>
      Promise.resolve({ status: 200, body: { items: [] } }),
    );
    const response = await request(
      createApp(authenticator, { ...composition, relay }),
    )
      .get("/v1/beneficiaries?kind=favourite")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId);
    expect(response.status).toBe(200);
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "payment",
        method: "GET",
        path: "/v1/beneficiaries",
        tenantId,
        authorization: "Bearer test",
        query: new URLSearchParams("kind=favourite"),
      }),
    );
  });

  it("relays idempotent beneficiary creation", async () => {
    const relay = jest.fn(() =>
      Promise.resolve({ status: 201, body: { id: randomUUID() } }),
    );
    const response = await request(
      createApp(authenticator, { ...composition, relay }),
    )
      .post("/v1/beneficiaries")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId)
      .set("idempotency-key", "beneficiary-1")
      .send({
        bank_code: "999",
        account_number: "0123456789",
        name: "Ada Test",
      });
    expect(response.status).toBe(201);
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "payment",
        method: "POST",
        path: "/v1/beneficiaries",
        tenantId,
        authorization: "Bearer test",
        idempotencyKey: "beneficiary-1",
      }),
    );
  });

  it("relays a customer transfer to Payment's bank transfer command", async () => {
    const relay = jest.fn(() =>
      Promise.resolve({ status: 202, body: { id: randomUUID() } }),
    );
    const response = await request(
      createApp(authenticator, { ...composition, relay }),
    )
      .post("/v1/transfers")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId)
      .set("idempotency-key", "transfer-1")
      .send({ quote_id: randomUUID(), bank_code: "058" });
    expect(response.status).toBe(202);
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "payment",
        method: "POST",
        path: "/v1/transfers/bank",
        idempotencyKey: "transfer-1",
      }),
    );
  });

  it("does not expose a domain route that is absent from the BFF allowlist", async () => {
    const response = await request(app)
      .post("/v1/savings-products")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId)
      .send({});
    expect(response.status).toBe(404);
  });
});
