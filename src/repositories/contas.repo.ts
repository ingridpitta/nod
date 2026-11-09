import type { SituacaoConta } from "../contracts/ferramentas-conta.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

/**
 * Tabelas globais da conta (0109, NOD-345, ADR-124). SEM RLS por desenho (exceção em gate-rls.ts): são lidas antes de
 * existir escopo — entrar, resolver o cookie, recuperar a senha. Por isso TODA consulta que é da pessoa repete
 * `tenant_id`/`pessoa_id` no WHERE, e o nod_app só tem os privilégios que estes métodos usam (contas.test.ts).
 * Recebe o pool ou uma transação sem escopo; nunca devolve hash de senha para fora, só `senhaDaConta` para conferir.
 */

export type OrigemSessao = "web" | "maquina";
export type SessaoDto = { id: string; origem: OrigemSessao; aparelho: string; criadaEm: number; ultimoUsoEm: number; revogadaEm: number | null };
export type FinalidadeGuardada = "verificacao" | "recuperacao" | "troca_app" | "troca_email" | "reautenticacao" | "google_app";
export type CodigoAberto = { id: string; chave: string; tentativas: number; dados: Record<string, unknown>; expiraEm: number };
export type IdentidadeNova = { tipo: "senha"; senhaHash: string } | { tipo: "google"; iss: string; sub: string } | { tipo: "email" };
export type EntradaPendente = {
  id: string;
  sessaoId: string;
  destino: Escopo;
  contaId: string | null;
  email: string;
  novaIdentidade: IdentidadeNova | Record<string, never>;
  expiraEm: number;
  resolvidaEm: number | null;
  resolucao: string | null;
};
export type EstadoPareamento = "aguardando" | "pedido" | "confirmado" | "recusado" | "usado" | "trocado";
export type Pareamento = { id: string; dono: Escopo; estado: EstadoPareamento; pedidoSessaoId: string | null; pedidoAparelho: string | null; simbolos: string[] | null; expiraEm: number };

// ------------------------------------------------------------------------------------------- sessões

export async function criarSessaoConta(conn: Conn, e: Escopo & { origem: OrigemSessao; aparelho: string }): Promise<string> {
  const [l] = await conn<{ id: string }[]>`
    insert into sessoes (tenant_id, pessoa_id, origem, aparelho)
    values (${e.tenantId}, ${e.pessoaId}, ${e.origem}, ${e.aparelho.slice(0, 80)}) returning id`;
  if (!l) throw new Error("sessão não criada");
  return l.id;
}

/** A sessão do cookie: viva e da MESMA pessoa que o cookie diz. null = revogada, de outra pessoa ou inexistente. */
export async function sessaoViva(conn: Conn, sid: string, escopo: Escopo): Promise<{ ultimoUsoEm: number } | null> {
  const [l] = await conn<{ ultimo_uso_em: Date }[]>`
    select ultimo_uso_em from sessoes
    where id = ${sid} and tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId} and revogada_em is null`;
  return l ? { ultimoUsoEm: ms(l.ultimo_uso_em) } : null;
}

/** Marca o uso no máximo a cada `aCadaMs` (a lista de sessões mostra "usada há X"): sem escrita a cada pedido. */
export async function tocarSessao(conn: Conn, sid: string, aCadaMs: number): Promise<void> {
  await conn`update sessoes set ultimo_uso_em = clock_timestamp()
    where id = ${sid} and revogada_em is null and ultimo_uso_em < clock_timestamp() - make_interval(secs => ${aCadaMs / 1000})`;
}

export async function listarSessoes(conn: Conn, escopo: Escopo): Promise<SessaoDto[]> {
  const linhas = await conn<{ id: string; origem: OrigemSessao; aparelho: string; criada_em: Date; ultimo_uso_em: Date; revogada_em: Date | null }[]>`
    select id, origem, aparelho, criada_em, ultimo_uso_em, revogada_em from sessoes
    where tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId} and revogada_em is null
    order by ultimo_uso_em desc limit 100`;
  return linhas.map((l) => ({ id: l.id, origem: l.origem, aparelho: l.aparelho, criadaEm: ms(l.criada_em), ultimoUsoEm: ms(l.ultimo_uso_em), revogadaEm: msOuNull(l.revogada_em) }));
}

