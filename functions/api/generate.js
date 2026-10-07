// Cloudflare Pages Function: proxies recipe requests to Gemini so the API key stays server-side.
// Set GEMINI_API_KEY as a secret in the Pages project settings (or .dev.vars locally).
const MODEL = 'gemini-3.1-flash-lite';
const MAX_BODY_BYTES = 20_000;

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return new Response('Request too large', { status: 413 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { contents, systemInstruction, generationConfig } = body;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents, systemInstruction, generationConfig }),
    }
  );

  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
