/**
 * Cenário de UAT da conversa "depois" (canvas "Uma conversa de verdade · depois", 2026-10-03).
 *
 * Popula um banco EFÊMERO com uma conversa da Ada que mostra os doze itens do canvas de uma vez: balões, markdown com
 * lista/tabela/links, a linha da memória, o artefato, as aprovações ancoradas (um item e lista) e a pergunta aberta.
 * A parte AO VIVO (cartão de atividade, "Na fila" e o balão em streaming da Nina) não se finge no banco — ela só existe
 * nos frames SSE — e sai de turnos reais do catcher: `scripts/cenario-conversa-depois-ao-vivo.ts`, que pode ser
 * rodado de novo sempre que o turno acabar. Não é seed do produto e não roda no CI.
 *
 *   npm run db:efemero:up -- chat-depois 5437
 *   DATABASE_URL=postgres://nod_app:nod@127.0.0.1:5437/nod node scripts/cenario-conversa-depois.ts
 */
import { randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import type { Autoria } from "../src/contracts/evento.ts";
import { MODELO_AGENTE_PADRAO } from "../src/contracts/modelos.ts";
import { criarDb } from "../src/db/client.ts";
import { PESSOA_MARLON } from "../src/db/seed/index.ts";
import { abrirTxEscopada } from "../src/db/tx.ts";
import { textoDaPublicacao } from "../src/domain/artefato.ts";
import { log } from "../src/obs/log.ts";
import { criarRepos } from "../src/repositories/index.ts";
import type { Escopo } from "../src/shared/types.ts";
import { autoriaPessoa } from "../src/use-cases/autoria-evento.ts";

const url = process.env.DATABASE_URL;
if (!url || !/:(543[5-9]|54[4-9][0-9])\//.test(url)) {
  // A porta 5434 é o banco diário (AGENTS.md); este script cria lixo de UAT de propósito.
  log("erro", "cenario_banco_nao_efemero", { dica: "DATABASE_URL de um banco efêmero (npm run db:efemero:up -- chat-depois 5437)" });
  process.exit(1);
}

const db = criarDb(url, { max: 2 });
const [pessoa] = await db<{ id: string; tenant_id: string }[]>`select id, tenant_id from pessoas where id = ${PESSOA_MARLON}`;
if (!pessoa) {
  log("erro", "cenario_sem_pessoa", { dica: "rode o seed no banco efêmero" });
  process.exit(1);
}
const escopo: Escopo = { tenantId: pessoa.tenant_id, pessoaId: pessoa.id };
const emTransacao = abrirTxEscopada(db, escopo);
/** Cada linha na sua transação, com um respiro: `criado_em` é now() da transação, e a ordem da conversa vem dele. */
async function passo<T>(fn: (repos: ReturnType<typeof criarRepos>) => Promise<T>): Promise<T> {
  const r = await emTransacao((trx) => fn(criarRepos(trx, escopo)));
  await esperar(15);
  return r;
}

const PRAZO = 23 * 60 * 60 * 1000;
const pessoaFala: Autoria = autoriaPessoa(escopo);
const doBot = (agenteId: string): Autoria => ({ ...autoriaPessoa(escopo), autor_tipo: "agente", autor_id: agenteId });

// Conectores com o nome que o card mostra ("Google Sheets", não "googlesheets"). Reexecutável: slug é UNIQUE.
await passo(async (repos) => {
  for (const c of [
    { slug: "googlesheets", nome: "Google Sheets", cap: ["update_values", "get_values"] },
    { slug: "slack", nome: "Slack", cap: ["send_message", "search_messages"] },
  ]) {
    const conector = (await repos.conectores.buscarPorSlug(c.slug)) ?? (await repos.conectores.criar({ nome: c.nome, slug: c.slug, transporte: "stdio", comando: "node", args: ["scripts/mcp-exemplo.mjs"], declaracao: "nao-toca" }));
    if (!conector) continue;
    await repos.conectores.registrarSonda(conector.id, { ok: true, catalogo: c.cap.map((nome) => ({ nome, descricao: nome, schema: { type: "object" as const }, readOnlyHint: nome.startsWith("get") || nome.startsWith("search") })), agora: Date.now() });
  }
});

async function bot(nome: string, titulo: string, forma: "shape-square" | "shape-circle", cor: "c-blue" | "c-purple"): Promise<{ agenteId: string; conversaId: string }> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  await passo(async (repos) => {
    await repos.agentes.criar({ id: agenteId, nome, titulo, dono: "pessoa", forma, cor, modelo: MODELO_AGENTE_PADRAO, confirmado: true });
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
  });
  return { agenteId, conversaId };
}

