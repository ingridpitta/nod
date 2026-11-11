import { QUADROS_COM_EXIBIR_MAX, USOS_DO_MAC, VISOES_DO_QUADRO, type ExibirDoQuadro, type VisaoDoQuadro, type Experimentos, type Preferencias, type RaioXConversa, type RaioXTurno, type UsoDoMac } from "../contracts/raio-x.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { CAMPOS_DAS_OPCOES, lerOpcoesDoQuadro, temOpcoes } from "../domain/opcoes-do-quadro.ts";
import { lerOrdemDaPessoa } from "../domain/inteligencia.ts";
import { resumoDoRaioX } from "../domain/raio-x.ts";
import { rotuloFerramenta } from "../domain/rotulo-ferramenta.ts";
import type { CasoDeUso } from "./tipos.ts";

/** Turnos que a faixa dev cobre numa conversa: os mais recentes, o bastante para a tela aberta. */
export const TURNOS_NO_RAIO_X_DA_CONVERSA = 300;

export const lerPreferencias: CasoDeUso<Record<string, never>, Preferencias> = async (deps) => ({ data: await deps.repos.preferencias.buscar() });

/**
 * PUT preferencias: o que vier muda, o resto fica. revisto em 2026-10-12 (ADR-099, I10): `faixaTrabalhosRecolhida`
 * (ADR-083) saiu — a web não a mandava desde 09/10; vinda, é ignorada como qualquer chave desconhecida. revisto em 2026-10-08 (ADR-085): `usoDoMac` ('pouco' | 'equilibrado' | 'livre'), de Seu
 * espaço › Este Mac. revisto em 2026-10-10 (0068, emenda da ADR-036): `ordemIas`, a ordem do Automático arrastada em
 * Provedores de IA (lista das IAs integradas, completada no fim com as que faltarem; null = a padrão). Corpo sem nenhum
 * dos três, ou com valor fora do tipo, é entrada inválida.
 */
/**
 * revisto em 2026-10-16 (ADR-111, 0088): `experimentos`, as chaves do menu da conta — `{calibracao?, memoriaLonga?, whatsapp?, quadro?}`, cada
 * uma booleana; a que vier muda sozinha. Objeto vazio, com chave desconhecida ou valor fora do tipo é entrada inválida.
 * ADR-112 (0089): `whatsapp`, do mesmo jeito. NOD-429 (0130): `quadro`, do mesmo jeito.
 */
function lerExperimentos(v: unknown): Partial<Experimentos> | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ErroDeDominio("entrada_invalida", { cause: "experimentos" });
  const chaves = Object.keys(v);
  const validas: readonly string[] = ["calibracao", "memoriaLonga", "whatsapp", "quadro"];
  if (chaves.length === 0 || chaves.some((k) => !validas.includes(k) || typeof (v as Record<string, unknown>)[k] !== "boolean")) throw new ErroDeDominio("entrada_invalida", { cause: "experimentos" });
  return v as Partial<Experimentos>;
}

export const gravarPreferencias: CasoDeUso<{ modoDev?: unknown; usoDoMac?: unknown; ordemIas?: unknown; experimentos?: unknown }, Preferencias> = async (deps, input) => {
  const ok = (v: unknown) => v === undefined || typeof v === "boolean";
  const usoOk = input.usoDoMac === undefined || (typeof input.usoDoMac === "string" && (USOS_DO_MAC as readonly string[]).includes(input.usoDoMac));
  const nenhum = input.modoDev === undefined && input.usoDoMac === undefined && input.ordemIas === undefined && input.experimentos === undefined;
  if (!ok(input.modoDev) || !usoOk || nenhum) throw new ErroDeDominio("entrada_invalida", { cause: "preferencias" });
  const ordemIas = input.ordemIas === undefined ? undefined : lerOrdemDaPessoa(input.ordemIas);
  const experimentos = lerExperimentos(input.experimentos);
  return {
    data: await deps.repos.preferencias.gravar({
      ...(ordemIas !== undefined ? { ordemIas } : {}),
      ...(experimentos ? { experimentos } : {}),
      ...(typeof input.modoDev === "boolean" ? { modoDev: input.modoDev } : {}),
      ...(input.usoDoMac !== undefined ? { usoDoMac: input.usoDoMac as UsoDoMac } : {}),
    }),
  };
};

/**
 * Chave de aviso da tela (0059): tipo e variante separados por ":", em minúsculas — "modo:total". Curta e fechada,
 * porque vira linha de banco de quem clica; o teto de 50 chaves da 0059 é guardado aqui antes (erro de entrada, não 500).
 */
const CHAVE_AVISO = /^[a-z][a-z0-9_-]{0,30}(:[a-z0-9_-]{1,30})?$/;
export const AVISOS_FECHADOS_MAX = 50;

