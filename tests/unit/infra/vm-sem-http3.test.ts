import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * NOD-254 (definido em 2026-10-15): na VM o Caddy serve só h1/h2. O QUIC derrubava o SSE por inatividade
 * ("timeout: no recent network activity") e no Caddy não dá para desligar só na rota de eventos. Este teste
 * impede religar o HTTP/3 (ou reabrir o UDP 443 no compose) sem uma decisão nova. A sintaxe do Caddyfile não é
 * validada no CI: o PR que mexer nele cola a saída do `caddy validate`.
 */
const ler = (caminho: string) => readFileSync(new URL(`../../../${caminho}`, import.meta.url), "utf8");
const semComentarios = (texto: string) =>
  texto
    .split("\n")
    .map((l) => l.replace(/(^|\s)#.*$/, "").trimEnd())
    .filter((l) => l.trim() !== "")
    .join("\n");

describe("VM sem HTTP/3 (NOD-254)", () => {
  it("Caddyfile abre com o bloco global `servers { protocols h1 h2 }`, antes do site", () => {
    const caddy = semComentarios(ler("infra/gcp/vm/Caddyfile"));
    expect(caddy).toMatch(/^\{\s*\n\s*servers\s*\{\s*\n\s*protocols\s+h1\s+h2\s*\n\s*\}\s*\n\s*\}/);
    expect(caddy.indexOf("protocols h1 h2")).toBeLessThan(caddy.indexOf("{$NOD_DOMINIO}"));
    expect(caddy).not.toMatch(/\bh3\b/);
  });

  it("Caddyfile serve o domínio e o endereço provisório no mesmo site (NOD-173)", () => {
    const caddy = semComentarios(ler("infra/gcp/vm/Caddyfile"));
    expect(caddy).toMatch(/^\{\$NOD_DOMINIO\} \{\$NOD_ENDERECO_PROVISORIO\} \{$/m);
    expect(semComentarios(ler("infra/gcp/vm/compose.yml"))).toMatch(/NOD_ENDERECO_PROVISORIO: \$\{NOD_ENDERECO_PROVISORIO:-\}/);
    expect(semComentarios(ler("infra/gcp/vm/deploy.sh"))).toMatch(/export NOD_DOMINIO NOD_ENDERECO_PROVISORIO/);
  });

  it("compose.yml não publica nenhuma porta UDP", () => {
    const compose = semComentarios(ler("infra/gcp/vm/compose.yml"));
    expect(compose).toMatch(/"443:443"/);
    expect(compose).not.toMatch(/\/udp/i);
  });

  it("provisionar.sh abre só TCP 80/443 na regra nod-web e fecha o UDP de uma regra já criada", () => {
    const linhas = semComentarios(ler("infra/gcp/provisionar.sh"))
      .split("\n")
      .filter((l) => /firewall-rules (create|update) nod-web\s/.test(l));
    expect(linhas.length).toBeGreaterThanOrEqual(2);
    for (const l of linhas) {
      expect(l).toMatch(/--allow=tcp:80,tcp:443(\s|$)/);
      expect(l).not.toMatch(/udp/i);
    }
    expect(linhas.some((l) => /firewall-rules update nod-web/.test(l))).toBe(true);
    expect(linhas.some((l) => /firewall-rules create nod-web/.test(l))).toBe(true);
  });
});
