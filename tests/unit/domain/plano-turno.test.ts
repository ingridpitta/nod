import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Concessao } from "../../../src/contracts/concessao.ts";
import type { Conector } from "../../../src/contracts/conector.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { NATIVAS_DO_TERMINAL } from "../../../src/domain/nativas.ts";
import { FERRAMENTAS_NOD_POR_MODO, FORA_DO_PEDIDO_DE_OUTRA_PESSOA, MODOS_DO_QUADRO, montarPlano, permitidaAPedidoDeOutraPessoa, PLANO_SEM_VALIDADE, type EntradaPlano } from "../../../src/domain/plano-turno.ts";

const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Vera", titulo: "", descricao: "revisa PRs", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora, mensagemOrigemId: "m0" };
const conector: Conector = { tenantId: "t", id: "k1", ownerId: "p", visibility: "privado", nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", args: [], url: null, env: {}, declaracao: "nao-toca", habilitado: true, catalogo: [
  { nome: "listar_contatos", descricao: "lista", schema: { type: "object" }, readOnlyHint: true },
  { nome: "enviar_email", descricao: "envia", schema: { type: "object" }, readOnlyHint: false },
], sondadoEm: agora, ultimaFalha: null, criadoEm: 0 };
const concessoes: Concessao[] = [
  { tenantId: "t", id: "g1", ownerId: "p", agenteId: "a1", conectorId: "k1", capacidade: "listar_contatos", mensagemId: "m", criadoEm: 0 },
  { tenantId: "t", id: "g2", ownerId: "p", agenteId: "a1", conectorId: "k1", capacidade: "enviar_email", mensagemId: "m", criadoEm: 0 },
];
const base: EntradaPlano = { turno, agente, memorias: [], concessoes, conectores: [conector], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora };
const nomes = (p: ReturnType<typeof montarPlano>) => p.catalogo.ferramentas.map((f) => f.nome);

