import { ACOES_GERIR_MAQUINAS, type ErroGerirMaquinas, type MaquinaParaBot, type ResultadoGerirMaquinas } from "../contracts/ferramentas-maquinas.ts";
import type { CasoNod, SaidaCasoDeUso } from "../contracts/servicos.ts";
import { ehErroDeDominio } from "../domain/erro.ts";
import { EXECUTORES_MAQUINAS } from "./acoes/maquinas.ts";
import { alvoDoBot } from "./alvo-do-bot.ts";
import type { Deps } from "./tipos.ts";

/**
 * gerir_maquinas (definido em 2026-11-07, ADA-243, ADR-135): a via do chat do `maquinas.definir_padrao` e a leitura
 * "onde os bots trabalham", para QUALQUER bot, na conversa com a pessoa. Escolher a padrão chama o MESMO executor da tela
 * (EXECUTORES_MAQUINAS). Risco "muda": aplica direto em todo modo, como os times (só muda onde os bots sem máquina rodam
 * e se desfaz pedindo de novo ou no seletor da tela).
 *
 * Cercas (as do gerir_times): o turno é do bot, é conversa ou criação, de primeira mão (sem procuração de colega), não
 * foi parado e, para mudar, nada de fora entrou nele. Listar só lê.
 */

const MODOS = new Set(["conversa", "criacao"]);
const INSTRUCAO: Record<ErroGerirMaquinas, string> = {
  fora_da_conversa: "Nada mudou. gerir_maquinas só muda a máquina padrão na conversa com a pessoa, a pedido dela.",
  entrada_invalida: "Nada mudou. Mande acao listar, ou definir_padrao com maquina (o nome) ou qualquer_uma: true.",
  nao_encontrado: "Nada mudou. Essa máquina não é da pessoa (ou foi desconectada). As opções estão em opcoes: pergunte qual.",
  nome_ambiguo: "Nada mudou. Há mais de uma máquina com esse nome: pergunte à pessoa qual e chame de novo com o id.",
};

const falha = (erro: ErroGerirMaquinas, o: { detalhe?: string; opcoes?: string[] } = {}): SaidaCasoDeUso<ResultadoGerirMaquinas> => ({
  data: { ok: false, erro, instrucao: o.detalhe ? `${o.detalhe} ${INSTRUCAO[erro]}` : INSTRUCAO[erro], ...(o.opcoes ? { opcoes: o.opcoes } : {}) },
});

export const normalizar = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** As máquinas que podem rodar bot (vivas, não só-computador), do jeito que o bot as recebe. */
async function maquinasDaPessoa(deps: Deps): Promise<MaquinaParaBot[]> {
  const [chaves, prefs] = await Promise.all([deps.repos.maquinaTokens.listar(), deps.repos.preferencias.buscar()]);
  const servico = deps.services.maquinas;
  return chaves
    .filter((c) => c.revogadaEm === null && c.papel !== "computador")
    .map((c) => ({ id: c.id, nome: c.nome, ligada: servico?.conectada?.(deps.escopo, c.id) ?? false, plataforma: servico?.plataforma?.(deps.escopo, c.id) ?? null, padrao: c.id === (prefs.maquinaPadraoId ?? null) }));
}

/** O nome (ou id) pedido → a máquina. Pura, exportada para o teste. */
export function acharMaquina(pedido: string, maquinas: readonly Pick<MaquinaParaBot, "id" | "nome">[]): { ok: true; id: string; nome: string } | { ok: false; erro: "nao_encontrado" | "nome_ambiguo"; opcoes: string[] } {
  const porId = maquinas.find((m) => m.id === pedido.trim());
  if (porId) return { ok: true, id: porId.id, nome: porId.nome };
  const chave = normalizar(pedido);
  // Revisão do PR #692: o pedido que some na normalização casaria por "parte do nome" com TODAS (e escolheria a única).
  if (!chave) return { ok: false, erro: "nao_encontrado", opcoes: maquinas.map((m) => m.nome) };
  const iguais = maquinas.filter((m) => normalizar(m.nome) === chave);
  const achados = iguais.length > 0 ? iguais : maquinas.filter((m) => normalizar(m.nome).includes(chave));
  if (achados.length === 1 && achados[0]) return { ok: true, id: achados[0].id, nome: achados[0].nome };
  if (achados.length > 1) return { ok: false, erro: "nome_ambiguo", opcoes: achados.map((m) => `${m.nome} (${m.id})`) };
  return { ok: false, erro: "nao_encontrado", opcoes: maquinas.map((m) => m.nome) };
}