export async function revogarSessao(conn: Conn, escopo: Escopo, sid: string): Promise<boolean> {
  const r = await conn`update sessoes set revogada_em = clock_timestamp()
    where id = ${sid} and tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId} and revogada_em is null`;
  return r.count > 0;
}

/**
 * Revoga todas as sessões da pessoa menos `manter` e corta os cookies antigos sem sid (sessoes_corte). Devolve os ids
 * revogados, para o cache do processo esquecê-los na hora. Chaves de máquina NÃO são tocadas (ADR-124 §4).
 */
export async function revogarOutrasSessoes(conn: Conn, escopo: Escopo, manter: string | null): Promise<string[]> {
  // Primeiro as portas, depois as sessões (a ordem importa): a escolha aberta (ou a importação recém-feita, que ainda
  // pode repetir a resposta) e o pareamento aberto abrem sessão NESTE espaço. Fechá-los trava as linhas; uma importação
  // ou um pareamento em curso termina antes (e a sessão que ele criou entra na varredura abaixo, que lê depois do
  // commit dele) ou depois (e acha a porta fechada). Varrer as sessões antes deixaria escapar a sessão criada no meio.
  await conn`update entradas_conta set resolvida_em = coalesce(resolvida_em, clock_timestamp()), resolucao = 'cancelada'
    where destino_tenant_id = ${escopo.tenantId} and destino_pessoa_id = ${escopo.pessoaId} and (resolvida_em is null or resolucao = 'importada')`;
  await invalidarPareamentos(conn, escopo);
  const linhas = await conn<{ id: string }[]>`update sessoes set revogada_em = clock_timestamp()
    where tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId} and revogada_em is null
      and (${manter}::uuid is null or id <> ${manter}::uuid)
    returning id`;
  await conn`insert into sessoes_corte (tenant_id, pessoa_id) values (${escopo.tenantId}, ${escopo.pessoaId})
    on conflict (tenant_id, pessoa_id) do update set cortado_em = clock_timestamp()`;
  return linhas.map((l) => l.id);
}

/** Desde quando cookie sem sid desta pessoa deixou de valer (null = nunca cortado). */
/** A pessoa do cookie ainda existe? (Depois da purga, nada dela fica: nem pessoa, nem corte.) */
export async function pessoaExiste(conn: Conn, escopo: Escopo): Promise<boolean> {
  const [l] = await conn<{ ok: boolean }[]>`select nod_pessoa_existe(${escopo.tenantId}, ${escopo.pessoaId}) as ok`;
  return l?.ok === true;
}

export async function corteDaPessoa(conn: Conn, escopo: Escopo): Promise<number | null> {
  const [l] = await conn<{ cortado_em: Date }[]>`select cortado_em from sessoes_corte where tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId}`;
  return l ? ms(l.cortado_em) : null;
}

// ------------------------------------------------------------------------------------------- contas e identidades

export async function contaPorEmail(conn: Conn, email: string): Promise<{ id: string } | null> {
  const [l] = await conn<{ id: string }[]>`select id from contas where email = ${email}`;
  return l ?? null;
}

export async function contaPorGoogle(conn: Conn, iss: string, sub: string): Promise<{ id: string; email: string } | null> {
  const [l] = await conn<{ id: string; email: string }[]>`
    select c.id, c.email from identidades_conta i join contas c on c.id = i.conta_id
    where i.tipo = 'google' and i.google_iss = ${iss} and i.google_sub = ${sub}`;
  return l ?? null;
}

/** A conta ligada à pessoa (null = espaço provisório ou pessoa legada sem conta). */
export async function contaDaPessoa(conn: Conn, escopo: Escopo): Promise<{ id: string; email: string; temSenha: boolean; temGoogle: boolean } | null> {
  const [l] = await conn<{ id: string; email: string; tem_senha: boolean; tem_google: boolean }[]>`
    select c.id, c.email,
      exists (select 1 from identidades_conta i where i.conta_id = c.id and i.tipo = 'senha') as tem_senha,
      exists (select 1 from identidades_conta i where i.conta_id = c.id and i.tipo = 'google') as tem_google
    from conta_pessoas cp join contas c on c.id = cp.conta_id
    where cp.tenant_id = ${escopo.tenantId} and cp.pessoa_id = ${escopo.pessoaId}`;
  return l ? { id: l.id, email: l.email, temSenha: l.tem_senha, temGoogle: l.tem_google } : null;
}

