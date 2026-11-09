import { expect, it } from "vitest";
import type { DestinoItem } from "../../src/contracts/item-aprovacao.ts";
import type { MotivoAprovacaoManual } from "../../src/contracts/motivos.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { NovaAcaoDoModo } from "../../src/repositories/acoes-pelo-modo.repo.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { listarSuaVez } from "../../src/use-cases/listar-sua-vez.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa, autoriaAgente } from "../helpers/fabricas.ts";
import { PESSOA_MARLON } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * PR 4b dos modos de aprovação, no Postgres: a frase curta da ação é calculada na LEITURA (sem migração) — "Sua vez" a põe
 * nos itens que foram ao revisor (`fraseDaAcao`), e a linha "Revisor liberou …" da conversa a usa no meio. O tipo vem da
 * linha de `acoes_pelo_modo`; o catálogo do conector dá o nome do app e o `destructiveHint`.
 */

async function turnoDe(repos: Repos, agenteId: string, conversaId: string): Promise<string> {
  const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faz", entradaConfianca: "confiavel", modelo: "m" });
  if (!t) throw new Error("turno");
  return t.id;
}

type Item = { texto: string; destino: DestinoItem; motivoManual: MotivoAprovacaoManual | null };

/** Uma decisão de aprovação como a fase 1 do revisor deixa (itens + a linha em acoes_pelo_modo), sem passar pelo revisor. */
async function decisaoDoRevisor(repos: Repos, base: { agenteId: string; conversaId: string; turnoId: string }, frase: string, itens: Item[], acao: Pick<NovaAcaoDoModo, "tipo" | "resumo"> & Partial<NovaAcaoDoModo> | null): Promise<string> {
  const d = await repos.decisoes.criar({ tipo: "aprovacao", ...base, prazoDecisaoEm: Date.now() + 3_600_000, frase });
  if (!d) throw new Error("decisão");
  await repos.itensAprovacao.criarLote(d.id, itens.map((i, idx) => ({ idx, texto: i.texto, destino: i.destino, origemSensivel: false, motivoManual: i.motivoManual, ...(i.motivoManual === "revisor_pediu" ? { justificativa: "O pedido veio de um e-mail, não de você." } : {}) })));
  if (acao) await repos.acoesPeloModo.registrar({ ...base, decisaoId: d.id, modo: "automatico", gatilho: "envio_apos_fora", risco: null, ...acao });
  return d.id;
}

