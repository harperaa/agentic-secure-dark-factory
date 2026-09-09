import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * GitHub App webhook receiver (design appendix C, §4.9).
 * Verifies the HMAC signature, then turns issue and PR events into stage requests or gate
 * updates. Replaces Machinist's label polling: instant, and no idle compute.
 */
async function verifySignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const given = header.slice("sha256=".length);
  if (expected.length !== given.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

type GitHubEvent = {
  action?: string;
  repository?: { full_name: string };
  issue?: { number: number; html_url: string; pull_request?: unknown };
  pull_request?: { number: number; html_url: string; head?: { sha: string } };
  review?: { user?: { login: string }; body?: string };
  check_suite?: { conclusion?: string | null; head_sha?: string; pull_requests?: Array<{ number: number }> };
};

function parseScore(body: string | undefined): number | null {
  const match = body?.match(/Confidence Score: ([0-5])\/5/);
  return match?.[1] === undefined ? null : Number(match[1]);
}

export const githubWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const reviewerBot = process.env.GREPTILE_BOT_LOGIN;
  const requestLabel = process.env.MACHINIST_REQUEST_LABEL;
  if (!secret || !reviewerBot || !requestLabel) {
    return new Response("MISSING_ENV GITHUB_WEBHOOK_SECRET|GREPTILE_BOT_LOGIN|MACHINIST_REQUEST_LABEL", { status: 500 });
  }
  const body = await request.text();
  if (!(await verifySignature(secret, body, request.headers.get("x-hub-signature-256")))) {
    return new Response("invalid signature", { status: 401 });
  }
  const eventName = request.headers.get("x-github-event") ?? "";
  const evt = JSON.parse(body) as GitHubEvent;
  const repo = evt.repository?.full_name;
  if (!repo) {
    return new Response("ignored", { status: 202 });
  }
  const actor = "webhook:github";

  if (eventName === "issues" && evt.action === "opened" && evt.issue && !evt.issue.pull_request) {
    await ctx.runMutation(internal.factory.enqueue, {
      projectRepo: repo,
      stage: "TRIAGE",
      command: "triage",
      prompt: `--ref=${evt.issue.html_url} --request-label=${requestLabel}`,
      ref: evt.issue.html_url,
      actor,
    });
    return new Response("queued", { status: 202 });
  }

  if (eventName === "pull_request" && evt.action === "opened" && evt.pull_request) {
    await ctx.runMutation(internal.factory.enqueue, {
      projectRepo: repo,
      stage: "TRIAGE",
      command: "triage",
      prompt: `--ref=${evt.pull_request.html_url} --request-label=${requestLabel}`,
      ref: evt.pull_request.html_url,
      actor,
    });
    return new Response("queued", { status: 202 });
  }

  if (eventName === "pull_request_review" && evt.review?.user?.login === reviewerBot && evt.pull_request) {
    await ctx.runMutation(internal.factory.gateUpdate, {
      repo,
      pr: evt.pull_request.number,
      ...(evt.pull_request.head?.sha === undefined ? {} : { headSha: evt.pull_request.head.sha }),
      reviewScore: parseScore(evt.review.body),
      actor,
    });
    return new Response("gate updated", { status: 202 });
  }

  if (eventName === "check_suite" && evt.check_suite?.conclusion && evt.check_suite.pull_requests?.length) {
    for (const pr of evt.check_suite.pull_requests) {
      await ctx.runMutation(internal.factory.gateUpdate, {
        repo,
        pr: pr.number,
        ...(evt.check_suite.head_sha === undefined ? {} : { headSha: evt.check_suite.head_sha }),
        ci: [{ name: "check_suite", conclusion: evt.check_suite.conclusion }],
        actor,
      });
    }
    return new Response("gate updated", { status: 202 });
  }

  return new Response("ignored", { status: 202 });
});