describe("montarPlano", () => {
  // NOD-442: gerir_quadro é de QUALQUER bot, mas só com o experimento ligado e nos modos de trabalho.
  it("gerir_quadro só com o experimento Quadro e nos modos do quadro", () => {
    expect(nomes(montarPlano(base))).not.toContain("gerir_quadro");
    for (const modo of MODOS_DO_QUADRO) expect(nomes(montarPlano({ ...base, modo, quadro: true }))).toContain("gerir_quadro");
    expect(nomes(montarPlano({ ...base, modo: "sala", quadro: true }))).not.toContain("gerir_quadro");
  });
  it("conversa: ferramentas nod do modo + conector ∩ concessão como slug__tool com nomeMcp exato", () => {
    const p = montarPlano(base);
    // remover_computador só com NOD_ONBOARDING_TEXTO=1 (revisão do PR #694; conta-pelo-chat.test.ts)
    for (const n of FERRAMENTAS_NOD_POR_MODO.conversa.filter((f) => f !== "remover_computador")) expect(nomes(p)).toContain(n);
    expect(nomes(p)).toContain("exemplo__listar_contatos");
    expect(nomes(p)).toContain("exemplo__enviar_email");
    expect(p.catalogo.ferramentas.find((f) => f.nome === "exemplo__enviar_email")?.nomeMcp).toBe("mcp__nod__exemplo__enviar_email");
    expect(p.catalogo.servidores).toEqual([{ conectorId: "k1", nome: "exemplo", trust: "untrusted", transporte: "stdio" }]);
    expect(p.superficie).toBe("maquina_da_pessoa");
    expect(p.localidade).toBe("local");
    expect(p.autoria).toMatchObject({ autor_tipo: "agente", autor_id: "a1", conta_de_execucao: "p", locality_reason: "tudo_local_nesta_rodada", decidido_por: "regra:localidade" });
    expect(p.decididoPor).toBe("regra:montagem-ferramentas");
    expect(p.promptSistema).toContain("mcp__nod__exemplo__enviar_email");
  });

  it("sem concessão a ferramenta do conector não entra; conector desabilitado some inteiro", () => {
    const so = montarPlano({ ...base, concessoes: [concessoes[0]!] });
    expect(nomes(so)).toContain("exemplo__listar_contatos");
    expect(nomes(so)).not.toContain("exemplo__enviar_email");
    const off = montarPlano({ ...base, conectores: [{ ...conector, habilitado: false }] });
    expect(nomes(off).some((n) => n.startsWith("exemplo__"))).toBe(false);
    expect(off.catalogo.servidores).toEqual([]);
  });

  it("no limite (profundidade 3) corta o salto — sem pedir_a_bot nem encaminhar (E12.4) — e mantém o modo (ADR-058/062)", () => {
    const p = montarPlano({ ...base, modo: "sala", profundidade: 3 });
    expect(nomes(p)).not.toContain("pedir_a_bot");
    expect(nomes(p)).not.toContain("encaminhar");
    expect(nomes(p)).toContain("passar");
    expect(p.profundidade).toBe(3);
    expect(p.promptSistema).toContain("Modo de sala");
    expect(p.promptSistema).toContain("Limite da corrente:");
  });

  it("em profundidade 1 e 2 o salto fica (ADR-063): a continuação de quem pediu ainda pede a outro colega", () => {
    for (const profundidade of [1, 2] as const) {
      const p = montarPlano({ ...base, modo: "sala", profundidade });
      expect(nomes(p)).toEqual(expect.arrayContaining(["pedir_a_bot", "encaminhar", "passar"]));
      expect(p.profundidade).toBe(profundidade);
      expect(p.promptSistema).not.toContain("Limite da corrente:");
    }
  });

  it("ADR-066: entrada nao_confiavel não encolhe o catálogo — leitura E escrita do conector ficam, decididoPor é a regra de montagem; só a regra 'Sempre permitir' sai", () => {
    const p = montarPlano({ ...base, confianca: "nao_confiavel", semprePermitir: ["exemplo__enviar_email"] });
    expect(nomes(p)).toContain("exemplo__listar_contatos");
    expect(nomes(p)).toContain("exemplo__enviar_email");
    expect(nomes(p)).toContain("pedir_aprovacao");
    expect(nomes(p).sort()).toEqual(nomes(montarPlano(base)).sort());
    expect(p.confiancaEntrada).toBe("nao_confiavel");
    expect(p.decididoPor).toBe("regra:montagem-ferramentas");
    // O conteúdo de fora só pesa no manual, na hora de cada ação (aprovacao-permanente.ts): a regra da pessoa não vem.
    expect(p.semprePermitir).toEqual([]);
    expect(montarPlano({ ...base, semprePermitir: ["exemplo__enviar_email"] }).semprePermitir).toEqual(["exemplo__enviar_email"]);
  });

  it("modos: criacao é o kit da conversa mais atualizar_perfil; rotina permite ver e pedir a colega (ver_colegas desde a ADR-066), pedir acesso e silêncio; sala tem passar/encaminhar", () => {
    // ADR-050: bot novo é bot completo — perfil vazio não tira ferramenta nenhuma da conversa.
    const criacao = nomes(montarPlano({ ...base, modo: "criacao" })).filter((n) => !n.includes("__"));
    expect(criacao.filter((n) => n !== "atualizar_perfil").sort()).toEqual(nomes(montarPlano(base)).filter((n) => !n.includes("__")).sort());
    expect(criacao).toContain("atualizar_perfil");
    for (const n of ["ver_colegas", "pedir_a_bot", "pedir_a_pessoa"]) expect(criacao).toContain(n);
    expect(nomes(montarPlano(base))).not.toContain("atualizar_perfil");
    // ADR-044: pedir_acesso só propõe (a pessoa decide num botão); sem ele a rotina pedia acesso em texto a cada disparo.
    expect(nomes(montarPlano({ ...base, modo: "rotina" })).filter((n) => !n.includes("__") && n !== "ler_mais")).toEqual(["lembrar", "pedir_aprovacao", "pedir_acesso", "ver_colegas", "pedir_a_pessoa", "pedir_a_bot", "sem_novidade", "publicar_artefato", "ler_artefato", "abrir_frentes", "mandar_para_frente", "me_chame_as", "avisar_pessoa", "buscar_conversas", "ler_conversa"]);
    // ADR-051: a rotina também publica e lê o artefato (a checklist do meio-dia atualiza a da manhã).
    // definido em 2026-09-28: com ferramenta de fora (conector) vem ler_mais, atendida pelo proxy; sem nenhuma, não.
    expect(nomes(montarPlano({ ...base, modo: "rotina" }))).toContain("ler_mais");
    // Sem nenhuma (e sem ler_conversa, NOD-61), não: o peer só lembra.
    expect(nomes(montarPlano({ ...base, modo: "peer", profundidade: 1, conectores: [], concessoes: [] }))).not.toContain("ler_mais");
    const sala = nomes(montarPlano({ ...base, modo: "sala" }));
    expect(sala).toContain("passar");
    expect(sala).toContain("encaminhar");
    expect(sala).toContain("pedir_a_pessoa");
    // sem_novidade é só de rotina: em sala/conversa alguém está esperando resposta.
    expect(sala).not.toContain("sem_novidade");
    // NOD-114: sala e peer falam com outras pessoas/bots; não podem chamar a dona por fora do fio.
    expect(sala).not.toContain("avisar_pessoa");
    expect(nomes(montarPlano({ ...base, modo: "peer", profundidade: 1 }))).not.toContain("avisar_pessoa");
  });

  it("ADR-051: artefato em conversa, criação, rotina e delegação (ADR-066: roda na conversa própria de quem recebe); fora de sala e peer; ler_artefato só lê", () => {
    // A criação tem o kit da conversa desde a ADR-050 (bot novo é bot completo), artefato incluído.
    for (const modo of ["conversa", "criacao", "rotina", "delegacao"] as const) {
      expect(nomes(montarPlano({ ...base, modo })), modo).toEqual(expect.arrayContaining(["publicar_artefato", "ler_artefato"]));
    }
    expect(nomes(montarPlano({ ...base, modo: "sala" }))).not.toContain("publicar_artefato");
    expect(nomes(montarPlano({ ...base, modo: "peer", profundidade: 1 }))).not.toContain("publicar_artefato");
    const plano = montarPlano({ ...base, modo: "conversa" });
    const ler = plano.catalogo.ferramentas.find((f) => f.nome === "ler_artefato");
    const publicar = plano.catalogo.ferramentas.find((f) => f.nome === "publicar_artefato");
    expect(ler).toMatchObject({ origem: "nod", readOnlyHint: true });
    expect(publicar).toMatchObject({ origem: "nod", readOnlyHint: false });
    // Turno não confiável: o catálogo não encolhe (ADR-066) — publicar continua.
    const deFora = montarPlano({ ...base, modo: "conversa", confianca: "nao_confiavel" });
    expect(nomes(deFora)).toEqual(expect.arrayContaining(["publicar_artefato", "ler_artefato"]));
    expect(plano.promptSistema).toContain("publicar_artefato");
    expect(plano.promptSistema).toContain("window.nod.salvar");
    expect(montarPlano({ ...base, modo: "sala" }).promptSistema).not.toContain("window.nod.salvar");
  });

  it("NOD-61: buscar_conversas e ler_conversa onde o bot trabalha (sala inclusive, menos o peer legado), só leitura, com a linha do prompt", () => {
    for (const modo of ["conversa", "criacao", "rotina", "ligacao", "sala"] as const) {
      const plano = montarPlano({ ...base, modo });
      for (const n of ["buscar_conversas", "ler_conversa"]) expect(plano.catalogo.ferramentas.find((f) => f.nome === n), `${modo}: ${n}`).toMatchObject({ origem: "nod", readOnlyHint: true });
    }
    const peer = montarPlano({ ...base, modo: "peer", profundidade: 1 });
    expect(nomes(peer)).not.toContain("buscar_conversas");
    expect(nomes(peer)).not.toContain("ler_conversa");
    expect(montarPlano({ ...base, modo: "conversa" }).promptSistema).toContain("buscar_conversas");
    expect(peer.promptSistema).not.toContain("buscar_conversas");
    // Revisão do /codex (P2): sem conector nenhum, ler_mais vem pelo ler_conversa (20 falas de 2.000 passam do corte do proxy).
    expect(nomes(montarPlano({ ...base, modo: "rotina", conectores: [], concessoes: [] }))).toContain("ler_mais");
    // Revisão 3 (M1/M2): pedido de outro bot — a delegação (pedir_a_bot grava sobProcuracaoDe = quem pediu, igual ao ownerId)
    // e a frente/retomada que herdou sobProcuracaoDe — não leva o histórico, nem com a mesma pessoa (pode ter vindo de uma sala).
    for (const p of [{ modo: "delegacao" as const, turno: { ...turno, sobProcuracaoDe: turno.ownerId } }, { modo: "delegacao" as const, turno }, { modo: "conversa" as const, turno: { ...turno, sobProcuracaoDe: turno.ownerId } }, { modo: "conversa" as const, turno: { ...turno, sobProcuracaoDe: "outra-pessoa" } }]) {
      const n = nomes(montarPlano({ ...base, ...p }));
      expect(n, `${p.modo} ${p.turno.sobProcuracaoDe ?? "-"}`).not.toContain("buscar_conversas");
      expect(n).not.toContain("ler_conversa");
    }
    expect(nomes(montarPlano({ ...base, modo: "conversa", turno: { ...turno, sobProcuracaoDe: null } }))).toContain("buscar_conversas");
  });

  it("NOD-443 (revisão 4 do PR #628, achado 2): o turno a pedido de outra pessoa não grava estado da dona (memória, frentes, despertar, artefato, rotinas, perfil, barra, acesso)", () => {
    const deOutra = { ...turno, sobProcuracaoDe: "outra-pessoa" };
    for (const modo of ["conversa", "criacao", "delegacao", "rotina"] as const) {
      const daDona = nomes(montarPlano({ ...base, modo, quadro: true }));
      const n = nomes(montarPlano({ ...base, modo, quadro: true, turno: deOutra }));
      for (const f of FORA_DO_PEDIDO_DE_OUTRA_PESSOA) expect(n, `${modo} ${f}`).not.toContain(f);
      expect(n, modo).toContain("gerir_quadro");
      expect(n, modo).toContain("pedir_aprovacao");
      // A referência: o mesmo turno da dona tem as que o modo dá (lembrar em todos).
      expect(daDona, modo).toContain("lembrar");
    }
    expect(FORA_DO_PEDIDO_DE_OUTRA_PESSOA).toEqual(expect.arrayContaining(["lembrar", "abrir_frentes", "me_chame_as", "publicar_artefato"]));
    // A procuração da própria dona (pedido de colega dela) não perde nada disto.
    expect(nomes(montarPlano({ ...base, turno: { ...turno, sobProcuracaoDe: turno.ownerId } }))).toEqual(expect.arrayContaining(["lembrar", "me_chame_as", "publicar_artefato", "abrir_frentes"]));
  });

  it("NOD-443 (revisão 5 do PR #628, achado 1): o turno a pedido de outra pessoa não leva conector da dona (nem leitura) nem as memórias dela", () => {
    const memorias = [{ tenantId: "t", id: "m1", agenteId: "a1", tipo: "preferencia" as const, texto: "SEGREDO-DA-DONA", origem: "pessoa" as const, criadoEm: 0 }];
    const daDona = montarPlano({ ...base, memorias });
    expect(nomes(daDona)).toContain("exemplo__listar_contatos");
    expect(daDona.promptSistema).toContain("SEGREDO-DA-DONA");
    for (const modo of ["conversa", "criacao", "delegacao", "rotina"] as const) {
      const p = montarPlano({ ...base, modo, memorias, turno: { ...turno, sobProcuracaoDe: "outra-pessoa" } });
      expect(p.catalogo.ferramentas.filter((f) => f.origem === "conector"), modo).toEqual([]);
      expect(p.catalogo.servidores, modo).toEqual([]);
      expect(p.promptSistema, modo).not.toContain("SEGREDO-DA-DONA");
      expect(p.promptSistema, modo).not.toContain("mcp__nod__exemplo__");
    }
    // A procuração da própria dona continua com tudo.
    const propria = montarPlano({ ...base, memorias, turno: { ...turno, sobProcuracaoDe: turno.ownerId } });
    expect(nomes(propria)).toContain("exemplo__listar_contatos");
    expect(propria.promptSistema).toContain("SEGREDO-DA-DONA");
  });

  it("NOD-443 (revisão 6 do PR #628, achados 1, 2 e 4): a pedido de outra pessoa, nem o Sobre mim da dona, nem ver_colegas/ler_artefato/listar_rotinas, nem o diretório de colegas ou o inventário de rotinas no prompt", () => {
    const daDona: Partial<EntradaPlano> = {
      sobreMim: "SOBRE-MIM-DA-DONA",
      colegas: [{ id: "a2", nome: "ColegaDaDona", titulo: "Financeiro", descricao: "DESCRICAO-DO-COLEGA" }],
      rotinasDoAgente: [{ id: "r1", resumo: "toda sexta às 16h", instrucao: "ROTINA-DA-DONA", estado: "ativa" }],
    };
    // A referência: o turno da dona tem tudo isto.
    const propria = montarPlano({ ...base, ...daDona, modo: "conversa" });
    expect(nomes(propria)).toEqual(expect.arrayContaining(["ver_colegas", "ler_artefato", "listar_rotinas"]));
    for (const s of ["SOBRE-MIM-DA-DONA", "ColegaDaDona", "DESCRICAO-DO-COLEGA", "ROTINA-DA-DONA", "Diretório de colegas"]) expect(propria.promptSistema, s).toContain(s);
    for (const modo of ["conversa", "criacao", "delegacao", "rotina"] as const) {
      const p = montarPlano({ ...base, ...daDona, modo, quadro: true, turno: { ...turno, sobProcuracaoDe: "outra-pessoa" } });
      for (const f of ["ver_colegas", "ler_artefato", "listar_rotinas"]) expect(nomes(p), `${modo} ${f}`).not.toContain(f);
      for (const s of ["SOBRE-MIM-DA-DONA", "ColegaDaDona", "DESCRICAO-DO-COLEGA", "ROTINA-DA-DONA", "Diretório de colegas", "Inventário de rotinas"]) expect(p.promptSistema, `${modo} ${s}`).not.toContain(s);
      // O que fica no catálogo é exatamente o que o caso de uso deixa rodar (achado 5).
      for (const f of p.catalogo.ferramentas) expect(permitidaAPedidoDeOutraPessoa(f), `${modo} ${f.nome}`).toBe(true);
    }
    // A procuração da própria dona (pedido de um bot dela) não perde nada disto.
    const procuracaoDaDona = montarPlano({ ...base, ...daDona, modo: "conversa", turno: { ...turno, sobProcuracaoDe: turno.ownerId } });
    expect(nomes(procuracaoDaDona)).toEqual(expect.arrayContaining(["ver_colegas", "ler_artefato", "listar_rotinas"]));
    expect(procuracaoDaDona.promptSistema).toContain("SOBRE-MIM-DA-DONA");
  });

  it("NOD-443 (revisão 7 do PR #628, achado 1): a pedido de outra pessoa, nem as frentes e tasks abertas da dona no prompt", () => {
    const trabalhosAbertos = [{ id: "w1", titulo: "FRENTE-DA-DONA", estado: "rodando" as const, ultimoPasso: "PASSO-DA-DONA" }];
    // A referência: o turno da dona (conversa e delegação, sem trabalho) mostra as frentes dela.
    for (const modo of ["conversa", "delegacao"] as const) {
      const propria = montarPlano({ ...base, modo, trabalhosAbertos });
      for (const s of ["FRENTE-DA-DONA", "PASSO-DA-DONA", "Trabalhos em andamento"]) expect(propria.promptSistema, `${modo} ${s}`).toContain(s);
    }
    for (const modo of ["conversa", "criacao", "delegacao", "rotina"] as const) {
      const p = montarPlano({ ...base, modo, quadro: true, trabalhosAbertos, turno: { ...turno, sobProcuracaoDe: "outra-pessoa" } });
      for (const s of ["FRENTE-DA-DONA", "PASSO-DA-DONA", "Trabalhos em andamento"]) expect(p.promptSistema, `${modo} ${s}`).not.toContain(s);
    }
    // A procuração da própria dona (pedido de um bot dela) continua vendo.
    expect(montarPlano({ ...base, modo: "delegacao", trabalhosAbertos, turno: { ...turno, sobProcuracaoDe: turno.ownerId } }).promptSistema).toContain("FRENTE-DA-DONA");
  });

  it("NOD-443 (revisão 6 do PR #628, achado 5): a lista do pedido de outra pessoa só tem ferramenta do nod fora das da dona", () => {
    expect(permitidaAPedidoDeOutraPessoa({ nome: "gerir_quadro", origem: "nod" })).toBe(true);
    expect(permitidaAPedidoDeOutraPessoa({ nome: "pedir_aprovacao", origem: "nod" })).toBe(true);
    for (const nome of [...FORA_DO_PEDIDO_DE_OUTRA_PESSOA, "buscar_conversas", "ler_conversa", "ver_agenda", "nao_lidos"]) expect(permitidaAPedidoDeOutraPessoa({ nome, origem: "nod" }), nome).toBe(false);
    for (const origem of ["conector", "computador", "workspace", "proxy"] as const) expect(permitidaAPedidoDeOutraPessoa({ nome: "x", origem }), origem).toBe(false);
  });

  it("NOD-85 (revisão 1 do PR #595): ver_agenda só onde a pessoa dona lê — nem na sala nem a pedido de outro bot", () => {
    for (const modo of ["conversa", "criacao", "ligacao"] as const) expect(nomes(montarPlano({ ...base, modo })), modo).toContain("ver_agenda");
    expect(nomes(montarPlano({ ...base, modo: "sala" }))).not.toContain("ver_agenda");
    // Revisão 2 do PR 595: leitura pura, marcada como só leitura.
    expect(montarPlano({ ...base, modo: "conversa" }).catalogo.ferramentas.find((f) => f.nome === "ver_agenda")).toMatchObject({ origem: "nod", readOnlyHint: true });
    for (const sob of [turno.ownerId, "outra-pessoa"]) expect(nomes(montarPlano({ ...base, modo: "conversa", turno: { ...turno, sobProcuracaoDe: sob } })), sob).not.toContain("ver_agenda");
  });

  it("NOD-317: o \"A fazer\" saiu — nenhum modo tem ferramenta de pendência, nem o prompt fala dela", () => {
    for (const modo of Object.keys(FERRAMENTAS_NOD_POR_MODO) as (keyof typeof FERRAMENTAS_NOD_POR_MODO)[]) {
      expect(FERRAMENTAS_NOD_POR_MODO[modo].filter((n) => n.includes("pendencia")), modo).toEqual([]);
    }
    for (const modo of ["conversa", "criacao", "rotina", "sala", "delegacao", "ligacao"] as const) {
      const plano = montarPlano({ ...base, modo });
      expect(nomes(plano).filter((n) => n.includes("pendencia")), modo).toEqual([]);
      expect(plano.promptSistema, modo).not.toContain("anotar_pendencia");
      expect(plano.promptSistema, modo).not.toContain("Suas pendências abertas");
    }
  });

  it("NOD-183 (ADR-080): o plano leva as duas partes do prompt; juntadas com \"\\n\" dão o promptSistema, sem marcador", () => {
    for (const entrada of [base, { ...base, modo: "delegacao" as const, profundidade: 1 as const }]) {
      const p = montarPlano(entrada);
      const partes = p.promptSistemaPartes!;
      expect([partes.estavel, partes.volatil].filter((s) => s !== "").join("\n")).toBe(p.promptSistema);
      expect(p.promptSistema).not.toContain("__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__");
    }
  });

  it("agente acordado por rotina pede a colega com o catálogo inteiro, mesmo não confiável; quem recebe (delegacao) tem o catálogo dele e repassa até o limite (ADR-058/062/066)", () => {
    const rotina = montarPlano({ ...base, modo: "rotina", turno: { ...turno, origem: "rotina" }, confianca: "nao_confiavel" });
    expect(nomes(rotina)).toContain("pedir_a_bot");
    // ADR-066: em 30/09 a Clarice não mandava Slack na rotina porque a escrita sumia calada do catálogo.
    expect(nomes(rotina)).toEqual(expect.arrayContaining(["exemplo__listar_contatos", "exemplo__enviar_email"]));
    expect(Object.keys(rotina.politicaExecucao).sort()).toEqual(["orcamentoResultadoChars", "prazoMs"]);
    const colega = montarPlano({ ...base, modo: "delegacao", turno: { ...turno, origem: "delegacao", profundidade: 1 }, profundidade: 1, confianca: "confiavel" });
    // O Chico, pedido pela Clarice a acionar os Devs, não tinha como (2026-09-30): agora quem recebe também pede.
    expect(nomes(colega)).toContain("pedir_a_bot");
    expect(nomes(colega)).toEqual(expect.arrayContaining(["exemplo__listar_contatos", "exemplo__enviar_email"]));
    // ADR-066: sem trava herdada da rotina de quem pediu — quem decide a escrita é o modo de quem recebe.
    expect(Object.keys(colega.politicaExecucao).sort()).toEqual(["orcamentoResultadoChars", "prazoMs"]);
    const noLimite = montarPlano({ ...base, modo: "delegacao", turno: { ...turno, origem: "delegacao", profundidade: 3 }, profundidade: 3, confianca: "confiavel" });
    expect(nomes(noLimite)).not.toContain("pedir_a_bot");
    expect(nomes(noLimite)).toContain("exemplo__enviar_email");
  });

  it("ADR-066: a rotina não tem gate — política só de prazo e orçamento, como a conversa, e o catálogo inteiro, com escrita e terminal", () => {
    const rot = montarPlano({ ...base, turno: { ...turno, origem: "rotina" }, modo: "rotina", terminal: true });
    expect(rot.politicaExecucao).toEqual({ prazoMs: 86_400_000, orcamentoResultadoChars: expect.any(Number) });
    expect(rot.politicaExecucao).toEqual(montarPlano(base).politicaExecucao);
    expect(nomes(rot)).toContain("exemplo__enviar_email");
    expect(rot.nativas).toEqual(NATIVAS_DO_TERMINAL);
    expect(rot.promptSistema).not.toContain("Terminal: este turno não tem terminal");
    // O mesmo vale para a conversa e para a rotina não confiável: a origem não muda o catálogo.
    expect(montarPlano({ ...base, terminal: true }).nativas).toEqual(NATIVAS_DO_TERMINAL);
    expect(montarPlano({ ...base, turno: { ...turno, origem: "rotina" }, modo: "rotina", confianca: "nao_confiavel", terminal: true }).nativas).toEqual(NATIVAS_DO_TERMINAL);
  });

  it("ADR-066: a retomada de uma rotina, mesmo não confiável, segue no modo rotina sem gate e com a escrita; o ciclo de vida de rotina continua fora", () => {
    const retomada = montarPlano({ ...base, turno: { ...turno, origem: "retomada", retomaTurnoId: "t0" }, modo: "rotina", confianca: "nao_confiavel" });
    expect(Object.keys(retomada.politicaExecucao).sort()).toEqual(["orcamentoResultadoChars", "prazoMs"]);
    expect(nomes(retomada)).toContain("exemplo__enviar_email");
    expect(nomes(retomada)).not.toContain("pausar_rotina");
    expect(retomada.promptSistema).toContain("Você foi acordado por um agendamento");
    // Retomada de conversa: a mesma política.
    expect(montarPlano({ ...base, turno: { ...turno, origem: "retomada" } }).politicaExecucao).toEqual(retomada.politicaExecucao);
  });

  it("inventário não pronto → executor_indisponivel (nunca promove em silêncio)", () => {
    expect(() => montarPlano({ ...base, inventario: { estado: "ausente", motivo: "claude ausente", em: agora } })).toThrow(ErroDeDominio);
    try {
      montarPlano({ ...base, inventario: { estado: "nao_autenticado", motivo: "sem login", em: agora } });
    } catch (e) {
      expect((e as ErroDeDominio).codigo).toBe("executor_indisponivel");
    }
  });

  it("entrada e prazo vêm do turno/relógio; o plano vale enquanto o turno vive (ADR-067); sessaoCli passa para --resume; sem cwd (EMENDA 11)", () => {
    const p = montarPlano({ ...base, sessaoCli: "sess-1" });
    expect(p.entrada).toEqual({ texto: "oi", sessaoCli: "sess-1", modelo: "claude-haiku-4-5-20251001" });
    expect(p.politicaExecucao.prazoMs).toBe(86_400_000);
    expect(p.expiraEm).toBe(PLANO_SEM_VALIDADE);
    expect("cwd" in p.politicaExecucao).toBe(false);
  });
});

