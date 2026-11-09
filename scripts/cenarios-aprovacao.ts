/**
 * Cenários de UAT do card de aprovação (frente §7 do plano de fluxo de aprovações).
 *
 * Popula um banco EFÊMERO com os casos que o card precisa cobrir, para olhar na tela o que os
 * testes já provam em texto. Não é seed do produto e não roda no CI: é ferramenta de UAT, como
 * scripts/smoke-computador.ts.
 *
 *   npm run db:efemero:up -- aprovacoes 5437
 *   DATABASE_URL=... node scripts/cenarios-aprovacao.ts
 */
import { randomUUID } from "node:crypto";
import type { Agente } from "../src/contracts/agente.ts";
import { MODELO_AGENTE_PADRAO } from "../src/contracts/modelos.ts";
import { criarDb } from "../src/db/client.ts";
import { PESSOA_MARLON } from "../src/db/seed/index.ts";
import { abrirTxEscopada } from "../src/db/tx.ts";
import { criarRepos } from "../src/repositories/index.ts";
import { log } from "../src/obs/log.ts";
import type { Escopo } from "../src/shared/types.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: variáveis vêm do ambiente
}

const url = process.env.DATABASE_URL;
if (!url) {
  log("erro", "cenarios_sem_url", { faltando: "DATABASE_URL" });
  process.exit(1);
}
if (!/:(543[5-9]|54[4-9][0-9])\//.test(url)) {
  // A porta 5434 é o banco diário (AGENTS.md); este script cria lixo de UAT de propósito.
  log("erro", "cenarios_banco_nao_efemero", { dica: "use npm run db:efemero:up -- aprovacoes 5437" });
  process.exit(1);
}

const db = criarDb(url, { max: 4 });
const PRAZO = 24 * 60 * 60 * 1000;

const [pessoa] = await db<{ id: string; tenant_id: string }[]>`select id, tenant_id from pessoas where id = ${PESSOA_MARLON}`;
if (!pessoa) {
  log("erro", "cenarios_sem_pessoa", { dica: "rode npm run db:seed no banco efêmero" });
  process.exit(1);
}
const escopo: Escopo = { tenantId: pessoa.tenant_id, pessoaId: pessoa.id };

// abrirTxEscopada é FÁBRICA: devolve a função que abre a transação (src/db/tx.ts).
const emTransacao = abrirTxEscopada(db, escopo);

