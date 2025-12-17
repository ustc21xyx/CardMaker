import { NextResponse } from "next/server";

type Body = { baseUrl: string; apiKey: string };

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.baseUrl || !body?.apiKey) {
    return NextResponse.json({ error: "Missing baseUrl/apiKey" }, { status: 400 });
  }

  const baseUrl = normalizeBaseUrl(body.baseUrl);
  const url = `${baseUrl}/v1/models`;

  const upstream = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${body.apiKey}`,
    },
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