describe("catálogo de workspace conforme haja projeto autorizado", () => {
  // definido em 2026-09-18: ver ferramentas que ainda não pode usar levava o agente a tentar,
  // falhar e virar tutorial de menu. Sem projeto, só consultar e propor.
  it("sem projeto autorizado oferece apenas consultar e propor", () => {
    const p = montarPlano({ ...base, workspace: true, workspaceVinculado: false });
    const doWorkspace = p.catalogo.ferramentas.filter((f) => f.origem === "workspace").map((f) => f.nome);
    expect(doWorkspace.sort()).toEqual(["workspace_consultar", "workspace_propor_pasta"]);
    expect(doWorkspace).not.toContain("workspace_gravar_texto");
    expect(doWorkspace).not.toContain("workspace_terminal");
  });
  it("com projeto autorizado oferece o catálogo completo", () => {
    const p = montarPlano({ ...base, workspace: true, workspaceVinculado: true });
    const doWorkspace = p.catalogo.ferramentas.filter((f) => f.origem === "workspace").map((f) => f.nome);
    expect(doWorkspace).toContain("workspace_gravar_texto");
    expect(doWorkspace).toContain("workspace_terminal");
    expect(doWorkspace).toContain("workspace_trocar_projeto");
  });
  it("sem o serviço de workspace não oferece nenhuma", () => {
    expect(montarPlano({ ...base, workspace: false, workspaceVinculado: true }).catalogo.ferramentas.filter((f) => f.origem === "workspace")).toHaveLength(0);
  });
  it("ADR-066: em todo modo menos o peer legado — sala, rotina e pedido de colega também trabalham na pasta", () => {
    for (const modo of ["sala", "rotina", "delegacao"] as const) {
      const p = montarPlano({ ...base, modo, workspace: true, workspaceVinculado: true });
      expect(p.catalogo.ferramentas.some((f) => f.nome === "workspace_terminal"), modo).toBe(true);
      // Sem projeto autorizado, a mesma regra de sempre: só consultar e propor.
      expect(montarPlano({ ...base, modo, workspace: true, workspaceVinculado: false }).catalogo.ferramentas.filter((f) => f.origem === "workspace").map((f) => f.nome).sort(), modo).toEqual(["workspace_consultar", "workspace_propor_pasta"]);
    }
    expect(montarPlano({ ...base, modo: "peer", profundidade: 1, workspace: true, workspaceVinculado: true }).catalogo.ferramentas.filter((f) => f.origem === "workspace")).toHaveLength(0);
  });
  it("a criação é conversa própria: bot novo também trabalha na pasta (ADR-050)", () => {
    expect(montarPlano({ ...base, modo: "criacao", workspace: true, workspaceVinculado: true }).catalogo.ferramentas.some((f) => f.nome === "workspace_terminal")).toBe(true);
  });
});