/** A pessoa em que a conta entra: a primeira ligada (hoje toda conta tem uma só). */
export async function pessoaDaConta(conn: Conn, contaId: string): Promise<Escopo | null> {
  const [l] = await conn<{ tenant_id: string; pessoa_id: string }[]>`
    select tenant_id, pessoa_id from conta_pessoas where conta_id = ${contaId} order by criada_em limit 1`;
  return l ? { tenantId: l.tenant_id, pessoaId: l.pessoa_id } : null;
}

export async function pessoaTemConta(conn: Conn, escopo: Escopo): Promise<boolean> {
  const [l] = await conn<{ n: number }[]>`select count(*)::int as n from conta_pessoas where tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId}`;
  return (l?.n ?? 0) > 0;
}

/**
 * Espaço provisório (ADR-124 §2): a pessoa nasceu de `nod_criar_espaco_provisorio` (sem e-mail, com a linha da
 * instalação em `bootstrap_instalacoes`) e ainda não tem conta. Pessoa de time sem e-mail não passa por aqui.
 * Só ele converte, abre escolha ou é importado: a pessoa de time (ADR-030, com e-mail do login Google) nunca ganha senha
 * nem tem o trabalho levado para fora do tenant dela.
 */
export async function ehProvisorio(conn: Conn, escopo: Escopo): Promise<boolean> {
  const [l] = await conn<{ ok: boolean }[]>`
    select (p.email is null
      and exists (select 1 from bootstrap_instalacoes b where b.tenant_id = p.tenant_id and b.pessoa_id = p.id and b.aposentada_em is null)
      and not exists (select 1 from conta_pessoas cp where cp.tenant_id = p.tenant_id and cp.pessoa_id = p.id)) as ok
    from pessoas p where p.tenant_id = ${escopo.tenantId} and p.id = ${escopo.pessoaId}`;
  return l?.ok === true;
}

/** A pessoa ligada à conta veio do login de antes (tem e-mail em `pessoas`): entra só pelo Google, nunca por senha. */
export async function pessoaEhLegada(conn: Conn, escopo: Escopo): Promise<boolean> {
  const [l] = await conn<{ ok: boolean }[]>`select (email is not null) as ok from pessoas where tenant_id = ${escopo.tenantId} and id = ${escopo.pessoaId}`;
  return l?.ok === true;
}

/**
 * NOD-351: a situação da conta da pessoa, para o chat escolher o cartão. Lê na conexão que recebe (a transação do turno,
 * sem abrir outra do pool). Conta sem senha de pessoa do login de antes é `conta_google_de_antes`: o link de recuperação
 * não cria senha para ela (ServicoConta.redefinir).
 */
export async function situacaoDaConta(conn: Conn, escopo: Escopo): Promise<SituacaoConta> {
  const conta = await contaDaPessoa(conn, escopo);
  if (conta?.temSenha) return "conta_com_senha";
  if (conta) return (await pessoaEhLegada(conn, escopo)) ? "conta_google_de_antes" : "conta_sem_senha";
  if (await ehProvisorio(conn, escopo)) return "sem_conta";
  return (await pessoaEhLegada(conn, escopo)) ? "legado" : "fora_das_contas";
}

/** O e-mail da pessoa de antes das contas (ADR-030); null = provisória ou sem e-mail. */
export async function emailLegado(conn: Conn, escopo: Escopo): Promise<string | null> {
  const [l] = await conn<{ email: string | null }[]>`select email from pessoas where tenant_id = ${escopo.tenantId} and id = ${escopo.pessoaId}`;
  return l?.email ?? null;
}

/** Há pessoa de antes das contas com este e-mail (em qualquer número de tenants)? */
export async function existePessoaLegada(conn: Conn, email: string): Promise<boolean> {
  const [l] = await conn<{ n: number }[]>`
    select count(*)::int as n from pessoas p where p.email is not null and lower(p.email) = ${email}
      and not exists (select 1 from conta_pessoas cp where cp.tenant_id = p.tenant_id and cp.pessoa_id = p.id)`;
  return (l?.n ?? 0) > 0;
}

