/**
 * A parte AO VIVO do cenário da conversa "depois" (scripts/cenario-conversa-depois.ts): turnos reais do catcher, que é
 * de onde vêm os frames SSE do cartão de atividade e do streaming.
 * - Ada: um turno longo que alterna narração e ferramentas só de leitura → cartão de atividade com mascote e "ao vivo".
 *   (Uma segunda mensagem no meio do turno não fica "Na fila": o turno vivo a absorve — motivo_interrupcao absorvido.)
 * - Nina: um turno longo só de texto, sem ferramenta → balão em streaming já formatado.
 * O texto das mensagens da pessoa é trocado por uma frase limpa: o roteiro do catcher ([[delta: …]]) mora em
 * turnos.entrada_texto e não precisa aparecer no balão. Rode de novo quando o turno acabar.
 *
 *   CARGA_API_PORTA=8893 DATABASE_URL=postgres://nod_app:nod@127.0.0.1:5437/nod node scripts/cenario-conversa-depois-ao-vivo.ts
 */
import { criarDb } from "../src/db/client.ts";
import { abrirTxEscopada } from "../src/db/tx.ts";
import { log } from "../src/obs/log.ts";
import { api, entrar } from "./carga-tela/comum.ts";

const url = process.env.DATABASE_URL;
if (!url || !/:(543[5-9]|54[4-9][0-9])\//.test(url)) {
  log("erro", "cenario_banco_nao_efemero", { dica: "DATABASE_URL de um banco efêmero" });
  process.exit(1);
}
/** Quantas voltas de narração + ferramenta; com o catcher a 700 ms por evento, 600 voltas ≈ 20 min de turno vivo. */
const VOLTAS = Number(process.env.CENARIO_VOLTAS ?? 600);

const s = await entrar("Marlon");
const frota = await api<{ agentes: { id: string; nome: string; conversaId: string; excluidoEm?: string | null }[] }>(s, "GET", "frota");
const ada = frota.agentes.find((a) => a.nome === "Ada" && !a.excluidoEm);
const nina = frota.agentes.find((a) => a.nome === "Nina" && !a.excluidoEm);
if (!ada || !nina) throw new Error("rode antes scripts/cenario-conversa-depois.ts");

type Resposta = { ids: { mensagem: string } };
const db = criarDb(url, { max: 2 });
const limpar = (mensagemId: string, texto: string): Promise<unknown> =>
  abrirTxEscopada(db, { tenantId: s.tenantId, pessoaId: s.pessoaId })((trx) => trx`update mensagens set texto = ${texto} where id = ${mensagemId}`);

/**
 * O catcher apara cada [[delta: …]] (tests/helpers/catcher-roteiro.ts), e o espaço ou a quebra de linha ENTRE dois
 * pedaços sumiria. Cada pedaço começa com um espaço de largura zero (U+200B, que trim() não tira) seguido do espaço ou
 * das quebras que o separam do anterior; ele fica invisível no fim da linha de cima.
 */
const Z = "\u200b";
const pedacos = (lista: readonly string[]): string => lista.map((p) => `[[delta: ${Z}${p}]]`).join(" ");

// Rodada anterior interrompida: nenhum roteiro do catcher fica à vista num balão.
await abrirTxEscopada(db, { tenantId: s.tenantId, pessoaId: s.pessoaId })((trx) => trx`update mensagens set texto = 'Agora revisa o PR #481 da loja e me diz se dá pra subir hoje.' where conversa_id in (${ada.conversaId}, ${nina.conversaId}) and autor_tipo = 'pessoa' and texto like '%[[delta:%'`);

const PASSOS = [
  " Abrindo os arquivos alterados do PR https://github.com/acme/loja-web/pull/481 e conferindo os testes do carrinho.",
  " Cruzando com as rotinas que rodam no deploy.",
  " O cálculo do frete mudou em **dois** lugares;",
  " vou checar se o cache do checkout acompanha.",
];
const roteiroAda = Array.from({ length: VOLTAS }, (_, i) => `${pedacos([PASSOS[i % PASSOS.length]!, ` (passo ${i + 1})`])} [[tool: ${i % 2 ? "ver_colegas" : "listar_rotinas"} {}]]`).join(" ")
  + " [[texto: Revisei o PR #481: **pode subir hoje**, com uma ressalva no cache do checkout.]]";
// Com o turno da rodada anterior ainda vivo, ele mesmo serve: não manda outro.
const emCurso = (await api<{ turnosEmCurso: unknown[] }>(s, "GET", `conversas/${ada.conversaId}/mensagens`)).turnosEmCurso.length > 0;
if (!emCurso) {
  const enviada = await api<Resposta>(s, "POST", `conversas/${ada.conversaId}/mensagens`, { texto: roteiroAda });
  await limpar(enviada.ids.mensagem, "Agora revisa o PR #481 da loja e me diz se dá pra subir hoje.");
}


const FRASES = [
  "Aqui vai uma **proposta** de texto para o anúncio:",
  "\n\n## Setembro em números",
  "\nFechamos o mês com *R$ 482 mil*,",
  " 12% acima de agosto.",
  "\n\n- o Sudeste puxou o resultado",
  "\n- ticket médio de R$ 1.380",
  "\n- três renovações antecipadas",
  "\n\n| Região | Receita |\n|---|--:|\n| Sudeste | R$ 210 mil |\n| Sul | R$ 98 mil |",
  "\n\nQuer que eu ajuste o tom?",
  " Posso deixar mais curto, ou mais animado.",
];
// Uma versão do texto atrás da outra, devagar: o balão cresce formatado o tempo todo.
const roteiroNina = Array.from({ length: Math.ceil((VOLTAS * 2) / FRASES.length) }, (_, v) => pedacos([...FRASES.map((f, i) => (i === 0 && v ? `\n\n${f}` : f))])).join(" ") + " [[texto: Texto pronto.]]";
const daNina = await api<Resposta>(s, "POST", `conversas/${nina.conversaId}/mensagens`, { texto: roteiroNina });
await limpar(daNina.ids.mensagem, "Escreve o anúncio de setembro para o time?");

process.stdout.write(`ao vivo: Ada (cartão de atividade) e Nina (streaming) por ~${Math.round((VOLTAS * 3 * 0.7) / 60)} min\n`);
await db.end();
