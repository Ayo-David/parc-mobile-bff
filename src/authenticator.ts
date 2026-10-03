import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";

export interface CustomerPrincipal {
  tenantId: string;
  customerId: string;
  sessionId: string;
}

export interface CustomerAuthenticator {
  authenticate(authorization: string): Promise<CustomerPrincipal>;
}

export class JwksCustomerAuthenticator implements CustomerAuthenticator {
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;
  public constructor(
    jwksUrl: string,
    private readonly issuer: string,
    private readonly audience = "mobile-bff",
  ) {
    this.keys = createRemoteJWKSet(new URL(jwksUrl), {
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });
  }
  public async authenticate(authorization: string): Promise<CustomerPrincipal> {
    if (!authorization.startsWith("Bearer "))
      throw new Error("Bearer authorization is required");
    const { payload } = await jwtVerify(authorization.slice(7), this.keys, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ["RS256", "ES256", "EdDSA"],
      clockTolerance: 5,
    });
    return principal(payload);
  }
}

function principal(payload: JWTPayload): CustomerPrincipal {
  if (
    typeof payload.sub !== "string" ||
    typeof payload["tenant_id"] !== "string" ||
    typeof payload["session_id"] !== "string"
  )
    throw new Error("JWT is missing subject, tenant, or session claims");
  return z
    .object({
      customerId: z.string().uuid(),
      tenantId: z.string().uuid(),
      sessionId: z.string().uuid(),
    })
    .parse({
      customerId: payload.sub,
      tenantId: payload["tenant_id"],
      sessionId: payload["session_id"],
    });
}
