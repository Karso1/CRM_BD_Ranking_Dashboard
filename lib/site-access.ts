import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "__Host-upay_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
type CredentialEnv = Pick<Cloudflare.Env, "DASHBOARD_USERNAME" | "DASHBOARD_PASSWORD" | "DASHBOARD_SESSION_SECRET">;
type AccessEnv = CredentialEnv & Pick<Cloudflare.Env, "DASHBOARD_BD_ACCOUNTS" | "DASHBOARD_ADDITIONAL_ADMINS" |
  "LOGIN_RATE_LIMITER" | "WALLET_SOURCE_URL" | "DASHBOARD_SOURCE_URL">;
type BdAccount = { username: string; password: string; owner: string };
type AdminAccount = { username: string; password: string };
export type Principal = { role: "admin" } | { role: "bd"; owner: string; username: string };

function bdAccounts(env: AccessEnv): BdAccount[] {
  if (!env.DASHBOARD_BD_ACCOUNTS) return [];
  try {
    const parsed: unknown = JSON.parse(env.DASHBOARD_BD_ACCOUNTS);
    if (!Array.isArray(parsed) || parsed.length > 50) return [];
    if (!parsed.every(item => item && typeof item === "object" &&
      ["username", "password", "owner"].every(key => typeof (item as Record<string, unknown>)[key] === "string" &&
        String((item as Record<string, unknown>)[key]).length > 0 && String((item as Record<string, unknown>)[key]).length <= 128))) return [];
    return parsed as BdAccount[];
  } catch { return []; }
}

function additionalAdmins(env: AccessEnv): AdminAccount[] {
  if (!env.DASHBOARD_ADDITIONAL_ADMINS) return [];
  try {
    const parsed: unknown = JSON.parse(env.DASHBOARD_ADDITIONAL_ADMINS);
    if (!Array.isArray(parsed) || parsed.length > 20) return [];
    if (!parsed.every(item => item && typeof item === "object" &&
      ["username", "password"].every(key => typeof (item as Record<string, unknown>)[key] === "string" &&
        String((item as Record<string, unknown>)[key]).length > 0 && String((item as Record<string, unknown>)[key]).length <= 128))) return [];
    return parsed as AdminAccount[];
  } catch { return []; }
}

function adminAccountEnv(env: AccessEnv, account: AdminAccount): CredentialEnv {
  return { DASHBOARD_USERNAME: account.username, DASHBOARD_PASSWORD: account.password,
    DASHBOARD_SESSION_SECRET: env.DASHBOARD_SESSION_SECRET };
}

function accountEnv(env: AccessEnv, account: BdAccount): CredentialEnv {
  return { DASHBOARD_USERNAME: account.username, DASHBOARD_PASSWORD: account.password,
    DASHBOARD_SESSION_SECRET: env.DASHBOARD_SESSION_SECRET };
}

function equalSecret(a: string, b: string): boolean {
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(a), hash(b));
}

