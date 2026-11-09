import { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { Socket } from "node:net";
import { expect, it } from "vitest";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { AnuncioMaquina } from "../../src/contracts/ponte.ts";
import { VERSAO_MINIMA_APP, type PonteInternaNod } from "../../src/adapters/fundo/ponte-interna.ts";
import { criarPonteHttpServidor } from "../../src/adapters/http/rotas/ponte.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: 0 } as const;
const semLogin = { estado: "nao_autenticado", motivo: "entre", em: 0 } as const;
const turnoId = "00000000-0000-4000-8000-0000000001aa";

/**
 * NOD-199: o anúncio só de inventário grava o inventário no Postgres como o conectar grava (o `persistir` do compor), sem
 * tocar no turno que a máquina está rodando.
 */
type Repos = Awaited<ReturnType<typeof agenteComConversa>>["repos"];

/** A ponte HTTP do servidor sobre o Postgres de verdade: o `persistir` grava o inventário como o do compor. */
function montar(repos: Repos) {
  const entregues: string[] = [];
  const maquinas = new Map<string, AnuncioMaquina>();
  const ponte: PonteInternaNod = {
    conectar: async (m) => { maquinas.set(m.machineId, m); }, puxar: async () => ({ turnoId } as PlanoTurno), renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }),
    entregar: async (e) => { entregues.push(e.turnoId); }, desconectar: async () => undefined, maquinasConectadas: () => [...maquinas.values()], escopoDoTurno: () => null,
  };
  const p = criarPonteHttpServidor({
    criar: () => ponte, persistir: async (_e, inv) => { await repos.inventario.registrar("claude-cli", inv); }, autorizar: async () => ({ ...escopo, chaveId: "m1" }),
    segredo: "s", seguro: false, agora: () => Date.now(), delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: 2_000, repetirBarrados: async () => undefined,
  });
  const chamar = async (nome: string, corpo: unknown, o: { escopo?: typeof escopo; versao?: string } = {}) => {
    const req = new IncomingMessage(new Socket());
    req.headers = { authorization: "Bearer k", "x-nod-versao": o.versao ?? VERSAO_MINIMA_APP };
    let r: { status: number; body: unknown } | null = null;
    await p.rotas.find((x) => x.padrao.test(`/${nome}`))!.handler({ req, res: new ServerResponse(req), escopo: o.escopo ?? escopo, params: { chaveId: "m1" }, corpo: async () => corpo, json: (status, body) => { r = { status, body }; } });
    return r!;
  };
  return { p, chamar, maquinas, entregues };
}

