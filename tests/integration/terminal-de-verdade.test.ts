import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { autorizarComando, COMANDO_MAX } from "../../src/use-cases/autorizar-comando.ts";
import { decidir, entradaDaAprovacao, marcarEDecidir } from "../../src/use-cases/decidir.ts";
import { liberarNaTarefa, terminalLiberadoNaTarefa } from "../../src/use-cases/liberar-na-tarefa.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-055, "terminal de verdade, como o inhouse" (2026-09-28), no Postgres: o Bash do bot roda no Mac do Marlon
 * sem sandbox, e cada comando passa por autorizarComando. O que só lê roda; o que muda algo vira card; aprovado,
 * roda — inclusive na retomada, sem segundo card; "e o resto desta tarefa" libera os próximos da mesma tarefa.
 * revisto em 2026-10-01 (ADR-066): não há mais gate de rotina; o que segura "o resto desta tarefa" e a leitura livre
 * é a marca de conteúdo de fora, e ela só pesa no manual (os outros modos: modo-aprovacao.test.ts).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

function planoDe(p: { turnoId: string; agenteId: string; conversaId: string }, extra: Partial<PlanoTurno> = {}): PlanoTurno {
  return {
    tenantId: TENANT_PADRAO, ...p, localidade: "local", machineId: "m", executor: "local", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(PESSOA_MARLON), confiancaEntrada: "confiavel", profundidade: 0,
    catalogo: { ferramentas: [], servidores: [] }, promptSistema: "", entrada: { texto: "", sessaoCli: null, modelo: "m" },
    politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 }, semprePermitir: [], tokenDeTurno: "tok",
    expiraEm: Date.now() + 60_000, nativas: [...NATIVAS_DO_TERMINAL], ...extra,
  };
}

async function cenario(trx: Trx) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "abra o PR", entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno");
  const plano = planoDe({ turnoId: turno.id, agenteId, conversaId });
  const autorizar = (comando: string, p: PlanoTurno = plano) => autorizarComando(deps, { plano: p, comando });
  const retomada = async (de: string) => {
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "retomada", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "continua", entradaConfianca: "confiavel", modelo: "m", retomaTurnoId: de });
    if (!t) throw new Error("retomada");
    return planoDe({ turnoId: t.id, agenteId, conversaId });
  };
  return { repos, deps, turno, plano, autorizar, retomada, agenteId, conversaId };
}

