import { randomUUID } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { z } from "zod";
import type {
  CustomerAuthenticator,
  CustomerPrincipal,
} from "./authenticator.js";
import type { MobileComposition } from "./composition.js";

type RelayRoute = {
  method: "get" | "post" | "patch" | "put" | "delete";
  publicPath: string;
  service:
    | "auth-customer"
    | "payment"
    | "lending"
    | "savings"
    | "ledger"
    | "tenant-admin";
  downstreamPath: (request: Request) => string;
  internal?: boolean;
};

const relayRoutes: RelayRoute[] = [
  {
    method: "post",
    publicPath: "/v1/auth/logout",
    service: "auth-customer",
    downstreamPath: () => "/v1/auth/logout",
  },
  {
    method: "post",
    publicPath: "/v1/security/transaction-pin/setup",
    service: "auth-customer",
    downstreamPath: () => "/v1/security/transaction-pin/setup",
  },
  {
    method: "post",
    publicPath: "/v1/security/transaction-pin/confirm",
    service: "auth-customer",
    downstreamPath: () => "/v1/security/transaction-pin/confirm",
  },
  {
    method: "post",
    publicPath: "/v1/security/transaction-pin/rotate",
    service: "auth-customer",
    downstreamPath: () => "/v1/security/transaction-pin/rotate",
  },
  {
    method: "get",
    publicPath: "/v1/onboarding/status",
    service: "auth-customer",
    downstreamPath: () => "/v1/onboarding/status",
  },
  {
    method: "put",
    publicPath: "/v1/onboarding/email",
    service: "auth-customer",
    downstreamPath: () => "/v1/onboarding/email",
  },
  {
    method: "post",
    publicPath: "/v1/onboarding/email/verify",
    service: "auth-customer",
    downstreamPath: () => "/v1/onboarding/email/verify",
  },
  {
    method: "post",
    publicPath: "/v1/onboarding/identity",
    service: "auth-customer",
    downstreamPath: () => "/v1/onboarding/identity",
  },
  {
    method: "post",
    publicPath: "/v1/onboarding/face-verification",
    service: "auth-customer",
    downstreamPath: () => "/v1/onboarding/face-verification",
  },
  {
    method: "post",
    publicPath: "/v1/onboarding/face-verification/confirm",
    service: "auth-customer",
    downstreamPath: () => "/v1/onboarding/face-verification/confirm",
  },
  {
    method: "put",
    publicPath: "/v1/onboarding/address",
    service: "auth-customer",
    downstreamPath: () => "/v1/onboarding/address",
  },
  {
    method: "put",
    publicPath: "/v1/onboarding/compliance",
    service: "auth-customer",
    downstreamPath: () => "/v1/onboarding/compliance",
  },
  {
    method: "put",
    publicPath: "/v1/onboarding/income",
    service: "auth-customer",
    downstreamPath: () => "/v1/onboarding/income",
  },
  {
    method: "put",
    publicPath: "/v1/onboarding/login-passcode",
    service: "auth-customer",
    downstreamPath: () => "/v1/onboarding/login-passcode",
  },
  {
    method: "post",
    publicPath: "/v1/onboarding/complete",
    service: "auth-customer",
    downstreamPath: () => "/v1/onboarding/complete",
  },
  {
    method: "post",
    publicPath: "/v1/auth/passkeys/registration/options",
    service: "auth-customer",
    downstreamPath: () => "/v1/auth/passkeys/registration/options",
  },
  {
    method: "post",
    publicPath: "/v1/auth/passkeys/registration/verify",
    service: "auth-customer",
    downstreamPath: () => "/v1/auth/passkeys/registration/verify",
  },
  {
    method: "get",
    publicPath: "/v1/transactions",
    service: "payment",
    downstreamPath: () => "/v1/transactions",
  },
  {
    method: "post",
    publicPath: "/v1/statements",
    service: "ledger",
    downstreamPath: (request) =>
      `/internal/v1/customers/${customerId(request)}/statements`,
    internal: true,
  },
  {
    method: "get",
    publicPath: "/v1/statements/:id",
    service: "ledger",
    downstreamPath: (request) =>
      `/internal/v1/customers/${customerId(request)}/statements/${routeId(request)}`,
    internal: true,
  },
  {
    method: "get",
    publicPath: "/v1/reference/banks",
    service: "payment",
    downstreamPath: () => "/v1/reference/banks",
  },
  {
    method: "get",
    publicPath: "/v1/wallet/funding-details",
    service: "payment",
    downstreamPath: () => "/v1/wallet/funding-details",
  },
  {
    method: "post",
    publicPath: "/v1/transfers/name-enquiries",
    service: "payment",
    downstreamPath: () => "/v1/transfers/name-enquiries",
  },
  {
    method: "post",
    publicPath: "/v1/transfers/quotes",
    service: "payment",
    downstreamPath: () => "/v1/transfers/quotes",
  },
  {
    method: "get",
    publicPath: "/v1/beneficiaries",
    service: "payment",
    downstreamPath: () => "/v1/beneficiaries",
  },
  {
    method: "post",
    publicPath: "/v1/beneficiaries",
    service: "payment",
    downstreamPath: () => "/v1/beneficiaries",
  },
  {
    method: "post",
    publicPath: "/v1/transfers",
    service: "payment",
    downstreamPath: () => "/v1/transfers",
  },
  {
    method: "get",
    publicPath: "/v1/transfers/:id",
    service: "payment",
    downstreamPath: (request) => `/v1/transfers/${routeId(request)}`,
  },
  {
    method: "get",
    publicPath: "/v1/transfers/:id/receipt",
    service: "payment",
    downstreamPath: (request) => `/v1/transfers/${routeId(request)}/receipt`,
  },
  {
    method: "post",
    publicPath: "/v1/transaction-authorizations",
    service: "auth-customer",
    downstreamPath: () => "/v1/transaction-authorizations",
  },
  {
    method: "get",
    publicPath: "/v1/bills/products",
    service: "payment",
    downstreamPath: () => "/v1/bills/products",
  },
  {
    method: "post",
    publicPath: "/v1/bills/customer-validations",
    service: "payment",
    downstreamPath: () => "/v1/bills/customer-validations",
  },
  {
    method: "post",
    publicPath: "/v1/bills/quotes",
    service: "payment",
    downstreamPath: () => "/v1/bills/quotes",
  },
  {
    method: "post",
    publicPath: "/v1/bills",
    service: "payment",
    downstreamPath: () => "/v1/bills",
  },
  {
    method: "get",
    publicPath: "/v1/bills/:id",
    service: "payment",
    downstreamPath: (request) =>
      `/v1/bills/${encodeURIComponent(routeId(request))}`,
  },
  {
    method: "get",
    publicPath: "/v1/bills/:id/receipt",
    service: "payment",
    downstreamPath: (request) =>
      `/v1/bills/${encodeURIComponent(routeId(request))}/receipt`,
  },
  {
    method: "post",
    publicPath: "/v1/loans/quotes",
    service: "lending",
    downstreamPath: () => "/v1/customer/loan-quotes",
  },
  {
    method: "post",
    publicPath: "/v1/loan-applications",
    service: "lending",
    downstreamPath: () => "/v1/loan-applications",
  },
  {
    method: "get",
    publicPath: "/v1/loan-applications/:id",
    service: "lending",
    downstreamPath: (request) =>
      `/v1/customer/loan-applications/${encodeURIComponent(routeId(request))}`,
  },
  {
    method: "get",
    publicPath: "/v1/loan-applications/:id/offer",
    service: "lending",
    downstreamPath: (request) =>
      `/v1/customer/loan-applications/${encodeURIComponent(routeId(request))}/offer`,
  },
  {
    method: "get",
    publicPath: "/v1/loans",
    service: "lending",
    downstreamPath: () => "/v1/customer/loans",
  },
  {
    method: "post",
    publicPath: "/v1/loan-offers/:id/accept",
    service: "lending",
    downstreamPath: (request) =>
      `/v1/customer/loan-offers/${encodeURIComponent(routeId(request))}/accept`,
  },
  {
    method: "post",
    publicPath: "/v1/loans/:id/repayment-quotes",
    service: "lending",
    downstreamPath: (request) =>
      `/v1/customer/loans/${encodeURIComponent(routeId(request))}/repayment-quotes`,
  },
  {
    method: "post",
    publicPath: "/v1/loans/:id/repayments",
    service: "lending",
    downstreamPath: (request) =>
      `/v1/customer/loans/${encodeURIComponent(routeId(request))}/repayments`,
  },
  {
    method: "get",
    publicPath: "/v1/savings/summary",
    service: "savings",
    downstreamPath: () => "/v1/customer/savings-summary",
  },
  {
    method: "post",
    publicPath: "/v1/savings/goals",
    service: "savings",
    downstreamPath: () => "/v1/savings-goals",
  },
  {
    method: "post",
    publicPath: "/v1/fixed-deposits",
    service: "savings",
    downstreamPath: () => "/v1/fixed-deposits",
  },
  {
    method: "post",
    publicPath: "/v1/savings/goals/:id/withdrawal-quotes",
    service: "savings",
    downstreamPath: (request) =>
      `/v1/customer/savings-goals/${encodeURIComponent(routeId(request))}/withdrawal-quotes`,
  },
  {
    method: "post",
    publicPath: "/v1/savings/goals/:id/partial-withdrawal",
    service: "savings",
    downstreamPath: (request) =>
      `/v1/savings-goals/${encodeURIComponent(routeId(request))}/partial-withdrawal`,
  },
  {
    method: "post",
    publicPath: "/v1/savings/goals/:id/break",
    service: "savings",
    downstreamPath: (request) =>
      `/v1/savings-goals/${encodeURIComponent(routeId(request))}/break`,
  },
  {
    method: "post",
    publicPath: "/v1/savings/fixed-deposit-quotes",
    service: "savings",
    downstreamPath: () => "/v1/customer/fixed-deposit-quotes",
  },
  {
    method: "get",
    publicPath: "/v1/fixed-deposits/:id",
    service: "savings",
    downstreamPath: (request) =>
      `/v1/customer/fixed-deposits/${encodeURIComponent(routeId(request))}`,
  },
  {
    method: "post",
    publicPath: "/v1/fixed-deposits/:id/liquidation-quote",
    service: "savings",
    downstreamPath: (request) =>
      `/v1/fixed-deposits/${encodeURIComponent(routeId(request))}/liquidation-quote`,
  },
  {
    method: "post",
    publicPath: "/v1/fixed-deposits/:id/liquidate",
    service: "savings",
    downstreamPath: (request) =>
      `/v1/fixed-deposits/${encodeURIComponent(routeId(request))}/liquidate`,
  },
  {
    method: "put",
    publicPath: "/v1/fixed-deposits/:id/maturity-instruction",
    service: "savings",
    downstreamPath: (request) =>
      `/v1/fixed-deposits/${encodeURIComponent(routeId(request))}/maturity-instruction`,
  },
  {
    method: "post",
    publicPath: "/v1/savings/recurring-plans",
    service: "savings",
    downstreamPath: () => "/v1/recurring-plans",
  },
  {
    method: "get",
    publicPath: "/v1/profile",
    service: "auth-customer",
    downstreamPath: () => "/v1/customers/me",
  },
  {
    method: "patch",
    publicPath: "/v1/profile",
    service: "auth-customer",
    downstreamPath: () => "/v1/customers/me",
  },
  {
    method: "get",
    publicPath: "/v1/security",
    service: "auth-customer",
    downstreamPath: () => "/v1/security",
  },
  {
    method: "get",
    publicPath: "/v1/notifications",
    service: "auth-customer",
    downstreamPath: () => "/v1/notifications",
  },
  {
    method: "get",
    publicPath: "/v1/notification-preferences",
    service: "auth-customer",
    downstreamPath: () => "/v1/notification-preferences",
  },
  {
    method: "put",
    publicPath: "/v1/notification-preferences/:category",
    service: "auth-customer",
    downstreamPath: (request) =>
      `/v1/notification-preferences/${encodeURIComponent(routeId(request))}`,
  },
  {
    method: "put",
    publicPath: "/v1/devices/push-token",
    service: "auth-customer",
    downstreamPath: () => "/v1/devices/push-token",
  },
  {
    method: "delete",
    publicPath: "/v1/devices/:id",
    service: "auth-customer",
    downstreamPath: (request) =>
      `/v1/devices/${encodeURIComponent(routeId(request))}`,
  },
  {
    method: "delete",
    publicPath: "/v1/security/sessions/:id",
    service: "auth-customer",
    downstreamPath: (request) =>
      `/v1/security/sessions/${encodeURIComponent(routeId(request))}`,
  },
  {
    method: "get",
    publicPath: "/v1/referrals/summary",
    service: "auth-customer",
    downstreamPath: () => "/v1/referrals/summary",
  },
  {
    method: "get",
    publicPath: "/v1/support/faqs",
    service: "tenant-admin",
    downstreamPath: (request) =>
      `/internal/v1/customers/${customerId(request)}/support/faqs`,
    internal: true,
  },
  {
    method: "get",
    publicPath: "/v1/support/tickets",
    service: "tenant-admin",
    downstreamPath: (request) =>
      `/internal/v1/customers/${customerId(request)}/support/tickets`,
    internal: true,
  },
  {
    method: "post",
    publicPath: "/v1/support/tickets",
    service: "tenant-admin",
    downstreamPath: (request) =>
      `/internal/v1/customers/${customerId(request)}/support/tickets`,
    internal: true,
  },
];

