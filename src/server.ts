import { createServer } from "node:http";
import { createApp } from "./app.js";
import { JwksCustomerAuthenticator } from "./authenticator.js";
import { loadConfig } from "./config.js";
import { HttpMobileComposition } from "./http-composition.js";
import { ParcTokenClient } from "./security/parc-service-auth.js";

const config = loadConfig();
const tokens = await ParcTokenClient.fromBase64Key({
  tokenUrl: config.AUTH_TOKEN_URL,
  issuer: config.JWT_ISSUER,
  clientId: "parc-mobile-bff",
  keyId: config.SERVICE_CLIENT_KEY_ID,
  privateKeyBase64: config.SERVICE_CLIENT_PRIVATE_KEY_BASE64,
});
const app = createApp(
  new JwksCustomerAuthenticator(
    config.AUTH_JWKS_URL,
    config.JWT_ISSUER,
    config.JWT_AUDIENCE,
  ),
  new HttpMobileComposition(config, tokens),
);
const server = createServer(app);
server.listen(config.PORT, "0.0.0.0");

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