const ada = await bot("Ada", "Analista de vendas", "shape-square", "c-blue");
const nina = await bot("Nina", "Redatora", "shape-circle", "c-purple");

const texto = (alvo: { conversaId: string }, autoria: Autoria, conteudo: string, payload: Parameters<ReturnType<typeof criarRepos>["mensagens"]["criar"]>[0]["payload"] = null) =>
  passo((repos) => repos.mensagens.criar({ conversaId: alvo.conversaId, turnoId: null, autoria, kind: "texto", texto: conteudo, payload, confianca: "confiavel" }));

// ---------------------------------------------------------------- a conversa da Ada

await texto(ada, pessoaFala, "Bom dia! Fecha o relatório de vendas de setembro pra mim?");
await texto(ada, doBot(ada.agenteId), [
  "## Vendas de setembro",
  "Fechei o relatório: **R$ 482 mil** de receita, *12% acima de agosto*. O que puxou o mês:",
  "",
  "- o Sudeste sozinho fez **R$ 210 mil**",
  "- o ticket médio subiu para R$ 1.380",
  "- três contas grandes renovaram antes do prazo",
  "",
  "| Região | Receita | vs. agosto |",
  "|---|--:|--:|",
  "| Sudeste | R$ 210 mil | +15% |",
  "| Sul | R$ 98 mil | +9% |",
  "| Nordeste | R$ 74 mil | +11% |",
  "| Norte | R$ 58 mil | +6% |",
  "| Centro-Oeste | R$ 42 mil | +18% |",
  "",
  "A planilha completa está em https://docs.google.com/spreadsheets/d/1aB2c3D4e5F6/edit e o ajuste do painel subiu no [PR da loja](https://github.com/acme/loja-web/pull/481).",
].join("\n"));
await texto(ada, pessoaFala, "Ótimo. Daqui pra frente, sempre em reais e sem centavos.");
await passo(async (repos) => {
  await repos.memorias.criar({ agenteId: ada.agenteId, tipo: "preferencia", texto: "relatórios de vendas sempre em reais, sem centavos", origem: "agente" });
  await repos.mensagens.criar({ conversaId: ada.conversaId, turnoId: null, autoria: doBot(ada.agenteId), kind: "sistema", assunto: "memoria.anotada", texto: "Anotei uma preferência: relatórios de vendas sempre em reais, sem centavos", confianca: "confiavel" });
});
await texto(ada, pessoaFala, "/uso");
await texto(ada, pessoaFala, "Monta um painel com isso pra diretoria?");
await passo(async (repos) => {
  const artefato = await repos.artefatos.criar({ agenteId: ada.agenteId, conversaId: ada.conversaId, titulo: "Painel de vendas · setembro" });
  if (!artefato) throw new Error("artefato não criado");
  const m = await repos.mensagens.criar({ conversaId: ada.conversaId, turnoId: null, autoria: doBot(ada.agenteId), kind: "artefato", texto: textoDaPublicacao({ titulo: artefato.titulo, versao: 1, artefatoId: artefato.id }), payload: { kind: "artefato", artefatoId: artefato.id, versao: 1, titulo: artefato.titulo }, confianca: "confiavel" });
  if (!m) throw new Error("mensagem do artefato não criada");
  await repos.artefatos.gravarVersao({ artefatoId: artefato.id, versao: 1, html: painel(), mensagemId: m.id });
});
await texto(ada, doBot(ada.agenteId), "Pronto, o painel está acima — dá para abrir em nova aba. Vou atualizar a planilha de metas com esses números; preciso do seu ok.");
await passo(async (repos) => {
  const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId: ada.agenteId, conversaId: ada.conversaId, turnoId: null, prazoDecisaoEm: Date.now() + PRAZO, frase: "Atualizar a planilha de metas com a receita de setembro" });
  if (!d) throw new Error("decisão não criada");
  await repos.itensAprovacao.criarLote(d.id, [{
    idx: 0,
    texto: "Atualizar a planilha de metas com a receita de setembro",
    destino: { conector: "googlesheets", ferramenta: "update_values", argumentos: { spreadsheetId: "1aB2c3D4e5F6", range: "Metas!B2:C7", values: [["Sudeste", "R$ 210 mil"], ["Sul", "R$ 98 mil"], ["Nordeste", "R$ 74 mil"], ["Norte", "R$ 58 mil"], ["Centro-Oeste", "R$ 42 mil"], ["Total", "R$ 482 mil"]] } },
    origemSensivel: false,
  }]);
});
await texto(ada, pessoaFala, "E avisa o time comercial também.");
await texto(ada, doBot(ada.agenteId), "Preparei três avisos no Slack. Confere antes de eu mandar:");
await passo(async (repos) => {
  const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId: ada.agenteId, conversaId: ada.conversaId, turnoId: null, prazoDecisaoEm: Date.now() + PRAZO, frase: "Posso mandar estes 3 avisos?" });
  if (!d) throw new Error("decisão não criada");
  await repos.itensAprovacao.criarLote(d.id, [
    { idx: 0, texto: "Setembro fechou em R$ 482 mil, 12% acima de agosto", destino: { conector: "slack", ferramenta: "send_message", argumentos: { channel: "#comercial", text: "Setembro fechou em R$ 482 mil, 12% acima de agosto" } }, origemSensivel: false },
    { idx: 1, texto: "Parabéns ao time do Sudeste pelos R$ 210 mil", destino: { conector: "slack", ferramenta: "send_message", argumentos: { channel: "#sudeste", text: "Parabéns ao time do Sudeste pelos R$ 210 mil" } }, origemSensivel: false },
    { idx: 2, texto: "O painel da diretoria está no ar", destino: { conector: "slack", ferramenta: "send_message", argumentos: { channel: "#diretoria", text: "O painel da diretoria está no ar" } }, origemSensivel: false },
  ]);
});
await passo(async (repos) => {
  const pergunta = "Posso mandar o painel para a diretoria e para o time comercial, ou só para a diretoria?";
  const d = await repos.decisoes.criar({ tipo: "pergunta", agenteId: ada.agenteId, conversaId: ada.conversaId, turnoId: null, prazoDecisaoEm: Date.now() + PRAZO, frase: `parei para perguntar a Marlon: ${pergunta}` });
  if (!d) throw new Error("pergunta não criada");
  await repos.mensagens.criar({ conversaId: ada.conversaId, turnoId: null, autoria: doBot(ada.agenteId), kind: "texto", texto: pergunta, payload: { kind: "pedido_a_pessoa", decisaoId: d.id, opcoes: ["Pode mandar para os dois", "Só para a diretoria"] }, confianca: "confiavel" });
});

