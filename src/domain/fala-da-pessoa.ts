/**
 * definido em 2026-11-07 (ADA-15, ADR-154): a aprovação da pessoa presa à fala dela. Puro: recebe as falas que o
 * servidor já filtrou (texto da própria pessoa, confiável, sem procuração, na conversa do turno, que abriu o turno ou
 * entrou nele) e escolhe a que autoriza o passo numa tarefa: posterior à pergunta do card e citando a tarefa.
 */

export type Fala = { id: string; conversaId: string; texto: string; criadoEm: number };

/** O que identifica a tarefa na fala: o código (ex.: ADA-2) e o item do Linear (ex.: NOD-12). */
export type CitacoesDaTarefa = { codigo: string; linearId: string | null };

const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A fala cita a tarefa pelo código ou pelo item do Linear, sem diferenciar caixa e com fronteira: `ADA-21` não casa
 * `ADA-2`, e `XADA-2` também não. O `#` da frente (`#ADA-2`) vale.
 */
export function citaTarefa(texto: string, c: CitacoesDaTarefa): boolean {
  const alvos = [c.codigo, c.linearId].filter((x): x is string => typeof x === "string" && x.trim() !== "" && !x.startsWith("#"));
  return alvos.some((a) => new RegExp(`(?<![\\p{L}\\p{N}_-])${escapar(a.trim())}(?![\\p{N}\\p{L}_])`, "iu").test(texto));
}

export const ERROS_FALA = {
  semFala: "pela_fala só vale no turno em que a pessoa falou com você, na conversa com ela",
  naoEDaPessoa: "a fala não é da pessoa nesta conversa (mensagem_id de outra conversa, de outro turno ou de outro autor)",
  anterior: "a fala da pessoa é anterior à pergunta do card: ela ainda não respondeu",
  naoCita: (codigo: string) => `a fala da pessoa não diz qual tarefa: pergunte a ela citando o código (ex.: ${codigo})`,
  ambigua: (codigo: string) => `mais de uma fala da pessoa cita ${codigo}: pergunte a ela qual vale, ou passe mensagem_id`,
  jaUsada: (codigo: string) => `a fala da pessoa já foi usada em ${codigo}: uma fala vale um passo por tarefa (para responder e seguir, use avancar no mesmo responder); para outro passo, pergunte a ela`,
} as const;

export type EscolhaDaFala = { ok: true; fala: Fala } | { ok: false; erro: string };

/**
 * Escolhe a fala que autoriza o passo. `perguntaEm` = quando a tarefa foi posta em Com você/Bloqueado (null = não
 * espera resposta: aí qualquer fala do turno serve, ex.: "ADA-2 pode ir para Feito"). Com `mensagemId`, só aquela.
 * `usadas` = as falas que já autorizaram um passo nesta tarefa (o histórico): uma fala vale um passo por tarefa (revisão
 * do PR #696). Sem isso, depois de a tarefa sair da espera (`perguntaEm` null), a mesma fala autorizaria passos
 * repetidos e contraditórios, no mesmo turno ou num turno re-enfileirado com a mesma mensagem de origem.
 */
export function escolherFala(e: { falas: readonly Fala[]; citacoes: CitacoesDaTarefa; perguntaEm: number | null; mensagemId?: string | null; usadas?: ReadonlySet<string> }): EscolhaDaFala {
  if (e.falas.length === 0) return { ok: false, erro: ERROS_FALA.semFala };
  const depois = (f: Fala) => e.perguntaEm === null || f.criadoEm > e.perguntaEm;
  const cita = (f: Fala) => citaTarefa(f.texto, e.citacoes);
  const usada = (f: Fala) => e.usadas?.has(f.id) === true;
  if (e.mensagemId) {
    const f = e.falas.find((x) => x.id === e.mensagemId);
    if (!f) return { ok: false, erro: ERROS_FALA.naoEDaPessoa };
    if (!cita(f)) return { ok: false, erro: ERROS_FALA.naoCita(e.citacoes.codigo) };
    if (!depois(f)) return { ok: false, erro: ERROS_FALA.anterior };
    if (usada(f)) return { ok: false, erro: ERROS_FALA.jaUsada(e.citacoes.codigo) };
    return { ok: true, fala: f };
  }
  const citam = e.falas.filter(cita);
  if (citam.length === 0) return { ok: false, erro: ERROS_FALA.naoCita(e.citacoes.codigo) };
  const posteriores = citam.filter(depois);
  if (posteriores.length === 0) return { ok: false, erro: ERROS_FALA.anterior };
  const validas = posteriores.filter((f) => !usada(f));
  if (validas.length === 0) return { ok: false, erro: ERROS_FALA.jaUsada(e.citacoes.codigo) };
  if (validas.length > 1) return { ok: false, erro: ERROS_FALA.ambigua(e.citacoes.codigo) };
  return { ok: true, fala: validas[0]! };
}
