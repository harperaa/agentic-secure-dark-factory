import { query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

/**
 * Spec defaults for the signed-in operator (design §4.12).
 *
 * The Spec screen asked for admin_email and github_owner on every new spec, though both are the
 * same answer nearly every time. They are remembered from the last spec written and offered as
 * defaults; nothing here pins anything, and changing either field in a spec simply teaches the
 * next one.
 *
 * admin_email falls back to the Clerk email already mirrored into `users`, so the very first
 * spec has a sensible default too. github_owner has no such source and is blank until a spec
 * supplies one.
 */
export type SpecDefaults = { admin_email: string; github_owner: string };

export const specDefaults = query({
  args: {},
  handler: async (ctx): Promise<SpecDefaults> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { admin_email: "", github_owner: "" };
    }
    const record = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    return {
      // The remembered value wins: an operator whose specs use a different address than the one
      // they sign in with should only have to say so once.
      admin_email: record?.specAdminEmail ?? record?.email ?? identity.email ?? "",
      github_owner: record?.specGithubOwner ?? "",
    };
  },
});

/**
 * Remember what a saved spec used. Called from createFromSpec, so the defaults follow what the
 * operator actually committed to rather than anything typed and abandoned.
 *
 * Not a public mutation: there is no reason for the client to set these directly, and keeping it
 * internal means the remembered value cannot disagree with any spec that was really saved.
 */
export async function rememberSpecDefaults(
  ctx: MutationCtx,
  spec: { admin_email?: unknown; github_owner?: unknown },
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return;
  }
  const record = await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
    .unique();
  if (!record) {
    return;
  }
  const patch: { specAdminEmail?: string; specGithubOwner?: string } = {};
  if (typeof spec.admin_email === "string" && spec.admin_email !== record.specAdminEmail) {
    patch.specAdminEmail = spec.admin_email;
  }
  if (typeof spec.github_owner === "string" && spec.github_owner !== record.specGithubOwner) {
    patch.specGithubOwner = spec.github_owner;
  }
  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(record._id, patch);
  }
}
