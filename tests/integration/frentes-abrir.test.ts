import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { autoriaAgente, autoriaPessoa } from "../../src/use-cases/autoria-evento.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { abrirFrentes, abrirTask, devolverResumo, mandarParaFrente } from "../../src/use-cases/frentes.ts";
import { marcarParado, sincronizarTrabalho, trabalhosParaDto } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const harnesses: Partial<Record<IdHarness, typeof pronto>> = { "claude-cli": pronto };

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const agora = () => Date.now();
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const turno = (extra: { trabalhoId?: string | null; entradaConfianca?: "confiavel" | "nao_confiavel" } = {}) =>
    base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "conserte o login e a CI", entradaConfianca: extra.entradaConfianca ?? "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: extra.trabalhoId ?? null });
  const ctx = (turnoId: string) => ({ turnoId, agenteId: base.agenteId, conversaId: base.conversaId });
  const plano = async (turnoId: string) => (await emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "local", harnesses })).data;
  const falaDoBot = (turnoId: string, texto: string) => base.repos.mensagens.criar({ conversaId: base.conversaId, turnoId, autoria: autoriaAgente({ agenteId: base.agenteId, contaDeExecucao: PESSOA_MARLON, executor: "catcher" }), kind: "texto", texto, confianca: "confiavel" });
  return { ...base, deps, turno, ctx, plano, falaDoBot };
}

const TRES = [
  { titulo: "Login no Safari", pedido: "Conserte o login no Safari.", repo: "gamefik/nod" },
  { titulo: "CI vermelha", pedido: "Descubra por que a CI quebrou.", branch_base: "feat/ci", pode_empurrar: true },
  { titulo: "Notas da versão", pedido: "Escreva as notas da versão." },
];