export const gerirMaquinas: CasoNod<Deps, "gerir_maquinas"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const modo = input.plano?.modoTurno ?? turno?.origem ?? null;
  if (!turno || turno.agenteId !== input.agenteId || turno.conversaId !== input.conversaId || !modo || !MODOS.has(modo) || turno.profundidade > 0) return falha("fora_da_conversa");
  if (turno.sobProcuracaoDe != null && turno.sobProcuracaoDe !== deps.escopo.pessoaId) return falha("fora_da_conversa", { detalhe: "Este turno é um pedido de outra pessoa." });
  if (!(ACOES_GERIR_MAQUINAS as readonly string[]).includes(input.acao)) return falha("entrada_invalida");
  const maquinas = await maquinasDaPessoa(deps);
  const padrao = maquinas.find((m) => m.padrao) ?? null;

  if (input.acao === "listar") {
    let bot: { nome: string; trabalha_em: string | null; ligada: boolean | null } | undefined;
    if (typeof input.bot === "string" && input.bot.trim() !== "") {
      const agentes = await deps.repos.agentes.listar();
      const porId = agentes.find((a) => a.id === input.bot);
      const porNome = agentes.filter((a) => normalizar(a.nome) === normalizar(input.bot ?? ""));
      const a = porId ?? (porNome.length === 1 ? porNome[0] : undefined);
      if (!a) return falha("nao_encontrado", { detalhe: `"${input.bot}" não é um bot da pessoa.`, opcoes: agentes.map((x) => x.nome).slice(0, 50) });
      const alvo = await alvoDoBot(deps, a.id);
      bot = { nome: a.nome, trabalha_em: alvo?.nome ?? null, ligada: alvo ? (maquinas.find((m) => m.id === alvo.id)?.ligada ?? false) : null };
    }
    const sobreBot = bot ? (bot.trabalha_em ? ` ${bot.nome} trabalha no ${bot.trabalha_em}${bot.ligada ? ", que está ligado" : ", que está desligado"}.` : ` ${bot.nome} roda em qualquer máquina conectada.`) : "";
    return { data: { ok: true, maquinas, padrao: padrao?.nome ?? null, ...(bot ? { bot } : {}), instrucao: `Responda numa frase curta, pelo nome das máquinas.${sobreBot}` } };
  }

  // definir_padrao: muda onde os bots trabalham, então só num turno limpo (uma página lida não move os bots por injeção).
  if (turno.pararSolicitadoEm != null || turno.estado === "interrompido") return falha("fora_da_conversa", { detalhe: "Este turno foi parado." });
  const limpo = turno.entradaConfianca === "confiavel" && input.plano?.confiancaEntrada !== "nao_confiavel" && !(await deps.repos.turnos.contaminado(turno.id));
  if (!limpo) return falha("fora_da_conversa", { detalhe: "Este turno leu conteúdo de fora: a máquina padrão só muda a pedido direto da pessoa." });
  const temMaquina = typeof input.maquina === "string" && input.maquina.trim() !== "";
  if (temMaquina === (input.qualquer_uma === true)) return falha("entrada_invalida");
  let alvo: { id: string; nome: string } | null = null;
  if (temMaquina) {
    const r = acharMaquina(input.maquina ?? "", maquinas);
    if (!r.ok) return falha(r.erro, { opcoes: r.opcoes });
    alvo = { id: r.id, nome: r.nome };
  }
  try {
    await EXECUTORES_MAQUINAS["maquinas.definir_padrao"](deps, { maquinaId: alvo?.id ?? null });
  } catch (e) {
    if (ehErroDeDominio(e) && e.codigo === "nao_encontrado") return falha("nao_encontrado", { opcoes: maquinas.map((m) => m.nome) });
    throw e;
  }
  const desligada = alvo && !maquinas.find((m) => m.id === alvo.id)?.ligada;
  return {
    data: {
      ok: true,
      padrao: alvo,
      instrucao: alvo
        ? `Feito: o ${alvo.nome} agora é a máquina padrão; os bots sem máquina própria trabalham nele${desligada ? " (ele está desligado: começam quando ele voltar)" : ""}. Responda numa frase curta.`
        : "Feito: sem máquina padrão; os bots sem máquina própria rodam em qualquer uma conectada. Responda numa frase curta.",
    },
  };
};