/** Cria a conta. null = o e-mail já tem conta (corrida perdida: o chamador relê). */
export async function criarConta(conn: Conn, email: string): Promise<string | null> {
  const [l] = await conn<{ id: string }[]>`insert into contas (email) values (${email}) on conflict (email) do nothing returning id`;
  return l?.id ?? null;
}

/**
 * Liga a conta à pessoa. false = a pessoa já tem conta ou a conta já tem pessoa nesse tenant. Ao ligar, o verificador da
 * instalação daquele espaço é aposentado na mesma transação: com conta, só se entra pela conta (senha, Google, pareamento).
 */
export async function ligarContaPessoa(conn: Conn, contaId: string, escopo: Escopo): Promise<boolean> {
  const linhas = await conn`insert into conta_pessoas (tenant_id, pessoa_id, conta_id) values (${escopo.tenantId}, ${escopo.pessoaId}, ${contaId}) on conflict do nothing returning 1`;
  if (linhas.length > 0) await aposentarInstalacao(conn, escopo);
  return linhas.length > 0;
}

/** A instalação deixa de voltar a este espaço (a pessoa levou o trabalho para uma conta). */
/**
 * Trava a instalação viva do espaço provisório até o fim da transação. Duas importações do mesmo provisório (duas abas,
 * contas diferentes) fazem fila aqui: a segunda acha a instalação já aposentada e não leva uma segunda cópia.
 */
export async function travarInstalacaoViva(conn: Conn, escopo: Escopo): Promise<boolean> {
  const linhas = await conn`select 1 from bootstrap_instalacoes
    where tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId} and aposentada_em is null for update`;
  return linhas.length > 0;
}

/** O app pediu o provisório de novo (só pede sem chave guardada): as chaves antigas do espaço caem antes da nova. */
export async function revogarChavesDoEspaco(conn: Conn, escopo: Escopo): Promise<void> {
  await conn`update maquina_tokens set revogado_em = clock_timestamp()
    where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and revogado_em is null`;
}

export async function aposentarInstalacao(conn: Conn, escopo: Escopo): Promise<void> {
  await conn`update bootstrap_instalacoes set aposentada_em = clock_timestamp()
    where tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId} and aposentada_em is null`;
}

export async function gravarIdentidade(conn: Conn, contaId: string, i: IdentidadeNova): Promise<boolean> {
  const linhas =
    i.tipo === "senha"
      ? await conn`insert into identidades_conta (conta_id, tipo, senha_hash) values (${contaId}, 'senha', ${i.senhaHash}) on conflict do nothing returning 1`
      : i.tipo === "email"
      ? await conn`insert into identidades_conta (conta_id, tipo) values (${contaId}, 'email') on conflict do nothing returning 1`
      : await conn`insert into identidades_conta (conta_id, tipo, google_iss, google_sub) values (${contaId}, 'google', ${i.iss}, ${i.sub}) on conflict do nothing returning 1`;
  return linhas.length > 0;
}

export async function senhaDaConta(conn: Conn, contaId: string, travar = false): Promise<string | null> {
  const [l] = travar
    ? await conn<{ senha_hash: string }[]>`select senha_hash from identidades_conta where conta_id = ${contaId} and tipo = 'senha' for update`
    : await conn<{ senha_hash: string }[]>`select senha_hash from identidades_conta where conta_id = ${contaId} and tipo = 'senha'`;
  return l?.senha_hash ?? null;
}

/** Refaz o hash só se a senha guardada ainda é a mesma (uma redefinição no meio do caminho vence). */
export async function refazerSenha(conn: Conn, contaId: string, antigo: string, novo: string): Promise<void> {
  await conn`update identidades_conta set senha_hash = ${novo}, atualizada_em = clock_timestamp() where conta_id = ${contaId} and tipo = 'senha' and senha_hash = ${antigo}`;
}

/** Senha nova ou sessões revogadas: o pareamento aberto (inclusive o já confirmado e não usado) deixa de valer. */
export async function invalidarPareamentos(conn: Conn, dono: Escopo): Promise<void> {
  await conn`update pareamentos_conta set estado = 'trocado' where tenant_id = ${dono.tenantId} and pessoa_id = ${dono.pessoaId} and estado in ('aguardando', 'pedido', 'confirmado')`;
}

