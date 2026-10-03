# Parc Mobile BFF Instructions

## Mission

This repository owns the customer-mobile HTTP composition layer. It owns no authoritative customer, tenant, product, provider, or financial state.

## Rules

- Use plain Express with strict TypeScript and Yarn.
- Accept public traffic only through Kong in production; bind direct service ports to private networks.
- Validate JWT signature, issuer, `mobile-bff` audience, tenant, subject, and session claims.
- Require the signed tenant claim to match `X-Tenant-Id` on protected operations.
- Call owning services only through versioned private HTTP APIs; never query their databases or import their source.
- Forward only explicitly allowed headers and never trust Gateway identity headers.
- Preserve idempotency and correlation identifiers across downstream commands.
- Use integer-minor-unit strings for money and never use JavaScript `number` for monetary arithmetic.
- Bound downstream timeouts and represent optional dashboard dependency failures explicitly.
- Generate unit, integration, authentication, and contract-boundary tests.