describe("montarPlano: o modo de aprovação (ADR-059)", () => {
  it("leva o modo do agente e diz ao modelo que ele aprova as próprias ações", () => {
    expect(montarPlano(base).modoAprovacao).toBe("manual");
    expect(montarPlano(base).promptSistema).not.toContain("Aprovações:");
    const auto = montarPlano({ ...base, agente: { ...agente, modoAprovacao: "automatico" } });
    expect(auto.modoAprovacao).toBe("automatico");
    expect(auto.promptSistema).toContain("Aprovações: este bot está em Aprovar automaticamente");
    const total = montarPlano({ ...base, agente: { ...agente, modoAprovacao: "total" } });
    expect(total.promptSistema).toContain("Aprovações: este bot está em Ignorar todas as aprovações");
  });

  it("ADR-066: nem trava herdada nem gate da própria rotina — em todo modo a política é só prazo e orçamento, e quem decide é o modo do agente, que vai no plano", () => {
    for (const modo of ["conversa", "criacao", "sala", "rotina", "delegacao"] as const) {
      const p = montarPlano({ ...base, modo, profundidade: modo === "delegacao" ? 1 : 0, agente: { ...agente, modoAprovacao: "automatico" }, delegacao: modo === "delegacao" ? { pessoaNome: "Marlon", remetenteNome: "Clarice" } : null });
      expect(Object.keys(p.politicaExecucao).sort(), modo).toEqual(["orcamentoResultadoChars", "prazoMs"]);
      expect(p.modoAprovacao, modo).toBe("automatico");
      expect(p.modoTurno, modo).toBe(modo);
    }
    // O automático não para mais depois de conteúdo de fora, e o prompt diz isso.
    const deFora = montarPlano({ ...base, confianca: "nao_confiavel", agente: { ...agente, modoAprovacao: "automatico" } });
    expect(deFora.promptSistema).toContain("Ler a web, um e-mail ou um PR não muda isso.");
  });

  it("ADR-131: o plano diz ao motor se o turno é o que a pessoa espera agora (a régua do soDaPessoa)", () => {
    const daPessoa = (t: Partial<Turno>) => montarPlano({ ...base, turno: { ...turno, ...t } }).daPessoa;
    expect(daPessoa({})).toBe(true);
    expect(daPessoa({ origem: "retomada", retomaTurnoId: "t0" })).toBe(true);
    expect(daPessoa({ origem: "ligacao" })).toBe(true);
    // O fundo: frente, rotina, pedido de colega e as retomadas deles.
    expect(daPessoa({ trabalhoId: "w1" })).toBe(false);
    expect(daPessoa({ origem: "rotina", bastidores: true })).toBe(false);
    expect(daPessoa({ origem: "retomada", bastidores: true })).toBe(false);
    // A frente que a pessoa olha ("Testar agora") conta como dela.
    expect(daPessoa({ trabalhoId: "w1", pessoaEsperando: true })).toBe(true);
  });
});