export const fecharAviso: CasoDeUso<{ chave: unknown }, Preferencias> = async (deps, input) => {
  if (typeof input.chave !== "string" || !CHAVE_AVISO.test(input.chave)) throw new ErroDeDominio("entrada_invalida", { cause: "chave" });
  const atual = await deps.repos.preferencias.buscar();
  if (atual.avisosFechados.includes(input.chave)) return { data: atual };
  if (atual.avisosFechados.length >= AVISOS_FECHADOS_MAX) throw new ErroDeDominio("entrada_invalida", { cause: "avisos_fechados cheio" });
  return { data: await deps.repos.preferencias.fecharAviso(input.chave) };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * NOD-460: o Exibir do quadro em tela cheia (colunas recolhidas à mostra e densidade compacta), da pessoa e por quadro.
 * Estado da própria tela: não muda o quadro nem os bots, por isso não passa pelo lote nem tem Desfazer. O id não precisa
 * ser de um quadro que a pessoa vê (a chave é só dela e não revela nada); o teto de quadros guardados vem antes do banco.
 */
export const exibirDoQuadro: CasoDeUso<{ quadroId: unknown; recolhidas?: unknown; compacto?: unknown; visao?: unknown } & Partial<Record<(typeof CAMPOS_DAS_OPCOES)[number], unknown>>, Preferencias> = async (deps, input) => {
  if (typeof input.quadroId !== "string" || !UUID.test(input.quadroId)) throw new ErroDeDominio("entrada_invalida", { cause: "quadro" });
  // ADA-18: cada campo é opcional (o chat troca só a visão); o que vem tem de ser do tipo certo, e algum tem de vir.
  const { recolhidas, compacto, visao } = input;
  if ((recolhidas !== undefined && typeof recolhidas !== "boolean") || (compacto !== undefined && typeof compacto !== "boolean")) throw new ErroDeDominio("entrada_invalida", { cause: "exibir" });
  if (visao !== undefined && !(VISOES_DO_QUADRO as readonly unknown[]).includes(visao)) throw new ErroDeDominio("entrada_invalida", { cause: "visao" });
  // Quadro minimalista (2026-11-10): as Opções do quadro, com a mesma validação da op exibir do gerir_quadro.
  const opcoes = lerOpcoesDoQuadro(input);
  if ("erro" in opcoes) throw new ErroDeDominio("entrada_invalida", { cause: opcoes.erro });
  if (recolhidas === undefined && compacto === undefined && visao === undefined && !temOpcoes(opcoes)) throw new ErroDeDominio("entrada_invalida", { cause: "exibir" });
  const quadroId = input.quadroId.toLowerCase();
  const mudanca: Partial<ExibirDoQuadro> = { ...(recolhidas !== undefined ? { recolhidas } : {}), ...(compacto !== undefined ? { compacto } : {}), ...(visao !== undefined ? { visao: visao as VisaoDoQuadro } : {}), ...opcoes };
  const p = await deps.repos.preferencias.exibirQuadro(quadroId, mudanca, QUADROS_COM_EXIBIR_MAX);
  if (!p) throw new ErroDeDominio("entrada_invalida", { cause: "quadro_exibir cheio" });
  return { data: p };
};

/** O Raio-X inteiro de um turno (a gaveta). Turno que a pessoa não vê é nao_encontrado, como em GET turnos/:id. */
export const raioXDoTurno: CasoDeUso<{ turnoId: string }, RaioXTurno> = async (deps, input) => {
  const t = await deps.repos.raioX.doTurno(input.turnoId);
  if (!t) throw new ErroDeDominio("nao_encontrado", { cause: "turno" });
  // NOD-352: o nome amigável de cada id para o `title` do Raio-X (a web não lê o domínio, ADR-018).
  const nomes = new Map<string, string>();
  for (const c of t.execucao?.chamadas ?? []) for (const f of c.ferramentas) if (!nomes.has(f.nome)) nomes.set(f.nome, rotuloFerramenta(f.nome));
  return { data: { ...t, nomesDasFerramentas: Object.fromEntries(nomes) } };
};

/** A faixa dev de cada resposta da conversa e o total desde `desde` (a meia-noite de quem pergunta). */
export const raioXDaConversa: CasoDeUso<{ conversaId: string; desde: number }, RaioXConversa> = async (deps, input) => {
  const [turnos, total, parcial] = await Promise.all([
    deps.repos.raioX.daConversa(input.conversaId, TURNOS_NO_RAIO_X_DA_CONVERSA),
    deps.repos.raioX.totalDesde(input.conversaId, input.desde),
    deps.repos.gastos.algumSemCusto({ desde: input.desde, ate: deps.agora(), conversaId: input.conversaId }),
  ]);
  const desde = parcial ? { ...total, parcial: true } : total;
  return {
    data: {
      turnos: turnos.filter((t) => t.execucao !== null || t.custoUsd !== null).map((t) => resumoDoRaioX(t.turnoId, t.custoUsd, t.execucao)),
      desde,
    },
  };
};
