# Proposal: SVCOS optional modules for EU identity and payments

SVCOS's middleware, components, Convex `auth.config.ts`, and webhooks are Clerk-specific, and
the pricing/subscription module is Clerk Billing-specific. Swapping either provider needs
template code, which the factory will not patch.

## `auth-oidc`

An optional module (installed with `modules.mjs install auth-oidc --apply-edits`) that
replaces the Clerk frontend pieces with a generic OIDC client (Keycloak or Zitadel as tested
issuers), keeps Convex's `auth.config.ts` issuer-driven, and provides the same
`requireAdmin`/role helpers so the rest of the template is unchanged.

## `payments-mollie` and `payments-payone`

Optional modules providing products, checkout, webhook, and entitlement lookups against Mollie
or PayOne with the same component surface as the Clerk Billing pricing module.

## Factory status

Tracked as design R14. Until these exist, the `eu` provider profile refuses
`identity` and `payments` swaps via `capabilities()` and ships as "EU data plane, Clerk
identity", labelled in the hand-off.
