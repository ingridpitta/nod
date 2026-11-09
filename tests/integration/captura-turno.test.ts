import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { Entrega } from "../../src/contracts/ponte.ts";
import { TAMANHO_MAX_ANEXO } from "../../src/contracts/anexo.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarCapturas } from "../../src/services/capturas.ts";
import type { Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { criarSala } from "../../src/use-cases/criar-sala.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { postarNaSala } from "../../src/use-cases/postar-na-sala.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { guardadorDeTelas } from "../helpers/guardador-de-telas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const SUCESSO: Entrega["resultado"] = { desfecho: "sucesso", texto: "feito", sessaoCli: null, sinais: SINAIS, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
const FALHA: Entrega["resultado"] = { ...SUCESSO, desfecho: "falha", motivoFalha: "erro_execucao" };
const tela = (n: number) => new Uint8Array(Buffer.from(`\x89PNG tela ${n}`));

/** Os deps da L7 (repos reais na transação) com o serviço de capturas do guardador real. */
function comCapturas(trx: Tx, capturas: Deps["services"]["capturas"], agora?: () => number): { deps: Deps; repos: ReturnType<typeof criarRepos> } {
  const base = depsSobre(trx, MARLON, agora ? { agora } : {});
  return { deps: { ...base.deps, services: { ...base.deps.services, capturas } }, repos: base.repos };
}

async function turnoDeConversa(trx: Tx, origem: "conversa" | "rotina" = "conversa", texto = "olhe a tela") {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Eng" });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: texto, entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno não criado");
  return { agenteId, conversaId, turnoId: turno.id };
}

const assentar = (deps: Deps, turnoId: string, p: { texto?: string; resultado?: Entrega["resultado"]; machineId?: string } = {}) =>
  assentarTurno(deps, { turnoId, machineId: p.machineId ?? randomUUID(), seqLocal: 1, fala: { tipo: "texto", texto: p.texto ?? "Pronto, a tela mostra o painel." }, resultado: p.resultado ?? SUCESSO, executor: "catcher" });

async function anexosDaConversa(trx: Tx, conversaId: string) {
  return trx<{ id: string; nome: string; mime: string; mensagem_id: string | null; conteudo: Buffer }[]>`select id, nome, mime, mensagem_id, conteudo from anexos where conversa_id = ${conversaId}`;
}

function logsDe(evento: string): { linhas: Record<string, unknown>[] } {
  const saida = { linhas: [] as Record<string, unknown>[] };
  vi.spyOn(console, "log").mockImplementation((x: unknown) => {
    const linha = JSON.parse(String(x)) as Record<string, unknown>;
    if (linha.evento === evento) saida.linhas.push(linha);
  });
  return saida;
}

afterEach(() => { vi.restoreAllMocks(); });

/**
 * NOD-200: a última tela que o bot viu no turno vira anexo png da fala dele, atrás de NOD_CAPTURA_NO_TRANSCRIPT. O
 * assentar só lê a captura; só a fala de texto do bot (fora de sala, não silenciada, não tardia) a recebe. Quem a
 * esquece é a ponte, depois do assentar confirmado (tests/concurrency/trabalhos-revisao-ponte.test.ts).
 */