/** Troca (ou cria, na redefinição de quem só tinha Google) a senha da conta. */
export async function definirSenha(conn: Conn, contaId: string, senhaHash: string): Promise<void> {
  const r = await conn`update identidades_conta set senha_hash = ${senhaHash}, atualizada_em = clock_timestamp() where conta_id = ${contaId} and tipo = 'senha'`;
  if (r.count === 0) await conn`insert into identidades_conta (conta_id, tipo, senha_hash) values (${contaId}, 'senha', ${senhaHash}) on conflict do nothing`;
}

/** Pessoa legada (sem conta) com este e-mail em `pessoas`: o login Google de antes da ADR-124. */
export async function pessoaLegadaPorEmail(conn: Conn, email: string): Promise<Escopo | null> {
  const linhas = await conn<{ tenant_id: string; id: string }[]>`
    select p.tenant_id, p.id from pessoas p
    where p.email is not null and lower(p.email) = ${email}
      and not exists (select 1 from conta_pessoas cp where cp.tenant_id = p.tenant_id and cp.pessoa_id = p.id)
    order by p.tenant_id limit 2`;
  const l = linhas.length === 1 ? linhas[0] : undefined;
  return l ? { tenantId: l.tenant_id, pessoaId: l.id } : null;
}

// ------------------------------------------------------------------------------------------- códigos e tokens

/** Emite um código novo e invalida os abertos da mesma finalidade e chave (pedir outro invalida o anterior). */
export async function emitirCodigo(conn: Conn, e: { finalidade: FinalidadeGuardada; chave: string; hash: Buffer; expiraEm: number; dados?: Record<string, unknown> }): Promise<string> {
  // Dois pedidos ao mesmo tempo não deixam dois códigos abertos: a troca é serializada por finalidade e chave.
  await conn`select pg_advisory_xact_lock(hashtextextended(${`codigo:${e.finalidade}:${e.chave}`}, 0))`;
  await conn`update codigos_conta set usado_em = clock_timestamp() where finalidade = ${e.finalidade} and chave = ${e.chave} and usado_em is null`;
  const [l] = await conn<{ id: string }[]>`
    insert into codigos_conta (finalidade, chave, hash, expira_em, dados)
    values (${e.finalidade}, ${e.chave}, ${e.hash}, ${data(e.expiraEm)}, ${conn.json((e.dados ?? {}) as never)}) returning id`;
  if (!l) throw new Error("código não emitido");
  return l.id;
}

/** O código aberto (não usado e não vencido) de uma chave, travado para a conferência. */
export async function codigoAbertoDaChave(conn: Conn, finalidade: FinalidadeGuardada, chave: string): Promise<(CodigoAberto & { hash: Buffer }) | null> {
  const [l] = await conn<{ id: string; chave: string; tentativas: number; dados: Record<string, unknown>; expira_em: Date; hash: Buffer }[]>`
    select id, chave, tentativas, dados, expira_em, hash from codigos_conta
    where finalidade = ${finalidade} and chave = ${chave} and usado_em is null and expira_em > clock_timestamp()
    order by criado_em desc limit 1 for update`;
  return l ? { id: l.id, chave: l.chave, tentativas: l.tentativas, dados: l.dados, expiraEm: ms(l.expira_em), hash: l.hash } : null;
}

/** Consome o código aberto com este hash (uso único: o UPDATE condicional decide a corrida). */
export async function consumirCodigoPorHash(conn: Conn, finalidade: FinalidadeGuardada, hash: Buffer): Promise<CodigoAberto | null> {
  const [l] = await conn<{ id: string; chave: string; tentativas: number; dados: Record<string, unknown>; expira_em: Date }[]>`
    update codigos_conta set usado_em = clock_timestamp()
    where finalidade = ${finalidade} and hash = ${hash} and usado_em is null and expira_em > clock_timestamp()
    returning id, chave, tentativas, dados, expira_em`;
  return l ? { id: l.id, chave: l.chave, tentativas: l.tentativas, dados: l.dados, expiraEm: ms(l.expira_em) } : null;
}