describe("montarPlano: o onboarding por ligação (ADR-077)", () => {
  it("as três ferramentas do onboarding só entram na ligação com `onboarding`; nunca em outro modo", () => {
    const ligacao = nomes(montarPlano({ ...base, modo: "ligacao" }));
    for (const n of ["anotar_entrevista", "concluir_entrevista", "propor_bot"]) expect(ligacao).not.toContain(n);
    const onboarding = nomes(montarPlano({ ...base, modo: "ligacao", onboarding: true }));
    for (const n of ["anotar_entrevista", "concluir_entrevista", "propor_bot", "pedir_acesso", "criar_rotina", "desligar"]) expect(onboarding).toContain(n);
    const conversa = nomes(montarPlano({ ...base, modo: "conversa", onboarding: true }));
    for (const n of ["anotar_entrevista", "concluir_entrevista", "propor_bot"]) expect(conversa).not.toContain(n);
  });

  it("ADR-086: me_chame_as entra onde o bot trabalha com tempo (não na sala nem na ligação), com a linha do prompt contra o laço de sleep", () => {
    const conversa = montarPlano(base);
    expect(nomes(conversa)).toContain("me_chame_as");
    expect(conversa.promptSistema).toContain("não fique num laço com sleep");
    for (const modo of ["criacao", "rotina", "delegacao"] as const) expect(nomes(montarPlano({ ...base, modo }))).toContain("me_chame_as");
    for (const modo of ["sala", "ligacao", "peer"] as const) {
      const p = montarPlano({ ...base, modo });
      expect(nomes(p)).not.toContain("me_chame_as");
      expect(p.promptSistema).not.toContain("me_chame_as");
    }
  });

  it("ADR-099 (parte 2): esperar_comando entra só com terminal, nos modos do me_chame_as; o prompt deixa me_chame_as para hora marcada", () => {
    const semTerminal = montarPlano(base);
    expect(nomes(semTerminal)).not.toContain("esperar_comando");
    expect(semTerminal.promptSistema).not.toContain("esperar_comando");
    const conversa = montarPlano({ ...base, terminal: true });
    expect(nomes(conversa)).toContain("esperar_comando");
    expect(conversa.promptSistema).toContain("Chame esperar_comando com um comando que só termina quando a espera acabar");
    expect(conversa.promptSistema).toContain("me_chame_as é só para hora marcada");
    expect(conversa.promptSistema).not.toContain("testes, build, CI, QA");
    for (const modo of ["criacao", "rotina", "delegacao"] as const) expect(nomes(montarPlano({ ...base, modo, terminal: true }))).toContain("esperar_comando");
    for (const modo of ["sala", "ligacao", "peer"] as const) expect(nomes(montarPlano({ ...base, modo, terminal: true }))).not.toContain("esperar_comando");
  });

  it("NOD-323: anexar_midia só com pasta do bot e Bash, e o prompt manda usá-la em vez de caminho na fala", () => {
    const semTerminal = montarPlano(base);
    expect(semTerminal.pastaDoBot).toBeUndefined();
    expect(nomes(semTerminal)).not.toContain("anexar_midia");
    expect(semTerminal.promptSistema).not.toContain("Mídia:");
    const comTerminal = montarPlano({ ...base, terminal: true });
    expect(comTerminal.pastaDoBot).toBeTruthy();
    expect(nomes(comTerminal)).toContain("anexar_midia");
    expect(comTerminal.catalogo.ferramentas.find((f) => f.nome === "anexar_midia")?.origem).toBe("proxy");
    expect(comTerminal.promptSistema).toContain("vai para o chat com anexar_midia");
    // Na sala a fala vai por postarNaSala, que não prende a mídia: a ferramenta não entra (o bot não diria "Anexei abaixo.").
    expect(nomes(montarPlano({ ...base, modo: "sala", terminal: true }))).not.toContain("anexar_midia");
  });
});