describeIntegracao("captura de tela no transcript (NOD-200)", () => {
  it("3 observações → 1 anexo png com os bytes da 3ª, preso à fala e visível na conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const { conversaId, turnoId } = await turnoDeConversa(trx);
      for (const n of [1, 2, 3]) await g.observar(turnoId, tela(n));
      const { deps } = comCapturas(trx, g.capturas);
      const r = await assentar(deps, turnoId);
      const anexos = await anexosDaConversa(trx, conversaId);
      expect(anexos).toHaveLength(1);
      expect(anexos[0]?.mime).toBe("image/png");
      expect(anexos[0]?.nome).toMatch(/^tela-\d{4}\.png$/);
      expect(anexos[0]?.mensagem_id).toBe(r.data.mensagem?.id);
      expect(Buffer.compare(anexos[0]!.conteudo, Buffer.from(tela(3)))).toBe(0);
      expect(r.events?.some((e) => e.kind === "mensagem_criada")).toBe(true);
      // A web mostra o anexo na fala do bot (lerConversa).
      const conversa = await lerConversa(deps, { conversaId });
      expect(conversa.data.mensagens.find((m) => m.id === r.data.mensagem?.id)?.anexos?.map((a) => a.id)).toEqual([anexos[0]?.id]);
    });
  });

  it("assentar repetido (impasse que volta a transação): a repetição acha a mesma captura e grava 1 anexo", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const { conversaId, turnoId } = await turnoDeConversa(trx);
      await g.observar(turnoId, tela(1));
      const { deps } = comCapturas(trx, g.capturas);
      // A 1ª tentativa assenta e a transação volta inteira (como o 40P01 na ponte), inclusive o registro da entrega.
      await trx.savepoint(async () => {
        await assentar(deps, turnoId);
        throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
      }).catch(() => {});
      expect(await anexosDaConversa(trx, conversaId)).toHaveLength(0);
      const r = await assentar(deps, turnoId);
      const anexos = await anexosDaConversa(trx, conversaId);
      expect(anexos.map((a) => a.mensagem_id)).toEqual([r.data.mensagem?.id]);
      expect(Buffer.compare(anexos[0]!.conteudo, Buffer.from(tela(1)))).toBe(0);
    });
  });

  it("turno parcial (interrompido) com fala grava a captura", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const { conversaId, turnoId } = await turnoDeConversa(trx);
      await g.observar(turnoId, tela(1));
      const r = await assentar(comCapturas(trx, g.capturas).deps, turnoId, { resultado: FALHA });
      expect(r.data.mensagem?.parcial).toBe(true);
      expect(await anexosDaConversa(trx, conversaId)).toHaveLength(1);
    });
  });

  it("entrega tardia sem sucesso (turno já interrompido): a fala entra parcial, sem anexo", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const { conversaId, turnoId } = await turnoDeConversa(trx);
      const { deps, repos } = comCapturas(trx, g.capturas);
      await g.observar(turnoId, tela(1));
      await repos.turnos.interromper(turnoId, "maquina_sem_contato");
      // Com sucesso e sem retomada, a tardia vira `concluido` (NOD-264, E8); sem sucesso segue parcial.
      const r = await assentar(deps, turnoId, { resultado: FALHA });
      expect(r.data).toMatchObject({ tardia: true, mensagem: { parcial: true } });
      expect(await anexosDaConversa(trx, conversaId)).toHaveLength(0);
    });
  });

  it("sem observação no turno: nenhum anexo", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const { conversaId, turnoId } = await turnoDeConversa(trx);
      const r = await assentar(comCapturas(trx, g.capturas).deps, turnoId);
      expect(r.data.mensagem).not.toBeNull();
      expect(await anexosDaConversa(trx, conversaId)).toHaveLength(0);
    });
  });

  it("silencioso (sem_novidade): nem mensagem nem anexo", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const { conversaId, turnoId } = await turnoDeConversa(trx, "rotina");
      const { deps, repos } = comCapturas(trx, g.capturas);
      await repos.turnos.marcarSemNovidade(turnoId, "nada_mudou");
      await g.observar(turnoId, tela(1));
      const r = await assentar(deps, turnoId);
      expect(r.data.mensagem).toBeNull();
      expect(await anexosDaConversa(trx, conversaId)).toHaveLength(0);
    });
  });

  it("rotina derrubada pela máquina: nem fala nem anexo", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Rotineiro" });
      const inicio = Date.now();
      const { deps, repos } = comCapturas(trx, g.capturas, () => inicio);
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "*/5 * * * *", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "slack", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: inicio });
      const machineId = randomUUID();
      const disparo = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: inicio, machineId, executor: "catcher" });
      if (!("turno" in disparo.data)) throw new Error("deveria disparar");
      const turnoId = disparo.data.turno.id;
      await repos.turnos.reivindicar({ machineId, agora: inicio });
      await g.observar(turnoId, tela(1));
      // A entrega chega com o lease vencido e sem Parar: maquina_sem_contato, e a rotina não escreve na conversa.
      const depois = comCapturas(trx, g.capturas, () => inicio + 24 * 60 * 60_000).deps;
      const r = await assentar(depois, turnoId, { resultado: FALHA, machineId });
      expect(r.data.mensagem).toBeNull();
      expect(await anexosDaConversa(trx, conversaId)).toHaveLength(0);
    });
  });

  it("sala: a fala vai por postarNaSala e não leva anexo", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const { deps } = comCapturas(trx, g.capturas);
      const s = await criarSala(deps, { nome: "revisão", agenteIds: [vera.agenteId, tuca.agenteId] });
      const post = await postarNaSala(deps, { salaId: s.data.sala.id, texto: "@Vera olha a tela" });
      const turnoId = post.data.turnos[0]?.id ?? "";
      await g.observar(turnoId, tela(1));
      const r = await assentar(deps, turnoId);
      expect(r.data.mensagem).not.toBeNull();
      expect(await anexosDaConversa(trx, s.data.conversa.id)).toHaveLength(0);
    });
  });

  it("/compactar não grava captura", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const { conversaId, turnoId } = await turnoDeConversa(trx, "conversa", "/compactar");
      await g.observar(turnoId, tela(1));
      const r = await assentar(comCapturas(trx, g.capturas).deps, turnoId);
      expect(r.data.mensagem?.kind).toBe("sistema");
      expect(await anexosDaConversa(trx, conversaId)).toHaveLength(0);
    });
  });

  it("tela vista com a pessoa no controle ou aguardando a pessoa nunca vira anexo", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const { conversaId, turnoId } = await turnoDeConversa(trx);
      await g.observar(turnoId, tela(1), "pessoa");
      await g.observar(turnoId, tela(2), "aguardando_pessoa");
      await assentar(comCapturas(trx, g.capturas).deps, turnoId);
      expect(await anexosDaConversa(trx, conversaId)).toHaveLength(0);
    });
  });

  it("falha em anexos.criar: a mensagem entra igual, o log sai sem bytes e a transação segue válida", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const { conversaId, turnoId } = await turnoDeConversa(trx);
      await g.observar(turnoId, tela(1));
      const { deps } = comCapturas(trx, g.capturas);
      // Falha de banco de verdade (divisão por zero): sem o savepoint, ela abortaria a transação inteira.
      const quebrado = { ...deps, repos: { ...deps.repos, anexos: { ...deps.repos.anexos, criar: async () => { await trx`select 1 / 0`; return null; } } } };
      const logs = logsDe("captura_turno_falhou");
      const r = await assentar(quebrado, turnoId);
      expect(r.data.mensagem?.texto).toBe("Pronto, a tela mostra o painel.");
      expect(r.events?.some((e) => e.kind === "mensagem_criada")).toBe(true);
      expect(logs.linhas).toEqual([expect.objectContaining({ nivel: "aviso", turno_id: turnoId, motivo: "22012" })]);
      expect(JSON.stringify(logs.linhas)).not.toContain(Buffer.from(tela(1)).toString("base64"));
      // A transação continua válida: lê e grava depois da falha.
      expect((await criarRepos(trx, MARLON).mensagens.listarDaConversa(conversaId)).map((m) => m.id)).toContain(r.data.mensagem?.id);
      expect(await anexosDaConversa(trx, conversaId)).toHaveLength(0);
    });
  });

  it("acima do teto de tamanho: não grava e registra no log", async () => {
    await withRollback(MARLON, async (trx) => {
      const { conversaId, turnoId } = await turnoDeConversa(trx);
      const grande = new Uint8Array(TAMANHO_MAX_ANEXO + 1);
      const logs = logsDe("captura_turno_falhou");
      const r = await assentar(comCapturas(trx, { ler: () => grande, esquecer: () => {} }).deps, turnoId);
      expect(r.data.mensagem).not.toBeNull();
      expect(logs.linhas).toEqual([expect.objectContaining({ turno_id: turnoId, motivo: "acima_do_teto" })]);
      expect(await anexosDaConversa(trx, conversaId)).toHaveLength(0);
    });
  });

  it("outro tenant/pessoa não lê a captura (RLS) e nod_poda a apaga com a conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const { conversaId, turnoId } = await turnoDeConversa(trx);
      await g.observar(turnoId, tela(1));
      await assentar(comCapturas(trx, g.capturas).deps, turnoId);
      const [anexo] = await anexosDaConversa(trx, conversaId);
      expect(anexo).toBeDefined();
      await vincularEscopo(trx, ANA);
      expect(await criarRepos(trx, ANA).anexos.conteudo(anexo!.id)).toBeNull();
      expect(await trx`select id from anexos where id = ${anexo!.id}`).toHaveLength(0);
      // Outro tenant, mesmo com o id de pessoa do dono: a RLS por tenant também esconde.
      const outroTenant = { tenantId: randomUUID(), pessoaId: PESSOA_MARLON };
      await vincularEscopo(trx, outroTenant);
      expect(await criarRepos(trx, outroTenant).anexos.conteudo(anexo!.id)).toBeNull();
      expect(await trx`select id from anexos where id = ${anexo!.id}`).toHaveLength(0);
      await vincularEscopo(trx, MARLON);
      // A poda (ADR-002) apaga a captura junto com a prosa da conversa: ela é uma linha comum de `anexos` da conversa,
      // que nod_poda pode ler e apagar (o teste roda como nod_app e não assume o papel de poda).
      const [poda] = await trx<{ ler: boolean; apagar: boolean }[]>`select has_table_privilege('nod_poda', 'anexos', 'SELECT') as ler, has_table_privilege('nod_poda', 'anexos', 'DELETE') as apagar`;
      expect(poda).toEqual({ ler: true, apagar: true });
      expect((await anexosDaConversa(trx, conversaId)).map((l) => l.id)).toEqual([anexo!.id]);
    });
  });

  it("o turno seguinte não recebe a captura: nem nos anexos de entrada nem no histórico do plano", async () => {
    await withRollback(MARLON, async (trx) => {
      const g = guardadorDeTelas(MARLON);
      const { agenteId, conversaId, turnoId } = await turnoDeConversa(trx);
      await g.observar(turnoId, tela(1));
      const { deps, repos } = comCapturas(trx, g.capturas);
      await assentar(deps, turnoId);
      const [anexo] = await anexosDaConversa(trx, conversaId);
      expect(anexo).toBeDefined();
      const proximo = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "e agora?", entradaConfianca: "confiavel", modelo: "m" });
      const plano = await emitirPlanoTurno(deps, { turnoId: proximo?.id ?? "", machineId: randomUUID(), executor: "catcher" });
      expect(plano.data.entrada.anexos ?? []).toEqual([]);
      const serializado = JSON.stringify(plano.data);
      expect(serializado).not.toContain(anexo!.id);
      expect(serializado).not.toContain(anexo!.nome);
      expect(serializado).not.toContain(Buffer.from(tela(1)).toString("base64"));
    });
  });

  it("com a chave ausente ou 0: nenhum anexo", async () => {
    for (const env of [{}, { NOD_CAPTURA_NO_TRANSCRIPT: "0" }]) {
      await withRollback(MARLON, async (trx) => {
        const g = guardadorDeTelas(MARLON, env);
        const { conversaId, turnoId } = await turnoDeConversa(trx);
        await g.observar(turnoId, tela(1));
        const r = await assentar(comCapturas(trx, g.capturas).deps, turnoId);
        expect(r.data.mensagem).not.toBeNull();
        expect(await anexosDaConversa(trx, conversaId)).toHaveLength(0);
      });
    }
    expect(criarCapturas({ ligado: false }).ler("qualquer")).toBeNull();
  });
});
