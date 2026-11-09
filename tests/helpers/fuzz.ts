import { ChildProcess } from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { Socket } from "node:net";
import type { DefinicaoAcao } from "../../src/contracts/acoes.ts";
import { planoDeFuzz, type CasoDeFuzz, type IdsDoFuzz, type RotaDoFuzz } from "../../src/domain/fuzz/gerador.ts";
import type { Db } from "../../src/shared/types.ts";

/**
 * O executor do fuzz (NOD-398): manda cada caso ao servidor de verdade e confere os invariantes depois de cada chamada.
 * Não sabe de ação nenhuma: recebe os casos do plano (src/domain/fuzz/gerador.ts) e um alvo. Devolve as violações; quem
 * falha o teste é o chamador, com a semente na mensagem.
 */

export type Violacao = { acao: string; caso: string; motivo: string };

/** O retrato do banco visto por UMA pessoa: por tabela, contagem e md5 das linhas (o RLS decide o que entra). */
export type Retrato = Record<string, string>;

export type AlvoDoFuzz = {
  /** Faz a chamada da pessoa e devolve o status. */
  chamar(caso: CasoDeFuzz): Promise<{ status: number; corpo: string }>;
  /** O servidor ainda responde? */
  saude(): Promise<boolean>;
  /** O retrato da pessoa que o fuzz pilota. */
  retrato(): Promise<Retrato>;
  /** O retrato de outra pessoa (o RLS não pode deixar o fuzz mexer nela). Ausente = não confere. */
  retratoDaOutra?(): Promise<Retrato>;
  /** Depois de um caso que derruba a sessão (sair, excluir conta): o alvo recunha a sessão. */
  depoisDe?(caso: CasoDeFuzz, status: number): Promise<void>;
  /**
   * Opcional (o custo do fuzz no PR): uma marca do banco INTEIRO tal que duas marcas iguais e não nulas provam que
   * nenhuma transação gravou nada entre elas. Com ela o executor pula o retrato quando nada foi gravado (o retrato seria
   * igual por construção). `null` = não dá para garantir (há escrita em curso): o retrato roda. Ver `marcaDoBanco`.
   */
  marca?(): Promise<string | null>;
};

/**
 * A marca do Postgres para `AlvoDoFuzz.marca`: o `xmax` do snapshot (o próximo xid a ser dado), só quando não há
 * transação com xid em curso. Toda transação que grava recebe um xid; se a marca de T1 não tinha nenhuma em curso e a de
 * T2 tem o mesmo `xmax`, nenhum xid foi dado entre T1 e T2, logo nada foi gravado (nem por trabalho em segundo plano)
 * e qualquer retrato tirado depois de T1 vale em T2. O xid é do cluster: outro banco gravando só faz a marca mudar e o
 * retrato rodar (mais lento, nunca errado). Uma consulta solta, sem transação: não gasta xid.
 */
export async function marcaDoBanco(db: Db): Promise<string | null> {
  const [l] = await db<{ s: string }[]>`select pg_current_snapshot()::text as s`;
  const [, , xmax, emCurso] = /^(\d+):(\d+):(.*)$/.exec(l!.s) ?? [];
  return xmax !== undefined && emCurso === "" ? xmax : null;
}

/**
 * Tabelas que mudam em QUALQUER pedido, por desenho, mesmo no erro: o fuzz não as conta como dado da pessoa.
 * Cada uma com o motivo; tabela nova que mude no erro aparece como violação e entra aqui só com motivo escrito.
 */
export const TABELAS_FORA_DO_RETRATO: Record<string, string> = {
  trilha: "a trilha de auditoria registra a negação (ADR-004), é o que deve acontecer no erro",
  events: "o evento de domínio da negação/erro acompanha a trilha",
  events_outbox: "o outbox do evento acima",
};

/**
 * A consulta do retrato: uma só, `union all` sobre as tabelas com RLS (barato o bastante para rodar a cada chamada).
 * Nas tabelas escopadas (com `owner_id`), só as linhas de que a pessoa é DONA: o RLS também mostra as `equipe` de
 * qualquer um do tenant, e outro teste rodando em paralelo no mesmo tenant (um turno do catcher, p.ex.) mudava o
 * retrato sem o fuzz ter feito nada. Escrita na linha de outra pessoa continua pega pelo retrato DELA.
 */
