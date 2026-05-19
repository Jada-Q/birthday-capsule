// Vercel Edge function — server-side GitHub Issues proxy.
// Keeps GH_TOKEN out of the client bundle.

export const config = { runtime: "edge" };

const REPO = "Jada-Q/birthday-capsule";

interface CapsulePayload {
  year: number;
  q1: string;
  q2: string;
  q3: string;
  audioDataUrl?: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const token = process.env.GH_TOKEN;
  if (!token) {
    return json({ error: "Server not configured: GH_TOKEN missing" }, 500);
  }

  let data: CapsulePayload;
  try {
    data = (await req.json()) as CapsulePayload;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!data || typeof data.year !== "number") {
    return json({ error: "Invalid payload" }, 400);
  }
  if (!data.q1 && !data.q2 && !data.q3) {
    return json({ error: "Empty capsule" }, 400);
  }

  const sealedAt = new Date().toISOString();
  const issueBody =
    `# 🎂 Birthday Capsule ${data.year}\n\n` +
    `> sealed at ${sealedAt}\n\n` +
    "```json\n" +
    JSON.stringify({
      year: data.year,
      q1: data.q1,
      q2: data.q2,
      q3: data.q3,
      audioDataUrl: data.audioDataUrl ?? "",
    }, null, 2) +
    "\n```\n";

  if (issueBody.length > 60000) {
    return json({ error: "Capsule payload too large (audio?)" }, 413);
  }

  const ghRes = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "birthday-capsule",
    },
    body: JSON.stringify({
      title: `Capsule ${data.year}`,
      body: issueBody,
      labels: [`capsule-${data.year}`],
    }),
  });

  if (!ghRes.ok) {
    const txt = await ghRes.text();
    return json({ error: `GitHub API ${ghRes.status}: ${txt.slice(0, 200)}` }, 502);
  }

  const issue = (await ghRes.json()) as { html_url?: string };
  return json({ url: issue.html_url ?? "" }, 200);
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
