import { NextResponse } from "next/server";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type Body = {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
};

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.baseUrl || !body?.apiKey || !body?.model || !Array.isArray(body?.messages)) {
    return NextResponse.json({ error: "Missing baseUrl/apiKey/model/messages" }, { status: 400 });
  }

  const baseUrl = normalizeBaseUrl(body.baseUrl);
  const url = `${baseUrl}/v1/chat/completions`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${body.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: body.model,
      messages: body.messages,
      temperature: body.temperature ?? 0.7,
      ...(typeof body.max_tokens === "number" ? { max_tokens: body.max_tokens } : {}),
    }),
    cache: "no-store",
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