// ---------------------------------------------------------------- a conversa da Nina (só o streaming ao vivo)

await texto(nina, pessoaFala, "Oi, Nina! Vou te pedir um texto daqui a pouco.");
await texto(nina, doBot(nina.agenteId), "Combinado. Quando quiser, é só mandar.");

process.stdout.write(`${JSON.stringify({ ada, nina })}\n`);
await db.end();

/** O artefato: HTML com CSS e um pouco de JS (o filtro), como um painel de verdade. */
function painel(): string {
  return `<style>
body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:20px;color:#171d2d;background:#fff}
h1{font-size:18px;margin:0 0 4px}p{margin:0 0 16px;color:#6b7389}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}
.kpi{border:1px solid #e3e6ec;border-radius:12px;padding:12px}.kpi b{display:block;font-size:20px}.kpi span{font-size:12px;color:#6b7389}
.linha{display:grid;grid-template-columns:110px 1fr 90px;align-items:center;gap:10px;margin:6px 0;font-size:13px}
.barra{height:10px;border-radius:6px;background:#2554a2}
button{border:1px solid #d7dbe2;background:#fff;border-radius:8px;padding:5px 10px;margin-right:6px;cursor:pointer}
button[aria-pressed=true]{background:#171d2d;color:#fff;border-color:#171d2d}
</style>
<h1>Vendas de setembro</h1><p>Receita por região · fechamento de 30/09</p>
<div class="kpis"><div class="kpi"><b>R$ 482 mil</b><span>receita</span></div><div class="kpi"><b>+12%</b><span>vs. agosto</span></div><div class="kpi"><b>R$ 1.380</b><span>ticket médio</span></div></div>
<div><button aria-pressed="true" data-f="todas">Todas</button><button aria-pressed="false" data-f="acima">Acima de 10%</button></div>
<div id="linhas"></div>
<script>
const dados=[["Sudeste",210,15],["Sul",98,9],["Nordeste",74,11],["Norte",58,6],["Centro-Oeste",42,18]];
function desenhar(f){document.getElementById("linhas").innerHTML=dados.filter(d=>f==="todas"||d[2]>10).map(d=>'<div class="linha"><span>'+d[0]+'</span><div class="barra" style="width:'+(d[1]/210*100)+'%"></div><span>R$ '+d[1]+' mil</span></div>').join("")}
document.querySelectorAll("button").forEach(b=>b.onclick=()=>{document.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));desenhar(b.dataset.f)});
desenhar("todas");
</script>`;
}