export async function sqlDoRetrato(dbDono: Db): Promise<string> {
  const linhas = await dbDono<{ relname: string; dono: boolean }[]>`
    select c.relname, exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'owner_id' and not a.attisdropped) as dono
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity order by c.relname`;
  const tabelas = linhas.filter((l) => !(l.relname in TABELAS_FORA_DO_RETRATO));
  if (tabelas.length === 0) throw new Error("nenhuma tabela com RLS: o retrato não mediria nada");
  return tabelas
    .map(({ relname: t, dono }) => {
      const filtro = dono ? ` where x.owner_id = current_setting('nod.pessoa_id')::uuid` : "";
      return `select '${t}' as t, count(*)::text || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from public."${t}" x${filtro}`;
    })
    .join(" union all ");
}

/**
 * Colunas que mudam a cada pedido por desenho (não são dado que o erro possa mexer). Cada uma com o motivo.
 */
export const COLUNAS_FORA_DO_RETRATO: Record<string, string> = {
  "sessoes.ultimo_uso_em": "a sessão marca o último uso em todo pedido autenticado, com erro ou não",
};

/**
 * Tabelas sem RLS que o retrato da conta não cobre, com o motivo. As de conta (ADR-124 §1) são identidade GLOBAL, acima
 * dos tenants: não têm RLS e o retrato do `dentro` não as enxerga (revisão 2, alto). Por isso este retrato separado, pelo
 * dono, filtrado pela pessoa. Tabela nova sem RLS que não entre por nenhuma chave abaixo nem aqui faz o teste falhar.
 */
export const TABELAS_SEM_RLS_FORA_DO_RETRATO: Record<string, string> = {
  limites_conta: "o limite de tentativas conta toda tentativa, também a recusada (é a defesa contra força bruta)",
  codigos_conta: "chaveado por e-mail/finalidade, não pela pessoa; o código errado incrementa `tentativas` por desenho",
  schema_migrations: "controle das migrações",
  tenants: "o tenant, não a pessoa: nenhuma ação de pessoa o muda",
  dominios_admitidos: "configuração de admissão do tenant (feita pela operação, não por rota de pessoa)",
};

/**
 * A consulta do retrato da CONTA da pessoa (parâmetros $1 = tenant, $2 = pessoa), rodada pelo dono. Entra toda tabela
 * pública SEM RLS (partições ficam com a tabela-mãe) que se liga à pessoa por (tenant_id, pessoa_id), (destino_|origem_)tenant_id/pessoa_id ou conta_id
 * (pela conta_pessoas); `contas` pelo id. Falha se sobrar tabela sem RLS que não se liga e não está nas exceções.
 */
export async function sqlDoRetratoDaConta(dbDono: Db): Promise<string> {
  const cols = await dbDono<{ t: string; c: string }[]>`
    select c.relname as t, a.attname as c from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity and not c.relispartition order by c.relname, a.attnum`;
  const porTabela = new Map<string, Set<string>>();
  for (const { t, c } of cols) porTabela.set(t, (porTabela.get(t) ?? new Set()).add(c));
  const consultas: string[] = [];
  const soltas: string[] = [];
  const DA_CONTA = "(select conta_id from public.conta_pessoas where tenant_id = $1::uuid and pessoa_id = $2::uuid)";
  for (const [t, c] of porTabela) {
    if (t in TABELAS_SEM_RLS_FORA_DO_RETRATO || t in TABELAS_FORA_DO_RETRATO) continue;
    const filtros: string[] = [];
    for (const pre of ["", "destino_", "origem_"]) if (c.has(`${pre}tenant_id`) && c.has(`${pre}pessoa_id`)) filtros.push(`(x.${pre}tenant_id = $1::uuid and x.${pre}pessoa_id = $2::uuid)`);
    if (c.has("conta_id")) filtros.push(`x.conta_id in ${DA_CONTA}`);
    if (t === "contas") filtros.push(`x.id in ${DA_CONTA}`);
    if (t === "pessoas") filtros.push(`(x.tenant_id = $1::uuid and x.id = $2::uuid)`);
    if (filtros.length === 0) { soltas.push(t); continue; }
    const tirar = Object.keys(COLUNAS_FORA_DO_RETRATO).filter((k) => k.startsWith(`${t}.`)).map((k) => ` - '${k.slice(t.length + 1)}'`).join("");
    const linha = `(to_jsonb(x)${tirar})::text`;
    consultas.push(`select 'conta/${t}' as t, count(*)::text || ':' || coalesce(md5(string_agg(${linha}, '|' order by ${linha})), '') as h from public."${t}" x where ${filtros.join(" or ")}`);
  }
  if (soltas.length) throw new Error(`tabelas sem RLS que o retrato da conta não liga à pessoa (ligue ou registre o motivo em TABELAS_SEM_RLS_FORA_DO_RETRATO): ${soltas.join(", ")}`);
  if (!porTabela.has("sessoes")) throw new Error("o retrato da conta não achou a tabela sessoes: a consulta mudou de forma");
  return consultas.join(" union all ");
}

