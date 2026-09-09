import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Operator gate for the factory UI: a signed-in Clerk user whose email is the configured
 * operator (ADMIN_EMAIL, set by SVCOS configure). Single-operator by design (design §2).
 */
export async function requireOperator(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("not signed in");
  }
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error("MISSING_ENV ADMIN_EMAIL");
  }
  // The Clerk JWT template for Convex carries no email claim; SVCOS mirrors users (with email) into
  // the users table via the Clerk webhook. Prefer that record, fall back to a claim if present.
  const record = await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
    .unique();
  const email = (record?.email ?? identity.email ?? "").toLowerCase();
  if (!email) {
    throw new Error("operator record not found yet: the Clerk webhook has not mirrored this user; retry in a moment");
  }
  if (email !== adminEmail.toLowerCase()) {
    throw new Error("not the operator");
  }
  return `user:${identity.subject}`;
}

/** Bridge gate: the local bridge presents a shared secret (FACTORY_BRIDGE_SECRET). */
export function requireBridge(secret: string): string {
  const expected = process.env.FACTORY_BRIDGE_SECRET;
  if (!expected) {
    throw new Error("MISSING_ENV FACTORY_BRIDGE_SECRET");
  }
  if (secret.length !== expected.length) {
    throw new Error("bridge secret rejected");
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  if (diff !== 0) {
    throw new Error("bridge secret rejected");
  }
  return "bridge";
}