function signature(payload: string, env: CredentialEnv): string {
  // A separate random secret prevents offline password guessing from cookies.
  // Deriving the key from the password also revokes sessions when it changes.
  const key = createHmac("sha256", env.DASHBOARD_SESSION_SECRET!)
    .update(`upay-session-v2\0${JSON.stringify([env.DASHBOARD_USERNAME, env.DASHBOARD_PASSWORD])}`).digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createSession(env: CredentialEnv, now = Date.now()): string {
  const payload = `v1.${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(24).toString("base64url")}`;
  return `${payload}.${signature(payload, env)}`;
}

export function validSession(request: Request, env: CredentialEnv, now = Date.now()): boolean {
  if (!env.DASHBOARD_USERNAME || !env.DASHBOARD_PASSWORD || !env.DASHBOARD_SESSION_SECRET) return false;
  const cookies = (request.headers.get("Cookie") ?? "").split(";")
    .map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`));
  if (cookies.length !== 1) return false;
  const token = cookies[0].slice(SESSION_COOKIE.length + 1);
  if (!/^v1\.\d{10}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const parts = token.split(".");
  const expires = Number(parts[1]), seconds = Math.floor(now / 1000);
  return expires > seconds && expires <= seconds + SESSION_SECONDS &&
    equalSecret(parts[3], signature(parts.slice(0, 3).join("."), env));
}

export function sessionPrincipal(request: Request, env: AccessEnv): Principal | null {
  if (validSession(request, env)) return { role: "admin" };
  for (const account of additionalAdmins(env)) {
    if (validSession(request, adminAccountEnv(env, account))) return { role: "admin" };
  }
  for (const account of bdAccounts(env)) {
    if (validSession(request, accountEnv(env, account))) {
      return { role: "bd", owner: account.owner, username: account.username };
    }
  }
  return null;
}

export function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

type Language = "en" | "zh";
const loginWords = {
  en: { title: "Welcome to UPay", subtitle: "Sign in to your dashboard.", username: "Username", password: "Password", submit: "Sign in",
    unavailable: "Sign-in is temporarily unavailable. Please try again later.", limited: "Too many attempts. Please wait a minute and try again.",
    invalid: "Incorrect username or password.", large: "Request too large. Please try again." },
  zh: { title: "欢迎使用 UPay", subtitle: "登录以访问数据看板。", username: "用户名", password: "密码", submit: "登录",
    unavailable: "暂时无法登录，请稍后重试。", limited: "尝试次数较多，请等待一分钟后重试。",
    invalid: "用户名或密码不正确。", large: "请求过大，请重新输入。" },
};
type LoginError = "" | "unavailable" | "limited" | "invalid" | "large";
function loginPage(lang: Language, error: LoginError = "", status = 200): Response {
  const t = loginWords[lang];
  return privateResponse(new Response(`<!doctype html><html lang="${lang === "zh" ? "zh-CN" : "en"}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>UPay · ${t.submit}</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e8f4f0;background:#061214}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 12%,#12342e 0,transparent 55%)}
main{width:min(100%,440px);padding:36px;background:#0b1c1e;border:1px solid #25433f;border-radius:20px;box-shadow:0 24px 80px #0004}
header{display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:11px;color:#60d8b5;font-size:24px;font-weight:700;letter-spacing:-.6px}.brand img{width:43px;height:43px;object-fit:contain}
.languages{display:flex;border:1px solid #36554f;border-radius:8px;padding:3px;gap:2px}.languages a{font-size:12px;text-decoration:none;color:#9ab8b0;padding:7px 9px;border-radius:5px}.languages a[aria-current="page"]{background:#1a4036;color:#8ce8c9}.languages a:focus-visible{outline:2px solid #61d7b3}
h1{font-size:25px;line-height:1.4;font-weight:600;margin:32px 0 9px}p{font-size:14px;line-height:1.7;color:#98b3ae;margin:0 0 26px}label{display:block;color:#c4d7d2;font-size:13px;margin:18px 0 9px}
input{width:100%;font:inherit;padding:14px 15px;background:#071618;border:1px solid #36554f;border-radius:9px;color:#fff;outline:none}input:focus{border-color:#61d7b3;box-shadow:0 0 0 3px #61d7b322}
button{width:100%;margin-top:26px;padding:14px;font:inherit;font-size:14px;font-weight:650;color:#06231a;background:#5ad5b0;border:0;border-radius:9px;cursor:pointer}button:hover{background:#76e2c0}button:focus-visible{outline:2px solid #d0fff0;outline-offset:3px}
.error{color:#ffb3a8;font-size:13px;margin:0 0 18px;padding:12px;background:#482d2b;border-radius:8px}
@media(max-width:440px){main{padding:28px 24px}.languages a{padding:7px}}
</style></head><body><main><header><div class="brand"><img src="/upay-logo.png" alt="UPay" width="43" height="43">UPay</div>
<nav class="languages" aria-label="${lang === "zh" ? "语言" : "Language"}"><a href="/access?lang=en" lang="en" ${lang === "en" ? 'aria-current="page"' : ""}>EN</a><a href="/access?lang=zh" lang="zh-CN" ${lang === "zh" ? 'aria-current="page"' : ""}>中文</a></nav></header>
<h1>${t.title}</h1><p>${t.subtitle}</p>
${error ? `<div class="error" role="alert">${t[error]}</div>` : ""}
<form method="post" action="/access/login?lang=${lang}">
<label for="username">${t.username}</label><input id="username" name="username" type="text" autocomplete="username" required maxlength="128" autocapitalize="none" spellcheck="false" autofocus>
<label for="password">${t.password}</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="128">
<button type="submit">${t.submit}</button></form>
</main></body></html>`, { status, headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  } }));
}

function redirect(location: string, cookie?: string): Response {
  return privateResponse(new Response(null, { status: 303, headers: {
    Location: location, ...(cookie ? { "Set-Cookie": cookie } : {}),
  } }));
}

function trustedSync(request: Request, env: AccessEnv): boolean {
  const url = new URL(request.url);
  if (url.pathname !== "/api/dashboard" || !["GET", "POST"].includes(request.method)) return false;
  const supplied = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const source = env.WALLET_SOURCE_URL ?? env.DASHBOARD_SOURCE_URL;
  if (!supplied || !source) return false;
  try {
    const expected = new URL(source).searchParams.get("key");
    return Boolean(expected && equalSecret(supplied, expected));
  } catch { return false; }
}

// Null means the framework/asset handler may serve this request.
export async function accessResponse(request: Request, env: AccessEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const lang: Language = url.searchParams.get("lang") === "zh" ? "zh" : "en";
  // The public brand asset contains no business data.
  if (url.pathname === "/upay-logo.png" && ["GET", "HEAD"].includes(request.method)) return null;
  if (trustedSync(request, env)) return null;
  if (!env.DASHBOARD_USERNAME || !env.DASHBOARD_PASSWORD || !env.DASHBOARD_SESSION_SECRET) {
    return privateResponse(new Response(lang === "zh" ? "登录尚未配置，请联系管理员。" : "Sign-in is not configured. Please contact the administrator.", { status: 503 }));
  }
  if (url.pathname === "/access/logout" || url.pathname === "/access/login") {
    if (request.method !== "POST") return privateResponse(new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } }));
    if (request.headers.get("Origin") !== url.origin) return privateResponse(new Response("Forbidden", { status: 403 }));
    if (url.pathname.endsWith("/logout")) {
      const response = redirect("/access", `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
      response.headers.set("Clear-Site-Data", '"cache", "storage"');
      return response;
    }
    if (!env.LOGIN_RATE_LIMITER) return loginPage(lang, "unavailable", 503);
    const limit = await env.LOGIN_RATE_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") ?? "unknown" });
    if (!limit.success) {
      const response = loginPage(lang, "limited", 429);
      response.headers.set("Retry-After", "60");
      return response;
    }
    if (!(request.headers.get("Content-Type") ?? "").startsWith("application/x-www-form-urlencoded")) {
      return loginPage(lang, "invalid", 400);
    }
    // Bound the request body even when Content-Length is omitted or untrusted.
    const reader = request.body?.getReader();
    let body = "", size = 0;
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) { await reader.cancel(); return loginPage(lang, "large", 413); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    }
    const fields = new URLSearchParams(body);
    const username = fields.get("username") ?? "";
    const password = fields.get("password") ?? "";
    const account = bdAccounts(env).find(item => equalSecret(username, item.username));
    const extraAdmin = additionalAdmins(env).find(item => equalSecret(username, item.username));
    const adminMatch = equalSecret(username, env.DASHBOARD_USERNAME) && equalSecret(password, env.DASHBOARD_PASSWORD);
    const extraAdminMatch = extraAdmin && equalSecret(password, extraAdmin.password);
    const bdMatch = account && equalSecret(password, account.password);
    if (!username || username.length > 128 || !password || password.length > 128 || (!adminMatch && !extraAdminMatch && !bdMatch)) {
      return loginPage(lang, "invalid", 401);
    }
    const credential = adminMatch ? env : extraAdminMatch ? adminAccountEnv(env, extraAdmin!) : accountEnv(env, account!);
    return redirect("/", `${SESSION_COOKIE}=${createSession(credential)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`);
  }
  const principal = sessionPrincipal(request, env);
  if (url.pathname === "/access") {
    if (!["GET", "HEAD"].includes(request.method)) return privateResponse(new Response("Method not allowed", { status: 405 }));
    return principal ? redirect("/") : loginPage(lang);
  }
  if (principal?.role === "admin") return null;
  if (principal?.role === "bd") {
    if (["GET", "HEAD"].includes(request.method) &&
      (url.pathname === "/" || url.pathname.startsWith("/_next/") || url.pathname === "/vinext-client-entry-manifest.json" ||
        (url.pathname === "/api/dashboard" && url.searchParams.get("refresh") !== "1"))) return null;
    return privateResponse(Response.json({ error: "Forbidden." }, { status: 403 }));
  }
  if (url.pathname.startsWith("/api/") || /\.[a-z0-9]+$/i.test(url.pathname) || request.headers.has("RSC")) {
    return privateResponse(Response.json({ error: "Authentication required." }, { status: 401 }));
  }
  return redirect("/access");
}
