import fs from "node:fs";
import { execFile } from "node:child_process";

/*
 * Доступ к хабу вне дома через Tailscale.
 *
 * Tailscale объединяет компьютер и телефон в личную сеть (через интернет, без
 * открытия портов). `tailscale serve` публикует хаб в этой сети по адресу
 * https://<компьютер>.<сеть>.ts.net с настоящим сертификатом — поэтому на телефоне
 * работает и микрофон. Снаружи этой сети хаб не виден; вход — по паролю хаба.
 */

const CANDIDATES =
  process.platform === "win32"
    ? ["C:\\Program Files\\Tailscale\\tailscale.exe", "C:\\Program Files (x86)\\Tailscale\\tailscale.exe", "tailscale"]
    : process.platform === "darwin"
      ? ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale", "tailscale"]
      : ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "tailscale"];

function exec(bin: string, args: string[], timeout = 15000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 5 * 1024 * 1024 }, (err, out, stderr) => {
      resolve({ code: err ? ((err as any).code === "ENOENT" ? -1 : typeof (err as any).code === "number" ? (err as any).code : 1) : 0, out: String(out), err: String(stderr) });
    });
  });
}

let cachedBin: string | null | undefined;

async function findBin(): Promise<string | null> {
  if (cachedBin !== undefined && cachedBin !== null) return cachedBin;
  for (const c of CANDIDATES) {
    if (c.includes("/") || c.includes("\\")) {
      if (!fs.existsSync(c)) continue;
    }
    const r = await exec(c, ["version"], 8000);
    if (r.code === 0) return (cachedBin = c);
  }
  return (cachedBin = null);
}

export interface TailscaleStatus {
  installed: boolean;
  /** Running, NeedsLogin, Stopped, NoState… */
  state?: string;
  dnsName?: string;
  ips?: string[];
  tailnet?: string;
  serve: { enabled: boolean; url?: string };
  error?: string;
}

export async function tailscaleStatus(port: number): Promise<TailscaleStatus> {
  const bin = await findBin();
  if (!bin) return { installed: false, serve: { enabled: false } };
  const st = await exec(bin, ["status", "--json"]);
  let data: any = null;
  try {
    data = JSON.parse(st.out);
  } catch {}
  if (!data) {
    cachedBin = undefined;
    return { installed: true, state: "Stopped", serve: { enabled: false }, error: (st.err || st.out).trim().split("\n")[0] };
  }
  const dnsName = String(data.Self?.DNSName ?? "").replace(/\.$/, "");
  const status: TailscaleStatus = {
    installed: true,
    state: data.BackendState,
    dnsName: dnsName || undefined,
    ips: data.Self?.TailscaleIPs ?? [],
    tailnet: data.CurrentTailnet?.Name,
    serve: { enabled: false },
  };
  if (data.BackendState === "Running") {
    const sv = await exec(bin, ["serve", "status", "--json"]);
    try {
      const cfg = JSON.parse(sv.out || "{}");
      for (const [hostPort, web] of Object.entries<any>(cfg.Web ?? {})) {
        for (const h of Object.values<any>(web.Handlers ?? {})) {
          if (typeof h.Proxy === "string" && new RegExp(`:${port}(/|$)`).test(h.Proxy)) {
            status.serve = { enabled: true, url: `https://${hostPort.replace(/:443$/, "")}` };
          }
        }
      }
    } catch {}
  }
  return status;
}

/** Включает https://<компьютер>.ts.net → хаб. */
export async function enableServe(port: number, hubHttps: boolean): Promise<{ ok: boolean; message: string }> {
  const bin = await findBin();
  if (!bin) return { ok: false, message: "Tailscale не установлен" };
  const target = hubHttps ? `https+insecure://127.0.0.1:${port}` : `http://127.0.0.1:${port}`;
  const r = await exec(bin, ["serve", "--bg", "--https=443", target], 30000);
  const text = (r.out + "\n" + r.err).trim();
  if (r.code === 0) return { ok: true, message: text };
  if (/HTTPS.*(not enabled|disabled)|enable HTTPS|certificates/i.test(text)) {
    return {
      ok: false,
      message: `В вашей сети Tailscale выключены HTTPS-сертификаты. Откройте https://login.tailscale.com/admin/dns, включите «MagicDNS» и «HTTPS Certificates», затем нажмите кнопку ещё раз.\n\n${text}`,
    };
  }
  if (/access denied|operator|permission/i.test(text)) {
    return { ok: false, message: `Tailscale не дал прав на настройку. Запустите в терминале от администратора: tailscale set --operator=$USER (Linux) или выполните команду в PowerShell от администратора:\n${bin} serve --bg --https=443 ${target}\n\n${text}` };
  }
  return { ok: false, message: text || "tailscale serve завершился с ошибкой" };
}

export async function disableServe(): Promise<{ ok: boolean; message: string }> {
  const bin = await findBin();
  if (!bin) return { ok: false, message: "Tailscale не установлен" };
  const r = await exec(bin, ["serve", "--https=443", "off"], 30000);
  return { ok: r.code === 0, message: (r.out + r.err).trim() };
}