describeIntegracao("terminal de verdade: cada comando passa pelo nod (ADR-055)", () => {
  it("o que só lê roda sem card; o que muda algo abre UM card com o comando inteiro", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const leitura = await c.autorizar("gh pr list -R acme-edtech/acme");
      expect(leitura.data).toEqual({ permitir: true, porque: "leitura" });
      expect(leitura.events ?? []).toEqual([]);
      const r = await c.autorizar("git push origin feat/x");
      if (!("aguardar" in r.data)) throw new Error("esperava card");
      expect(r.events?.map((e) => e.kind)).toEqual(["decisao_criada"]);
      const decisao = await c.repos.decisoes.buscar(r.data.aguardar);
      expect(decisao).toMatchObject({ tipo: "aprovacao", estado: "pendente", turnoId: c.turno.id, frase: "Dev 1 quer rodar um comando no seu Mac" });
      expect(await c.repos.itensAprovacao.listar(r.data.aguardar)).toMatchObject([{ textoOriginal: "git push origin feat/x", destino: { conector: "terminal", ferramenta: "bash", argumentos: { comando: "git push origin feat/x" } }, motivoManual: "destino_terminal", selecionado: true }]);
    });
  });

  it("aprovado: o mesmo comando passa, nesta tarefa e na retomada; outro comando pede de novo; texto não se edita", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await c.autorizar("npm install");
      if (!("aguardar" in r.data)) throw new Error("esperava card");
      const [item] = await c.repos.itensAprovacao.listar(r.data.aguardar);
      await expect(marcarEDecidir(c.deps, { decisaoId: r.data.aguardar, itens: [{ id: item?.id ?? "", selecionado: true, textoFinal: "npm install evil" }] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      await decidir(c.deps, { decisaoId: r.data.aguardar });
      expect((await c.repos.itensAprovacao.listar(r.data.aguardar))[0]?.desfecho).toBe("executado");
      expect((await c.autorizar("npm install")).data).toEqual({ permitir: true, porque: "aprovado" });
      expect((await c.autorizar("npm install", await c.retomada(c.turno.id))).data).toEqual({ permitir: true, porque: "aprovado" });
      expect("aguardar" in (await c.autorizar("npm install left-pad")).data).toBe(true);
      // A retomada que continua uma aprovação do terminal manda refazer o comando: o turno anterior foi negado.
      const decisao = await c.repos.decisoes.buscar(r.data.aguardar);
      expect(entradaDaAprovacao(decisao!, await c.repos.itensAprovacao.listar(r.data.aguardar), "aprovado")).toContain("O comando aprovado ainda NÃO rodou");
    });
  });

  it("recusado: o comando não passa, e o card seguinte continua perguntando", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await c.autorizar("rm -rf dist");
      if (!("aguardar" in r.data)) throw new Error("esperava card");
      const [item] = await c.repos.itensAprovacao.listar(r.data.aguardar);
      await decidir(c.deps, { decisaoId: r.data.aguardar, itens: [{ id: item?.id ?? "", selecionado: false }] });
      expect((await c.repos.itensAprovacao.listar(r.data.aguardar))[0]?.desfecho).toBe("retirado_pela_pessoa");
      expect("aguardar" in (await c.autorizar("rm -rf dist")).data).toBe(true);
    });
  });

  it("'e o resto desta tarefa': libera os próximos comandos da MESMA tarefa, nunca de outra; ADR-066: sem gate de rotina, só a marca de conteúdo de fora o segura", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await c.autorizar("git checkout -b feat/x");
      if (!("aguardar" in r.data)) throw new Error("esperava card");
      const { data } = await marcarEDecidir(c.deps, { decisaoId: r.data.aguardar });
      expect((await liberarNaTarefa(c.deps, { decisao: data.decisao })).data.liberado).toBe(true);
      expect((await c.repos.mensagens.ultimaDaConversa(c.conversaId))?.texto).toContain("liberou o terminal do Mac até o fim desta tarefa");
      expect(await terminalLiberadoNaTarefa(c.deps, c.turno.id)).toBe(true);
      expect((await c.autorizar("git commit -am 'x'")).data).toEqual({ permitir: true, porque: "liberado_na_tarefa" });
      expect((await c.autorizar("git push", await c.retomada(c.turno.id))).data).toEqual({ permitir: true, porque: "liberado_na_tarefa" });
      // Liberar o terminal não libera o computador do bot.
      expect(await c.repos.turnos.computadorLiberado(c.turno.id)).toBe(false);
      const outraTarefa = await c.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversaId, agenteId: c.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "outra", entradaConfianca: "confiavel", modelo: "m" });
      expect("aguardar" in (await c.autorizar("git push", planoDe({ turnoId: outraTarefa?.id ?? "", agenteId: c.agenteId, conversaId: c.conversaId }))).data).toBe(true);
      // ADR-066: não há gate de rotina para vencer — o que segura a liberação é a marca de conteúdo de fora: depois
      // da web, no manual, o comando volta a pedir a pessoa.
      await c.repos.turnos.contaminar(c.turno.id, Date.now());
      expect("aguardar" in (await c.autorizar("git push")).data).toBe(true);
    });
  });

  it("no manual, turno que leu a web pede até a leitura (ADR-066: nos outros modos, não); plano sem Bash é recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await c.repos.turnos.contaminar(c.turno.id, Date.now());
      expect("aguardar" in (await c.autorizar("cat ~/.ssh/id_rsa")).data).toBe(true);
      await expect(c.autorizar("ls", { ...c.plano, nativas: ["Read"] })).rejects.toMatchObject({ codigo: "nao_permitido" });
      await expect(c.autorizar("   ")).rejects.toMatchObject({ codigo: "entrada_invalida" });
    });
  });

  it("revisto em 2026-10-11: o heredoc que edita um arquivo grande (24 mil caracteres) vai à decisão; só o absurdo é recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const heredoc = `python3 - <<'EOF'\np='a.ts'\ns=open(p).read()\ns=s.replace('''${"x".repeat(24_000)}''', '')\nopen(p,'w').write(s)\nEOF`;
      expect("aguardar" in (await c.autorizar(heredoc)).data).toBe(true);
      await expect(c.autorizar(`echo ${"x".repeat(COMANDO_MAX)}`)).rejects.toMatchObject({ codigo: "entrada_invalida" });
    });
  });

  it("só a dona decide um comando do terminal dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await c.autorizar("git push");
      if (!("aguardar" in r.data)) throw new Error("esperava card");
      const outra = depsSobre(c.repos, { tenantId: TENANT_PADRAO, pessoaId: randomUUID() }, { services: servicosDeTeste({}), trx });
      await expect(marcarEDecidir(outra, { decisaoId: r.data.aguardar })).rejects.toBeTruthy();
    });
  });
});