export function diferenca(antes: Retrato, depois: Retrato): string[] {
  const chaves = new Set([...Object.keys(antes), ...Object.keys(depois)]);
  return [...chaves].filter((k) => antes[k] !== depois[k]).sort();
}

const resumir = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…(${s.length})` : s);

/**
 * Depois de um sucesso, o trabalho que ele disparou em segundo plano (o turno de `rotinas.executar`, a resposta a uma
 * mensagem) continua escrevendo. Sem esperar, a escrita cai no retrato do caso SEGUINTE e vira falso "erro mexeu no
 * banco" (revisão 9, quando as rotas de rotina e conversa passaram a receber ids reais). Espera duas leituras iguais
 * seguidas com `ocioso()` verdadeiro (sem turno na fila), até `prazoMs`; se não aquietar, segue com a última (o caso seguinte acusa, com o nome da tabela).
 */
export const quietude = { esgotou: 0 };
/** O que cada rodada do fuzz gastou, por tipo de chamada (contagem e ms somados): o teste o imprime no fim. */
export const custoDoFuzz = { chamadas: 0, saude: 0, marcas: 0, retratos: 0, retratosPulados: 0, retratosDaOutra: 0, retratosDaOutraPulados: 0, ocioso: 0, esperasQuietas: 0, ms: { chamar: 0, conferir: 0, quieto: 0, outra: 0 } };
export function zerarCustoDoFuzz(): void {
  Object.assign(custoDoFuzz, { chamadas: 0, saude: 0, marcas: 0, retratos: 0, retratosPulados: 0, retratosDaOutra: 0, retratosDaOutraPulados: 0, ocioso: 0, esperasQuietas: 0 });
  Object.assign(custoDoFuzz.ms, { chamar: 0, conferir: 0, quieto: 0, outra: 0 });
}
const cronometrar = async <T>(chave: keyof typeof custoDoFuzz.ms, f: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  try {
    return await f();
  } finally {
    custoDoFuzz.ms[chave] += performance.now() - t0;
  }
};
type Quieto = { prazoMs: number; intervaloMs: number; ocioso?: () => Promise<boolean> };
async function retratoQuieto(alvo: AlvoDoFuzz, primeiro: Retrato, q: Quieto): Promise<Retrato> {
  const { prazoMs, intervaloMs } = q;
  // Com `ocioso`, a fila vazia logo de cara dispensa a espera: só o sucesso que disparou trabalho paga o intervalo.
  if (q.ocioso) custoDoFuzz.ocioso++;
  if (q.ocioso && (await q.ocioso())) return primeiro;
  const limite = Date.now() + prazoMs;
  let atual = primeiro;
  while (Date.now() < limite) {
    custoDoFuzz.esperasQuietas++;
    custoDoFuzz.retratos++;
    if (q.ocioso) custoDoFuzz.ocioso++;
    await new Promise((ok) => setTimeout(ok, intervaloMs));
    const [seguinte, ocioso] = await Promise.all([alvo.retrato(), q.ocioso ? q.ocioso() : Promise.resolve(true)]);
    if (ocioso && diferenca(atual, seguinte).length === 0) return seguinte;
    atual = seguinte;
  }
  quietude.esgotou++;
  return atual;
}

export async function executarFuzz(alvo: AlvoDoFuzz, casos: readonly CasoDeFuzz[], o: { aoProgredir?: (i: number) => void; quieto?: Quieto } = {}): Promise<Violacao[]> {
  const violacoes: Violacao[] = [];
  // A marca é tirada ANTES do retrato: marca igual depois prova que nada foi gravado desde antes do retrato, então ele vale.
  const marcar = async (): Promise<string | null> => {
    if (!alvo.marca) return null;
    custoDoFuzz.marcas++;
    return alvo.marca();
  };
  let marcaDoAntes = await marcar();
  let antes = await alvo.retrato();
  let marcaDaOutra = await marcar();
  const outraAntes = alvo.retratoDaOutra ? await alvo.retratoDaOutra() : null;
  // Desde onde a outra pessoa não foi conferida: a violação diz o intervalo de casos (o culpado está nele).
  let outraConferidaAte = -1;
  for (const [i, caso] of casos.entries()) {
    o.aoProgredir?.(i);
    const rotulo = `${caso.metodo} ${caso.caminho} · ${caso.entrada.rotulo}`;
    let status: number;
    let corpo = "";
    try {
      custoDoFuzz.chamadas++;
      ({ status, corpo } = await cronometrar("chamar", () => alvo.chamar(caso)));
    } catch (e) {
      violacoes.push({ acao: caso.acao, caso: rotulo, motivo: `a chamada não voltou: ${(e as Error).message}` });
      if (!(await alvo.saude().catch(() => false))) return [...violacoes, { acao: caso.acao, caso: rotulo, motivo: "o servidor morreu" }];
      continue;
    }
    if (status >= 500) violacoes.push({ acao: caso.acao, caso: rotulo, motivo: `status ${status}: ${resumir(corpo)}` });
    // A saúde e o retrato não dependem um do outro: em paralelo, o fuzz do PR cabe no orçamento de 90 s (revisão 5).
    custoDoFuzz.saude++;
    const [vivo, depois] = await cronometrar("conferir", () => Promise.all([
      alvo.saude().catch(() => false),
      (async () => {
        await alvo.depoisDe?.(caso, status);
        const marca = await marcar();
        // Nada gravado desde a marca do retrato de referência: o retrato de agora seria ele mesmo (a conferência não cai).
        if (marca !== null && marca === marcaDoAntes) {
          custoDoFuzz.retratosPulados++;
          return antes;
        }
        marcaDoAntes = marca;
        custoDoFuzz.retratos++;
        return alvo.retrato();
      })(),
    ]));
    if (!vivo) return [...violacoes, { acao: caso.acao, caso: rotulo, motivo: "o servidor parou de responder /api/saude" }];
    // Erro (4xx/5xx) não deixa dado da pessoa pela metade; sucesso vira o novo retrato de referência.
    if (status >= 400) {
      const mudou = diferenca(antes, depois);
      if (mudou.length > 0) violacoes.push({ acao: caso.acao, caso: rotulo, motivo: `status ${status} e o banco da pessoa mudou em: ${mudou.join(", ")}` });
    }
    antes = status < 400 && o.quieto ? await cronometrar("quieto", () => retratoQuieto(alvo, depois, o.quieto!)) : depois;
    // A espera tirou retratos novos sem marca antes deles: o próximo caso tira o retrato de novo.
    if (antes !== depois) marcaDoAntes = null;
    // A outra pessoa: depois de todo sucesso (é onde um vazamento de RLS escreveria), a cada 25 chamadas e no fim — o
    // retrato dela custa uma consulta grande, e conferir a cada erro dobrava o tempo do fuzz sem pegar nada a mais.
    if (outraAntes && alvo.retratoDaOutra && (status < 400 || i % 25 === 24 || i === casos.length - 1)) {
      const marca = await marcar();
      let mudou: string[] = [];
      // Mesma regra: nada gravado desde a marca da última conferência que bateu, então o retrato dela seguiria igual.
      if (marca !== null && marca === marcaDaOutra) custoDoFuzz.retratosDaOutraPulados++;
      else {
        custoDoFuzz.retratosDaOutra++;
        mudou = diferenca(outraAntes, await cronometrar("outra", () => alvo.retratoDaOutra!()));
        marcaDaOutra = marca;
      }
      const intervalo = outraConferidaAte + 1 === i ? `no caso ${i}` : `entre os casos ${outraConferidaAte + 1} e ${i}: ${[...new Set(casos.slice(outraConferidaAte + 1, i + 1).map((c) => c.acao))].join(", ")}`;
      if (mudou.length > 0) return [...violacoes, { acao: caso.acao, caso: rotulo, motivo: `o banco de OUTRA pessoa mudou em: ${mudou.join(", ")} (RLS), ${intervalo}` }];
      outraConferidaAte = i;
    }
  }
  return violacoes;
}

/** A mensagem de falha: a semente primeiro (é ela que reproduz), depois as violações agrupadas por ação. */
export function relatarViolacoes(semente: number, n: number, v: readonly Violacao[]): string {
  const porAcao = new Map<string, Violacao[]>();
  for (const x of v) porAcao.set(x.acao, [...(porAcao.get(x.acao) ?? []), x]);
  const linhas = [`fuzz falhou — reproduza com FUZZ_SEMENTE=${semente} FUZZ_N=${n}`, "(rode o arquivo inteiro, sem -t: o plano do 2º servidor e o estado do banco dependem do que veio antes)", `${v.length} violação(ões) em ${porAcao.size} ação(ões):`];
  for (const [acao, lista] of porAcao) {
    linhas.push(`  ${acao}:`);
    for (const x of lista.slice(0, 5)) linhas.push(`    - ${x.caso}: ${x.motivo}`);
    if (lista.length > 5) linhas.push(`    … e mais ${lista.length - 5}`);
  }
  return linhas.join("\n");
}

/** Uma rota como o servidor a monta (src/adapters/http/roteador.ts): o fuzz lê o registro de rotas do app de verdade. */
export type RotaDoServidor = { metodo: string; padrao: RegExp; acao?: string; interno?: boolean; maquina?: boolean; publica?: boolean };

/**
 * As ações `semRotaDePessoa` (conta.*, ADR-124) moram nas rotas públicas de /api/conta, que não levam `acao`: cada uma
 * aponta aqui para os caminhos dela. Ação de conta nova sem entrada aqui fica sem rota e o fuzz falha (cobertura).
 */
// ADR-157 (ADA-242/243): /conta/codigo e /conta/google/trocar são do conta.entrar (código e Google no app).
export const CAMINHOS_DAS_ACOES_DE_CONTA: Record<string, RegExp> = {
  "conta.trocar_senha": /^\/conta\/senha$/,
  "conta.entrar": /^\/conta(\/(cadastro|reenviar|verificar|entrar|importar|outra|cancelar|recuperar|redefinir|google|google\/trocar|codigo|provisorio|troca-app))?$/,
  "conta.parear_aparelho": /^\/conta\/parear/,
  "conta.sair_das_outras": /^\/conta\/(sair-das-outras|sessoes)$/,
  "conta.editar_perfil": /^\/conta\/eu(\/(perfil|foto|reautenticar.*))?$/,
  "conta.trocar_email": /^\/conta\/eu\/email/,
  "conta.remover_google": /^\/conta\/eu\/google\/remover$/,
  "conta.exportar": /^\/conta\/eu\/exportacao/,
  "conta.excluir": /^\/conta\/eu\/excluir/,
};

const caminhoLegivel = (padrao: RegExp): string => padrao.source.replace(/\\\//g, "/");

/**
 * O plano do fuzz para UM servidor, a partir das rotas que ele montou: o que o teste de conformidade roda, extraído
 * para a sentinela exercitar o mesmo código. `pendentes`: as ações do registro que ainda não tiveram fuzz (o primeiro
 * servidor recebe todas). Rota de conta sem ação conhecida entra como ação sintética (fuzz igual, não conta cobertura).
 */
export function planoDoServidor(o: {
  registro: readonly DefinicaoAcao[];
  pendentes: readonly string[];
  rotas: readonly RotaDoServidor[];
  semente: number;
  n: number;
  ids: IdsDoFuzz;
}): { casos: CasoDeFuzz[]; semRota: string[]; acoes: number } {
  const visiveis = o.rotas.filter((r) => !r.interno && !r.maquina);
  const rotas: RotaDoFuzz[] = visiveis.filter((r) => r.acao).map((r) => ({ metodo: r.metodo, padrao: r.padrao.source, acao: r.acao, publica: r.publica === true }));
  const sinteticas: DefinicaoAcao[] = [];
  for (const r of visiveis.filter((x) => !x.acao && x.publica && caminhoLegivel(x.padrao).startsWith("^/conta"))) {
    const caminho = caminhoLegivel(r.padrao).replace(/^\^/, "").replace(/\$$/, "");
    const acao = Object.keys(CAMINHOS_DAS_ACOES_DE_CONTA).find((id) => CAMINHOS_DAS_ACOES_DE_CONTA[id]!.test(caminho)) ?? `conta.sem_acao ${r.metodo} ${caminho}`;
    if (!o.registro.some((a) => a.id === acao) && !sinteticas.some((a) => a.id === acao)) {
      sinteticas.push({ id: acao, titulo: acao, risco: "muda", cartaoNoChat: false, chat: { estado: "nunca", motivo: "rota pública de conta" } });
    }
    rotas.push({ metodo: r.metodo, padrao: r.padrao.source, acao, publica: true });
  }
  const registro = [...o.registro.filter((a) => o.pendentes.includes(a.id)), ...sinteticas];
  const plano = planoDeFuzz({ registro, rotas, semente: o.semente, n: o.n, ids: o.ids });
  return { ...plano, semRota: plano.semRota.filter((id) => !id.startsWith("conta.sem_acao ")), acoes: registro.length };
}

/**
 * A resposta veio do HANDLER da ação, não do roteador? 404 "rota não encontrada" e 401 de sessão numa rota escopada
 * saem antes do handler: a ação não foi exercitada, e o fuzz não pode contá-la como coberta. Nas rotas públicas de
 * conta, 403 da trava de Origin (vem antes da entrada, sem `motivo`) e 429 (o limite de tentativas) também barram antes:
 * só esses casos contariam como cobertos sem a entrada ter sido lida (revisão 2, médio 8). O 403 COM `motivo` vem do
 * caso de uso (Minha conta: "reautenticar", "sem conta") e conta: é a regra da ação respondendo.
 */
export function chegouNoHandler(caso: Pick<CasoDeFuzz, "publica">, status: number, corpo: string): boolean {
  if (status === 404 && corpo.includes("rota não encontrada")) return false;
  if (status === 401 && !caso.publica) return false;
  if (caso.publica && status === 429) return false;
  if (caso.publica && status === 403 && !/"motivo"\s*:/.test(corpo)) return false;
  return true;
}

/** As ações do plano que nenhuma chamada fez chegar ao handler. */
export function acoesSemHandler(casos: readonly CasoDeFuzz[], chegaram: ReadonlySet<string>): string[] {
  return [...new Set(casos.map((c) => c.acao))].filter((a) => !chegaram.has(a));
}

/**
 * As rotas públicas (conta) do plano que nenhuma chamada fez chegar ao handler. Uma ação de conta mora em várias rotas
 * (conta.entrar: cadastro, entrar, recuperar…): contar por ação deixava uma rota cobrir as outras (revisão 2, médio 8).
 */
export function rotasPublicasSemHandler(casos: readonly CasoDeFuzz[], chegaram: ReadonlySet<string>): string[] {
  return [...new Set(casos.filter((c) => c.publica).map((c) => c.rota))].filter((r) => !chegaram.has(r));
}

/** Os programas que o fuzz tentou rodar enquanto bloqueado (revisão 8): o teste os mostra no log. */
export const processosBloqueados: string[] = [];

/**
 * Durante o fuzz, nenhuma conexão sai do loopback (fetch, http/https.request, net.connect: tudo passa por
 * Socket.prototype.connect) e nenhum processo-filho roda (spawn, execFile, exec, fork: tudo passa por
 * ChildProcess.prototype.spawn). Revisão 8: `apps.conectar` com o slug "github" roda `gh auth status` e sobe o MCP do
 * GitHub; numa máquina com `gh` logado, isso usava o token de verdade da pessoa. O filho vira um executável que não
 * existe: quem chamou recebe o ENOENT de sempre (o mesmo de uma máquina sem `gh`), sem exceção nova no caminho.
 */
export function bloquearRedeExterna(o: { unixPermitidos?: readonly string[] } = {}): () => void {
  // As variantes síncronas não passam pelo protótipo (revisão 9): spawnSync, execSync e execFileSync lançam ENOENT
  // enquanto bloqueado. `syncBuiltinESMExports` leva a troca a quem importou por ESM (`import { execFileSync }`).
  const cp = createRequire(import.meta.url)("node:child_process") as Record<"spawnSync" | "execSync" | "execFileSync", (...a: unknown[]) => unknown>;
  const sincronasOriginais = { spawnSync: cp.spawnSync, execSync: cp.execSync, execFileSync: cp.execFileSync };
  for (const nome of ["spawnSync", "execSync", "execFileSync"] as const) {
    cp[nome] = (...a: unknown[]) => {
      processosBloqueados.push(String(a[0]));
      throw Object.assign(new Error(`spawnSync ${String(a[0])} ENOENT (fuzz: processo bloqueado)`), { code: "ENOENT" });
    };
  }
  syncBuiltinESMExports();
  // `spawn` do protótipo é interno do Node (não está nos tipos): o ponto por onde todo processo-filho passa.
  type OpcoesSpawn = { file?: unknown; args?: unknown[] };
  const proto = ChildProcess.prototype as unknown as { spawn: (this: ChildProcess, o: OpcoesSpawn) => unknown };
  const spawnOriginal = proto.spawn;
  const INEXISTENTE = "/nonexistent/nod-fuzz-processo-bloqueado";
  proto.spawn = function (this: ChildProcess, opcoes: OpcoesSpawn) {
    processosBloqueados.push(String(opcoes.file ?? "?"));
    return spawnOriginal.call(this, { ...opcoes, file: INEXISTENTE, args: [INEXISTENTE] });
  };
  const original = Socket.prototype.connect;
  const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"]);
  Socket.prototype.connect = function (this: Socket, ...args: unknown[]) {
    const a0 = args[0];
    const opcoes = Array.isArray(a0) ? (a0[0] as Record<string, unknown>) : a0;
    let host: unknown;
    let caminho: unknown;
    if (typeof opcoes === "object" && opcoes !== null) {
      host = (opcoes as { host?: unknown }).host ?? "localhost";
      caminho = (opcoes as { path?: unknown }).path;
    } else if (typeof opcoes === "string" && !/^\d+$/.test(opcoes)) caminho = opcoes;
    else host = typeof args[1] === "string" ? args[1] : "localhost";
    // Socket unix só com `path` string não vazia: o http/https do Node passa `path: null` com host de rede.
    const unix = typeof caminho === "string" && caminho !== "";
    // Socket unix só o do Postgres (`.s.PGSQL.<porta>`) e os de `unixPermitidos` (revisão 9): o docker.sock e
    // qualquer outro socket local da máquina ficam fora.
    const unixOk = typeof caminho === "string" && unix && (/(^|\/)\.s\.PGSQL\.\d+$/.test(caminho) || (o.unixPermitidos ?? []).some((p) => caminho.startsWith(p)));
    if (unix ? !unixOk : !LOOPBACK.has(String(host))) {
      process.nextTick(() => this.destroy(new Error(`fuzz: rede bloqueada para ${unix ? String(caminho) : String(host)}`)));
      return this;
    }
    return (original as (...a: unknown[]) => Socket).apply(this, args);
  } as typeof Socket.prototype.connect;
  return () => {
    Socket.prototype.connect = original;
    proto.spawn = spawnOriginal;
    Object.assign(cp, sincronasOriginais);
    syncBuiltinESMExports();
  };
}

/**
 * NOD-420 (o teto de 150 s no PR): `k` casos por rota nas ações escolhidas, em vez de N. Fica, na ordem: as entradas fixas
 * do gerador (base plausível, json quebrado, sem corpo), pelo menos um caso FUNDO (todo id do caminho é um id real da
 * pessoa, o que passa da busca) e o resto na ordem do plano até `k`. A ordem do plano (DELETE do mais fundo ao mais raso)
 * não muda; as outras ações ficam intactas.
 */
export function enxugarCasos(casos: readonly CasoDeFuzz[], o: { acoes: (acao: string) => boolean; k: number; idsDaPessoa: ReadonlySet<string> }): CasoDeFuzz[] {
  const fixas = new Set(["base plausível", "json quebrado", "sem corpo"]);
  const fundo = (c: CasoDeFuzz) => {
    const grupos = (c.rota.match(/\(\?</g) ?? []).length;
    return c.caminho.split("/").filter((s) => o.idsDaPessoa.has(decodeURIComponent(s))).length >= grupos;
  };
  const porRota = new Map<string, CasoDeFuzz[]>();
  for (const c of casos) if (o.acoes(c.acao)) porRota.set(`${c.acao} ${c.rota}`, [...(porRota.get(`${c.acao} ${c.rota}`) ?? []), c]);
  const ficam = new Set<CasoDeFuzz>();
  for (const grupo of porRota.values()) {
    const escolhidos = grupo.filter((c) => fixas.has(c.entrada.rotulo));
    if (!escolhidos.some(fundo)) escolhidos.push(...grupo.filter((c) => fundo(c) && !escolhidos.includes(c)).slice(0, 1));
    for (const c of grupo) if (escolhidos.length < o.k && !escolhidos.includes(c)) escolhidos.push(c);
    for (const c of escolhidos) ficam.add(c);
  }
  return casos.filter((c) => !o.acoes(c.acao) || ficam.has(c));
}

/** FUZZ_N do ambiente: inteiro de 1 a 10 mil, senão erro claro (NaN viraria zero casos e um fuzz verde que não testou). */
export function lerN(valor: string | undefined, padrao: number): number {
  if (valor === undefined || valor.trim() === "") return padrao;
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n < 1 || n > 10_000) throw new Error(`FUZZ_N inválido: ${valor}`);
  return n;
}

/**
 * O veredito de UMA chamada de `gerirBots` com um item arriscado/pessoa_confirma num modo em que ele deve esperar:
 * "esperou" (cartão com decisão), "recusou" (falha de entrada) ou "rodou" (a violação: mudou sem decisão).
 * `{ ok: false }` (lote inteiro recusado) também é recusa.
 */
export function vereditoDeDecisao(r: { ok: boolean; feitas?: readonly unknown[]; esperando?: readonly number[]; falhas?: readonly { i: number }[]; decisao_id?: string | null }): "esperou" | "recusou" | "rodou" {
  if (!r.ok) return "recusou";
  if ((r.feitas?.length ?? 0) > 0) return "rodou";
  if (r.esperando?.includes(0) && r.decisao_id) return "esperou";
  if (r.falhas?.some((f) => f.i === 0)) return "recusou";
  return "rodou";
}

/** A semente do PR: os 8 primeiros hex do commit. Sem commit (fora do CI), null. */
export function sementeDoPr(sha: string | undefined): number | null {
  if (!sha || !/^[0-9a-f]{8}/i.test(sha)) return null;
  return parseInt(sha.slice(0, 8), 16) >>> 0;
}

/**
 * Revisão 14 do #590: as ações NOVAS do registro (fora da foto `conhecidas`) que o fuzz exercitou e que em NENHUM dos
 * servidores passaram da busca ou da guarda (só 404/403/401/429 ou corpo quebrado). Acumula entre os servidores: a ação
 * desligada no padrão e lida no compartilhado não reprova. Não é determinístico: depende da amostra da semente.
 */
export function acoesNovasSemLeitura(o: { fuzzadas: Iterable<string>; alemDaBusca: ReadonlySet<string>; conhecidas: ReadonlySet<string> }): string[] {
  return [...new Set(o.fuzzadas)].filter((a) => !o.conhecidas.has(a) && !o.alemDaBusca.has(a)).sort();
}
