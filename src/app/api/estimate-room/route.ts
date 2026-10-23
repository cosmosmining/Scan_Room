import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_IMAGES = 6;
// Free tier via Google AI Studio (no billing). Override with GEMINI_MODEL.
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

const PROMPT = `These photos are a 360° sweep taken by a person standing in the centre of one room, slowly turning a full circle, so together they show the whole room from one spot. You have no depth sensor — estimate visually, keeping scale CONSISTENT across all the views using known references (interior doors ~2030mm tall, kitchen worktops ~900mm high, ceilings ~2400-2700mm, standard floor tiles ~300-600mm). Cross-check across the views. Always return your best guess — never refuse.
Estimate the room's interior width, depth, and ceiling height in millimetres. Output ONLY this JSON, nothing else:
{"widthMm":<int>,"depthMm":<int>,"heightMm":<int>,"confidence":"low"|"medium"|"high","note":"<short>"}`;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(Math.round(v), lo), hi);

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'AI estimate is not configured — set GEMINI_API_KEY (free key from aistudio.google.com).',
      },
      { status: 503 },
    );
  }

  let body: { images?: string[]; image?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const images = (
    Array.isArray(body.images) ? body.images : body.image ? [body.image] : []
  )
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .slice(0, MAX_IMAGES);

  if (images.length === 0) {
    return NextResponse.json({ error: 'No images provided.' }, { status: 400 });
  }

  const parts = [
    ...images.map((data) => ({
      inline_data: { mime_type: 'image/jpeg', data },
    })),
    { text: PROMPT },
  ];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      return NextResponse.json(
        { error: `AI request failed (${res.status}). ${detail}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const raw: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return NextResponse.json({ error: 'Could not parse estimate.' }, { status: 502 });
    }
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      widthMm: number;
      depthMm: number;
      heightMm: number;
      confidence?: string;
      note?: string;
    };

    return NextResponse.json({
      widthMm: clamp(parsed.widthMm, 1000, 12000),
      depthMm: clamp(parsed.depthMm, 1000, 12000),
      heightMm: clamp(parsed.heightMm, 2000, 4000),
      confidence: parsed.confidence ?? 'low',
      note: parsed.note ?? '',
      views: images.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: `AI request failed: ${message}` }, { status: 502 });
  }
}