export async function consumirCodigo(conn: Conn, id: string): Promise<boolean> {
  const r = await conn`update codigos_conta set usado_em = clock_timestamp() where id = ${id} and usado_em is null`;
  return r.count > 0;
}

/** Conta uma tentativa errada; ao chegar ao teto, o código morre. Devolve as tentativas que restam. */
export async function errarCodigo(conn: Conn, id: string, teto: number): Promise<number> {
  const [l] = await conn<{ tentativas: number }[]>`
    update codigos_conta set tentativas = tentativas + 1,
      usado_em = case when tentativas + 1 >= ${teto} then clock_timestamp() else usado_em end
    where id = ${id} returning tentativas`;
  return Math.max(0, teto - (l?.tentativas ?? teto));
}

/** Invalida todos os códigos abertos de uma chave (senha trocada invalida a recuperação pendente). */
export async function invalidarCodigos(conn: Conn, finalidade: FinalidadeGuardada, chave: string): Promise<void> {
  await conn`update codigos_conta set usado_em = clock_timestamp() where finalidade = ${finalidade} and chave = ${chave} and usado_em is null`;
}

// ------------------------------------------------------------------------------------------- escolha pendente

type LinhaEntrada = { id: string; sessao_id: string; destino_tenant_id: string; destino_pessoa_id: string; conta_id: string | null; email: string; nova_identidade: Record<string, unknown>; expira_em: Date; resolvida_em: Date | null; resolucao: string | null };
const paraEntrada = (l: LinhaEntrada): EntradaPendente => ({
  id: l.id,
  sessaoId: l.sessao_id,
  destino: { tenantId: l.destino_tenant_id, pessoaId: l.destino_pessoa_id },
  contaId: l.conta_id,
  email: l.email,
  novaIdentidade: l.nova_identidade as EntradaPendente["novaIdentidade"],
  expiraEm: ms(l.expira_em),
  resolvidaEm: msOuNull(l.resolvida_em),
  resolucao: l.resolucao,
});

/** Abre a escolha da sessão; uma escolha aberta anterior da mesma sessão é cancelada (vale a última entrada tentada). */
export async function abrirEntrada(conn: Conn, e: { sessaoId: string; destino: Escopo; contaId: string | null; email: string; novaIdentidade: IdentidadeNova | null; expiraEm: number }): Promise<EntradaPendente> {
  await conn`update entradas_conta set resolvida_em = clock_timestamp(), resolucao = 'cancelada' where sessao_id = ${e.sessaoId} and resolvida_em is null`;
  const [l] = await conn<LinhaEntrada[]>`
    insert into entradas_conta (sessao_id, destino_tenant_id, destino_pessoa_id, conta_id, email, nova_identidade, expira_em)
    values (${e.sessaoId}, ${e.destino.tenantId}, ${e.destino.pessoaId}, ${e.contaId}, ${e.email}, ${conn.json((e.novaIdentidade ?? {}) as never)}, ${data(e.expiraEm)})
    returning *`;
  if (!l) throw new Error("entrada não aberta");
  return paraEntrada(l);
}

/** Trava as escolhas abertas da sessão (ordem única de travas: entradas antes da identidade). */
export async function travarEntradasDaSessao(conn: Conn, sessaoId: string): Promise<void> {
  await conn`select id from entradas_conta where sessao_id = ${sessaoId} and resolvida_em is null order by id for update`;
}

/** A escolha da sessão: a aberta e não vencida, ou a última resolvida como importada (para repetir a resposta). */
export async function entradaDaSessao(conn: Conn, sessaoId: string, travar = false): Promise<EntradaPendente | null> {
  const linhas = travar
    ? await conn<LinhaEntrada[]>`select * from entradas_conta where sessao_id = ${sessaoId} and ((resolvida_em is null and expira_em > clock_timestamp()) or resolucao = 'importada') order by criada_em desc limit 1 for update`
    : await conn<LinhaEntrada[]>`select * from entradas_conta where sessao_id = ${sessaoId} and ((resolvida_em is null and expira_em > clock_timestamp()) or resolucao = 'importada') order by criada_em desc limit 1`;
  const l = linhas[0];
  return l ? paraEntrada(l) : null;
}