describeIntegracao("frentes: abrir em lote e devolver o resumo (ADR-099, I2)", () => {
  it("abrir_frentes com 3: um lote do turno do dono, 3 frentes com turno próprio e UMA linha na conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turno({ entradaConfianca: "nao_confiavel" });
      const r = await abrirFrentes(m.deps, { ...m.ctx(dono!.id), frentes: TRES, avisar_a_cada_uma: true });
      if (!r.data.ok) throw new Error(`deveria abrir: ${r.data.instrucao}`);
      expect(r.data.frentes.map((f) => f.titulo)).toEqual(["Login no Safari", "CI vermelha", "Notas da versão"]);
      expect(r.data.instrucao).toContain("Começou 3 frentes");

      const lote = await m.repos.frentes.buscarLote(r.data.lote_id);
      expect(lote).toMatchObject({ agenteId: m.agenteId, abertoPorTurnoId: dono!.id, trabalhoId: null, avisarACadaUma: true, devolvidoEm: null });
      const frentes = await m.repos.frentes.frentesDoLote(r.data.lote_id);
      expect(frentes.map((f) => f.id)).toEqual(r.data.frentes.map((f) => f.trabalho_id));
      for (const f of r.data.frentes) {
        const t = await m.repos.trabalhos.buscar(f.trabalho_id);
        expect(t).toMatchObject({ forma: "frente", loteId: r.data.lote_id, origem: "pessoa", estado: "na_fila", conversaId: m.conversaId, resumo: null });
        expect(t?.pasta).toMatch(/^~\/nod\/Ada\//);
        const turnos = await m.repos.turnos.doTrabalho(f.trabalho_id);
        expect(turnos).toHaveLength(1);
        expect(turnos[0]).toMatchObject({ origem: "conversa", estado: "pendente" });
        // A marca do turno do dono (leu algo de fora) atravessa para cada frente.
        expect(await m.repos.turnos.contaminado(turnos[0]!.id)).toBe(true);
      }
      const [login, ci] = r.data.frentes;
      const entradaLogin = (await m.repos.turnos.doTrabalho(login!.trabalho_id))[0]!.entradaTexto;
      expect(entradaLogin).toContain('[nod] Frente "Login no Safari"');
      expect(entradaLogin).toContain("Conserte o login no Safari.");
      expect(entradaLogin).toContain("Repositório: gamefik/nod. Parta de origin/main.");
      // NOD-315 (0102): o repo validado fica no trabalho, para o executor preparar o clone da máquina; sem repo, nada.
      expect((await m.repos.trabalhos.buscar(login!.trabalho_id))?.repo).toBe("gamefik/nod");
      expect((await m.repos.trabalhos.buscar(ci!.trabalho_id))?.repo).toBeUndefined();
      // I4: pode_empurrar vira a linha da entrada; o padrão é não empurrar.
      expect(entradaLogin).toContain("Não empurre: devolva o branch e o SHA.");
      expect((await m.repos.turnos.doTrabalho(ci!.trabalho_id))[0]!.entradaTexto).toContain("Parta do branch feat/ci.\nO dono autorizou empurrar o seu branch e abrir PR.");

      const linhas = (await m.repos.mensagens.listarDaConversa(m.conversaId)).filter((x) => x.kind === "sistema");
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ turnoId: dono!.id, texto: "Começou 3 frentes: Login no Safari, CI vermelha e Notas da versão", payload: { kind: "frentes_abertas", loteId: r.data.lote_id, origem: "pessoa", frentes: r.data.frentes.map((f) => ({ trabalhoId: f.trabalho_id, titulo: f.titulo })) } });
      expect((r.events ?? []).filter((e) => e.kind === "mensagem_criada")).toHaveLength(1);

      // Frente não abre frente (2ª camada, além do catálogo); o sinônimo também recusa.
      const daFrente = (await m.repos.turnos.doTrabalho(login!.trabalho_id))[0]!;
      expect((await abrirFrentes(m.deps, { ...m.ctx(daFrente.id), frentes: [{ titulo: "x", pedido: "x" }] })).data).toMatchObject({ ok: false, erro: "nao_abre_frente" });
      expect((await abrirTask(m.deps, { ...m.ctx(daFrente.id), titulo: "x", pedido: "x" })).data).toMatchObject({ ok: false, erro: "nao_abre_task" });
      expect((await abrirFrentes(m.deps, { ...m.ctx(dono!.id), frentes: [] })).data).toMatchObject({ ok: false, erro: "sem_frentes" });
    });
  });

  it("titulo_do_lote (plano chat limpo, PR 5): gravado no lote e no payload; sem ele, 'N frentes' ou o título da frente", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dto = async (trabalhoId: string) => (await trabalhosParaDto(m.deps, [(await m.repos.trabalhos.buscar(trabalhoId))!]))[0]!;
      const payloadDo = async (loteId: string) => (await m.repos.mensagens.listarDaConversa(m.conversaId)).find((x) => x.payload?.kind === "frentes_abertas" && x.payload.loteId === loteId)?.payload;

      // Com título: espaço junto, gravado no lote, no payload e no DTO de cada frente.
      const com = await abrirFrentes(m.deps, { ...m.ctx((await m.turno())!.id), frentes: TRES, titulo_do_lote: "  frentes   de release " });
      if (!com.data.ok) throw new Error(com.data.instrucao);
      expect((await m.repos.frentes.buscarLote(com.data.lote_id))?.titulo).toBe("frentes de release");
      expect(await payloadDo(com.data.lote_id)).toMatchObject({ kind: "frentes_abertas", tituloDoLote: "frentes de release" });
      expect(await dto(com.data.frentes[1]!.trabalho_id)).toMatchObject({ tituloDoLote: "frentes de release", lote: { id: com.data.lote_id, frentes: 3 } });

      // Sem título (ou vazio, ou "??"): o lote fica null e a tela diz "N frentes".
      for (const titulo_do_lote of [undefined, "", "??"]) {
        const sem = await abrirFrentes(m.deps, { ...m.ctx((await m.turno())!.id), frentes: TRES.slice(0, 2), ...(titulo_do_lote === undefined ? {} : { titulo_do_lote }) });
        if (!sem.data.ok) throw new Error(sem.data.instrucao);
        expect((await m.repos.frentes.buscarLote(sem.data.lote_id))?.titulo).toBeNull();
        expect(await payloadDo(sem.data.lote_id)).toMatchObject({ tituloDoLote: "2 frentes" });
        expect((await dto(sem.data.frentes[0]!.trabalho_id)).tituloDoLote).toBe("2 frentes");
      }

      // Uma frente só, sem título: o do lote é o da frente. O sinônimo abrir_task também.
      const uma = await abrirFrentes(m.deps, { ...m.ctx((await m.turno())!.id), frentes: [TRES[2]!] });
      if (!uma.data.ok) throw new Error(uma.data.instrucao);
      expect(await payloadDo(uma.data.lote_id)).toMatchObject({ tituloDoLote: "Notas da versão" });
      expect((await dto(uma.data.frentes[0]!.trabalho_id)).tituloDoLote).toBe("Notas da versão");
      const task = await abrirTask(m.deps, { ...m.ctx((await m.turno())!.id), titulo: "Changelog", pedido: "Escreva o changelog." });
      if (!task.data.ok) throw new Error(task.data.instrucao);
      expect((await dto(task.data.trabalho_id)).tituloDoLote).toBe("Changelog");
    });
  });

  it("a abertura não falha com títulos longos (o teto continua 200): a frente fica com a linha curta e o lote, idem", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const longo = `Refazer os roteiros de animação do hero com o tom novo ${"e mais detalhes ".repeat(12)}`.slice(0, 200);
      expect(longo.length).toBe(200);
      const r = await abrirFrentes(m.deps, { ...m.ctx((await m.turno())!.id), frentes: [{ titulo: longo, pedido: "Refaça os roteiros." }, { titulo: "??", pedido: "Revise." }], titulo_do_lote: longo });
      if (!r.data.ok) throw new Error(`deveria abrir: ${r.data.instrucao}`);
      const [primeira, semLetra] = r.data.frentes;
      expect(primeira!.titulo).toHaveLength(80);
      expect(primeira!.titulo.endsWith("…")).toBe(true);
      // Título sem letra ("??") cai no reserva da frente.
      expect(semLetra!.titulo).toBe("Trabalho");
      expect((await m.repos.frentes.buscarLote(r.data.lote_id))?.titulo).toBe(primeira!.titulo);

      // Revisão do PR 5: o NUL que o modelo mande no título ou no titulo_do_lote não derruba a chamada (o Postgres o recusa
      // em text e em jsonb); vira espaço.
      const nul = await abrirFrentes(m.deps, { ...m.ctx((await m.turno())!.id), frentes: [{ titulo: "Roteiros\u0000novos", pedido: "Refaça." }], titulo_do_lote: "frentes\u0000de hero" });
      if (!nul.data.ok) throw new Error(`deveria abrir: ${nul.data.instrucao}`);
      expect(nul.data.frentes[0]!.titulo).toBe("Roteiros novos");
      expect((await m.repos.frentes.buscarLote(nul.data.lote_id))?.titulo).toBe("frentes de hero");
    });
  });

  it("o CHECK lote_titulo da 0092: nulo ou de 1 a 200 caracteres", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = (await m.turno())!;
      const inserir = (titulo: string | null) =>
        trx.savepoint((sp) => sp`insert into lotes_de_frentes (tenant_id, owner_id, agente_id, aberto_por_turno_id, titulo)
          values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${m.agenteId}, ${dono.id}, ${titulo}) returning titulo`);
      await expect(inserir(null)).resolves.toEqual([{ titulo: null }]);
      await expect(inserir("x".repeat(200))).resolves.toHaveLength(1);
      await expect(inserir("")).rejects.toMatchObject({ code: "23514", constraint_name: "lote_titulo" });
      await expect(inserir("x".repeat(201))).rejects.toMatchObject({ code: "23514", constraint_name: "lote_titulo" });
    });
  });

  it("o CHECK trabalho_repo da 0102 (NOD-315): nulo ou de 3 a 200 caracteres", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = (await m.repos.trabalhos.criar({ agenteId: m.agenteId, conversaId: m.conversaId, titulo: "frente", origem: "pessoa", forma: "frente", repo: "gamefik/nod" }))!;
      expect(t.repo).toBe("gamefik/nod");
      const gravar = (repo: string | null) => trx.savepoint((sp) => sp`update trabalhos set repo = ${repo} where tenant_id = ${TENANT_PADRAO} and id = ${t.id} returning repo`);
      await expect(gravar(null)).resolves.toEqual([{ repo: null }]);
      await expect(gravar("x".repeat(200))).resolves.toHaveLength(1);
      await expect(gravar("ab")).rejects.toMatchObject({ code: "23514", constraint_name: "trabalho_repo" });
      await expect(gravar("x".repeat(201))).rejects.toMatchObject({ code: "23514", constraint_name: "trabalho_repo" });
    });
  });

  it("o catálogo e o prompt: o dono abre e repassa; a frente devolve o resumo, sem me_chame_as", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turno();
      const r = await abrirFrentes(m.deps, { ...m.ctx(dono!.id), frentes: TRES.slice(0, 1) });
      if (!r.data.ok) throw new Error("abrir");
      const nomesDono = (await m.plano((await m.turno())!.id)).catalogo.ferramentas.map((f) => f.nome);
      expect(nomesDono).toEqual(expect.arrayContaining(["abrir_frentes", "mandar_para_frente", "me_chame_as"]));
      expect(nomesDono).not.toContain("devolver_resumo");
      const daFrente = (await m.repos.turnos.doTrabalho(r.data.frentes[0]!.trabalho_id))[0]!;
      const p = await m.plano(daFrente.id);
      const nomesFrente = p.catalogo.ferramentas.map((f) => f.nome);
      expect(nomesFrente).toContain("devolver_resumo");
      for (const fora of ["me_chame_as", "esperar_comando", "abrir_frentes", "mandar_para_frente"]) expect(nomesFrente).not.toContain(fora);
      expect(p.promptSistema).toContain("Frente: você é uma frente do dono");
      expect(p.promptSistema).toContain('Frente atual: você está na frente "Login no Safari"');
    });
  });

  it("devolver_resumo valida e grava; do dono, recusa; a frente que termina sem chamar ganha o resumo do servidor", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turno();
      const r = await abrirFrentes(m.deps, { ...m.ctx(dono!.id), frentes: TRES });
      if (!r.data.ok) throw new Error("abrir");
      const [login, ci, notas] = r.data.frentes.map((f) => f.trabalho_id);
      const turnoDe = async (id: string) => (await m.repos.turnos.doTrabalho(id))[0]!;

      const tLogin = await turnoDe(login!);
      expect((await devolverResumo(m.deps, { ...m.ctx(tLogin.id), feito: "Corrigi", sha: "XYZ" })).data).toMatchObject({ ok: false, erro: "resumo_invalido", instrucao: expect.stringContaining("(sha)") });
      expect((await devolverResumo(m.deps, { ...m.ctx(dono!.id), feito: "Corrigi" })).data).toMatchObject({ ok: false, erro: "nao_e_frente" });
      const ok = await devolverResumo(m.deps, { ...m.ctx(tLogin.id), feito: " Corrigi o login no Safari ", pr: 301, sha: "3f8bd4d", branch: "frente/login", falta: "esperar a CI" });
      expect(ok.data).toMatchObject({ ok: true });
      expect((await m.repos.trabalhos.buscar(login!))?.resumo).toEqual({ feito: "Corrigi o login no Safari", pr: 301, sha: "3f8bd4d", branch: "frente/login", falta: "esperar a CI" });
      // Termina: o resumo que ela devolveu fica (o do servidor não o troca).
      await m.repos.turnos.assentar(tLogin.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, login!);
      expect(await m.repos.trabalhos.buscar(login!)).toMatchObject({ estado: "terminado", resumo: { feito: "Corrigi o login no Safari", pr: 301 } });

      // A CI terminou sem devolver_resumo: o servidor monta com a última fala dela.
      const tCi = await turnoDe(ci!);
      await m.falaDoBot(tCi.id, "Olhando os logs");
      await m.falaDoBot(tCi.id, "A CI quebrou por um teste instável; reabri o job e passou.");
      await m.repos.turnos.assentar(tCi.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, ci!);
      expect(await m.repos.trabalhos.buscar(ci!)).toMatchObject({ estado: "terminado", resumo: { feito: "A CI quebrou por um teste instável; reabri o job e passou." } });

      // As notas foram paradas pela pessoa antes de falar: o resumo diz isso.
      const tNotas = await turnoDe(notas!);
      await m.repos.turnos.interromper(tNotas.id, "parado_pela_pessoa");
      await marcarParado(m.deps, (await m.repos.trabalhos.buscar(notas!))!);
      expect(await m.repos.trabalhos.buscar(notas!)).toMatchObject({ estado: "parado", resumo: { feito: "A pessoa parou a frente antes do fim." } });
    });
  });

  it("o histórico da frente sem sessão é o dela, nunca o da conversa do dono", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.mensagens.criar({ conversaId: m.conversaId, autoria: autoriaPessoa(MARLON), kind: "texto", texto: "segredo só da conversa com a pessoa", confianca: "confiavel" });
      const dono = await m.turno();
      const r = await abrirFrentes(m.deps, { ...m.ctx(dono!.id), frentes: TRES.slice(0, 1) });
      if (!r.data.ok) throw new Error("abrir");
      const id = r.data.frentes[0]!.trabalho_id;
      const primeiro = (await m.repos.turnos.doTrabalho(id))[0]!;
      await m.falaDoBot(primeiro.id, "Reproduzi o erro no Safari.");
      await m.repos.turnos.assentar(primeiro.id, { estado: "concluido" });
      // Um recado da pessoa na tela da frente abre o turno seguinte dela, sem sessão (a frente não tem sessao_cli).
      const segundo = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", retomaTurnoId: primeiro.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: id });
      const p = await m.plano(segundo!.id);
      expect(p.entrada.sessaoCli).toBeNull();
      const contexto = p.promptSistemaPartes?.volatil ?? "";
      expect(contexto).toContain("Reproduzi o erro no Safari.");
      expect(contexto).not.toContain("segredo só da conversa com a pessoa");
      // O dono, sem sessão, continua vendo a conversa.
      expect((await m.plano((await m.turno())!.id)).promptSistemaPartes?.volatil).toContain("segredo só da conversa com a pessoa");
    });
  });

  it("mandar_para_frente põe o recado na faixa da frente e deixa uma cópia como linha na conversa do dono", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turno();
      const r = await abrirFrentes(m.deps, { ...m.ctx(dono!.id), frentes: TRES.slice(0, 1) });
      if (!r.data.ok) throw new Error("abrir");
      const id = r.data.frentes[0]!.trabalho_id;
      const recado = await mandarParaFrente(m.deps, { ...m.ctx(dono!.id), trabalho_id: id, texto: "Teste também no iPhone" });
      expect(recado.data).toMatchObject({ ok: true, entrou: "na_fila" });
      expect((await m.repos.turnos.doTrabalho(id)).filter((t) => t.estado === "pendente").map((t) => t.entradaTexto)).toContain("[nod] Recado da conversa com a pessoa, repassado por você: Teste também no iPhone");
      const copia = (await m.repos.mensagens.listarDaConversa(m.conversaId)).find((x) => x.payload?.kind === "recado_a_frente");
      expect(copia).toMatchObject({ kind: "sistema", turnoId: dono!.id, texto: "Recado para a frente Login no Safari: Teste também no iPhone", confianca: "nao_confiavel", payload: { trabalhoId: id, titulo: "Login no Safari" } });
      const daFrente = (await m.repos.turnos.doTrabalho(id))[0]!;
      expect((await mandarParaFrente(m.deps, { ...m.ctx(daFrente.id), trabalho_id: id, texto: "x" })).data).toMatchObject({ ok: false, erro: "nao_repassa" });
    });
  });
});