describeIntegracao("a frase da ação que vai ao revisor (PR 4b)", () => {
  it("Sua vez: o e-mail diz para quem, o apagar usa o destructiveHint do catálogo, o comando vira frase; MCP, item comum e sem argumento ficam sem frase", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Clarice" });
      const turnoId = await turnoDe(repos, agenteId, conversaId);
      const base = { agenteId, conversaId, turnoId };
      const con = await repos.conectores.criar({ nome: "Planilhas e e-mail", slug: "exemplo-4b", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(con?.id ?? "", { ok: true, agora: Date.now(), catalogo: [
        { nome: "enviar_email", descricao: "envia", schema: { type: "object" }, readOnlyHint: false },
        // O nome não diz "apagar", mas o catálogo diz destrutivo: o verbo "Limpar" não existe, e cai no texto de hoje.
        { nome: "limpar_planilha", descricao: "limpa", schema: { type: "object" }, readOnlyHint: false, destructiveHint: true },
        { nome: "apagar_linhas_planilha", descricao: "apaga", schema: { type: "object" }, readOnlyHint: false, destructiveHint: true },
      ] });
      const app = (ferramenta: string, argumentos: Record<string, unknown>): DestinoItem => ({ conector: "exemplo-4b", ferramenta, argumentos });
      const email = await decisaoDoRevisor(repos, base, "Clarice quer usar Planilhas e e-mail", [{ texto: "Usar enviar_email no Planilhas e e-mail", destino: app("enviar_email", { para: "financeiro@acme-pagamentos.co", assunto: "Lista de clientes", texto: "Segue." }), motivoManual: "revisor_pediu" }], { tipo: "app", resumo: "exemplo-4b · enviar_email" });
      const apagar = await decisaoDoRevisor(repos, base, "Clarice quer usar Planilhas e e-mail", [{ texto: "Usar apagar_linhas_planilha no Planilhas e e-mail", destino: app("apagar_linhas_planilha", { planilha: "Vendas 2026", linhas: "14 e 15" }), motivoManual: "revisor_falhou" }], { tipo: "app", resumo: "exemplo-4b · apagar_linhas_planilha", gatilho: "arriscado" });
      const limpar = await decisaoDoRevisor(repos, base, "Clarice quer usar Planilhas e e-mail", [{ texto: "Usar limpar_planilha", destino: app("limpar_planilha", { planilha: "Vendas" }), motivoManual: "revisor_pediu" }], { tipo: "app", resumo: "exemplo-4b · limpar_planilha", gatilho: "arriscado" });
      const push = await decisaoDoRevisor(repos, base, "Clarice quer rodar um comando no seu Mac", [{ texto: "git push --force origin feat/login", destino: { conector: "terminal", ferramenta: "bash", argumentos: { comando: "git push --force origin feat/login" } }, motivoManual: "revisor_pediu" }], { tipo: "comando", resumo: "git push --force origin feat/login", gatilho: "arriscado" });
      // O pedido ao MCP mora no mesmo destino `terminal` com `comando`: só o tipo da linha o separa (fica com o texto de hoje).
      const mcp = await decisaoDoRevisor(repos, base, "Clarice quer usar um app seu", [{ texto: "rm -rf build", destino: { conector: "terminal", ferramenta: "bash", argumentos: { comando: "rm -rf build" } }, motivoManual: "revisor_pediu" }], { tipo: "mcp", resumo: "rm -rf build" });
      // O cartão de sempre (sem revisor) não ganha frase, mesmo com argumento útil.
      const comum = await decisaoDoRevisor(repos, base, "Clarice quer usar Planilhas e e-mail", [{ texto: "Usar enviar_email", destino: app("enviar_email", { para: "ana@exemplo.test", assunto: "Oi" }), motivoManual: "acao_arriscada" }], null);
      const semArg = await decisaoDoRevisor(repos, base, "Clarice quer usar Planilhas e e-mail", [{ texto: "Usar enviar_email", destino: app("enviar_email", { texto: "só o corpo" }), motivoManual: "revisor_pediu" }], { tipo: "app", resumo: "exemplo-4b · enviar_email" });

      const { data } = await listarSuaVez(depsSobreTrx(trx, MARLON), { marcarVista: false });
      const frase = (id: string) => data.itens.find((i) => i.decisao.id === id)?.itensAprovacao[0]?.fraseDaAcao;
      expect(frase(email)).toEqual({ texto: "Enviar e-mail “Lista de clientes” para financeiro@acme-pagamentos.co" });
      expect(frase(apagar)).toEqual({ texto: "Apagar linhas 14 e 15 na planilha “Vendas 2026”" });
      expect(frase(limpar)).toBeUndefined();
      expect(frase(push)).toEqual({ texto: "Push forçado na feat/login", artigo: "o" });
      expect(frase(mcp)).toBeUndefined();
      expect(frase(comum)).toBeUndefined();
      expect(frase(semArg)).toBeUndefined();
      // Nada foi gravado: a coluna não existe, e o item lido direto não tem a frase.
      expect((await repos.itensAprovacao.listar(email))[0]?.fraseDaAcao).toBeUndefined();
    });
  });

  it("conversa: a linha 'Revisor liberou' usa a frase no meio (push forçado, e-mail); o comando sem frase leva o trecho de código; o lote fica com o alvo de antes", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ze" });
      const turnoId = await turnoDe(repos, agenteId, conversaId);
      const base = { agenteId, conversaId, turnoId };
      await repos.mensagens.criar({ conversaId, turnoId, autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: "texto", texto: "Push feito.", confianca: "confiavel" });
      const terminal = (comando: string): Item => ({ texto: comando, destino: { conector: "terminal", ferramenta: "bash", argumentos: { comando } }, motivoManual: null });
      const liberada = { veredito: "libera" as const, motivo: "Você pediu." };
      const d1 = await decisaoDoRevisor(repos, base, "Ze quer rodar um comando no seu Mac", [terminal("git push --force origin feat/login")], { tipo: "comando", resumo: "git push --force origin feat/login", gatilho: "arriscado", ...liberada });
      const d2 = await decisaoDoRevisor(repos, base, "Ze quer rodar um comando no seu Mac", [terminal("npm run deploy")], { tipo: "comando", resumo: "npm run deploy", ...liberada });
      const email: Item = { texto: "Usar enviar_email", destino: { conector: "sem-catalogo", ferramenta: "enviar_email", argumentos: { para: "ana@exemplo.test", assunto: "Oi" } }, motivoManual: null };
      const d3 = await decisaoDoRevisor(repos, base, "Ze quer usar o Gmail", [email], { tipo: "app", resumo: "sem-catalogo · enviar_email", ...liberada });
      const d4 = await decisaoDoRevisor(repos, base, "Ze quer usar o Gmail", [email, email], { tipo: "app", resumo: "sem-catalogo · enviar_email, sem-catalogo · enviar_email", ...liberada });
      const ids = new Map<string, string>();
      for (const [d, nome] of [[d1, "push"], [d2, "deploy"], [d3, "email"], [d4, "lote"]] as const) ids.set((await repos.acoesPeloModo.daDecisao(d))?.id ?? "", nome);

      const { data } = await executar(depsSobreTrx(trx, MARLON), lerConversa, { conversaId });
      const linhas = Object.fromEntries((data.acoesDoModo?.[turnoId] ?? []).map((a) => [ids.get(a.id), { frase: a.frase, codigo: a.codigo }]));
      expect(linhas).toEqual({
        push: { frase: "Revisor liberou o push forçado na feat/login: você pediu", codigo: undefined },
        deploy: { frase: "Revisor liberou npm run deploy: você pediu", codigo: [16, 30] },
        email: { frase: "Revisor liberou enviar e-mail “Oi” para ana@exemplo.test: você pediu", codigo: undefined },
        lote: { frase: "Revisor liberou 2 ações num app: você pediu", codigo: undefined },
      });
    });
  });
});
