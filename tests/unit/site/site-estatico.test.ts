import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NOD-321 / ADR-118: o site de marketing é a pasta site/ servida como está pelo Worker
 * nodbot-site (static assets). Sem build, então quem guarda o contrato é este teste.
 */
const SITE = join(import.meta.dirname, "../../../site");
const ler = (arquivo: string) => readFileSync(join(SITE, arquivo), "utf8");
const html = ler("index.html");
const headers = ler("_headers");

/** Regras do _headers: caminho (linha sem recuo) → cabeçalhos (linhas recuadas). Comentário só em linha própria. */
function regras(texto: string): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  let atual: string[] | null = null;
  for (const linha of texto.split("\n")) {
    if (!linha.trim() || linha.trim().startsWith("#")) continue;
    if (/^\s/.test(linha)) {
      if (!atual) throw new Error(`cabeçalho sem caminho: ${linha}`);
      atual.push(linha.trim());
    } else {
      atual = [];
      mapa.set(linha.trim(), atual);
    }
  }
  return mapa;
}

const ORIGEM_PROPRIA = /^(https:\/\/nodbot\.ai(\/|$)|\/(?!\/)|#|data:|[^:/]+(\/|$))/;

describe("site estático (site/)", () => {
  it("1. link falso na página exige o noindex no _headers, na regra /* (vale para todo caminho)", () => {
    const temPendente = /href="#"/.test(html) || /data-pend/.test(html);
    if (temPendente) expect(regras(headers).get("/*")).toContain("X-Robots-Tag: noindex");
  });

  it("2. o HTML não tem meta robots (o noindex mora só no _headers)", () => {
    expect(html).not.toMatch(/<meta\s+name=["']robots["']/i);
  });

  it.each(["index.html", "404.html", "privacidade.html", "termos.html"])("3. nenhum recurso de %s vem de fora (só <a href> pode ser externo)", (arquivo) => {
    const pagina = ler(arquivo);
    const recursos = [
      ...[...pagina.matchAll(/\s(?:src|srcset|poster)="([^"]*)"/g)].flatMap((m) => m[1]!.split(",").map((s) => s.trim().split(/\s+/)[0]!)),
      ...[...pagina.matchAll(/url\(\s*['"]?([^'")]+)/g)].map((m) => m[1]!),
      ...[...pagina.matchAll(/<link\b[^>]*>/g)]
        .map((m) => m[0])
        .filter((tag) => !/rel="canonical"/.test(tag))
        .map((tag) => /href="([^"]*)"/.exec(tag)?.[1] ?? ""),
    ];
    expect(recursos.length).toBeGreaterThan(0);
    const externos = recursos.filter((r) => !ORIGEM_PROPRIA.test(r));
    expect(externos).toEqual([]);
  });

  it("4. canonical, og:url e og:image apontam para nodbot.ai, e o og.png tem 1200×630", () => {
    expect(html).toContain('<link rel="canonical" href="https://nodbot.ai/">');
    expect(html).toContain('<meta property="og:url" content="https://nodbot.ai/">');
    expect(html).toContain('<meta property="og:image" content="https://nodbot.ai/og.png">');
    const png = readFileSync(join(SITE, "og.png"));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(png.length).toBeLessThanOrEqual(300 * 1024);
  });

  it("5. robots.txt não bloqueia e aponta o sitemap, que tem a home", () => {
    const robots = ler("robots.txt");
    expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/m);
    expect(robots).toMatch(/^Sitemap: https:\/\/nodbot\.ai\/sitemap\.xml$/m);
    expect(ler("sitemap.xml")).toContain("<loc>https://nodbot.ai/</loc>");
  });

  it("6. _headers com os 6 cabeçalhos de segurança, sem Cache-Control em /*; 404.html servido como 404", () => {
    const todos = regras(headers).get("/*");
    expect(todos).toBeDefined();
    const nomes = todos!.map((h) => h.split(":")[0]!.toLowerCase());
    for (const nome of [
      "x-content-type-options",
      "referrer-policy",
      "x-frame-options",
      "permissions-policy",
      "strict-transport-security",
      "content-security-policy",
    ]) {
      expect(nomes).toContain(nome);
    }
    expect(nomes).not.toContain("cache-control");
    expect(existsSync(join(SITE, "404.html"))).toBe(true);
    const wrangler = ler("wrangler.jsonc");
    expect(wrangler).toMatch(/"name":\s*"nodbot-site"/);
    expect(wrangler).toMatch(/"directory":\s*"\."/);
    expect(wrangler).toMatch(/"not_found_handling":\s*"404-page"/);
  });

  it("6b. a CSP é a do contrato (é ela que garante zero requisição externa) e o HSTS não amarra o app.nodbot.ai", () => {
    const todos = regras(headers).get("/*")!;
    const valor = (nome: string) => todos.find((h) => h.toLowerCase().startsWith(`${nome}:`))?.slice(nome.length + 1).trim();
    expect(valor("content-security-policy")).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(valor("strict-transport-security")).toBe("max-age=31536000");
    expect(valor("x-frame-options")).toBe("DENY");
    expect(valor("x-content-type-options")).toBe("nosniff");
  });

  it("7. o .assetsignore barra a config, o README e o estado local do wrangler dev", () => {
    const ignorados = ler(".assetsignore")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(ignorados).toEqual(expect.arrayContaining(["wrangler.jsonc", "README.md", ".wrangler"]));
  });

  it("8. todo link /download/* da página tem redirect 302 para um .dmg (ou o .exe do Windows, ADA-226) em https no _redirects", () => {
    const destinos = new Map(
      ler("_redirects")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split(/\s+/))
        .map(([origem, destino, status]) => [origem!, { destino: destino!, status: status ?? "302" }]),
    );
    const caminhos = [...new Set([...html.matchAll(/href="(\/download\/[^"]*)"/g)].map((m) => m[1]!))];
    expect(caminhos).toEqual(expect.arrayContaining(["/download/mac", "/download/mac-intel", "/download/windows"]));
    for (const caminho of caminhos) {
      expect(destinos.get(caminho), caminho).toBeDefined();
      expect(destinos.get(caminho)!.status, caminho).toBe("302");
      expect(destinos.get(caminho)!.destino, caminho).toMatch(caminho === "/download/windows" ? /^https:\/\/[^/]+\/.+\.exe$/ : /^https:\/\/[^/]+\/.+\.dmg$/);
    }
  });

  it("10. ADA-32 (ADR-151): /windows redireciona (302) para o script do Windows no servidor oficial", () => {
    const linhas = ler("_redirects").split("\n").map((l) => l.trim().split(/\s+/));
    expect(linhas).toContainEqual(["/windows", "https://app.nodbot.ai/windows", "302"]);
  });

  it.each(["privacidade", "termos"])("9. /%s existe em pt-BR, sem meta robots, com canonical e links para as duas páginas e a home", (slug) => {
    const pagina = ler(`${slug}.html`);
    expect(pagina).toContain('<html lang="pt-BR">');
    expect(pagina).not.toMatch(/<meta\s+name=["']robots["']/i);
    expect(pagina).toContain(`<link rel="canonical" href="https://nodbot.ai/${slug}">`);
    for (const href of ['href="/"', 'href="/privacidade"', 'href="/termos"']) expect(pagina).toContain(href);
    expect(ler("sitemap.xml")).toContain(`<loc>https://nodbot.ai/${slug}</loc>`);
    expect(html).toContain(`href="/${slug}"`);
  });
  it("11. ADA-287: o bloco Open source existe, aponta para o repo público e o CONTRIBUTING, e fica escondido até o repo abrir", () => {
    const bloco = /<section id="open-source"[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0];
    expect(bloco).toBeDefined();
    expect(bloco!.slice(0, bloco!.indexOf(">"))).toMatch(/\shidden(\s|$)/);
    expect(bloco).toContain('href="https://github.com/marlonwlv/nod"');
    expect(bloco).toContain('href="https://github.com/marlonwlv/nod/blob/main/CONTRIBUTING.md"');
    expect(bloco).not.toMatch(/gamefik/i);
  });
});
