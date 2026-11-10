import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * NOD-331 (decidido pelo Marlon em 2026-10-22): o health check ativo do Caddy só tira uma cor depois de 2 falhas
 * seguidas. O /api/saude/lb depende do banco; com 1 falha um soluço do banco derrubava a cor ativa.
 */
const caddy = readFileSync(new URL("../../../infra/gcp/vm/Caddyfile", import.meta.url), "utf8")
  .split("\n")
  .map((l) => l.replace(/(^|\s)#.*$/, "").trim())
  .filter((l) => l !== "");

describe("Caddyfile da VM: health check do azul/verde (NOD-331)", () => {
  it("tira a cor só depois de 2 falhas seguidas e volta com 1 sucesso", () => {
    expect(caddy).toContain("health_fails 2");
    expect(caddy).toContain("health_passes 1");
  });

  it("checa /api/saude/lb e manda tudo para a primeira cor saudável", () => {
    expect(caddy).toContain("health_uri /api/saude/lb");
    expect(caddy).toContain("lb_policy first");
  });
});
