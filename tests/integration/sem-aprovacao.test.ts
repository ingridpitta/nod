import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import type { NovaAcaoDoModo } from "../../src/repositories/acoes-pelo-modo.repo.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Tx } from "../../src/shared/types.ts";
import { contarAtividade, lerAtividade } from "../../src/use-cases/atividade.ts";
import { AVISO_TOTAL_CREDENCIAIS, avisarTotalCredenciais } from "../../src/use-cases/aviso-total-credenciais.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { mudarModoAprovacao } from "../../src/use-cases/mudar-modo-aprovacao.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa, autoriaAgente } from "../helpers/fabricas.ts";
import { PESSOA_MARLON } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * PR 6 dos modos de aprovação, no Postgres: o que o "Ignorar todas" rodou sem a pessoa aparece na Atividade (a quarta
 * fonte, filtro "Sem aprovação", tela Y3) e numa linha embaixo da fala do turno (`acoesDoModo` da conversa, telas Y1/Y2);
 * e a linha do deploy nos bots que já estavam no total (decisão 3 do Marlon) é escrita uma vez.
 */
const DIA = "2026-10-18";
const em = (hhmm: string, dia = DIA) => new Date(`${dia}T${hhmm}:00Z`);

async function turnoDe(repos: Repos, agenteId: string, conversaId: string): Promise<string> {
  const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "publica a imagem", entradaConfianca: "confiavel", modelo: "m" });
  if (!t) throw new Error("turno");
  return t.id;
}

async function acao(trx: Tx, repos: Repos, a: Omit<NovaAcaoDoModo, "decisaoId" | "risco"> & { risco?: string | null; decisaoId?: string | null }, quando: Date): Promise<string> {
  const id = await repos.acoesPeloModo.registrar({ decisaoId: null, risco: null, ...a });
  await trx`update acoes_pelo_modo set criado_em = ${quando} where id = ${id}`;
  return id;
}

