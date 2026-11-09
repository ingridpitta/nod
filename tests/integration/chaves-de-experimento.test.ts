import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Inventario } from "../../src/contracts/inventario.ts";
import { QUADROS_PARA_TODOS } from "../../src/domain/flag-quadros.ts";
import { LINHA_CALIBRACAO } from "../../src/domain/prompt-sistema.ts";
import { configurarLiberacaoQuadros, preferenciasRepo } from "../../src/repositories/raio-x.repo.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { autoriaPessoa } from "../../src/use-cases/autoria-evento.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { gravarPreferencias } from "../../src/use-cases/raio-x.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-111 (0088) no Postgres: as chaves de experimento da pessoa mudam o plano do turno seguinte — a Calibração põe a
 * linha no prompt; a Memória longa, sem sessão retomada, leva a fala inteira (até 8 mil) e o anexo de antes — e o Raio-X
 * grava o que valeu. Desligadas, o plano sai como antes.
 */
const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto: Inventario = { estado: "pronto", versao: "teste", em: Date.now() };
const LONGA = `${"a".repeat(4000)} FIM-DA-TABELA`;

describeIntegracao("chaves de experimento (ADR-111)", () => {
  async function montar(trx: Parameters<Parameters<typeof withRollback>[1]>[0], nome?: string) {
    const base = await agenteComConversa(trx, escopo, nome ? { nome } : {});
    const agora = () => Date.now();
    const deps = depsSobre(base.repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
    const fala = (await base.repos.mensagens.criar({ conversaId: base.conversaId, autoria: autoriaPessoa(escopo), kind: "texto", texto: "segue o playbook", confianca: "confiavel" }))!;
    const anexo = (await base.repos.anexos.criar({ conversaId: base.conversaId, nome: "playbook.md", mime: "text/markdown", conteudo: new TextEncoder().encode("# playbook") }))!;
    await base.repos.anexos.prender([anexo.id], { conversaId: base.conversaId, mensagemId: fala.id });
    await base.repos.mensagens.criar({ conversaId: base.conversaId, autoria: autoriaPessoa(escopo), kind: "texto", texto: LONGA, confianca: "confiavel" });
    const turno = (await base.repos.turnos.enfileirar({ executor: "local", agenteId: base.agenteId, conversaId: base.conversaId, origem: "conversa", prazoEm: agora() + 60_000, profundidade: 0, entradaTexto: "e aí?", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" }))!;
    const plano = async () => (await emitirPlanoTurno(deps, { turnoId: turno.id, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } })).data;
    return { ...base, deps, anexo, turno, plano };
  }

  it("a preferência: cada chave muda sozinha, nasce desligada e recusa o que não é booleano", async () => {
    await withRollback(escopo, async (trx) => {
      const m = await montar(trx);
      expect((await m.repos.preferencias.buscar()).experimentos).toEqual({ calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false });
      expect((await gravarPreferencias(m.deps, { experimentos: { calibracao: true } })).data.experimentos).toEqual({ calibracao: true, memoriaLonga: false, whatsapp: false, quadro: false });
      const ambas = (await gravarPreferencias(m.deps, { experimentos: { memoriaLonga: true } })).data;
      expect(ambas.experimentos).toEqual({ calibracao: true, memoriaLonga: true, whatsapp: false, quadro: false });
      expect(ambas.modoDev).toBe(false);
      // NOD-429 (0130): o Quadro liga e desliga sozinho, sem mexer nas outras chaves.
      expect((await gravarPreferencias(m.deps, { experimentos: { quadro: true } })).data.experimentos).toEqual({ calibracao: true, memoriaLonga: true, whatsapp: false, quadro: true });
      expect((await m.repos.preferencias.buscar()).experimentos?.quadro).toBe(true);
      expect((await gravarPreferencias(m.deps, { experimentos: { calibracao: false } })).data.experimentos?.quadro).toBe(true);
      expect((await gravarPreferencias(m.deps, { experimentos: { quadro: false } })).data.experimentos).toEqual({ calibracao: false, memoriaLonga: true, whatsapp: false, quadro: false });
      for (const ruim of [{}, [], { calibracao: "sim" }, { quadro: 1 }, { outra: true }, null]) {
        await expect(gravarPreferencias(m.deps, { experimentos: ruim })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      }
    });
  });

  it("desligadas: o plano sai como antes — sem a linha, fala cortada em 1 mil, sem o anexo de antes", async () => {
    await withRollback(escopo, async (trx) => {
      const m = await montar(trx);
      const p = await m.plano();
      expect(p.entrada.sessaoCli).toBeNull();
      expect(p.promptSistema).not.toContain("Calibração:");
      expect(p.promptSistema).toContain("a".repeat(1000));
      expect(p.promptSistema).not.toContain("FIM-DA-TABELA");
      expect(p.entrada.anexos).toBeUndefined();
      expect((await m.repos.raioX.doTurno(m.turno.id))?.composicao?.experimentos).toEqual({ calibracao: false, memoriaLonga: false, whatsapp: false, anexosAnteriores: 0 });
    });
  });

  it("NOD-429/NOD-442/NOD-445: o Quadro ligado só acrescenta gerir_quadro e gerir_apps ao catálogo — o resto do prompt sai igual e o Raio-X não o grava", async () => {
    const prompt = async (quadro: boolean) => withRollback(escopo, async (trx) => {
      // Nome fixo: o padrão da fábrica leva 8 caracteres do id, e o prompt começa com o nome do bot.
      const m = await montar(trx, "Bot do quadro");
      if (quadro) await m.repos.preferencias.gravar({ experimentos: { quadro: true } });
      const p = await m.plano();
      const composicao = (await m.repos.raioX.doTurno(m.turno.id))?.composicao?.experimentos;
      return { texto: p.promptSistema.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>"), composicao };
    });
    const [desligado, ligado] = [await prompt(false), await prompt(true)];
    // NOD-442 (ADR-135): com o experimento ligado, qualquer bot mexe no quadro pelo chat; desligado, a ferramenta some.
    // NOD-445 (ADR-146): as páginas do bot vêm no mesmo experimento, com gerir_apps.
    expect(desligado.texto).not.toContain("mcp__nod__gerir_quadro");
    expect(desligado.texto).not.toContain("mcp__nod__gerir_apps");
    // NOD-462 (ADR-142): com gerir_quadro vem também a linha "Quadro:" (a passagem por coluna); fora ela, nada muda.
    expect(desligado.texto).not.toMatch(/^Quadro:/m);
    expect(ligado.texto).toMatch(/^Quadro: .*definir_passagem/m);
    // ADA-9 (ADR-146): com gerir_apps vem a linha "Tela inicial:" (a view padrão pelo chat); desligado, ela some.
    expect(desligado.texto).not.toMatch(/^Tela inicial:/m);
    expect(ligado.texto).toMatch(/^Tela inicial: .*gerir_apps ordenar \{pagina: "tarefas", posicao: 1\}/m);
    // ADA-232 (ADR-155): com gerir_quadro vem também a linha das 4 saídas do trabalho de tarefa; desligado, ela some.
    expect(desligado.texto).not.toMatch(/^Trabalho de tarefa do quadro termina/m);
    expect(ligado.texto).toMatch(/^Trabalho de tarefa do quadro termina sempre numa de 4 saídas/m);
    const semQuadro = ligado.texto
      .split("\n")
      .filter((l) => !l.startsWith("Quadro:") && !l.startsWith("Tela inicial:") && !l.startsWith("Trabalho de tarefa do quadro termina"))
      .join("\n");
    expect(semQuadro.replace(" mcp__nod__gerir_apps,", "").replace(" mcp__nod__gerir_quadro,", "")).toBe(desligado.texto);
    expect(ligado.composicao).toEqual({ calibracao: false, memoriaLonga: false, whatsapp: false, anexosAnteriores: 0 });
  });

  describe("NOD-415 (ADR-141): a flag NOD_QUADROS", () => {
    afterEach(() => configurarLiberacaoQuadros(QUADROS_PARA_TODOS));

    /** O que a pessoa enxerga do quadro com a liberação dada: a chave, a ferramenta no plano e o lote. */
    async function oQueVe(liberacao: Parameters<typeof configurarLiberacaoQuadros>[0]) {
      return withRollback(escopo, async (trx) => {
        const m = await montar(trx, "Bot do quadro");
        // A chave ligada ANTES (como quem ligou quando era para todos): a flag tem de valer mesmo assim.
        configurarLiberacaoQuadros(QUADROS_PARA_TODOS);
        await m.repos.preferencias.gravar({ experimentos: { quadro: true } });
        configurarLiberacaoQuadros(liberacao);
        // Repo novo: a liberação é lida uma vez por repo (um por transação, como no servidor).
        const deps = { ...m.deps, repos: { ...m.deps.repos, preferencias: preferenciasRepo(trx, escopo) } };
        const prefs = (await gravarPreferencias(deps, { experimentos: { quadro: true } })).data;
        const plano = (await emitirPlanoTurno(deps, { turnoId: m.turno.id, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } })).data;
        const r = (await aplicarLoteQuadro(deps, { anfitriaoId: m.agenteId, ops: [{ tipo: "criar_quadro", meta: "Lançar" }], autor: { tipo: "pessoa" }, executor: "local" })).data;
        const lote = r.ok ? "ok" : r.erro;
        return { liberado: prefs.quadroLiberado, chave: prefs.experimentos?.quadro, ferramenta: plano.promptSistema.includes("mcp__nod__gerir_quadro"), lote };
      });
    }

    it("em admins, quem não é admin não vê a chave, a ferramenta nem consegue criar quadro", async () => {
      expect(await oQueVe({ modo: "admins", admins: ["outra@pessoa.com"] })).toMatchObject({ liberado: false, chave: false, ferramenta: false, lote: "experimento_desligado" });
    });

    it("em admins, o admin por id vê tudo", async () => {
      expect(await oQueVe({ modo: "admins", admins: [escopo.pessoaId] })).toMatchObject({ liberado: true, chave: true, ferramenta: true, lote: "ok" });
    });

    it("desligado fecha para todos; todos abre para todos", async () => {
      expect(await oQueVe({ modo: "desligado", admins: [escopo.pessoaId] })).toMatchObject({ liberado: false, chave: false, ferramenta: false, lote: "experimento_desligado" });
      expect(await oQueVe(QUADROS_PARA_TODOS)).toMatchObject({ liberado: true, chave: true, ferramenta: true, lote: "ok" });
    });
  });

  it("ligadas: a linha da Calibração entra, a fala vai inteira e o anexo anterior volta marcado; o Raio-X grava", async () => {
    await withRollback(escopo, async (trx) => {
      const m = await montar(trx);
      await m.repos.preferencias.gravar({ experimentos: { calibracao: true, memoriaLonga: true } });
      const p = await m.plano();
      expect(p.promptSistema).toContain(LINHA_CALIBRACAO);
      expect(p.promptSistema).toContain("FIM-DA-TABELA");
      expect(p.entrada.anexos).toEqual([{ id: m.anexo.id, nome: "playbook.md", mime: "text/markdown", tamanho: 10, anterior: true }]);
      expect((await m.repos.raioX.doTurno(m.turno.id))?.composicao?.experimentos).toEqual({ calibracao: true, memoriaLonga: true, whatsapp: false, anexosAnteriores: 1 });
    });
  });

  it("com sessão retomada, a Memória longa não traz nada: o modelo já viu o arquivo na sessão", async () => {
    await withRollback(escopo, async (trx) => {
      const m = await montar(trx);
      await m.repos.preferencias.gravar({ experimentos: { memoriaLonga: true } });
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, randomUUID(), "local", "claude-cli");
      const p = await m.plano();
      expect(p.entrada.sessaoCli).not.toBeNull();
      expect(p.entrada.anexos).toBeUndefined();
      expect((await m.repos.raioX.doTurno(m.turno.id))?.composicao?.experimentos).toMatchObject({ memoriaLonga: true, anexosAnteriores: 0 });
    });
  });
});