declare module "express-serve-static-core" {
  interface Request {
    principal?: CustomerPrincipal;
    correlationId?: string;
  }
}

export function createApp(
  authenticator: CustomerAuthenticator,
  composition: MobileComposition,
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "2mb" }));
  app.use((request, response, next) => {
    const supplied = request.header("x-correlation-id");
    request.correlationId =
      supplied && z.string().uuid().safeParse(supplied).success
        ? supplied
        : randomUUID();
    response.setHeader("x-correlation-id", request.correlationId);
    next();
  });
  app.get("/health/live", (_request, response) =>
    response.status(200).json({ status: "ok" }),
  );
  app.get("/health/ready", async (_request, response) => {
    const ready = await composition.ready();
    response
      .status(ready ? 200 : 503)
      .json({ status: ready ? "ready" : "not_ready" });
  });
  app.get("/v1/bootstrap", async (request, response, next) => {
    try {
      const query = z
        .object({
          app_version: z.string().min(1).max(40),
          platform: z.enum(["android", "ios"]),
        })
        .parse(request.query);
      const tenantSlug = z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
        .parse(request.header("x-tenant-slug"));
      response.json(
        await composition.bootstrap({
          tenantSlug,
          appVersion: query.app_version,
          platform: query.platform,
          correlationId: correlationId(request),
        }),
      );
    } catch (error) {
      next(error);
    }
  });
  app.get("/v1/onboarding/reference-data", async (request, response, next) => {
    try {
      const tenantId = z.string().uuid().parse(request.header("x-tenant-id"));
      response.json(
        await composition.onboardingReferenceData({
          tenantId,
          correlationId: correlationId(request),
        }),
      );
    } catch (error) {
      next(error);
    }
  });
  for (const route of [
    ["/v1/onboarding/registrations", "/v1/onboarding/registrations"],
    ["/v1/onboarding/phone/verify", "/v1/onboarding/phone/verify"],
    ["/v1/auth/passcode/login", "/v1/auth/passcode/login"],
    ["/v1/auth/token/refresh", "/v1/auth/token/refresh"],
    [
      "/v1/auth/passcode/recovery/request",
      "/v1/auth/passcode/recovery/request",
    ],
    [
      "/v1/auth/passcode/recovery/confirm",
      "/v1/auth/passcode/recovery/confirm",
    ],
    [
      "/v1/auth/passkeys/authentication/options",
      "/v1/auth/passkeys/authentication/options",
    ],
    [
      "/v1/auth/passkeys/authentication/verify",
      "/v1/auth/passkeys/authentication/verify",
    ],
  ] as const) {
    app.post(route[0], async (request, response, next) => {
      try {
        const tenantId = z.string().uuid().parse(request.header("x-tenant-id"));
        const idempotencyKey = z
          .string()
          .min(1)
          .max(255)
          .parse(request.header("idempotency-key"));
        const result = await composition.relay({
          service: "auth-customer",
          method: "POST",
          path: route[1],
          query: new URLSearchParams(),
          body: request.body as unknown,
          tenantId,
          correlationId: correlationId(request),
          idempotencyKey,
        });
        if (result.contentType)
          response.setHeader("content-type", result.contentType);
        response.status(result.status).send(result.body);
      } catch (error) {
        next(error);
      }
    });
  }
  app.use("/v1", authenticate(authenticator));
  app.get("/v1/wallet/source-account", async (request, response, next) => {
    try {
      const principal = request.principal;
      const authorization = request.header("authorization");
      if (!principal || !authorization)
        throw new Error("Authenticated customer context is unavailable");
      const customerId = await composition.customerProfileId({
        tenantId: principal.tenantId,
        authorization,
        correlationId: correlationId(request),
      });
      response.json(
        await composition.wallet({
          ...principal,
          customerId,
          authorization,
          correlationId: correlationId(request),
        }),
      );
    } catch (error) {
      next(error);
    }
  });
  app.get("/v1/dashboard", async (request, response, next) => {
    try {
      const principal = request.principal;
      if (!principal) throw new Error("Authenticated principal is unavailable");
      const authorization = request.header("authorization");
      if (!authorization) throw new Error("Authorization is unavailable");
      const customerId = await composition.customerProfileId({
        tenantId: principal.tenantId,
        authorization,
        correlationId: correlationId(request),
      });
      const context = {
        ...principal,
        customerId,
        authorization,
        correlationId: correlationId(request),
      };
      const [wallet, loans, savings] = await Promise.allSettled([
        composition.wallet(context),
        composition.section({ ...context, name: "loans" }),
        composition.section({ ...context, name: "savings" }),
      ]);
      if (wallet.status === "rejected")
        throw new Error("Wallet balance unavailable");
      response.json({
        wallet: wallet.value,
        sections: {
          loans:
            loans.status === "fulfilled"
              ? { available: true }
              : { available: false, error_code: "DEPENDENCY_UNAVAILABLE" },
          savings:
            savings.status === "fulfilled"
              ? { available: true }
              : { available: false, error_code: "DEPENDENCY_UNAVAILABLE" },
        },
      });
    } catch (error) {
      next(error);
    }
  });
  app.get("/v1/loans/summary", async (request, response, next) => {
    try {
      const principal = request.principal;
      const authorization = request.header("authorization");
      if (!principal || !authorization)
        throw new Error("Authenticated request context is unavailable");
      response.json(
        await composition.loanSummary({
          tenantId: principal.tenantId,
          authorization,
          correlationId: correlationId(request),
        }),
      );
    } catch (error) {
      next(error);
    }
  });
  for (const route of relayRoutes) {
    app[route.method](route.publicPath, async (request, response, next) => {
      try {
        const principal = request.principal;
        const authorization = request.header("authorization");
        if (!principal || !authorization)
          throw new Error("Authenticated request context is unavailable");
        const idempotencyKey = request.header("idempotency-key");
        const result = await composition.relay({
          service: route.service,
          method: route.method.toUpperCase() as
            "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
          path: route.downstreamPath(request),
          query: new URLSearchParams(request.query as Record<string, string>),
          body: request.body as unknown,
          tenantId: principal.tenantId,
          authorization,
          correlationId: correlationId(request),
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(route.internal ? { internal: true } : {}),
        });
        if (result.contentType)
          response.setHeader("content-type", result.contentType);
        response.status(result.status).send(result.body);
      } catch (error) {
        next(error);
      }
    });
  }
  app.use((_request, response) =>
    response.status(404).json({
      code: "NOT_FOUND",
      message: "Route not found",
      correlation_id: response.getHeader("x-correlation-id"),
      retryable: false,
    }),
  );
  app.use(
    (
      error: unknown,
      request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      const invalid = error instanceof z.ZodError;
      response.status(invalid ? 422 : 502).json({
        code: invalid ? "INVALID_REQUEST" : "DEPENDENCY_UNAVAILABLE",
        message: invalid
          ? "Request validation failed"
          : "A required dependency is unavailable",
        correlation_id: request.correlationId,
        retryable: !invalid,
      });
    },
  );
  return app;
}

function authenticate(authenticator: CustomerAuthenticator) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const authorization = request.header("authorization");
      if (!authorization) throw new Error("Authorization is required");
      const principal = await authenticator.authenticate(authorization);
      if (request.header("x-tenant-id") !== principal.tenantId) {
        response.status(403).json({
          code: "TENANT_MISMATCH",
          message: "Tenant context does not match token",
          correlation_id: request.correlationId,
          retryable: false,
        });
        return;
      }
      request.principal = principal;
      next();
    } catch {
      response.status(401).json({
        code: "UNAUTHORIZED",
        message: "Authentication failed",
        correlation_id: request.correlationId,
        retryable: false,
      });
    }
  };
}

function correlationId(request: Request): string {
  if (!request.correlationId)
    throw new Error("Correlation identifier is unavailable");
  return request.correlationId;
}

function routeId(request: Request): string {
  return z.string().uuid().parse(request.params["id"]);
}

function customerId(request: Request): string {
  if (!request.principal)
    throw new Error("Authenticated customer context is unavailable");
  return encodeURIComponent(request.principal.customerId);
}