export async function resolverEntrada(conn: Conn, id: string, resolucao: "importada" | "entrou" | "outra" | "cancelada", contaId?: string): Promise<boolean> {
  const r = await conn`update entradas_conta set resolvida_em = clock_timestamp(), resolucao = ${resolucao}, conta_id = coalesce(${contaId ?? null}::uuid, conta_id)
    where id = ${id} and resolvida_em is null`;
  return r.count > 0;
}

// ------------------------------------------------------------------------------------------- pareamento

type LinhaPar = { id: string; tenant_id: string; pessoa_id: string; estado: EstadoPareamento; pedido_sessao_id: string | null; pedido_aparelho: string | null; simbolos: string | null; expira_em: Date };
const paraPar = (l: LinhaPar): Pareamento => ({
  id: l.id,
  dono: { tenantId: l.tenant_id, pessoaId: l.pessoa_id },
  estado: l.estado,
  pedidoSessaoId: l.pedido_sessao_id,
  pedidoAparelho: l.pedido_aparelho,
  simbolos: l.simbolos ? l.simbolos.split(",") : null,
  expiraEm: ms(l.expira_em),
});

/** Gera o pareamento da pessoa; os abertos anteriores dela morrem (gerar outro invalida o anterior). */
export async function abrirPareamento(conn: Conn, dono: Escopo, hash: Buffer, expiraEm: number): Promise<Pareamento> {
  // Dois cliques (ou duas abas) ao mesmo tempo: a trava por pessoa garante que só o último código fica vivo.
  await conn`select pg_advisory_xact_lock(hashtextextended(${`pareamento:${dono.tenantId}:${dono.pessoaId}`}, 0))`;
  await invalidarPareamentos(conn, dono);
  const [l] = await conn<LinhaPar[]>`insert into pareamentos_conta (tenant_id, pessoa_id, hash, expira_em) values (${dono.tenantId}, ${dono.pessoaId}, ${hash}, ${data(expiraEm)}) returning *`;
  if (!l) throw new Error("pareamento não aberto");
  return paraPar(l);
}

/** O computador novo usa o código: só um aguardando e não vencido vira pedido (o UPDATE condicional decide a corrida). */
export async function pedirPareamento(conn: Conn, hash: Buffer, e: { sessaoId: string; aparelho: string; simbolos: string[] }): Promise<Pareamento | null> {
  const [l] = await conn<LinhaPar[]>`
    update pareamentos_conta set estado = 'pedido', pedido_sessao_id = ${e.sessaoId}, pedido_aparelho = ${e.aparelho.slice(0, 80)}, simbolos = ${e.simbolos.join(",")}
    where hash = ${hash} and estado = 'aguardando' and expira_em > clock_timestamp() returning *`;
  return l ? paraPar(l) : null;
}

export async function pareamentoDaPessoa(conn: Conn, dono: Escopo): Promise<Pareamento | null> {
  const [l] = await conn<LinhaPar[]>`select * from pareamentos_conta where tenant_id = ${dono.tenantId} and pessoa_id = ${dono.pessoaId}
    and estado in ('aguardando', 'pedido') order by criado_em desc limit 1`;
  return l ? paraPar(l) : null;
}

export async function pareamentoDoPedido(conn: Conn, sessaoId: string): Promise<Pareamento | null> {
  const [l] = await conn<LinhaPar[]>`select * from pareamentos_conta where pedido_sessao_id = ${sessaoId} order by criado_em desc limit 1`;
  return l ? paraPar(l) : null;
}

export async function decidirPareamento(conn: Conn, dono: Escopo, id: string, de: EstadoPareamento, para: EstadoPareamento): Promise<Pareamento | null> {
  const [l] = await conn<LinhaPar[]>`update pareamentos_conta set estado = ${para}
    where id = ${id} and tenant_id = ${dono.tenantId} and pessoa_id = ${dono.pessoaId} and estado = ${de} and expira_em > clock_timestamp()
    returning *`;
  return l ? paraPar(l) : null;
}

// ------------------------------------------------------------------------------------------- bootstrap e limites

/**
 * A instalação deste verificador. `aposentada`: o espaço já tem conta (ou o trabalho foi para uma); a instalação não
 * entra mais por aqui nem ganha espaço novo. Defesa extra: conta ligada vale como aposentada mesmo sem a marca.
 */