describeIntegracao("o que rodou sem aprovação (PR 6)", () => {
  it("Atividade: a quarta fonte no filtro 'Sem aprovação' — o total e o que o revisor liberou; o cartão que a pessoa decidiu e outro dia, não; a contagem soma", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ze" });
      await trx`update agentes set criado_em = ${em("08:00", "2026-10-10")} where id = ${agenteId}`;
      const turnoId = await turnoDe(repos, agenteId, conversaId);
      const base = { agenteId, conversaId, turnoId };
      const leu = await acao(trx, repos, { ...base, modo: "total", tipo: "leitura_credencial", gatilho: "credencial", resumo: "Ler ~/.aws/config" }, em("15:03"));
      const push = await acao(trx, repos, { ...base, modo: "total", tipo: "comando", gatilho: "arriscado", risco: "reescreve ou apaga no remoto", resumo: "git push --force origin staging" }, em("15:02"));
      const token = await acao(trx, repos, { ...base, modo: "total", tipo: "comando", gatilho: "credencial", resumo: "gh auth token | docker login ghcr.io …" }, em("14:21"));
      const gravou = await acao(trx, repos, { ...base, modo: "total", tipo: "arquivo", gatilho: "fora_da_pasta", resumo: "Gravar ~/code/app/.env.example" }, em("14:20"));
      const liberou = await acao(trx, repos, { ...base, modo: "automatico", tipo: "comando", gatilho: "arriscado", resumo: "rm -rf dist", veredito: "libera" }, em("13:00"));
      await acao(trx, repos, { ...base, modo: "automatico", tipo: "comando", gatilho: "arriscado", resumo: "rm -rf build", veredito: "pede" }, em("13:05"));
      await acao(trx, repos, { ...base, modo: "total", tipo: "comando", gatilho: "comum", resumo: "npm install" }, em("15:00", "2026-10-17"));
      // O que o modo aprovou num app (a fala "Fiz sem perguntar") também vai para o filtro.
      const app = await repos.mensagens.criar({ conversaId, autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: "sistema", assunto: "aprovacao.automatica", texto: "Fiz sem perguntar (1 ação) · sem aprovações", confianca: "confiavel" });
      await trx`update mensagens set criado_em = ${em("12:00")} where id = ${app!.id}`;

      const deps = depsSobreTrx(trx, MARLON);
      const { data } = await executar(deps, lerAtividade, { agenteId, dia: DIA, fuso: "UTC" });
      expect(data.itens.map((i) => i.id)).toEqual([`modo:${leu}`, `modo:${push}`, `modo:${token}`, `modo:${gravou}`, `modo:${liberou}`, app!.id]);
      const porId = new Map(data.itens.map((i) => [i.id, i]));
      expect(porId.get(`modo:${leu}`)).toEqual({ id: `modo:${leu}`, em: em("15:03").getTime(), categoria: "sem_aprovacao", titulo: "Leu as credenciais da AWS", detalhe: "~/.aws/config", codigo: true });
      expect(porId.get(`modo:${push}`)).toMatchObject({ titulo: "Comando arriscado", detalhe: "git push --force origin staging" });
      expect(porId.get(`modo:${token}`)).toMatchObject({ titulo: "Usou o token do GitHub" });
      expect(porId.get(`modo:${gravou}`)).toMatchObject({ titulo: "Gravou fora da pasta do bot", detalhe: "~/code/app/.env.example" });
      expect(porId.get(`modo:${liberou}`)).toMatchObject({ titulo: "Revisor liberou", categoria: "sem_aprovacao" });
      expect(porId.get(app!.id)).toMatchObject({ categoria: "sem_aprovacao", titulo: "Aprovado sem perguntar" });
      expect(data.total).toBe(6);
      expect((await executar(deps, contarAtividade, { agenteId, dia: DIA, fuso: "UTC" })).data.total).toBe(6);
    });
  });

  it("conversa: acoesDoModo leva, por turno da janela, a credencial e o arriscado do total com a frase pronta; o resto não", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ze" });
      const turnoId = await turnoDe(repos, agenteId, conversaId);
      const outro = await turnoDe(repos, agenteId, conversaId);
      const base = { agenteId, conversaId, turnoId };
      await repos.mensagens.criar({ conversaId, turnoId, autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: "texto", texto: "Publicada: ghcr.io/gamefik/nod:2.3.", confianca: "confiavel" });
      const token = await acao(trx, repos, { ...base, modo: "total", tipo: "comando", gatilho: "credencial", resumo: "gh auth token | docker login ghcr.io -u marlon --password-stdin" }, em("14:21"));
      const push = await acao(trx, repos, { ...base, modo: "total", tipo: "comando", gatilho: "arriscado", risco: "reescreve ou apaga no remoto", resumo: "git push --force origin staging" }, em("14:22"));
      await acao(trx, repos, { ...base, modo: "total", tipo: "comando", gatilho: "comum", resumo: "npm install" }, em("14:23"));
      // O turno sem fala na janela não entra (a consulta é pelos turnos das mensagens).
      await acao(trx, repos, { ...base, turnoId: outro, modo: "total", tipo: "comando", gatilho: "credencial", resumo: "cat ~/.aws/config" }, em("14:24"));

      const deps = depsSobreTrx(trx, MARLON);
      const { data } = await executar(deps, lerConversa, { conversaId });
      expect(data.acoesDoModo).toEqual({
        [turnoId]: [
          { id: token, turnoId, em: em("14:21").getTime(), gatilho: "credencial", frase: "Usou o token do GitHub do seu Mac" },
          { id: push, turnoId, em: em("14:22").getTime(), gatilho: "arriscado", frase: "Rodou um comando que reescreve ou apaga no remoto" },
        ],
      });
    });
  });

  it("conversa: o turno numa máquina Linux diz 'desta máquina'", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ze" });
      const turnoId = await turnoDe(repos, agenteId, conversaId);
      const chave = await repos.maquinaTokens.criar({ nome: "nod-vm", prefixo: "nodk_xyz", hash: randomBytes(32) });
      await repos.maquinaTokens.registrarPlataforma(chave!.id, "linux");
      await trx`update turnos set machine_id = ${chave!.id} where id = ${turnoId}`;
      await repos.mensagens.criar({ conversaId, turnoId, autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: "texto", texto: "No ar em staging.", confianca: "confiavel" });
      await acao(trx, repos, { agenteId, conversaId, turnoId, modo: "total", tipo: "leitura_credencial", gatilho: "credencial", resumo: "Ler /home/nod/.aws/config" }, em("15:03"));
      const { data } = await executar(depsSobreTrx(trx, MARLON), lerConversa, { conversaId });
      expect(data.acoesDoModo?.[turnoId]?.[0]?.frase).toBe("Leu as credenciais da AWS desta máquina");
    });
  });

  it("a linha do deploy: só nos bots em total, uma vez (rodar de novo não repete), e não no bot ligado depois do deploy", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const antigo = await agenteComConversa(trx, MARLON, { nome: "Ze" });
      const manual = await agenteComConversa(trx, MARLON, { nome: "Leo" });
      const depois = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      // O "antigo" foi para o total antes do deploy: a linha da troca dizia a descrição velha.
      await antigo.repos.agentes.definirModoAprovacao(antigo.agenteId, "total");
      await antigo.repos.mensagens.criar({ conversaId: antigo.conversaId, autoria: autoriaAgente(antigo.agenteId, PESSOA_MARLON), kind: "sistema", assunto: "aprovacao.modo", texto: "Marlon mudou as aprovações de Ze para Ignorar todas as aprovações: faz tudo sem perguntar. Não abre arquivos de credencial do Mac, e comandos com elas pedem você.", confianca: "confiavel" });
      // O "depois" foi para o total pelo menu novo: a linha da troca já diz a regra nova.
      await mudarModoAprovacao(deps, { agenteId: depois.agenteId, modo: "total", confirmado: true });

      const primeira = await avisarTotalCredenciais(deps);
      expect(primeira).toEqual({ avisados: 1, jaAvisados: 0, ligadosDepois: 1, semConversa: 0 });
      const linhas = await trx<{ conversa_id: string; texto: string; kind: string; destino: string | null }[]>`
        select conversa_id, texto, kind, assunto as destino from mensagens where assunto = 'aprovacao.total_credenciais' and conversa_id = any(${[antigo.conversaId, manual.conversaId, depois.conversaId]}::uuid[])`;
      expect(linhas).toEqual([{ conversa_id: antigo.conversaId, texto: AVISO_TOTAL_CREDENCIAIS, kind: "sistema", destino: "aprovacao.total_credenciais" }]);
      // A linha fica no chat (não some para a Atividade).
      const { data } = await executar(deps, lerConversa, { conversaId: antigo.conversaId });
      expect(data.mensagens.find((m) => m.texto === AVISO_TOTAL_CREDENCIAIS)?.destino).toBe("chat");
      // Idempotente.
      expect(await avisarTotalCredenciais(deps)).toEqual({ avisados: 0, jaAvisados: 1, ligadosDepois: 1, semConversa: 0 });
      // `seco` só conta.
      const seco = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      await seco.repos.agentes.definirModoAprovacao(seco.agenteId, "total");
      expect(await avisarTotalCredenciais(deps, { seco: true })).toMatchObject({ avisados: 1 });
      expect((await trx`select 1 from mensagens where conversa_id = ${seco.conversaId} and assunto = 'aprovacao.total_credenciais'`).length).toBe(0);
    });
  });
});
