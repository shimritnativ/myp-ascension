// api/demo-set-day.js
// Demo-only endpoint: lets a tester set their last_completed_day so they can
// jump between Day 1, Day 2, and Day 3 prompts without waiting 24h between
// each. Gated by env var DEMO_MODE_ENABLED. Returns 404 in production unless
// the env var is set to "true".

import { sql } from "@vercel/postgres";
import { getUserBySessionToken } from "../lib/db.js";

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-session-token");
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // Hard gate: this endpoint does not exist unless explicitly enabled.
  if (process.env.DEMO_MODE_ENABLED !== "true") {
    return res.status(404).json({ error: "not_found" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const token = req.headers["x-session-token"];
    const user = await getUserBySessionToken(token);
    if (!user) return res.status(401).json({ error: "unauthorized" });

    const { day } = req.body || {};
    const targetDay = Number(day);
    if (![1, 2, 3].includes(targetDay)) {
      return res.status(400).json({ error: "invalid_day" });
    }

    // last_completed_day = targetDay - 1 means current_day will be targetDay.
    const lastCompleted = targetDay - 1;

    const { rows } = await sql`
      UPDATE users
      SET last_completed_day = ${lastCompleted},
          pitch_eligible = ${targetDay >= 3},
          updated_at = NOW()
      WHERE id = ${user.id}
      RETURNING current_day, last_completed_day, pitch_eligible
    `;

    return res.status(200).json({
      currentDay: rows[0]?.current_day,
      lastCompletedDay: rows[0]?.last_completed_day,
      pitchEligible: rows[0]?.pitch_eligible,
    });
  } catch (err) {
    console.error("demo_set_day_error", { message: err?.message });
    return res.status(500).json({ error: "internal_error" });
  }
}