export async function instalacaoPorVerificador(conn: Conn, hash: Buffer): Promise<(Escopo & { aposentada: boolean }) | null> {
  const [l] = await conn<{ tenant_id: string; pessoa_id: string; aposentada: boolean }[]>`
    select b.tenant_id, b.pessoa_id, (b.aposentada_em is not null
      or exists (select 1 from conta_pessoas c where c.tenant_id = b.tenant_id and c.pessoa_id = b.pessoa_id)) as aposentada
      from bootstrap_instalacoes b where b.verificador_hash = ${hash}`;
  return l ? { tenantId: l.tenant_id, pessoaId: l.pessoa_id, aposentada: l.aposentada } : null;
}

export async function registrarInstalacao(conn: Conn, hash: Buffer, escopo: Escopo): Promise<boolean> {
  const linhas = await conn`insert into bootstrap_instalacoes (verificador_hash, tenant_id, pessoa_id) values (${hash}, ${escopo.tenantId}, ${escopo.pessoaId}) on conflict do nothing returning 1`;
  return linhas.length > 0;
}

/** Limite legado em janela fixa. Mantido para não mudar cadastro/entrada/recuperação com as flags desligadas. */
export async function consumirLimite(conn: Conn, chave: string, janelaMs: number, teto: number, agora: number): Promise<boolean> {
  const inicio = Math.floor(agora / janelaMs) * janelaMs;
  await conn`delete from limites_conta where chave = ${chave} and janela < ${data(inicio)}`;
  const [l] = await conn<{ contagem: number }[]>`
    insert into limites_conta (chave, janela, contagem) values (${chave}, ${data(inicio)}, 1)
    on conflict (chave, janela) do update set contagem = limites_conta.contagem + 1 returning contagem`;
  return (l?.contagem ?? teto + 1) <= teto;
}

/** Consulta o limite novo sem consumir. Útil para negar cedo sem criar outro contador antes do teto duro. */
export async function cabeNoLimiteDeslizante(conn: Conn, chave: string, janelaMs: number, teto: number, agora: number): Promise<boolean> {
  const corte = agora - janelaMs;
  await conn`select pg_advisory_xact_lock(hashtextextended(${chave}, 410))`;
  await conn`delete from limites_conta where chave = ${chave} and janela <= ${data(corte)}`;
  const [l] = await conn<{ contagem: number }[]>`select coalesce(sum(contagem), 0)::int as contagem from limites_conta where chave = ${chave} and janela > ${data(corte)}`;
  return (l?.contagem ?? teto) < teto;
}

/** Consome o limite novo em janela deslizante. A trava torna soma + incremento atômicos entre processos. */
export async function consumirLimiteDeslizante(conn: Conn, chave: string, janelaMs: number, teto: number, agora: number): Promise<boolean> {
  const corte = agora - janelaMs;
  await conn`select pg_advisory_xact_lock(hashtextextended(${chave}, 410))`;
  await conn`delete from limites_conta where chave = ${chave} and janela <= ${data(corte)}`;
  const [antes] = await conn<{ contagem: number }[]>`select coalesce(sum(contagem), 0)::int as contagem from limites_conta where chave = ${chave} and janela > ${data(corte)}`;
  // Recusas não renovam o bloqueio nem criam uma linha por tentativa automatizada.
  if ((antes?.contagem ?? teto) >= teto) return false;
  await conn`
    insert into limites_conta (chave, janela, contagem) values (${chave}, ${data(agora)}, 1)
    on conflict (chave, janela) do update set contagem = limites_conta.contagem + 1`;
  return true;
}

let ultimaPodaDosLimites = 0;
/** NOD-408/LGPD: o varredor chama mesmo sem tráfego de conta; o processo poda no máximo uma vez por hora. */
export async function podarLimitesConta(conn: Conn, agora: number): Promise<number> {
  if (agora - ultimaPodaDosLimites < 60 * 60_000) return 0;
  const removidas = await conn`delete from limites_conta where janela < ${data(agora - 2 * 24 * 60 * 60_000)} returning 1`;
  ultimaPodaDosLimites = agora;
  return removidas.length;
}
