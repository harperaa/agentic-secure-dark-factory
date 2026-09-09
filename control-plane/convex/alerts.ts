"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

/**
 * Alerts (design §11): NEEDS_HUMAN, blocked, credential failures, spend thresholds.
 * Delivered to ALERT_WEBHOOK_URL as a Slack-compatible JSON payload when set; otherwise the
 * decision itself is the alert (the Floor shows it). Never throws: an alert failure must not
 * change the line's state.
 */
export const notify = internalAction({
  args: { title: v.string(), text: v.string(), url: v.optional(v.string()) },
  handler: async (_ctx, { title, text, url }) => {
    const target = process.env.ALERT_WEBHOOK_URL;
    if (!target) {
      return { delivered: false, reason: "ALERT_WEBHOOK_URL not set" };
    }
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${title}*\n${text}${url ? `\n${url}` : ""}` }),
      });
      return { delivered: res.ok, status: res.status };
    } catch (err) {
      return { delivered: false, reason: String(err) };
    }
  },
});