describeIntegracao("NOD-199: anúncio de inventário persiste no banco", () => {
  it("com um turno rodando, o inventário novo chega ao banco e ao catálogo da pessoa; o turno entrega", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos } = await agenteComConversa(trx, escopo);
      const { p, chamar, entregues } = montar(repos);
      // O cenário da issue: o Claude pronto roda um turno; o Codex está sem login.
      await chamar("conectar", { versaoContrato: 1, nome: "Mac", inventario: pronto, harnesses: { "claude-cli": pronto, "codex-cli": semLogin } });
      expect(await repos.inventario.buscar("claude-cli")).toMatchObject({ estado: "pronto", versao: "teste" });
      expect((await chamar("puxar", {})).body).toEqual({ plano: { turnoId } });
      // A pessoa entra no Codex (e o CLI do Claude foi atualizado): o anúncio só de inventário chega com o turno rodando.
      const prontoNovo = { ...pronto, versao: "teste-2" };
      expect(await chamar("inventario", { versaoContrato: 1, inventario: prontoNovo, harnesses: { "claude-cli": prontoNovo, "codex-cli": pronto } })).toEqual({ status: 200, body: { ok: true } });
      expect(await repos.inventario.buscar("claude-cli")).toMatchObject({ estado: "pronto", versao: "teste-2" });
      expect(p.harnessesDaPessoa(escopo.pessoaId)).toMatchObject({ "claude-cli": { estado: "pronto" }, "codex-cli": { estado: "pronto" } });
      const resultado = { desfecho: "sucesso", texto: "ok", sessaoCli: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
      expect((await chamar("entregar", { turnoId, machineId: "m1", seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado })).status).toBe(200);
      expect(entregues).toEqual([turnoId]);
    });
  });

  // #313: o app rc.10/rc.11 manda em `inventario` o estado do Claude (sempre instalado). Quem só tinha o ChatGPT logado
  // ficava com o envio negado ("motor_ausente") e a máquina sem puxar turno. O servidor deriva o estado dos harnesses.
  it("#313: só o Codex pronto (com o `inventario` do Claude sem login): a máquina fica pronta, no banco e no puxar", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos } = await agenteComConversa(trx, escopo);
      const { chamar, maquinas } = montar(repos);
      const codex = { estado: "pronto", versao: "0.162.0", em: 0 } as const;
      await chamar("conectar", { versaoContrato: 1, nome: "gamefik-codex-dev", plataforma: "linux", inventario: semLogin, harnesses: { "claude-cli": semLogin, "codex-cli": semLogin } });
      expect((await repos.inventario.buscar("claude-cli"))?.estado).toBe("nao_autenticado");
      expect((await chamar("puxar", {})).body).toEqual({ plano: null });
      // O login do ChatGPT pela tela termina: o anúncio só de inventário chega com o Codex pronto e o Claude ainda sem login.
      await chamar("inventario", { versaoContrato: 1, inventario: semLogin, harnesses: { "claude-cli": semLogin, "codex-cli": codex } });
      expect(await repos.inventario.buscar("claude-cli")).toMatchObject({ estado: "pronto", versao: "0.162.0" });
      expect(maquinas.get("m1")?.inventario).toMatchObject({ estado: "pronto" });
      expect(maquinas.get("m1")?.harnesses).toMatchObject({ "claude-cli": { estado: "nao_autenticado" }, "codex-cli": { estado: "pronto" } });
      expect((await chamar("puxar", {})).body).toEqual({ plano: { turnoId } });
    });
  });

  it("sem conexão: estado_invalido (409 → reconectar); chave de outra pessoa: recusa; app antigo: 426 — e nada chega ao banco", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos } = await agenteComConversa(trx, escopo);
      const { chamar } = montar(repos);
      const anuncio = { versaoContrato: 1, inventario: pronto, harnesses: { "claude-cli": pronto, "codex-cli": pronto } };
      await expect(chamar("inventario", anuncio)).rejects.toThrow("estado_invalido");
      await chamar("conectar", { versaoContrato: 1, nome: "Mac", inventario: semLogin, harnesses: { "claude-cli": semLogin } });
      await expect(chamar("inventario", anuncio, { escopo: { ...escopo, pessoaId: "00000000-0000-4000-8000-0000000001ff" } })).rejects.toThrow("estado_invalido");
      expect(await chamar("inventario", anuncio, { versao: "0.0.1" })).toEqual({ status: 426, body: { codigo: "atualize_app", versaoMinimaApp: VERSAO_MINIMA_APP } });
      expect((await repos.inventario.buscar("claude-cli"))?.estado).toBe("nao_autenticado");
    });
  });

  it.each(["conectar", "inventario"])("pela rota %s, harness não integrado, semLacoDeVoz de IA não pronta e campos extras ficam de fora", async (rota) => {
    await withRollback(escopo, async (trx) => {
      const { repos } = await agenteComConversa(trx, escopo);
      const { p, chamar, maquinas } = montar(repos);
      await chamar("conectar", { versaoContrato: 1, nome: "Mac", inventario: semLogin });
      await chamar(rota, { versaoContrato: 1, nome: "Mac", inventario: pronto, harnesses: { "claude-cli": pronto, "codex-cli": semLogin, hermes: pronto }, semLacoDeVoz: ["codex-cli", "claude-cli", "hermes"], extra: "ignorado", planos: [] });
      const m = maquinas.get("m1")!;
      expect(Object.keys(m.harnesses ?? {}).sort()).toEqual(["claude-cli", "codex-cli"]);
      expect(m.semLacoDeVoz).toEqual(["claude-cli"]);
      expect(m).not.toHaveProperty("extra");
      expect(m).not.toHaveProperty("planos");
      expect(Object.keys(p.harnessesDaPessoa(escopo.pessoaId)).sort()).toEqual(["claude-cli", "codex-cli"]);
      expect((await repos.inventario.buscar("claude-cli"))?.estado).toBe("pronto");
    });
  });
});

describeIntegracao("ADA-11 (ADR-147): a plataforma win32 na ponte e no banco", () => {
  it("conectar com win32 entra; plataforma desconhecida é recusada (não vira Mac); ausente segue Mac", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos } = await agenteComConversa(trx, escopo);
      const { chamar, maquinas } = montar(repos);
      const anuncio = { versaoContrato: 1, nome: "PC da Bia", inventario: pronto, harnesses: { "claude-cli": pronto, "codex-cli": pronto } };
      await expect(chamar("conectar", { ...anuncio, plataforma: "freebsd" })).rejects.toThrow("entrada_invalida");
      expect(maquinas.size).toBe(0);
      expect((await chamar("conectar", { ...anuncio, plataforma: "win32" })).status).toBe(200);
      expect(maquinas.get("m1")).toBeDefined();
    });
  });

  it("0149: a chave grava win32 e o CHECK segue recusando valor fora da lista", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos } = await agenteComConversa(trx, escopo);
      const c = await repos.maquinaTokens.criar({ nome: "PC da Bia", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
      if (!c) throw new Error("chave");
      await repos.maquinaTokens.registrarPlataforma(c.id, "win32");
      expect(await repos.maquinaTokens.identificar(c.id)).toMatchObject({ plataforma: "win32" });
      // Último comando do envelope: o erro aborta a transação, que o withRollback desfaz de qualquer jeito.
      await expect(trx`UPDATE maquina_tokens SET plataforma = 'freebsd' WHERE id = ${c.id}`).rejects.toThrow(/maquina_tokens_plataforma/);
    });
  });
});
