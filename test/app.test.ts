import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { CustomerAuthenticator } from "../src/authenticator.js";
import type { MobileComposition } from "../src/composition.js";

const tenantId = randomUUID();
const customerId = randomUUID();
const walletAccountId = randomUUID();
const authenticate = jest.fn(() =>
  Promise.resolve({ tenantId, customerId, sessionId: randomUUID() }),
);
const authenticator: CustomerAuthenticator = {
  authenticate,
};
const composition: MobileComposition = {
  customerProfileId: jest.fn(() => Promise.resolve(customerId)),
  ready: jest.fn(() => Promise.resolve(true)),
  bootstrap: jest.fn(() =>
    Promise.resolve({
      tenant_id: tenantId,
      minimum_supported_version: "1.0.0",
      maintenance: false,
      features: { savings: true },
    }),
  ),
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

  it("does not expose a domain route that is absent from the BFF allowlist", async () => {
    const response = await request(app)
      .post("/v1/savings-products")
      .set("authorization", "Bearer test")
      .set("x-tenant-id", tenantId)
      .send({});
    expect(response.status).toBe(404);
  });
});
