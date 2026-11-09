import { esc } from "./escape.ts";

/**
 * definido em 2026-09-28 (ADR-053): link escrito pelo bot vira link, mas só http e https, e sempre com o
 * destino à vista. O bot lê Slack, e-mail e web; um texto de fora pode fazê-lo escrever um link com nome
 * bonito e destino ruim. Por isso o chip mostra o domínio de verdade (ou o app, reconhecido pelo próprio
 * endereço), a dica mostra o endereço inteiro e nome que parece endereço dá lugar ao destino real.
 */
export type IconeLink = "slack" | "clickup" | "github" | "google" | "linear" | "notion" | "web" | "inseguro" | "local";

export interface NomeDoLink {
  rotulo: string;
  icone: IconeLink;
  /** Reconhecido por app: o ícone já diz para onde vai. Site comum mostra o domínio ao lado do nome. */
  app: boolean;
}

/** Endereço que pode virar link: http(s), válido e sem usuário/senha (https://github.com@outro.site engana). */
export function lerLink(bruto: string): URL | null {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  return url;
}

// Bidi, controle e largura zero: invisíveis, mas capazes de disfarçar o caminho que a pessoa lê. Montada
// pelos códigos para o arquivo não carregar os próprios invisíveis.
const FAIXAS_INVISIVEIS = [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const INVISIVEIS = new RegExp(`[${FAIXAS_INVISIVEIS.map(([a, b]) => `\\u{${a!.toString(16)}}-\\u{${b!.toString(16)}}`).join("")}]`, "gu");

function caminhoLegivel(url: URL): string {
  let caminho = url.pathname;
  try {
    caminho = decodeURIComponent(caminho);
  } catch {
    // mantém codificado
  }
  caminho = caminho.replace(INVISIVEIS, "");
  return caminho === "/" ? "" : caminho.replace(/\/+$/, "");
}

export function dominio(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

const LIMITE_ROTULO = 38;

/** Site comum: o domínio inteiro (nunca cortado) e o começo do caminho; "…" quando algo ficou de fora. */
function rotuloDoSite(url: URL): string {
  const base = dominio(url) + (url.port ? `:${url.port}` : "");
  const caminho = caminhoLegivel(url);
  const omitido = url.search !== "" || url.hash !== "";
  if ((base + caminho).length <= LIMITE_ROTULO) return base + caminho + (omitido ? "…" : "");
  let acumulado = base;
  for (const parte of caminho.split("/").filter(Boolean)) {
    if ((acumulado + "/" + parte).length > LIMITE_ROTULO) break;
    acumulado += "/" + parte;
  }
  if (acumulado === base && caminho) acumulado = (base + caminho).slice(0, Math.max(base.length, LIMITE_ROTULO - 1));
  return acumulado + "…";
}

const dois = (n: number) => String(n).padStart(2, "0");

function mensagemDoSlack(segundos: number, agora: Date): string {
  const d = new Date(segundos * 1000);
  const mesmoDia = d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth() && d.getDate() === agora.getDate();
  return mesmoDia ? `Slack · mensagem das ${dois(d.getHours())}:${dois(d.getMinutes())}` : `Slack · mensagem de ${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;
}

function doApp(url: URL, agora: Date): NomeDoLink | null {
  const host = dominio(url);
  const partes = caminhoLegivel(url).split("/").filter(Boolean);
  const app = (icone: IconeLink, rotulo: string): NomeDoLink => ({ icone, rotulo, app: true });
  if (host === "slack.com" || host.endsWith(".slack.com")) {
    const [tipo, canal, mensagem] = partes;
    if (tipo === "archives" && canal) {
      const ts = mensagem?.match(/^p(\d{10})\d{6}$/);
      if (ts) return app("slack", mensagemDoSlack(Number(ts[1]), agora));
      return app("slack", canal.startsWith("D") ? "Slack · conversa" : "Slack · canal");
    }
    return app("slack", "Slack");
  }
  if (host === "clickup.com" || host.endsWith(".clickup.com")) {
    if (partes[0] === "t" && partes.length >= 2) return app("clickup", `ClickUp · tarefa ${partes.at(-1)}`);
    if (partes.includes("li") || partes.includes("l")) return app("clickup", "ClickUp · lista");
    if (partes.includes("dc")) return app("clickup", "ClickUp · documento");
    return app("clickup", "ClickUp");
  }
  if (host === "github.com") {
    const [dono, repo, tipo, id] = partes;
    if (repo && (tipo === "pull" || tipo === "issues") && id && /^\d+$/.test(id)) return app("github", `${repo} #${id}`);
    if (repo && tipo === "commit" && id) return app("github", `${repo} · ${id.slice(0, 7)}`);
    if (dono && repo && !tipo) return app("github", `${dono}/${repo}`);
    return app("github", rotuloDoSite(url));
  }
  if (host === "docs.google.com") {
    if (partes[0] === "document") return app("google", "Google Docs · documento");
    if (partes[0] === "spreadsheets") return app("google", "Google Sheets · planilha");
    if (partes[0] === "presentation") return app("google", "Google Slides · apresentação");
    if (partes[0] === "forms") return app("google", "Google Forms · formulário");
  }
  if (host === "drive.google.com") return app("google", "Google Drive · arquivo");
  if (host === "mail.google.com") return app("google", "Gmail");
  if (host === "calendar.google.com") return app("google", "Google Agenda");
  if (host === "meet.google.com" && partes[0]) return app("google", `Google Meet · ${partes[0]}`);
  if (host === "linear.app") {
    const i = partes.indexOf("issue");
    if (i >= 0 && partes[i + 1]) return app("linear", partes[i + 1]!.toUpperCase());
    if (partes.includes("project")) return app("linear", "Linear · projeto");
    return app("linear", "Linear");
  }
  if (/(^|\.)notion\.(so|com|site)$/.test(host)) return app("notion", "Notion · página");
  return null;
}

const LOCAIS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function nomeDoLink(url: URL, agora: Date = new Date()): NomeDoLink {
  if (LOCAIS.has(url.hostname)) return { icone: "local", rotulo: rotuloDoSite(url), app: false };
  if (url.protocol === "http:") return { icone: "inseguro", rotulo: rotuloDoSite(url), app: false };
  return doApp(url, agora) ?? { icone: "web", rotulo: rotuloDoSite(url), app: false };
}

/** Ícones desenhados, sem buscar nada fora: buscar o ícone do site avisaria o site de que a mensagem foi aberta. */
const DESENHOS: Record<IconeLink, string> = {
  slack: '<path d="M4.5 1.5 3.5 10.5M8.5 1.5l-1 9M1.5 4h9M1.5 8h9"/>',
  clickup: '<path d="M2.5 8 6 4.5 9.5 8"/>',
  github: '<circle cx="3.5" cy="2.8" r="1.3"/><circle cx="3.5" cy="9.2" r="1.3"/><circle cx="8.5" cy="9.2" r="1.3"/><path d="M3.5 4.1v3.8M8.5 7.9V5.5A1.5 1.5 0 0 0 7 4H5.2"/>',
  google: '<path d="M3 1.5h4l2.5 2.5v6.5H3z"/><path d="M4.6 6.2h3.2M4.6 8.2h2.4"/>',
  linear: '<path d="M2 7.5 4.5 10M2 4.5 7.5 10M3.5 2.5l6 6M6.5 2 10 5.5"/>',
  notion: '<rect x="2" y="1.5" width="8" height="9" rx="1"/><path d="M4.5 4v4.5M4.5 4l3 4.5M7.5 4v4.5"/>',
  web: '<circle cx="6" cy="6" r="4.5"/><path d="M1.5 6h9M6 1.5c1.6 1.4 1.6 7.6 0 9M6 1.5c-1.6 1.4-1.6 7.6 0 9"/>',
  inseguro: '<rect x="2.5" y="5.5" width="7" height="5" rx="1"/><path d="M4 5.5V3.8a2 2 0 0 1 3.9-.6"/>',
  local: '<rect x="1.5" y="2" width="9" height="6" rx="1"/><path d="M4.5 10.5h3M6 8v2.5"/>',
};

export function iconeDoLink(icone: IconeLink): string {
  return `<span class="lk-ic lk-ic-${icone}" aria-hidden="true"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${DESENHOS[icone]}</svg></span>`;
}

const ATRIBUTOS = 'data-lk target="_blank" rel="noopener noreferrer nofollow"';

/** Link solto: o chip do app ou do site, com o nome tirado do próprio endereço. */
export function chipDoLink(url: URL, agora?: Date): string {
  const nome = nomeDoLink(url, agora);
  return `<a class="lk-chip" href="${esc(url.href)}" ${ATRIBUTOS}>${iconeDoLink(nome.icone)}<span class="lk-rotulo">${esc(nome.rotulo)}</span></a>`;
}

/** Nome que parece endereço ("github.com/acme", "https://…"): quem lê acredita no nome, então ele não vale. */
const PARECE_ENDERECO = /^(https?:\/\/)?([\p{L}\p{N}-]+\.)+[\p{L}]{2,}(:\d+)?([/?#]\S*)?$/iu;

/** [nome](link): o nome fica na frase, com o ícone do app ou o domínio ao lado; o destino, na dica. */
export function linkComNome(nome: string, url: URL, agora?: Date): string {
  if (PARECE_ENDERECO.test(nome.trim()) || /https?:\/\//i.test(nome)) return chipDoLink(url, agora);
  const info = nomeDoLink(url, agora);
  const icone = info.app || info.icone === "local" ? iconeDoLink(info.icone) : "";
  const lado = info.app || info.icone === "local" ? "" : `<span class="lk-dominio">${esc(dominio(url))}</span>`;
  return `<a class="lk" href="${esc(url.href)}" ${ATRIBUTOS}>${icone}${esc(nome)}</a>${lado}`;
}

/** Tira do fim do endereço solto a pontuação da frase e o parêntese que não abriu dentro dele. */
export function aparaUrl(bruta: string): string {
  let url = bruta.replace(/[.,;:!?*'"]+$/, "");
  const pares: [string, string][] = [["(", ")"], ["[", "]"], ["{", "}"]];
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const [abre, fecha] of pares) {
      if (url.endsWith(fecha) && url.split(fecha).length > url.split(abre).length) {
        url = url.slice(0, -1).replace(/[.,;:!?*'"]+$/, "");
        mudou = true;
      }
    }
  }
  return url;
}

/** O que a dica do link mostra (ADR-053): o host exato e o resto do endereço, com o que vem depois do ?. */
export interface PartesDoEndereco {
  host: string;
  resto: string;
  seguro: boolean;
}

const LIMITE_RESTO = 160;

export function partesDoEndereco(href: string): PartesDoEndereco | null {
  const url = lerLink(href);
  if (!url) return null;
  const resto = (url.pathname === "/" ? "" : url.pathname) + url.search + url.hash;
  return { host: url.host, resto: resto.length > LIMITE_RESTO ? `${resto.slice(0, LIMITE_RESTO - 1)}…` : resto, seguro: url.protocol === "https:" };
}
