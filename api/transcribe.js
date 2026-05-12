// api/transcribe.js
import { getUserBySessionToken } from "../lib/db.js";

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } }
};

function applyCors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
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

function extensionForMime(mimeType) {
  const mt = (mimeType || "").toLowerCase();
  if (mt.includes("webm")) return "webm";
  if (mt.includes("mp4")) return "mp4";
  if (mt.includes("ogg")) return "ogg";
  if (mt.includes("wav")) return "wav";
  if (mt.includes("mpeg") || mt.includes("mp3")) return "mp3";
  return "webm";
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const token = req.headers["x-session-token"];
    const user = await getUserBySessionToken(token);
    if (!user) return res.status(401).json({ error: "unauthorized" });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "transcription_unavailable" });

    const { audioBase64, mimeType } = req.body || {};
    if (!audioBase64 || typeof audioBase64 !== "string") {
      return res.status(400).json({ error: "missing_audio" });
    }

    let audioBuffer;
    try { audioBuffer = Buffer.from(audioBase64, "base64"); }
    catch (e) { return res.status(400).json({ error: "invalid_audio_encoding" }); }

    if (audioBuffer.length < 1000) return res.status(400).json({ error: "audio_too_short" });
    if (audioBuffer.length > 5 * 1024 * 1024) return res.status(413).json({ error: "audio_too_large" });

    const ext = extensionForMime(mimeType);
    const filename = `audio.${ext}`;
    const fileType = mimeType || `audio/${ext}`;

    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: fileType });
    formData.append("file", blob, filename);
    formData.append("model", "whisper-1");
    formData.append("language", "en");
    formData.append("prompt", "Master Your Path. The Freedom Intelligence Field. Human Instrument. Day 1: State Reset. Day 2: Decision. Day 3: Aligned Action.");

    const openaiRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text().catch(() => "");
      console.error("transcribe_openai_error", { status: openaiRes.status, body: errText.slice(0, 200) });
      return res.status(502).json({ error: "transcription_failed" });
    }

    const data = await openaiRes.json();
    const text = ((data && data.text) || "").trim();
    return res.status(200).json({ text });
  } catch (err) {
    console.error("transcribe_error", { message: err?.message });
    return res.status(500).json({ error: "internal_error" });
  }
}