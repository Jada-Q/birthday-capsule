/**
 * capsule.ts — Birthday capsule persistence via GitHub Issues API.
 *
 * Repo is public; token is a fine-grained PAT with issues:write injected via Vite env.
 * One issue per year, labeled `capsule-${year}`, body contains a fenced ```json block
 * with the full CapsuleData payload (audio inlined as data URL).
 */

export interface CapsuleData {
  year: number;
  q1: string;
  q2: string;
  q3: string;
  /** Full data URL including `data:audio/webm;base64,...` prefix. May be empty string. */
  audioDataUrl: string;
}

export interface CapsuleSubmitOpts {
  /** Server proxy endpoint. Defaults to /api/submit-capsule. */
  endpoint?: string;
  /** Optional override of repo for fetch (capsule submit always goes through endpoint). */
  repo?: string;
}

export interface CapsuleFetchOpts {
  repo: string;
  token?: string;
}

interface GitHubIssue {
  html_url: string;
  body: string | null;
  labels: Array<string | { name?: string }>;
}

const API_BASE = "https://api.github.com";
const MAX_BODY_CHARS = 60_000;

function buildHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

function buildIssueBody(data: CapsuleData): string {
  const sealedAt = new Date().toISOString();
  const json = JSON.stringify(data, null, 2);
  return `# 🎂 Birthday Capsule ${data.year}

> sealed at ${sealedAt}

\`\`\`json
${json}
\`\`\`
`;
}

/**
 * Extract the first ```json fenced block from an issue body and parse it.
 * Returns null if no valid block is found or JSON parsing fails.
 *
 * Regex notes:
 * - `/```json\s*\n([\s\S]*?)\n```/` — non-greedy capture between fences
 * - `[\s\S]` to span newlines without the /s flag (broader runtime support)
 * - Non-greedy `*?` so a body with multiple fences only yields the first capsule block
 */
function extractCapsuleJson(body: string | null): CapsuleData | null {
  if (!body) return null;
  const match = body.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]!) as unknown;
    if (!isCapsuleData(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isCapsuleData(v: unknown): v is CapsuleData {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.year === "number" &&
    typeof o.q1 === "string" &&
    typeof o.q2 === "string" &&
    typeof o.q3 === "string" &&
    typeof o.audioDataUrl === "string"
  );
}

function hasCapsuleLabel(issue: GitHubIssue): boolean {
  for (const label of issue.labels) {
    const name = typeof label === "string" ? label : label?.name;
    if (typeof name === "string" && name.startsWith("capsule-")) {
      return true;
    }
  }
  return false;
}

/**
 * Submit a capsule. POSTs to a server-side proxy (Vercel Edge fn) that holds the
 * GH token — token never enters the client bundle. Returns the new issue's HTML URL.
 */
export async function submitCapsule(
  data: CapsuleData,
  opts: CapsuleSubmitOpts = {},
): Promise<string> {
  const endpoint = opts.endpoint ?? "/api/submit-capsule";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      year: data.year,
      q1: data.q1,
      q2: data.q2,
      q3: data.q3,
      audioDataUrl: data.audioDataUrl,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `Submit failed: HTTP ${res.status}`);
  }
  if (!json.url) throw new Error("Submit succeeded but no URL returned");
  return json.url;
}

/** Fetch all prior capsules sorted ascending by year. */
export async function fetchPriorCapsules(
  opts: CapsuleFetchOpts,
): Promise<CapsuleData[]> {
  const res = await fetch(
    `${API_BASE}/repos/${opts.repo}/issues?state=all&per_page=100`,
    {
      method: "GET",
      headers: buildHeaders(opts.token),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub API ${res.status}: ${errBody}`);
  }

  const issues = (await res.json()) as GitHubIssue[];

  const capsules: CapsuleData[] = [];
  for (const issue of issues) {
    if (!hasCapsuleLabel(issue)) continue;
    const parsed = extractCapsuleJson(issue.body);
    if (parsed) capsules.push(parsed);
  }

  capsules.sort((a, b) => a.year - b.year);
  return capsules;
}