const criados = await emTransacao(async (trx) => {
  const repos = criarRepos(trx, escopo);
  const agora = Date.now();

  /** Um agente com conversa própria por cenário: cada card aparece isolado na sua conversa. */
  async function bot(nome: string, cor: Agente["cor"]): Promise<{ agenteId: string; conversaId: string }> {
    const agenteId = randomUUID();
    const conversaId = randomUUID();
    const a = await repos.agentes.criar({ id: agenteId, nome, dono: "pessoa", forma: "shape-hex", cor, modelo: MODELO_AGENTE_PADRAO });
    if (!a) throw new Error(`agente ${nome} não criado`);
    const c = await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    if (!c) throw new Error(`conversa de ${nome} não criada`);
    return { agenteId, conversaId };
  }

  async function fala(conversaId: string, texto: string): Promise<void> {
    await repos.mensagens.criar({
      conversaId,
      turnoId: null,
      kind: "texto",
      texto,
      confianca: "confiavel",
      autoria: { autor_tipo: "agente", autor_id: escopo.pessoaId, sob_procuracao_de: escopo.pessoaId, conta_de_execucao: escopo.pessoaId, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 },
    });
  }

  async function aprovacao(
    alvo: { agenteId: string; conversaId: string },
    frase: string,
    itens: { texto: string; conector: string; ferramenta: string; argumentos: Record<string, unknown>; sensivel?: boolean }[],
  ): Promise<string> {
    const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId: alvo.agenteId, conversaId: alvo.conversaId, turnoId: null, prazoDecisaoEm: agora + PRAZO, frase });
    if (!d) throw new Error("decisão não criada");
    await repos.itensAprovacao.criarLote(
      d.id,
      itens.map((i, idx) => ({
        idx,
        texto: i.texto,
        destino: { conector: i.conector, ferramenta: i.ferramenta, argumentos: i.argumentos },
        origemSensivel: i.sensivel ?? false,
        ...(i.sensivel ? { justificativa: "Veio de um lugar que guarda dado pessoal. Deixei desmarcado — só você pode marcar." } : {}),
      })),
    );
    return d.id;
  }

  // Conectores com NOME diferente do slug: é o nome que o card mostra ("no Slack", não "no slack").
  // Reexecutável: o slug é UNIQUE, então quem já existe fica como está.
  for (const c of [
    { slug: "slack", nome: "Slack", cap: ["send_message", "search_messages"] },
    { slug: "drive", nome: "Google Drive", cap: ["move_file", "share"] },
    { slug: "gmail", nome: "Gmail", cap: ["send", "search"] },
  ]) {
    const existente = await repos.conectores.buscarPorSlug(c.slug);
    const conector = existente ?? (await repos.conectores.criar({ nome: c.nome, slug: c.slug, transporte: "stdio", comando: "node", args: ["scripts/mcp-exemplo.mjs"], declaracao: "nao-toca" }));
    if (!conector) continue;
    // A sonda é quem DECLARA o que é só-leitura (ADR-042): search/listar entram como readOnlyHint.
    await repos.conectores.registrarSonda(conector.id, {
      ok: true,
      catalogo: c.cap.map((nome) => ({ nome, descricao: nome, schema: { type: "object" as const }, readOnlyHint: nome.startsWith("search") })),
      agora,
    });
  }

  // 1. Um item: sem lista, "Pode fazer", jargão no disclosure.
  const vera = await bot("Vera", "c-purple");
  await fala(vera.conversaId, "Fechei os números de setembro: R$ 847 mil.");
  await aprovacao(vera, "Posso avisar o time no #vendas?", [
    { texto: "Setembro fechou em R$ 847 mil 🎉", conector: "slack", ferramenta: "send_message", argumentos: { channel: "#vendas", unfurl: false } },
  ]);

  // 2. Dois itens de conectores diferentes: lista, "Pode fazer" sem contador (tudo marcado).
  const bruno = await bot("Bruno", "c-teal");
  await fala(bruno.conversaId, "Terminei o fechamento. Faltam duas coisas.");
  await aprovacao(bruno, "Posso fechar o mês?", [
    { texto: "Avisar que setembro fechou em R$ 847 mil", conector: "slack", ferramenta: "send_message", argumentos: { channel: "#vendas" } },
    { texto: "Arquivar a planilha Vendas Q3 2025", conector: "drive", ferramenta: "move_file", argumentos: { fileId: "1aB2c3D4", parent: "/Arquivo/2025" } },
  ]);

  // 3. Item sensível junto de um comum: o sensível sai do modo enxuto e o contador VOLTA (1 de 2).
  const carla = await bot("Carla", "c-orange");
  await fala(carla.conversaId, "Preparei o resumo do acompanhamento.");
  await aprovacao(carla, "Posso fazer estas 2 coisas?", [
    { texto: "Avisar que a reunião é às 15h", conector: "slack", ferramenta: "send_message", argumentos: { channel: "#geral" } },
    { texto: "Enviar o relatório de progresso do João", conector: "slack", ferramenta: "send_message", argumentos: { channel: "#vendas" }, sensivel: true },
  ]);

  // 4. Um item sensível SOZINHO: continua com lista e caixa, nunca cai no modo enxuto.
  const diego = await bot("Diego", "c-red");
  await fala(diego.conversaId, "O material do acompanhamento está pronto.");
  await aprovacao(diego, "Posso enviar o relatório do cliente?", [
    { texto: "Enviar o relatório de progresso da Marina", conector: "gmail", ferramenta: "send", argumentos: { to: "coordenacao@escola.br", subject: "Progresso" }, sensivel: true },
  ]);

  // 5. Slug SEM conector casado: cai no próprio slug, nunca inventa nome.
  const eva = await bot("Eva", "c-blue");
  await fala(eva.conversaId, "Achei o registro no sistema antigo.");
  await aprovacao(eva, "Posso atualizar o cadastro?", [
    { texto: "Atualizar o cadastro do cliente 4471", conector: "sistema-legado", ferramenta: "update_record", argumentos: { id: 4471 } },
  ]);

  // 6. Lote grande: cinco itens, para ver a lista respirando (e o disclosure por item).
  const felipe = await bot("Felipe", "c-green");
  await fala(felipe.conversaId, "Organizei a semana inteira de uma vez.");
  await aprovacao(felipe, "Posso fazer estas 5 coisas?", [
    { texto: "Avisar a equipe sobre a retrospectiva", conector: "slack", ferramenta: "send_message", argumentos: { channel: "#time" } },
    { texto: "Arquivar as atas de agosto", conector: "drive", ferramenta: "move_file", argumentos: { fileId: "ata-08", parent: "/Arquivo" } },
    { texto: "Mandar o resumo para a diretoria", conector: "gmail", ferramenta: "send", argumentos: { to: "diretoria@acme.com.br" } },
    { texto: "Compartilhar a pasta do trimestre", conector: "drive", ferramenta: "share", argumentos: { fileId: "q3", role: "reader" } },
    { texto: "Avisar que o relatório saiu", conector: "slack", ferramenta: "send_message", argumentos: { channel: "#geral" } },
  ]);

  // 7. Turno de rotina: quem cria os itens é sempre pedirAprovacao, com tipo 'aprovacao' — 'gate_rotina'
  // é rótulo de plano (TIPOS_GATE_ROTINA em disparar-rotina.ts) e listar-sua-vez.ts:41 só carrega
  // itens para 'aprovacao'. Por isso o cenário da rotina usa 'aprovacao', como o produto faz.
  const gabi = await bot("Gabi", "c-pink");
  await fala(gabi.conversaId, "Resumo diário pronto (rotina das 8h).");
  await aprovacao(gabi, "Posso publicar o resumo diário?", [
    { texto: "Resumo de 21/09: 4 negócios fechados", conector: "slack", ferramenta: "send_message", argumentos: { channel: "#geral" } },
  ]);

  // 8. Decisão VENCIDA: cinza, sem ações, com reabrir — ADR-007 (nunca suprimida).
  const hugo = await bot("Hugo", "c-brown");
  const dVelha = await repos.decisoes.criar({ tipo: "aprovacao", agenteId: hugo.agenteId, conversaId: hugo.conversaId, turnoId: null, prazoDecisaoEm: agora - 60_000, frase: "Posso avisar sobre o evento de ontem?" });
  if (dVelha) {
    await repos.itensAprovacao.criarLote(dVelha.id, [{ idx: 0, texto: "Lembrete do evento", destino: { conector: "slack", ferramenta: "send_message", argumentos: { channel: "#geral" } }, origemSensivel: false }]);
    await repos.decisoes.vencerPendentes(agora);
  }

  // 9. Outros tipos de decisão, que NÃO mudaram: prova que o card novo não vazou para eles.
  const ivo = await bot("Ivo", "c-black");
  await repos.decisoes.criar({ tipo: "pergunta", agenteId: ivo.agenteId, conversaId: ivo.conversaId, turnoId: null, prazoDecisaoEm: agora + PRAZO, frase: "parei para perguntar a Marlon: uso o tom formal ou informal no anúncio?" });

  return [vera, bruno, carla, diego, eva, felipe, gabi, hugo, ivo].length;
});

log("info", "cenarios_prontos", { bots: criados, banco: new URL(url).port });
await db.end();
