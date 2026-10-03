import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3010),
  AUTH_JWKS_URL: z.string().url(),
  JWT_ISSUER: z.string().url(),
  JWT_AUDIENCE: z.literal("mobile-bff").default("mobile-bff"),
  TENANT_ADMIN_URL: z.string().url(),
  LEDGER_URL: z.string().url(),
  PAYMENT_URL: z.string().url(),
  LENDING_URL: z.string().url(),
  SAVINGS_URL: z.string().url(),
  AUTH_CUSTOMER_URL: z.string().url(),
  DOWNSTREAM_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(10000)
    .default(3000),
  /** Auth token endpoint and this service's ES256 client key. */
  AUTH_TOKEN_URL: z.string().url(),
  SERVICE_CLIENT_KEY_ID: z.string().min(1),
  SERVICE_CLIENT_PRIVATE_KEY_BASE64: z.string().min(1),
});

export type MobileBffConfig = z.infer<typeof schema>;
export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MobileBffConfig {
  return schema.parse(environment);
}
