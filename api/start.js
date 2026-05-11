// api/start.js
// Bootstrap endpoint: creates (or returns) a preview-tier user and issues
// a session token. v1 only — until the ThriveCart purchase.completed webhook
// is wired up, the Kajabi page calls this directly with the member's email
// to establish identity.
//
// SECURITY NOTE: this endpoint trusts the email the client sends. That is
// acceptable in the short term because:
//   1. CORS is locked to Kajabi origins.
//   2. The Kajabi page only renders for paying members.
//   3. Worst case, an attacker who fakes an email burns Anthropic credits
//      on their own conversation, capped by per-user rate limits.
// Once Kajabi exposes signed member identity, replace email-trust with that.

import { createPreviewUser, issueSessionToken, getOrCreateSession, timeRemainingMs, resolveActiveDay } from "../lib/db.js";

function applyCors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (!origin && process.env.NODE_ENV !== "production") {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const { email, displayName, kajabiMemberId, thrivecartCustomerId } = req.body || {};

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "invalid_email" });
    }

    const user = await createPreviewUser({
      email: email.toLowerCase().trim(),
      displayName,
      kajabiMemberId,
      thrivecartCustomerId,
    });

    // Make sure a session row exists so /api/chat can find one.
    await getOrCreateSession(user.id);

    const sessionToken = issueSessionToken(user.id);

    return res.status(200).json({
      sessionToken,
      currentDay: resolveActiveDay(user),
      timeRemainingMs: timeRemainingMs(user),
      tier: user.tier,
    });
  } catch (err) {
    console.error("start_error", { message: err?.message });
    return res.status(500).json({ error: "internal_error" });
  }
}
