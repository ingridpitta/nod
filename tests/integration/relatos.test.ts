import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { JANELA_RELATO_MS } from "../../src/contracts/relato.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { registrarRelato } from "../../src/use-cases/registrar-relato.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import type { Tx } from "../../src/shared/types.ts";
import type { Escopo } from "../../src/shared/types.ts";

const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

/** Deps mínimo: o caso de uso só usa repos, escopo e o relógio (é puro quanto ao resto). */
function deps(trx: Tx, e: Escopo, agora: number): Deps {
  return {
    repos: criarRepos(trx, e),
    services: {} as Deps["services"],
    useCases: {} as Deps["useCases"],
    tx: (fn) => fn(trx),
    escopo: e,
    agora: () => agora,
  };
}

describeIntegracao("relato de comportamento indesejado (ADR-041)", () => {
  it("copia o estado técnico do turno e guarda a prosa separada do registro", async () => {
    await withRollback(escopo, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, escopo);
      const turno = await a.repos.turnos.enfileirar({ executor: "catcher",
        conversaId: a.conversaId, agenteId: a.agenteId, origem: "conversa", prazoEm: agora + 60_000,
        profundidade: 0, entradaTexto: "faça a coisa", entradaConfianca: "confiavel",
        modelo: "claude-haiku-4-5-20251001", harness: "claude-cli",
      });
      const assentado = await a.repos.turnos.assentar(turno!.id, {
        estado: "interrompido", motivoInterrupcao: "sem_progresso", motivoFalha: null,
        sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
        custoUsd: 0.0123, tokensEntrada: 10, tokensSaida: 0,
      });
      expect(assentado).not.toBeNull();

      await a.repos.relatos.registrarDiagnostico({
        turnoId: turno!.id, erroCru: "stream closed by provider",
        ferramentas: ["Read", "Bash"], negacoes: ["WebFetch"], sessaoCli: "sess-1", em: agora,
      });

      const mensagem = await a.repos.mensagens.criar({
        conversaId: a.conversaId, turnoId: turno!.id, autoria: autoriaPessoa(PESSOA_MARLON),
        kind: "texto", texto: "resposta ruim", confianca: "nao_confiavel", parcial: true,
      });

      const r = await registrarRelato(deps(trx, escopo, agora), {
        mensagemId: mensagem!.id, categoria: "travou_ou_parou", alcance: "mensagem", texto: "  devia ter avisado  ",
        versaoApp: "0.2.0-rc.1",
      });

      const m = r.data.relato.metadados;
      expect(m.estadoTurno).toBe("interrompido");
      expect(m.motivoInterrupcao).toBe("sem_progresso");
      expect(m.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: false });
      expect(m.modelo).toBe("claude-haiku-4-5-20251001");
      expect(m.harness).toBe("claude-cli");
      expect(m.custoUsd).toBeCloseTo(0.0123);
      expect(m.confiancaMensagem).toBe("nao_confiavel");
      expect(m.mensagemParcial).toBe(true);
      expect(m.versaoApp).toBe("0.2.0-rc.1");
      // O diagnóstico que antes só existia como linha de log agora chega ao relato.
      expect(r.data.relato.diagnostico).toEqual({
        erroCru: "stream closed by provider", ferramentas: ["Read", "Bash"], negacoes: ["WebFetch"], sessaoCli: "sess-1",
      });

      // O evento carrega só escalares: o texto NUNCA sai pela trilha (ADR-004).
      const ev = r.events?.[0];
      expect(ev?.kind).toBe("relato_criado");
      expect(ev?.dados).toMatchObject({ categoria: "travou_ou_parou", alcance: "mensagem", mensagens_anexadas: 1, com_diagnostico: true, turno_via: "mensagem" });
      expect(JSON.stringify(ev?.dados)).not.toContain("devia ter avisado");

      // A prosa vive fora do registro, e chega aparada.
      const prosa = await a.repos.relatos.prosaDe(r.data.relato.id);
      expect(prosa?.textoPessoa).toBe("devia ter avisado");
      expect(prosa?.trecho?.mensagens).toHaveLength(1);
      expect(prosa?.trecho?.mensagens[0]?.texto).toBe("resposta ruim");
    });
  });

  it("a janela anexa só o que cabe nos 15 minutos anteriores à mensagem apontada", async () => {
    await withRollback(escopo, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, escopo);
      const autoria = autoriaPessoa(PESSOA_MARLON);
      const criar = async (texto: string) =>
        (await a.repos.mensagens.criar({ conversaId: a.conversaId, autoria, kind: "texto", texto, confianca: "confiavel" }))!;

      const antiga = await criar("muito antes");
      await trx`update mensagens set criado_em = ${new Date(agora - JANELA_RELATO_MS - 60_000)} where id = ${antiga.id}`;
      const dentro = await criar("dentro da janela");
      await trx`update mensagens set criado_em = ${new Date(agora - 60_000)} where id = ${dentro.id}`;
      const alvo = await criar("a que deu errado");
      await trx`update mensagens set criado_em = ${new Date(agora)} where id = ${alvo.id}`;

      const r = await registrarRelato(deps(trx, escopo, agora), { mensagemId: alvo.id, categoria: "lento", alcance: "janela" });
      expect(r.data.relato.mensagensAnexadas).toBe(2);

      const prosa = await a.repos.relatos.prosaDe(r.data.relato.id);
      expect(prosa?.trecho?.mensagens.map((m) => m.texto)).toEqual(["dentro da janela", "a que deu errado"]);
    });
  });

  it("mensagem sem turno (sistema) rende relato sem metadado de execução, e não quebra", async () => {
    await withRollback(escopo, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, escopo);
      const m = await a.repos.mensagens.criar({
        conversaId: a.conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "sistema", assunto: "sistema.generico",
        texto: "algo aconteceu", confianca: "confiavel",
      });

      const r = await registrarRelato(deps(trx, escopo, agora), { mensagemId: m!.id, categoria: "interface", alcance: "mensagem" });
      expect(r.data.relato.turnoId).toBeNull();
      expect(r.data.relato.metadados.estadoTurno).toBeNull();
      expect(r.data.relato.metadados.sinais).toBeNull();
      expect(r.data.relato.diagnostico).toBeNull();
      expect(r.data.relato.metadados.confiancaMensagem).toBe("confiavel");
    });
  });

  it("mensagem inexistente é nao_encontrado, nunca um relato órfão", async () => {
    await withRollback(escopo, async (trx) => {
      await expect(
        registrarRelato(deps(trx, escopo, Date.now()), { mensagemId: randomUUID(), categoria: "outro", alcance: "mensagem" }),
      ).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  /**
   * O relato é insumo de ROADMAP: quem investiga precisa ver o que as outras pessoas relataram,
   * senão a triagem lista só os próprios. A PROSA continua privada — é ela que carrega dado
   * pessoal e conteúdo de conector (ADR-002/026).
   */
  it("o time lê o registro do relato, mas a prosa é só de quem escreveu", async () => {
    await withRollback(escopo, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, escopo);
      const m = await a.repos.mensagens.criar({
        conversaId: a.conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto",
        texto: "conteúdo privado do Marlon", confianca: "confiavel",
      });
      const r = await registrarRelato(deps(trx, escopo, agora), {
        mensagemId: m!.id, categoria: "resposta_errada", alcance: "mensagem", texto: "segredo",
      });

      const ana = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
      await vincularEscopo(trx, ana);
      const reposAna = criarRepos(trx, ana);
      // Registro: visível para a equipe, senão ninguém faz triagem.
      expect(await reposAna.relatos.buscar(r.data.relato.id)).not.toBeNull();
      expect((await reposAna.relatos.listar()).some((x) => x.id === r.data.relato.id)).toBe(true);
      // Prosa: privada. O texto da pessoa e o trecho da conversa não atravessam.
      expect(await reposAna.relatos.prosaDe(r.data.relato.id)).toBeNull();
      // Escrever também não: a policy da 0004 abre LEITURA para 'equipe', nunca escrita.
      expect(await trx`update relatos set categoria = 'outro' where id = ${r.data.relato.id} returning id`).toHaveLength(0);
      expect(await trx`update relato_prosa set texto_pessoa = 'adulterado' where relato_id = ${r.data.relato.id} returning id`).toHaveLength(0);

      await vincularEscopo(trx, escopo);
      expect((await criarRepos(trx, escopo).relatos.prosaDe(r.data.relato.id))?.textoPessoa).toBe("segredo");
    });
  });

  it("NOD-367: na listagem, o relato do botão traz o texto para quem escreveu, e nada para outra pessoa", async () => {
    await withRollback(escopo, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, escopo);
      const m = await a.repos.mensagens.criar({
        conversaId: a.conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto",
        texto: "conteúdo privado do Marlon", confianca: "confiavel",
      });
      const r = await registrarRelato(deps(trx, escopo, agora), {
        mensagemId: m!.id, categoria: "outro", alcance: "mensagem", texto: "A Ada mandou o cronograma com as datas erradas",
      });
      const doMarlon = (await a.repos.relatos.listar()).find((x) => x.id === r.data.relato.id);
      expect(doMarlon?.origem).toBe("botao");
      expect(doMarlon?.resumo).toBe("A Ada mandou o cronograma com as datas erradas");

      const ana = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
      await vincularEscopo(trx, ana);
      const daAna = (await criarRepos(trx, ana).relatos.listar()).find((x) => x.id === r.data.relato.id);
      expect(daAna).toBeDefined();
      expect(daAna?.resumo ?? null).toBeNull();
      expect(daAna?.titulo ?? null).toBeNull();
    });
  });

  it("a listagem traz o diagnóstico do turno — é o campo que a feature existe para resgatar", async () => {
    await withRollback(escopo, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, escopo);
      const turno = await a.repos.turnos.enfileirar({ executor: "catcher",
        conversaId: a.conversaId, agenteId: a.agenteId, origem: "conversa", prazoEm: agora + 60_000,
        profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "sonnet",
      });
      // Duas linhas para o mesmo turno: a segunda simula a entrega tardia, mais pobre.
      await a.repos.relatos.registrarDiagnostico({ turnoId: turno!.id, erroCru: "causa real", ferramentas: ["Read"], negacoes: [], sessaoCli: "s1", em: agora });
      await a.repos.relatos.registrarDiagnostico({ turnoId: turno!.id, erroCru: null, ferramentas: [], negacoes: [], sessaoCli: null, em: agora + 5_000 });

      const m = await a.repos.mensagens.criar({
        conversaId: a.conversaId, turnoId: turno!.id, autoria: autoriaPessoa(PESSOA_MARLON),
        kind: "texto", texto: "falhou", confianca: "confiavel",
      });
      const r = await registrarRelato(deps(trx, escopo, agora), { mensagemId: m!.id, categoria: "travou_ou_parou", alcance: "mensagem" });

      const naLista = (await a.repos.relatos.listar()).find((x) => x.id === r.data.relato.id);
      // A PRIMEIRA linha vence: a entrega tardia não apaga a causa real da falha.
      expect(naLista?.diagnostico).toEqual({ erroCru: "causa real", ferramentas: ["Read"], negacoes: [], sessaoCli: "s1" });
    });
  });

  it("o relato sobre uma mensagem com ghp_… guarda o marcador na prosa e deixa a mensagem intacta (NOD-158)", async () => {
    await withRollback(escopo, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, escopo);
      // Montado em tempo de execução para não parecer chave real ao secret scanning.
      const ghp = `ghp_${"a1B2".repeat(9)}`;
      const texto = `o push falhou com ${ghp}`;
      const mensagem = await a.repos.mensagens.criar({
        conversaId: a.conversaId, turnoId: null, autoria: autoriaPessoa(PESSOA_MARLON),
        kind: "texto", texto, confianca: "confiavel", parcial: false,
      });
      const r = await registrarRelato(deps(trx, escopo, agora), {
        mensagemId: mensagem!.id, categoria: "outro", alcance: "mensagem", texto: `colei a chave ${ghp} sem querer`,
      });

      const prosa = await a.repos.relatos.prosaDe(r.data.relato.id);
      const marcador = `«redigido: ${ghp.length} caracteres»`;
      expect(prosa?.trecho?.mensagens[0]?.texto).toBe(`o push falhou com ${marcador}`);
      expect(prosa?.textoPessoa).toBe(`colei a chave ${marcador} sem querer`);
      expect(JSON.stringify(prosa)).not.toContain(ghp);
      // A conversa não muda: só a cópia que sai do contexto vivo é redigida.
      expect((await a.repos.mensagens.buscar(mensagem!.id))?.texto).toBe(texto);
    });
  });

  // Re-QA do #346 (Teodora, 2026-10-17): NOD-291 — o relato diz onde o turno RODOU, não o executor da autoria da mensagem.
  it("o executor do relato é o do turno, mesmo quando a autoria da mensagem diz outro (NOD-291)", async () => {
    await withRollback(escopo, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, escopo);
      const turno = await a.repos.turnos.enfileirar({ executor: "local",
        conversaId: a.conversaId, agenteId: a.agenteId, origem: "conversa", prazoEm: agora + 60_000,
        profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "m", harness: "claude-cli",
      });
      const mensagem = await a.repos.mensagens.criar({
        conversaId: a.conversaId, turnoId: turno!.id, autoria: autoriaPessoa(PESSOA_MARLON),
        kind: "texto", texto: "rodou no Mac", confianca: "confiavel", parcial: false,
      });
      expect(mensagem!.autoria.executor).toBe("catcher");
      const r = await registrarRelato(deps(trx, escopo, agora), { mensagemId: mensagem!.id, categoria: "outro", alcance: "mensagem" });
      expect(r.data.relato.metadados.executor).toBe("local");
    });
  });

  // NOD-292: a fala da pessoa não tem turno_id; o turno que a explica é o que ela disparou (ou o que a absorveu).
  it("relato sobre a fala da pessoa traz o turno que ela disparou, com estado técnico e diagnóstico (NOD-292)", async () => {
    await withRollback(escopo, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, escopo);
      const m = await a.repos.mensagens.criar({
        conversaId: a.conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "faz o relatório", confianca: "confiavel",
      });
      expect(m!.turnoId).toBeNull();
      const turno = await a.repos.turnos.enfileirar({ executor: "local",
        conversaId: a.conversaId, agenteId: a.agenteId, origem: "conversa", prazoEm: agora + 60_000,
        profundidade: 0, entradaTexto: "faz o relatório", entradaConfianca: "confiavel", modelo: "claude-sonnet-4-5", harness: "claude-cli",
        mensagemOrigemId: m!.id,
      });
      await a.repos.turnos.assentar(turno!.id, {
        estado: "interrompido", motivoInterrupcao: "trabalho_incompleto", motivoFalha: "erro_execucao",
        sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true },
        custoUsd: 0.05, tokensEntrada: 10, tokensSaida: 5,
      });
      await a.repos.relatos.registrarDiagnostico({ turnoId: turno!.id, erroCru: "api 529", ferramentas: ["Bash"], negacoes: [], sessaoCli: "s9", em: agora });

      const r = await registrarRelato(deps(trx, escopo, agora), { mensagemId: m!.id, categoria: "travou_ou_parou", alcance: "mensagem" });
      expect(r.data.relato.turnoId).toBe(turno!.id);
      const md = r.data.relato.metadados;
      expect(md.estadoTurno).toBe("interrompido");
      expect(md.motivoInterrupcao).toBe("trabalho_incompleto");
      expect(md.motivoFalha).toBe("erro_execucao");
      expect(md.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: true });
      expect(md.custoUsd).toBeCloseTo(0.05);
      expect(md.reenvios).toBe(0);
      expect(md.harness).toBe("claude-cli");
      expect(md.executor).toBe("local");
      expect(r.data.relato.diagnostico).toEqual({ erroCru: "api 529", ferramentas: ["Bash"], negacoes: [], sessaoCli: "s9" });
      expect(r.events?.[0]?.turnoId).toBe(turno!.id);
      expect(r.events?.[0]?.dados).toMatchObject({ com_diagnostico: true, turno_via: "disparado" });

      const naLista = (await a.repos.relatos.listar()).find((x) => x.id === r.data.relato.id);
      expect(naLista?.turnoId).toBe(turno!.id);
      expect(naLista?.diagnostico).toEqual({ erroCru: "api 529", ferramentas: ["Bash"], negacoes: [], sessaoCli: "s9" });
    });
  });

  it("fala da pessoa lida junto com outra aponta o turno que respondeu por ela (NOD-292)", async () => {
    await withRollback(escopo, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, escopo);
      const fala = async (texto: string) =>
        (await a.repos.mensagens.criar({ conversaId: a.conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto, confianca: "confiavel" }))!;
      const enfileirar = async (texto: string, mensagemOrigemId: string) =>
        (await a.repos.turnos.enfileirar({ executor: "catcher",
          conversaId: a.conversaId, agenteId: a.agenteId, origem: "conversa", prazoEm: agora + 60_000,
          profundidade: 0, entradaTexto: texto, entradaConfianca: "confiavel", modelo: "m", mensagemOrigemId,
        }))!;
      const m1 = await fala("primeira");
      const m2 = await fala("segunda");
      const tA = await enfileirar("primeira", m1.id);
      const tB = await enfileirar("segunda", m2.id);
      const { absorvidos } = await a.repos.turnos.absorverPendentes(tA, (ts) => ts.join("\n"));
      expect(absorvidos.map((t) => t.id)).toEqual([tB.id]);
      await a.repos.relatos.registrarDiagnostico({ turnoId: tA.id, erroCru: "falhou", ferramentas: [], negacoes: [], sessaoCli: null, em: agora });

      const r = await registrarRelato(deps(trx, escopo, agora), { mensagemId: m2.id, categoria: "resposta_errada", alcance: "mensagem" });
      expect(r.data.relato.turnoId).toBe(tA.id);
      expect(r.events?.[0]?.dados).toMatchObject({ com_diagnostico: true, turno_via: "absorvedor" });
    });
  });

  it("fala da pessoa sem turno rende relato sem turno, via nenhum (NOD-292)", async () => {
    await withRollback(escopo, async (trx) => {
      const agora = Date.now();
      const a = await agenteComConversa(trx, escopo);
      const m = await a.repos.mensagens.criar({
        conversaId: a.conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "oi", confianca: "confiavel",
      });
      const r = await registrarRelato(deps(trx, escopo, agora), { mensagemId: m!.id, categoria: "outro", alcance: "mensagem" });
      expect(r.data.relato.turnoId).toBeNull();
      expect(r.data.relato.diagnostico).toBeNull();
      expect(r.events?.[0]?.dados).toMatchObject({ com_diagnostico: false, turno_via: "nenhum" });
    });
  });
});
