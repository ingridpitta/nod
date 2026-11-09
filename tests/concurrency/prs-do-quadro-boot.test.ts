import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { definirDestinoDoLog } from "../../src/obs/log.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-421, 2ª revisão do PR #621 (ADR-145): o boot (boot.ts, planoPrsDoQuadro) só sobe o laço dos PRs do quadro com
 * algum tenant em NOD_QUADRO_GITHUB_TENANTS, em qualquer jeito e modo. O teste sobe o servidor completo com o laço a
 * 50 ms e observa a fonte: a API falsa conta os pedidos; o `gh` falso no PATH grava um arquivo quando roda. Sem tenant,
 * nenhum dos dois é chamado em 20 intervalos; com o tenant, os dois são (o controle positivo). O token é falso.
 */
const INTERVALO_MS = 50;
const TOKEN_FALSO = "ghp_FALSO_boot_0000_nuncaReal";

let api: Server;
let pedidosApi = 0;
let urlApi = "";
let dir = "";

beforeAll(async () => {
  api = createServer((_req, res) => {
    pedidosApi++;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }));
  });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  urlApi = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  dir = mkdtempSync(join(tmpdir(), "nod-421-boot-"));
  // Só o `gh pr list` do laço marca: o boot também consulta o gh por outros motivos (a sonda do conector GitHub).
  writeFileSync(join(dir, "gh"), `#!/bin/sh\nif [ "$1 $2" = "pr list" ]; then touch "${dir}/rodou"; echo '[]'; exit 0; fi\nexit 1\n`);
  chmodSync(join(dir, "gh"), 0o755);
});
afterAll(async () => {
  await new Promise<void>((r) => api.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

/** Sobe o servidor com o env, espera `esperaMs` e devolve as linhas de log e o servidor já fechado e limpo. */
async function subir(env: Record<string, string | undefined>, esperaMs: number, ate?: () => boolean): Promise<string[]> {
  const linhas: string[] = [];
  definirDestinoDoLog((l) => linhas.push(l));
  try {
    const srv = await servidorCompleto({ env: { NOD_QUADRO_GITHUB_REPOS: "gamefik/nod", NOD_QUADRO_GITHUB_TENANTS: "", NOD_QUADRO_GITHUB_TOKEN: "", GH_TOKEN: "", ...env }, intervalos: { prsDoQuadroMs: INTERVALO_MS } });
    try {
      if (ate) await srv.esperar(async () => ate(), { nome: "a fonte dos PRs foi chamada", timeoutMs: esperaMs });
      else await new Promise((r) => setTimeout(r, esperaMs)); // a janela em que o laço, se tivesse subido, bateria ~20 vezes
    } finally {
      await srv.fechar();
      await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [], conversas: [] });
      await srv.desligar();
    }
  } finally {
    definirDestinoDoLog(null);
  }
  return linhas;
}

const eventos = (linhas: string[]) => linhas.map((l) => (JSON.parse(l) as { evento?: string }).evento ?? "");

describeIntegracao("PRs do quadro no boot (NOD-421, ADR-145)", () => {
  it("token do servidor com a lista vazia: o laço não sobe e a API não é chamada; o token não vai ao log", async () => {
    pedidosApi = 0;
    const linhas = await subir({ NOD_QUADRO_GITHUB_TOKEN: TOKEN_FALSO, NOD_QUADRO_GITHUB_API: urlApi }, 20 * INTERVALO_MS);
    expect(pedidosApi).toBe(0);
    expect(eventos(linhas)).toContain("prs_do_quadro_sem_tenants");
    expect(eventos(linhas)).not.toContain("prs_do_quadro_ligado");
    expect(linhas.join("\n")).not.toContain(TOKEN_FALSO);
  }, 60_000);

  it("gh sem lista no modo compartilhado: o laço não sobe e o gh não roda; GH_TOKEN no ambiente também obedece à lista", async () => {
    const PATH = `${dir}:${process.env.PATH ?? ""}`;
    rmSync(join(dir, "rodou"), { force: true });
    const l1 = await subir({ NOD_MODO: "compartilhado", PATH }, 20 * INTERVALO_MS);
    expect(existsSync(join(dir, "rodou"))).toBe(false);
    expect(eventos(l1)).toContain("prs_do_quadro_sem_tenants");
    // Modo pessoal com GH_TOKEN: é token do servidor, sem lista também não sobe.
    const l2 = await subir({ PATH, GH_TOKEN: TOKEN_FALSO }, 20 * INTERVALO_MS);
    expect(existsSync(join(dir, "rodou"))).toBe(false);
    expect(eventos(l2)).toContain("prs_do_quadro_sem_tenants");
    expect(l2.join("\n")).not.toContain(TOKEN_FALSO);
  }, 60_000);

  it("controle: com o tenant na lista, o mesmo boot sobe o laço e chama a API e o gh", async () => {
    pedidosApi = 0;
    const l1 = await subir({ NOD_QUADRO_GITHUB_TOKEN: TOKEN_FALSO, NOD_QUADRO_GITHUB_API: urlApi, NOD_QUADRO_GITHUB_TENANTS: TENANT_PADRAO }, 20_000, () => pedidosApi > 0);
    expect(eventos(l1)).toContain("prs_do_quadro_ligado");
    expect(l1.join("\n")).not.toContain(TOKEN_FALSO);
    rmSync(join(dir, "rodou"), { force: true });
    await subir({ PATH: `${dir}:${process.env.PATH ?? ""}`, NOD_QUADRO_GITHUB_TENANTS: TENANT_PADRAO }, 20_000, () => existsSync(join(dir, "rodou")));
  }, 60_000);

  it("3ª revisão do PR #621: modo compartilhado sem token, com o tenant na lista, não roda o gh; o log diz sem_login uma vez", async () => {
    rmSync(join(dir, "rodou"), { force: true });
    const falhas = (linhas: string[]) => linhas.filter((l) => l.includes("prs_do_quadro_leitura_falhou"));
    const linhas = await subir({ NOD_MODO: "compartilhado", PATH: `${dir}:${process.env.PATH ?? ""}`, NOD_QUADRO_GITHUB_TENANTS: TENANT_PADRAO }, 20 * INTERVALO_MS);
    expect(existsSync(join(dir, "rodou"))).toBe(false);
    expect(linhas.map((l) => JSON.parse(l) as { evento?: string; jeito?: string }).find((l) => l.evento === "prs_do_quadro_ligado")?.jeito).toBe("nenhum");
    expect(falhas(linhas).map((l) => (JSON.parse(l) as { codigo: string }).codigo)).toEqual(["sem_login"]);
  }, 60_000);
});
