import { env } from "cloudflare:workers";

export const runtime = "edge";

type Input = { requirements?: unknown };

const HOURLY_LIMIT = 5;
const DAILY_LIMIT = 50;

async function visitorBucket(ip: string, secret: string) {
  const signingKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", signingKey, new TextEncoder().encode(ip));
  return `ip:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function consumeBucket(db: D1Database, bucket: string, limit: number, seconds: number, now: number) {
  // A single UPSERT is atomic across concurrent requests. Exceeded attempts
  // remain blocked until this bucket's original window expires.
  const row = await db.prepare(`
    INSERT INTO demo_rate_limits (bucket_key, count, expires_at) VALUES (?1, 1, ?2)
    ON CONFLICT(bucket_key) DO UPDATE SET
      count = CASE WHEN expires_at <= ?3 THEN 1 ELSE count + 1 END,
      expires_at = CASE WHEN expires_at <= ?3 THEN ?2 ELSE expires_at END
    RETURNING count, expires_at
  `).bind(bucket, now + seconds, now).first<{ count: number; expires_at: number }>();
  if (!row) throw new Error("Rate limit database returned no row");
  return { allowed: row.count <= limit, retryAfter: Math.max(1, row.expires_at - now) };
}

function limitedResponse(message: string, retryAfter: number) {
  return Response.json({ error: message }, {
    status: 429,
    headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
}

function quoteInputsFromText(text: string) {
  const wantsPrice = /报价|费用|成本|价格|年费|多少钱/.test(text);
  const asksForProfessional = /(?:按|选择|选用|购买|采购|采用|使用|试算|核算)\s*专业版|专业版.{0,8}(?:年费|报价|价格|试算)/.test(text);
  const counts = new Set<number>();
  for (const match of text.matchAll(/(\d{1,4})\s*(?:名|位|个)?\s*(?:客服(?:坐席)?|坐席)/g)) counts.add(Number(match[1]));
  for (const match of text.matchAll(/(?:客服(?:坐席)?|坐席)\s*(?:数|人数)?\s*(?:为|是|约|：|:)?\s*(\d{1,4})\s*(?:人|名|位|个)?/g)) counts.add(Number(match[1]));
  const seats = [...counts];
  // Only pass unambiguous, explicitly requested pricing to the calculator.
  if (!wantsPrice || !asksForProfessional || seats.length !== 1 || seats[0] < 1 || seats[0] > 50) return { version: "", seats: "" };
  return { version: "专业版", seats: String(seats[0]) };
}

export async function POST(request: Request) {
  let body: Input;
  try { body = await request.json() as Input; }
  catch { return Response.json({ error: "请输入有效需求。" }, { status: 400 }); }

  const requirements = typeof body.requirements === "string" ? body.requirements.trim() : "";
  if (!requirements || requirements.length > 5000) return Response.json({ error: "请输入不超过 5000 字的客户需求。" }, { status: 400 });
  const { version, seats } = quoteInputsFromText(requirements);

  const key = (env as unknown as { DIFY_API_KEY?: string }).DIFY_API_KEY;
  if (!key) return Response.json({ error: "新界面正在接入服务，请先使用 Dify 原版演示。" }, { status: 503 });

  // Enforce quotas before invoking Dify. The browser cannot reset or bypass
  // these counters by clearing local storage or opening a private window.
  const db = env.DB;
  const ip = request.headers.get("CF-Connecting-IP");
  if (!db || !ip) return Response.json({ error: "试用额度校验暂时不可用，请稍后再试。" }, { status: 503 });
  try {
    const now = Math.floor(Date.now() / 1000);
    const currentDay = await db.prepare("SELECT count, expires_at FROM demo_rate_limits WHERE bucket_key = 'global:day'")
      .first<{ count: number; expires_at: number }>();
    if (currentDay && currentDay.expires_at > now && currentDay.count >= DAILY_LIMIT)
      return limitedResponse("公开试用近 24 小时的总次数已用完，请稍后再试。", currentDay.expires_at - now);
    const visitor = await consumeBucket(db, await visitorBucket(ip, key), HOURLY_LIMIT, 3600, now);
    if (!visitor.allowed) return limitedResponse("同一网络地址每小时最多试用 5 次，请稍后再试。", visitor.retryAfter);
    const global = await consumeBucket(db, "global:day", DAILY_LIMIT, 86400, now);
    if (!global.allowed) return limitedResponse("公开试用近 24 小时的总次数已用完，请稍后再试。", global.retryAfter);
  } catch {
    return Response.json({ error: "试用额度校验暂时不可用，请稍后再试。" }, { status: 503 });
  }

  try {
    const response = await fetch("https://api.dify.ai/v1/workflows/run", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: { customer_requirements: requirements, quote_version: version, quote_seats: seats }, response_mode: "blocking", user: "public-demo-visitor" }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) return Response.json({ error: "核对服务暂时不可用，请稍后再试。" }, { status: 502 });
    const payload = await response.json() as { data?: { status?: string; outputs?: Record<string, unknown> } };
    if (payload.data?.status !== "succeeded") return Response.json({ error: "核对未完成，请稍后重试。" }, { status: 502 });
    const outputs = payload.data.outputs || {};
    const rawReport = outputs.analysis_report ?? outputs.direct_response ?? outputs.result ?? Object.values(outputs).find(value => typeof value === "string");
    if (typeof rawReport !== "string") return Response.json({ error: "未收到有效报告，请使用 Dify 原版演示。" }, { status: 502 });
    // Some providers include reasoning in the text field. Never display it as the customer report.
    let report = rawReport.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "").trim();
    if (!report || /<think>/i.test(report)) return Response.json({ error: "报告格式异常，请使用 Dify 原版演示。" }, { status: 502 });
    // Quote inputs come from the customer's text on this one-field page. The
    // workflow still has older wording about manually entered parameters.
    report = report.replace(/(?:独立|单独)填写(?:的)?(?:报价|试算)?参数|报价参数(?:独立|单独)填写|独立报价参数/g, "从需求文字识别的试算参数");
    if (!version && !seats) {
      const wantsPrice = /报价|费用|成本|价格|年费|多少钱/.test(requirements);
      const explanation = wantsPrice
        ? "客户要求核算费用，但演示价格表只录入专业版 1–50 名客服的软件年费；本次缺少适用的完整计价依据，暂不报价。企业版及部署、接口开发、维护费用需人工提供依据。"
        : "客户未要求试算，本次不报价。";
      // Replace the entire quote paragraph, whether the LLM used a single
      // line or a numbered section, so it cannot contradict the request.
      report = report.replace(/(^|\n)((?:三[、.]|3[、.])\s*)?模拟(?:价格|报价)[：:]?\s*[\s\S]*?(?=\n\s*(?:(?:四[、.]|4[、.])\s*)?结论[：:]|$)/m,
        (_match, leading, number) => `${leading}${number || ""}模拟价格：${explanation}\n`);
    }
    return Response.json({ report });
  } catch {
    return Response.json({ error: "请求超时或网络暂时不可用，请稍后重试。" }, { status: 502 });
  }
}
