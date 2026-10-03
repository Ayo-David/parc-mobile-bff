# Parc Mobile BFF

Customer-mobile composition service implemented with plain Express and strict TypeScript. Production traffic reaches this service only through Kong at `/mobile`.

## Current EDGE-02 slice

- Public tenant bootstrap composition
- Customer JWT validation through Auth JWKS
- Signed tenant claim and `X-Tenant-Id` agreement
- Authoritative Ledger wallet balance composition
- Independently degradable Lending and Savings dashboard sections
- Explicit allowlisted composition for available Payment bill/reference APIs,
  Lending customer servicing APIs, Savings customer APIs, Auth profile APIs,
  and transaction authorization
- Correlation, authorization, tenant and idempotency context preservation
- Bounded downstream timeouts and contract-shaped errors

## Progressive onboarding

The Figma-aligned mobile sequence is exposed through Kong at `/mobile/v1`: phone/consent registration, phone OTP verification, optional email and email OTP, NIN verification, VerifyMe face match, address, PEP declaration, income, six-digit login passcode, optional WebAuthn/passkey enrollment, and completion. `GET /v1/onboarding/status` resumes the durable ordered workflow.

Only registration, phone verification, passcode login, and passkey authentication are public. Profile enrichment and passkey enrollment require the customer token issued after phone verification. `LOGIN_PASSCODE`, transaction `PIN`, and WebAuthn credentials are deliberately separate.

Assumptions:

- The app obtains `X-Tenant-Id` from `/v1/bootstrap` before beginning onboarding.
- Face captures are uploaded to an approved private, short-lived HTTPS URL before the VerifyMe biometric call; neither the URL nor raw image is retained in the onboarding table.
- NIN is transient in the provider request. Persistent evidence remains masked, separately keyed, provider-referenced, and signed.
- Email and passkey enrollment are optional; all other steps are ordered and resumable.

The remaining mobile-contract operations stay pending until their owning
services expose matching versioned APIs. They are intentionally not implemented
as generic or direct-domain proxies.

The BFF owns no authoritative state, imports no sibling source, and queries no service database.

## Commands

```bash
cp .env.example .env
yarn install --frozen-lockfile
yarn validate
yarn dev
```
