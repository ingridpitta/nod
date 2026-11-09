import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import type { RespostaMutacao, RotinaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { acharChrome, criarCapturadorCdp } from "../../src/adapters/tela/capturador-cdp.ts";
import { APP_LOGADO, cookieDeSessao } from "../../src/adapters/http/rotas/tela.ts";
import { REGISTRO_DE_ACOES } from "../../src/domain/acoes/index.ts";
import { diferencasDeEstado, itemDoLote, marcaDaTela, NOME_DO_BOT_DE_QA, promptDoPasso, relatorioDeQa, ROTEIRO_DE_QA, type EstadoNaTela, type ResultadoDoPasso } from "../../src/domain/qa/roteiro.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-398: o bot de QA. Roda o roteiro (src/domain/qa/roteiro.ts) — criar bot → editar → criar rotina → excluir — PELO
 * CAMINHO DO CHAT: a pessoa escreve ao Nod e o Nod (o catcher, sem custo) chama o `gerir_bots` com o item de cada ação do
 * registro, pela mesma rota interna da ferramenta que o CLI real usa. Depois de cada passo, lê o estado pelas MESMAS
 * leituras da tela (GET /gestao-agentes e GET /rotinas) e falha com o passo e o diff se não bater. O Nod fica no modo
 * automático: o excluir (arriscada) TEM de virar card sem efeito, e só acontece quando a pessoa decide.
 *
 * Grava qa-relatorio.md (+ .json e o print da tela final em 390 e 1440, quando há Chrome) em QA_RELATORIO_DIR
 * (default: qa-relatorio/), que o job integration do CI publica como artefato.
 */

const DIR = process.env.QA_RELATORIO_DIR ?? join(process.cwd(), "qa-relatorio");
// Só o job do ci.yml que monta a web e o Chromium exige os dois (NOD_QA_EXIGE_CHROME=1); o desktop-release roda o mesmo
// `npm run check` sem eles e pula a captura, como fora do CI.
const EXIGE_CHROME = process.env.NOD_QA_EXIGE_CHROME === "1";
const WEB = join(process.cwd(), "dist/web");
// Sem a web montada não há print do app: nem tenta o Chrome (cada tentativa gastaria o prazo inteiro).
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
if (EXIGE_CHROME && !existsSync(join(WEB, "index.html"))) throw new Error("NOD-398: o CI precisa da web montada (npx vite build) para o print do bot de QA");

describeIntegracao("bot de QA pelas próprias ações, pelo chat do Nod (NOD-398)", () => {
  let srv: ServidorCompleto;
  let nod: { id: string; conversaId: string };
  let botId: string | undefined;
  beforeAll(async () => {
    srv = await servidorCompleto({
      env: { NOD_CAPTURA_TELA: chrome ? "1" : "0", NOD_STATIC_DIR: WEB, NOD_PRAZO_DECISAO_MS: "86400000" },
      drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 0 })],
    });
  }, 30_000);
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [botId, nod?.id].filter((x): x is string => !!x), conversas: nod ? [nod.conversaId] : [] });
    await srv.desligar();
  }, 30_000);

  /** O estado como a tela o lê: o cartão do bot na gestão de bots e as rotinas dele na lista de rotinas. */
  async function lerTela(): Promise<EstadoNaTela> {
    const { agentes } = await srv.json<{ agentes: { id: string; nome: string; titulo: string; descricao: string; excluidoEm?: number | null }[] }>("GET", "gestao-agentes");
    // O id do bot sai da tela na primeira vez que ele aparece (o nome do roteiro é único nesta pessoa); depois, só por id.
    botId ??= agentes.find((a) => a.nome === NOME_DO_BOT_DE_QA && !a.excluidoEm)?.id;
    const bot = agentes.find((a) => a.id === botId && !a.excluidoEm) ?? null;
    const { rotinas } = await srv.json<{ rotinas: RotinaDto[] }>("GET", "rotinas");
    return {
      bot: bot ? { nome: bot.nome, titulo: bot.titulo, descricao: bot.descricao } : null,
      rotinas: rotinas.filter((r) => botId && r.rotina.agenteId === botId).map((r) => ({ cron: r.rotina.cron, fusoIana: r.rotina.fusoIana, instrucao: r.rotina.instrucao })),
    };
  }

  /**
   * A tela de verdade depois do passo (revisão 6): o app aberto no Chrome com a sessão da pessoa, em 1440 (a barra lateral
   * com os bots aparece inteira), e o print só sai quando o DOM mostra o esperado (marcaDaTela). Não mostrou no prazo =
   * a tela não bate. Sem Chrome (fora do CI) devolve null e o passo segue só com a leitura das rotas.
   */
  const capturador = chrome ? criarCapturadorCdp({ chrome, prazoMs: 30_000 }) : null;
  async function olharATela(n: number, esperado: EstadoNaTela): Promise<ResultadoDoPasso["tela"] | null> {
    if (!capturador) return null;
    const marca = marcaDaTela(esperado, APP_LOGADO);
    const valor = cookieDeSessao(srv.pessoa.cookie);
    if (!valor) return { ok: false, nota: `${marca.nota} (sem cookie de sessão)` };
    try {
      const png = await capturador.capturar({ url: `${srv.url}/`, largura: 1440, cookies: [{ nome: "nod_sessao", valor }], pronto: marca.expressao });
      mkdirSync(DIR, { recursive: true });
      const arquivo = `passo-${n}-1440.png`;
      writeFileSync(join(DIR, arquivo), png);
      return { arquivo, ok: true, nota: marca.nota };
    } catch (e) {
      return { ok: false, nota: `${marca.nota} — ${(e as Error).message.slice(0, 160)}` };
    }
  }

  /** Pede ao Nod pelo chat e espera o turno acabar; devolve o erro do turno, se houver. */
  async function pedirAoNod(texto: string): Promise<string | null> {
    const r = await srv.json<RespostaMutacao>("POST", `conversas/${nod.conversaId}/mensagens`, { texto });
    const turnoId = r.ids.turno ?? "";
    const t = await srv.esperar(async () => {
      const { turno } = await srv.json<{ turno: Turno }>("GET", `turnos/${turnoId}`);
      return ["concluido", "falhou", "cancelado"].includes(turno.estado) ? turno : null;
    }, { nome: `turno ${turnoId} do Nod`, timeoutMs: 20_000 });
    if (t.estado !== "concluido") return `o turno do Nod acabou em ${t.estado}`;
    // A ferramenta respondeu erro (ação recusada, bot não achado): o catcher registra o resultado de cada chamada.
    const { registros } = await srv.json<{ registros: { turnoId: string; tipo: string; dados: Record<string, unknown> }[] }>("GET", "dev/catcher");
    const doTurno = registros.filter((x) => x.turnoId === turnoId && x.dados.nome === "gerir_bots");
    if (!doTurno.some((x) => x.tipo === "tool_use")) return "o Nod não chamou o gerir_bots";
    const resultado = doTurno.find((x) => x.tipo === "tool_result");
    if (!resultado) return "o gerir_bots não respondeu";
    if (resultado.dados.isError === true) {
      const msgs = await srv.json<{ mensagens: { kind: string; texto: string }[] }>("GET", `conversas/${nod.conversaId}/mensagens`);
      return `gerir_bots respondeu erro (${msgs.mensagens.slice(-3).map((m) => `${m.kind}: ${m.texto.slice(0, 120)}`).join(" | ")})`;
    }
    return null;
  }

  it("criar → editar → criar rotina → excluir pelo chat: a tela bate depois de cada passo, e o excluir espera a decisão", async () => {
    const resultados: ResultadoDoPasso[] = [];
    let falha: string | null = null;
    // O relatório sai SEMPRE: um passo que lança (rede, JSON quebrado, sessão) também vira relatório com o erro.
    try {
      // Preparação: a guia (o Nod) nasce no GET /onboarding; o onboarding é concluído e o Nod fica no automático.
      const onb = await srv.json<EstadoOnboarding>("GET", "onboarding");
      if (!onb.guia) throw new Error("o GET /onboarding não devolveu o Nod");
      nod = { id: onb.guia.id, conversaId: onb.guia.conversaId };
      const concluido = await srv.json<EstadoOnboarding>("POST", "onboarding/concluir", {});
      expect(concluido.etapa, "o onboarding não ficou concluído").toBe("concluido");
      await srv.json("POST", `agentes/${nod.id}/modo-aprovacao`, { modo: "automatico" });

      for (const passo of ROTEIRO_DE_QA) {
        const item = itemDoLote(passo, REGISTRO_DE_ACOES);
        const via = `gerir_bots ${item.tipo}`;
        const antes = await lerTela();
        const inicio = Date.now();
        const erro = await pedirAoNod(promptDoPasso(passo, item));
        if (erro) {
          resultados.push({ passo: passo.nome, acao: passo.acao, via, cartao: "nenhum", ms: Date.now() - inicio, diferencas: [], erro });
          falha = `passo "${passo.nome}" (${passo.acao}): ${erro}`;
          break;
        }
        let cartao: ResultadoDoPasso["cartao"] = "nenhum";
        if (passo.cartao) {
          // Ação arriscada no automático: NADA pode ter mudado antes da decisão da pessoa.
          const semDecisao = diferencasDeEstado(antes, await lerTela());
          const card = (await srv.json<SuaVezDto>("GET", "sua-vez")).itens.find((i) => i.decisao.tipo === "lote_bots" && i.decisao.agenteId === nod.id);
          if (semDecisao.length || !card) {
            cartao = "faltou";
            const erroCard = semDecisao.length ? `executou sem a decisão da pessoa: ${semDecisao.join("; ")}` : "não abriu o card de decisão";
            resultados.push({ passo: passo.nome, acao: passo.acao, via, cartao, ms: Date.now() - inicio, diferencas: [], erro: erroCard });
            falha = `passo "${passo.nome}" (${passo.acao}): ${erroCard}`;
            break;
          }
          await srv.json("POST", `decisoes/${card.decisao.id}/decidir`, {});
          cartao = "esperou e foi decidido";
        }
        const ms = Date.now() - inicio;
        const diferencas = diferencasDeEstado(passo.esperado, await lerTela());
        const tela = await olharATela(resultados.length + 1, passo.esperado);
        resultados.push({ passo: passo.nome, acao: passo.acao, via, cartao, ms, diferencas, ...(tela ? { tela } : {}) });
        if (diferencas.length) { falha = `passo "${passo.nome}" (${passo.acao}): a tela não bate\n  ${diferencas.join("\n  ")}`; break; }
        if (tela && !tela.ok) { falha = `passo "${passo.nome}" (${passo.acao}): a tela não mostrou ${tela.nota}`; break; }
      }
    } catch (e) {
      falha = `o bot de QA quebrou no passo ${resultados.length + 1}: ${(e as Error).message}`;
      resultados.push({ passo: ROTEIRO_DE_QA[resultados.length]?.nome ?? "preparação", acao: ROTEIRO_DE_QA[resultados.length]?.acao ?? "?", via: "?", cartao: "nenhum", ms: 0, diferencas: [], erro: (e as Error).message });
    }

    // A tela final, como a pessoa a vê (o bot já foi excluído: a página inicial sem ele).
    mkdirSync(DIR, { recursive: true });
    const telas: { arquivo: string; largura: number }[] = [];
    let semTela: string | undefined = chrome ? undefined : "sem Chrome ou sem a web montada nesta máquina (npx playwright install chromium; npx vite build)";
    if (chrome) {
      for (const largura of [390, 1440]) {
        const r = await fetch(`${srv.url}/api/t/${srv.pessoa.tenantId}/tela/captura`, { method: "POST", headers: { cookie: srv.pessoa.cookie, "content-type": "application/json" }, body: JSON.stringify({ tela: "inicio", largura }), signal: AbortSignal.timeout(60_000) }).catch((e: Error) => e);
        if (r instanceof Error) { semTela = `tela.capturar não respondeu: ${r.message}`; continue; }
        if (r.status !== 200) { semTela = `tela.capturar respondeu ${r.status}`; continue; }
        const arquivo = `tela-final-${largura}.png`;
        writeFileSync(join(DIR, arquivo), Buffer.from(await r.arrayBuffer()));
        telas.push({ arquivo, largura });
      }
    }
    writeFileSync(join(DIR, "qa-relatorio.md"), relatorioDeQa({ resultados, telas, quando: new Date().toISOString(), semTela }));
    writeFileSync(join(DIR, "qa-relatorio.json"), JSON.stringify({ ok: falha === null, resultados, telas }, null, 2));

    expect(falha, falha ?? "").toBeNull();
    expect(resultados.map((r) => r.acao)).toEqual(ROTEIRO_DE_QA.map((p) => p.acao));
    if (EXIGE_CHROME) expect(telas.map((t) => t.largura), semTela).toEqual([390, 1440]);
  }, 180_000);
});
