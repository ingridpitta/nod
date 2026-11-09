import { describe, expect, it, vi } from "vitest";
import { ErroApi } from "../../../web/lib/erro-api.ts";
import { interpretarFrame } from "../../../web/lib/live-events.ts";
import { abreProvisorio, criarContaNoChat, decidirPareamento, emRepouso, equipeNoApp, htmlBlocoConta, htmlEtapa, linkDaEquipe, resumoDoEspaco, type ApiConta, type DepsConta } from "../../../web/telas/conta-no-chat.ts";
import { deveLembrar, htmlLembrete, jaFalou, marcarFalou } from "../../../web/telas/lembrete-conta.ts";
import { htmlMenuConta } from "../../../web/telas/menu-conta.ts";

/**
 * NOD-345: os cartões da conta na conversa. Sem DOM: o HTML sai puro e o controlador recebe a API, o relógio e a leitura
 * dos campos falsos. O que se prova aqui: as etapas do protótipo, "Conferindo…" sem envio duplo, "Restam N", a falha da
 * importação que não muda nada, a resposta neutra da recuperação e que a senha nunca chega ao HTML nem às linhas.
 */
const SENHA = "uma-senha-bem-longa-123";
const vista = { ocupado: false, google: true, agora: 0 };
const form = (valores: Record<string, string>) => ({ valores });
const campo = (f: object, nome: string) => (f as { valores: Record<string, string> }).valores[nome] ?? "";
const el = (dados: Record<string, string> = {}) => ({ dataset: dados });

function montar(api: Partial<ApiConta>, extra: Partial<DepsConta> = {}) {
  const ticks: (() => void)[] = [];
  const entrou = vi.fn(async () => undefined);
  const irParaConversa = vi.fn();
  const c = criarContaNoChat({
    api: () => api as ApiConta,
    conversaDoNod: () => ({ conversaId: "conv-nod", agenteId: "nod" }),
    conversaDaTela: () => "conv-tela",
    irParaConversa,
    aoMudar: () => undefined,
    google: () => true,
    noApp: () => false,
    entrou,
    contaMudou: () => undefined,
    abrirUrl: () => undefined,
    agora: () => 1_000,
    intervalo: (fn) => { ticks.push(fn); return () => { ticks.splice(ticks.indexOf(fn), 1); }; },
    campo,
    ...extra,
  });
  const bloco = () => c.blocoNaConversa("conv-nod");
  return { c, bloco, entrou, irParaConversa, ticks };
}
const esperar = () => new Promise((r) => setTimeout(r, 0));

describe("cartões: HTML puro", () => {
  it("início: Google (quando há), e-mail, Agora não, entrar e código", () => {
    const h = htmlEtapa({ tipo: "inicio" }, vista);
    for (const t of ["Conta no nod", "Continuar com Google", "Usar e-mail", "Agora não", "Já tenho conta com e-mail", "Tenho um código"]) expect(h).toContain(t);
    expect(htmlEtapa({ tipo: "inicio" }, { ...vista, google: false })).not.toContain("Continuar com Google");
  });

  it("NOD-408: a cota explica que a mensagem voltou e oferece criar conta", () => {
    const semGoogle = htmlEtapa({ tipo: "inicio", cota: true }, { ...vista, google: false });
    expect(semGoogle).toContain("Você usou as mensagens sem conta");
    expect(semGoogle).toContain("sua mensagem ficou no campo");
    expect(semGoogle).toContain(">Criar conta<");
    const comGoogle = htmlEtapa({ tipo: "inicio", cota: true }, vista);
    expect(comGoogle).toContain("Continuar com Google");
    expect(comGoogle).toContain(">Usar e-mail<");
  });

  it("NOD-406: com `equipe`, o início e o entrar levam ao Google da equipe; sem ele, o link não aparece", () => {
    const comEquipe = { ...vista, google: false, equipe: "/api/sessao/google" };
    for (const etapa of [{ tipo: "inicio" as const }, { tipo: "entrar" as const, erro: null }]) {
      const h = htmlEtapa(etapa, comEquipe);
      expect(h).toContain('<a class="bt cc-link" href="/api/sessao/google">Sou da equipe: entrar com Google</a>');
      expect(htmlEtapa(etapa, { ...vista, google: false })).not.toContain("Sou da equipe");
      expect(htmlEtapa(etapa, { ...vista, google: false, equipe: null })).not.toContain("Sou da equipe");
    }
    // O endereço passa pelo escape (nunca HTML cru no href).
    expect(htmlEtapa({ tipo: "inicio" }, { ...vista, equipe: '/x"><b>' })).not.toContain('"><b>');
  });

  it("código: Restam N, vencido pede outro, ocupado = Conferindo… desabilitado", () => {
    const base = { tipo: "codigo" as const, email: "a@b.com", restantes: 3, vencido: false, reenviado: false };
    expect(htmlEtapa(base, vista)).toContain("Restam 3");
    const venc = htmlEtapa({ ...base, vencido: true }, vista);
    expect(venc).toContain("venceu");
    expect(venc).not.toContain('data-form="conta-codigo"');
    const ocup = htmlEtapa(base, { ...vista, ocupado: true });
    expect(ocup).toMatch(/type="submit" class="bt pri" disabled aria-busy="true">Conferindo…/);
  });

  it("código que não saiu (provedor fora): diz que ainda não saiu e pede outro, sem 'Mandamos'", () => {
    const h = htmlEtapa({ tipo: "codigo", email: "a@b.com", restantes: null, vencido: false, reenviado: false, naoEnviado: true }, vista);
    expect(h).toContain("ainda não saiu");
    expect(h).toContain("Tente mandar outro");
    expect(h).not.toContain("Mandamos");
  });

  it("escolha e falha: 'nada mudou' com Tentar de novo e Continuar sem conta", () => {
    const e = { tipo: "escolha" as const, email: "a@b.com", espaco: { bots: 2, conversas: 5, mensagens: 40, rotinas: 1, artefatos: 0 }, falhou: false, confirmado: true };
    const h = htmlEtapa(e, vista);
    for (const t of ["E-mail confirmado", "Levar para esta conta", "Usar outra conta", "Agora não", "2 bots, 5 conversas e 1 rotina"]) expect(h).toContain(t);
    const f = htmlEtapa({ ...e, falhou: true }, vista);
    expect(f).toContain("Nada mudou");
    expect(f).toContain("Tentar de novo");
    expect(f).toContain("Continuar sem conta");
  });

  it("sessões: lista, 'Sair de N sessões' em vermelho só depois de pedir", () => {
    const dados = { atual: "s1", sessoes: [
      { id: "s1", origem: "web" as const, aparelho: "Mac · Chrome", criadaEm: 0, ultimoUsoEm: 0, revogadaEm: null },
      { id: "s2", origem: "web" as const, aparelho: "Windows · Edge", criadaEm: 0, ultimoUsoEm: 0, revogadaEm: null },
      { id: "s3", origem: "maquina" as const, aparelho: "macOS · app do nod", criadaEm: 0, ultimoUsoEm: 0, revogadaEm: null },
      { id: "s4", origem: "web" as const, aparelho: "Velha", criadaEm: 0, ultimoUsoEm: 0, revogadaEm: 5 },
    ] };
    const lista = htmlEtapa({ tipo: "sessoes", dados, confirmar: false }, vista);
    expect(lista).toContain("esta sessão");
    expect(lista).not.toContain("Velha");
    const conf = htmlEtapa({ tipo: "sessoes", dados, confirmar: true }, vista);
    expect(conf).toMatch(/class="bt danger" data-act="conta-sair-outras">Sair de 2 sessões/);
  });

  it("pareamento: código grande com o prazo; pedido mostra os símbolos e Sim, conectar / Não reconheço", () => {
    const g = htmlEtapa({ tipo: "parear-gerar", codigo: "123456", expiraEm: 301_000, pedido: null, vencido: false }, { ...vista, agora: 1_000 });
    expect(g).toContain("123 456");
    expect(g).toContain("5:00");
    const p = htmlEtapa({ tipo: "parear-gerar", codigo: "123456", expiraEm: 0, pedido: { aparelho: "Windows · Edge", simbolos: ["sol", "lua", "peixe"] }, vencido: false }, vista);
    expect(p).toContain("Sim, conectar");
    expect(p).toContain("Não reconheço");
    expect(p).toContain("☀️");
    expect(htmlEtapa({ tipo: "parear-gerar", codigo: "1", expiraEm: 0, pedido: null, vencido: true }, vista)).toContain("Gerar novo código");
  });

  it("campos de senha são password, sem value, e o bloco só tem linhas sem senha", () => {
    for (const e of [{ tipo: "cadastro", erro: null }, { tipo: "entrar", erro: null }, { tipo: "senha", erro: null, salva: null }] as const) {
      const h = htmlEtapa(e, vista);
      expect(h).toMatch(/type="password"/);
      expect(h).not.toMatch(/value=/);
    }
    expect(htmlBlocoConta({ etapa: null, ocupado: false, resolvidas: [], google: false, agora: 0 })).toBe("");
  });

  it("resumoDoEspaco: só o que tem", () => {
    expect(resumoDoEspaco({ bots: 0, conversas: 0, mensagens: 0, rotinas: 0, artefatos: 0 })).toBeNull();
    expect(resumoDoEspaco({ bots: 1, conversas: 0, mensagens: 0, rotinas: 0, artefatos: 3 })).toBe("1 bot e 3 artefatos");
  });
});

describe("controlador", () => {
  it("NOD-406: abrir(\"entrar\") com o motivo mostra o erro no cartão; sem motivo, o cartão limpo", async () => {
    const { c, bloco } = montar({});
    await c.abrir("entrar", true, "Não foi possível entrar com essa conta Google.");
    expect(bloco()).toContain('role="alert"');
    expect(bloco()).toContain("Não foi possível entrar com essa conta Google.");
    await c.abrir("entrar", true);
    expect(bloco()).not.toContain('role="alert"');
    await c.abrir("inicio", true, "ignorado");
    expect(bloco()).not.toContain("ignorado");
  });

  it("o que começa pelo menu abre na conversa do Nod; fora dela o bloco é vazio", async () => {
    const { c, irParaConversa, bloco } = montar({});
    await c.abrir("inicio", true);
    expect(irParaConversa).toHaveBeenCalledWith("conv-nod", "nod");
    expect(bloco()).toContain("Usar e-mail");
    expect(c.blocoNaConversa("outra")).toBe("");
  });

  it("cadastro → código → Restam N → convertida vira uma linha sem a senha", async () => {
    const api = {
      cadastrar: vi.fn(async () => ({ enviado: true, email: "ana@x.com" })),
      verificar: vi.fn().mockResolvedValueOnce({ resultado: "errado", restantes: 4 }).mockResolvedValueOnce({ resultado: "convertida", email: "ana@x.com" }),
      estado: vi.fn(async () => ({ conta: { email: "ana@x.com", senha: true, google: false }, escolha: null, verificando: null })),
    };
    const { c, bloco } = montar(api as Partial<ApiConta>);
    await c.abrir("cadastro");
    await c.forms["conta-cadastro"]!(form({ email: " ana@x.com ", senha: SENHA }));
    expect(api.cadastrar).toHaveBeenCalledWith("ana@x.com", SENHA);
    expect(bloco()).toContain("Confira seu e-mail");
    await c.forms["conta-codigo"]!(form({ codigo: "111111" }));
    expect(bloco()).toContain("Restam 4");
    await c.forms["conta-codigo"]!(form({ codigo: "222222" }));
    expect(bloco()).toContain("Conta criada: ana@x.com");
    expect(bloco()).not.toContain(SENHA);
    expect(c.etapa()).toBeNull();
  });

  it("R11: senha curta (por caractere, não por unidade UTF-16) é barrada no cartão, sem chamar a API", async () => {
    const cadastrar = vi.fn(async () => ({ enviado: true, email: "a@b.com" }));
    const trocarSenha = vi.fn(async () => ({ resultado: "trocada" as const, encerradas: 0 }));
    const { c, bloco } = montar({ cadastrar, trocarSenha });
    await c.abrir("cadastro");
    // 11 emojis = 22 unidades UTF-16, mas 11 caracteres para quem digita.
    await c.forms["conta-cadastro"]!(form({ email: "a@b.com", senha: "😀".repeat(11) }));
    expect(bloco()).toContain("A senha precisa de pelo menos 12 caracteres.");
    expect(cadastrar).not.toHaveBeenCalled();
    await c.forms["conta-cadastro"]!(form({ email: "a@b.com", senha: "😀".repeat(12) }));
    expect(cadastrar).toHaveBeenCalledTimes(1);
    await c.abrir("senha");
    await c.forms["conta-senha"]!(form({ atual: "a", nova: "curta", nova2: "curta" }));
    expect(bloco()).toContain("A senha precisa de pelo menos 12 caracteres.");
    expect(trocarSenha).not.toHaveBeenCalled();
  });

  it("R11: código certo de e-mail da pessoa de time diz que ela entra pelo Google", async () => {
    const api = {
      cadastrar: vi.fn(async () => ({ enviado: true, email: "ana@empresa.com" })),
      verificar: vi.fn(async () => ({ resultado: "pelo_google", email: "ana@empresa.com" })),
    };
    const { c, bloco } = montar(api as unknown as Partial<ApiConta>);
    await c.abrir("cadastro");
    await c.forms["conta-cadastro"]!(form({ email: "ana@empresa.com", senha: SENHA }));
    await c.forms["conta-codigo"]!(form({ codigo: "111111" }));
    expect(bloco()).toContain("ana@empresa.com entra pelo Google");
    expect(bloco()).not.toContain(SENHA);
  });

  it("R11: erro da API vira frase pelo código (a mensagem da API é fixa e não decide nada)", async () => {
    const cadastrar = vi.fn()
      .mockRejectedValueOnce(new ErroApi(400, "entrada_invalida", "Algum dado do pedido não está certo."))
      .mockRejectedValueOnce(new ErroApi(409, "estado_invalido", "Isso não pode ser feito agora."));
    const { c, bloco } = montar({ cadastrar } as unknown as Partial<ApiConta>);
    await c.abrir("cadastro");
    await c.forms["conta-cadastro"]!(form({ email: "a@b.com", senha: SENHA }));
    expect(bloco()).toContain("Confira o que foi digitado.");
    await c.forms["conta-cadastro"]!(form({ email: "a@b.com", senha: SENHA }));
    expect(bloco()).toContain("Isso não vale mais. Comece de novo.");
  });

  it("Conferindo…: o segundo envio enquanto o primeiro corre não chama a API de novo", async () => {
    let soltar!: () => void;
    const verificar = vi.fn(() => new Promise((r) => { soltar = () => r({ resultado: "errado", restantes: 2 }); }));
    const cadastrar = vi.fn(async () => ({ enviado: true, email: "a@b.com" }));
    const { c: c2, bloco: bloco2 } = montar({ verificar, cadastrar } as unknown as Partial<ApiConta>);
    await c2.abrir("cadastro");
    await c2.forms["conta-cadastro"]!(form({ email: "a@b.com", senha: SENHA }));
    const um = c2.forms["conta-codigo"]!(form({ codigo: "123456" }));
    expect(bloco2()).toContain("Conferindo…");
    const dois = c2.forms["conta-codigo"]!(form({ codigo: "123456" }));
    soltar();
    await Promise.all([um, dois]);
    expect(verificar).toHaveBeenCalledTimes(1);
    expect(bloco2()).toContain("Restam 2");
  });

  it("importar que falha: 'nada mudou'; tentar de novo leva e entra no espaço novo", async () => {
    const importar = vi.fn().mockResolvedValueOnce({ resultado: "falhou" }).mockResolvedValueOnce({ resultado: "importado", contagem: { bots: 1, conversas: 2, mensagens: 3, rotinas: 0, artefatos: 0 }, trocaApp: "troca-123" });
    const api = {
      entrar: vi.fn(async () => ({ resultado: "escolher", email: "ana@x.com" })),
      estado: vi.fn(async () => ({ conta: null, escolha: { email: "ana@x.com", espaco: { bots: 1, conversas: 2, mensagens: 3, rotinas: 0, artefatos: 0 } }, verificando: null })),
      importar,
    };
    const { c, bloco, entrou } = montar(api as unknown as Partial<ApiConta>);
    await c.abrir("entrar");
    await c.forms["conta-entrar"]!(form({ email: "ana@x.com", senha: SENHA }));
    expect(bloco()).toContain("Levar para esta conta");
    await c.acoes["conta-importar"]!(el());
    expect(bloco()).toContain("Nada mudou");
    expect(entrou).not.toHaveBeenCalled();
    await c.acoes["conta-importar"]!(el());
    expect(bloco()).toContain("Levado para ana@x.com: 1 bot e 2 conversas");
    expect(entrou).toHaveBeenCalledWith("troca-123");
  });

  it("importar sem resposta (rede): não promete 'nada mudou' nem oferece 'Continuar sem conta'; tentar de novo leva", async () => {
    const importar = vi.fn().mockRejectedValueOnce(new ErroApi(0, "rede", "x")).mockResolvedValueOnce({ resultado: "importado", contagem: { bots: 0, conversas: 1, mensagens: 1, rotinas: 0, artefatos: 0 }, trocaApp: null });
    const api = { estado: vi.fn(async () => ({ conta: null, escolha: { email: "a@b.com", espaco: null }, verificando: null })), importar };
    const { c, bloco, entrou } = montar(api as unknown as Partial<ApiConta>);
    await c.retomar();
    await c.acoes["conta-importar"]!(el());
    expect(bloco()).toContain("Não deu para confirmar");
    expect(bloco()).not.toContain("Nada mudou");
    expect(bloco()).not.toContain("Continuar sem conta");
    await c.acoes["conta-importar"]!(el());
    expect(bloco()).toContain("Levado para a@b.com");
    expect(entrou).toHaveBeenCalledWith(null);
  });

  it("importar sem sessão (403, a importação pode ter ido): não diz 'nada mudou'; manda entrar na conta para conferir", async () => {
    const api = { estado: vi.fn(async () => ({ conta: null, escolha: { email: "a@b.com", espaco: null }, verificando: null })), importar: vi.fn(async () => { throw new ErroApi(403, "nao_permitido", "x"); }) };
    const { c, bloco } = montar(api as unknown as Partial<ApiConta>);
    await c.retomar();
    await c.acoes["conta-importar"]!(el());
    expect(bloco()).toContain("Entre para conferir");
    expect(bloco()).toContain("a@b.com");
    expect(bloco()).not.toContain("Nada mudou");
    expect(bloco()).not.toContain("Continuar sem conta");
    await c.acoes["conta-ir-entrar"]!(el());
    expect(c.etapa()).toMatchObject({ tipo: "entrar" });
  });

  it("importar recusado pelo servidor (4xx): a transação voltou, então é 'nada mudou'", async () => {
    const api = { estado: vi.fn(async () => ({ conta: null, escolha: { email: "a@b.com", espaco: null }, verificando: null })), importar: vi.fn(async () => { throw new ErroApi(409, "estado_invalido", "x"); }) };
    const { c, bloco } = montar(api as unknown as Partial<ApiConta>);
    await c.retomar();
    await c.acoes["conta-importar"]!(el());
    expect(bloco()).toContain("Nada mudou");
    expect(bloco()).toContain("Continuar sem conta");
  });

  it("entrar recusado e limite: frases no cartão, nada de 'e-mail não existe'", async () => {
    const entrar = vi.fn().mockResolvedValueOnce({ resultado: "recusado" }).mockRejectedValueOnce(new ErroApi(429, "limite_atingido", "entrar"));
    const { c, bloco } = montar({ entrar } as unknown as Partial<ApiConta>);
    await c.abrir("entrar");
    await c.forms["conta-entrar"]!(form({ email: "x@y.com", senha: "s" }));
    expect(bloco()).toContain("E-mail ou senha não conferem.");
    await c.forms["conta-entrar"]!(form({ email: "x@y.com", senha: "s" }));
    expect(bloco()).toContain("Muitas tentativas");
  });

  it("recuperar: resposta neutra com o e-mail digitado", async () => {
    const recuperar = vi.fn(async () => ({ ok: true as const }));
    const { c, bloco } = montar({ recuperar });
    await c.abrir("recuperar");
    await c.forms["conta-recuperar"]!(form({ email: "quem@x.com" }));
    expect(bloco()).toContain("Se existir uma conta com <b>quem@x.com</b>");
  });

  it("trocar senha: as duas novas precisam bater; trocada diz quantas outras saíram", async () => {
    const trocarSenha = vi.fn(async () => ({ resultado: "trocada" as const, encerradas: 2 }));
    const { c, bloco } = montar({ trocarSenha });
    await c.abrir("senha");
    await c.forms["conta-senha"]!(form({ atual: "a", nova: SENHA, nova2: "outra" }));
    expect(bloco()).toContain("não são iguais");
    expect(trocarSenha).not.toHaveBeenCalled();
    await c.forms["conta-senha"]!(form({ atual: "a", nova: SENHA, nova2: SENHA }));
    expect(bloco()).toContain("Senha nova salva");
    expect(bloco()).toContain("as outras 2 sessões");
    expect(bloco()).not.toContain(SENHA);
  });

  it("pareamento no computador novo: pede, mostra os símbolos, espera e entra", async () => {
    const esperarPareamento = vi.fn().mockResolvedValueOnce({ estado: "esperando" }).mockResolvedValueOnce({ estado: "entrou", trocaApp: null });
    const { c, bloco, entrou, ticks } = montar({ pedirPareamento: vi.fn(async () => ({ resultado: "pedido" as const, simbolos: ["sol", "lua", "flor"] })), esperarPareamento } as unknown as Partial<ApiConta>);
    await c.abrir("parear-entrar");
    await c.forms["conta-parear-pedir"]!(form({ codigo: "123 456" }));
    expect(bloco()).toContain("🌸");
    ticks[0]!(); await esperar();
    expect(bloco()).toContain("Esperando");
    ticks[0]!(); await esperar(); await esperar();
    expect(bloco()).toContain("Computador conectado.");
    expect(entrou).toHaveBeenCalledWith(null);
    expect(ticks).toHaveLength(0);
  });

  it("pareamento num provisório: confirmado no outro, abre a escolha de levar (não entra direto)", async () => {
    const esperarPareamento = vi.fn().mockResolvedValueOnce({ estado: "escolher", email: "ana@x.com" });
    const estado = vi.fn(async () => ({ conta: null, escolha: { email: "ana@x.com", espaco: null }, verificando: null }));
    const { c, bloco, entrou, ticks } = montar({ pedirPareamento: vi.fn(async () => ({ resultado: "pedido" as const, simbolos: ["sol", "lua", "flor"] })), esperarPareamento, estado } as unknown as Partial<ApiConta>);
    await c.abrir("parear-entrar");
    await c.forms["conta-parear-pedir"]!(form({ codigo: "123 456" }));
    ticks[0]!(); await esperar(); await esperar();
    expect(bloco()).toContain("Levar para esta conta");
    expect(entrou).not.toHaveBeenCalled();
    expect(ticks).toHaveLength(0);
  });

  it("pareamento no computador da conta: o pedido aparece; 'Não reconheço' recusa", async () => {
    const decidirPareamento = vi.fn(async () => ({ estado: "recusado" as const }));
    const api = {
      gerarPareamento: vi.fn(async () => ({ codigo: "654321", expiraEm: 301_000 })),
      pareamento: vi.fn(async () => ({ pareamento: { estado: "pedido" as const, aparelho: "Windows · Edge", simbolos: ["sol", "lua", "flor"], expiraEm: 301_000 } })),
      decidirPareamento,
    };
    const { c, bloco, ticks } = montar(api as unknown as Partial<ApiConta>);
    await c.abrir("parear-gerar");
    expect(bloco()).toContain("654 321");
    ticks[0]!(); await esperar(); await esperar();
    expect(bloco()).toContain("Windows · Edge");
    await c.acoes["conta-parear-decidir"]!(el({ confirmar: "nao" }));
    expect(decidirPareamento).toHaveBeenCalledWith(false);
    expect(bloco()).toContain("Pedido recusado");
  });

  it("o código vencido do pareamento pede um novo, sem chamar o servidor", async () => {
    let agora = 1_000;
    const pareamento = vi.fn();
    const { c, bloco, ticks } = montar({ gerarPareamento: vi.fn(async () => ({ codigo: "654321", expiraEm: 2_000 })), pareamento } as unknown as Partial<ApiConta>, { agora: () => agora });
    await c.abrir("parear-gerar");
    agora = 3_000;
    ticks[0]!(); await esperar();
    expect(bloco()).toContain("Gerar novo código");
    expect(pareamento).not.toHaveBeenCalled();
  });

  it("retomar: código pendente no servidor reabre o cartão do código", async () => {
    const { c, bloco } = montar({ estado: vi.fn(async () => ({ conta: null, escolha: null, verificando: { email: "a@b.com" } })) });
    await c.retomar();
    expect(bloco()).toContain("Mandamos um código para <b>a@b.com</b>");
  });

  it("retomar antes da frota: o cartão pendente aparece quando a conversa do Nod chega", async () => {
    let frota = false;
    const { c, bloco } = montar(
      { estado: vi.fn(async () => ({ conta: null, escolha: null, verificando: { email: "a@b.com" } })) },
      { conversaDoNod: () => (frota ? { conversaId: "conv-nod", agenteId: "nod" } : null), conversaDaTela: () => null },
    );
    await c.retomar();
    expect(bloco()).toBe("");
    frota = true;
    expect(bloco()).toContain("Mandamos um código para <b>a@b.com</b>");
  });

  it("Google no app: 'termine no navegador'; na volta, recusado vira linha", async () => {
    const abrirUrl = vi.fn();
    const { c, bloco } = montar({ google: vi.fn(async () => ({ url: "https://accounts.google.com/x" })), estado: vi.fn(async () => ({ conta: null, escolha: null, verificando: null })) }, { noApp: () => true, abrirUrl });
    await c.abrir("inicio");
    await c.acoes["conta-google"]!(el());
    expect(abrirUrl).toHaveBeenCalledWith("https://accounts.google.com/x");
    expect(bloco()).toContain("Termine no navegador");
    await c.aoVoltarDoGoogle("recusado");
    expect(bloco()).toContain("Crie com e-mail e senha; nada mudou.");
  });
});

describe("lembrete e menu (opção 2)", () => {
  it("fala uma vez: só com contas, sem conta, com rotina e sem ter falado", () => {
    const base = { contas: true, temConta: false, rotinas: 1, jaFalou: false };
    expect(deveLembrar(base)).toBe(true);
    expect(deveLembrar({ ...base, contas: false })).toBe(false);
    expect(deveLembrar({ ...base, temConta: true })).toBe(false);
    expect(deveLembrar({ ...base, temConta: null })).toBe(false);
    expect(deveLembrar({ ...base, rotinas: 0 })).toBe(false);
    expect(deveLembrar({ ...base, jaFalou: true })).toBe(false);
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(jaFalou(st)).toBe(false);
    marcarFalou(st);
    expect(jaFalou(st)).toBe(true);
    expect(htmlLembrete()).toContain('data-act="conta-abrir"');
  });

  // NOD-367: o menu só tem Sair; senha, sessões e outro computador moram em Configurações › Conta.
  it("menu: sem conta, a linha fixa; com conta, só Sair; sem contas no servidor, nada", () => {
    const base = { faixa: null, conexao: "Conectada" };
    expect(htmlMenuConta(base)).not.toContain("data-conta=");
    const sem = htmlMenuConta({ ...base, conta: { email: null, senha: false } });
    expect(sem).toContain("Criar conta ou entrar");
    expect(sem).toContain("Seu espaço está só neste computador");
    const com = htmlMenuConta({ ...base, quem: { nome: null, email: "ana@x.com" }, conta: { email: "ana@x.com", senha: true } });
    expect(com).toContain("ana@x.com");
    expect([...com.matchAll(/data-conta="([^"]+)"/g)].map((m) => m[1])).toEqual(["sair"]);
    for (const t of ["Trocar senha", "Sessões", "Conectar outro computador"]) expect(com).not.toContain(t);
  });

  it("NOD-406: menu do espaço provisório com `equipe`: o item da equipe vem depois do convite; com conta, nunca", () => {
    const base = { faixa: null, conexao: "Conectada", equipe: "/api/sessao/google" };
    const sem = htmlMenuConta({ ...base, conta: { email: null, senha: false } });
    expect([...sem.matchAll(/data-conta="([^"]+)"/g)].map((m) => m[1])).toEqual(["inicio", "equipe"]);
    expect(sem).toContain("Sou da equipe: entrar com Google");
    expect(htmlMenuConta({ ...base, equipe: null, conta: { email: null, senha: false } })).not.toContain('data-conta="equipe"');
    const com = htmlMenuConta({ ...base, conta: { email: "ana@x.com", senha: true } });
    expect(com).not.toContain('data-conta="equipe"');
    // No app, a equipe conecta com a chave (a tela de conexão), não pelo Google.
    expect(htmlMenuConta({ ...base, equipe: "app", conta: { email: null, senha: false } })).toContain("Sou da equipe: conectar com a chave");
  });

  it("NOD-406: no app, o item da equipe só com o Google de equipe, sem Google para conta e com a ponte do app nova", () => {
    const base = { loginGoogle: true, contaGoogle: false, noApp: true, ponte: true };
    expect(equipeNoApp(base)).toBe(true);
    expect(equipeNoApp({ ...base, loginGoogle: false })).toBe(false);
    expect(equipeNoApp({ ...base, contaGoogle: true })).toBe(false);
    expect(equipeNoApp({ ...base, noApp: false })).toBe(false);
    expect(equipeNoApp({ ...base, ponte: false })).toBe(false);
  });

  it("NOD-406: o espaço provisório só abre na primeira visita web com bootstrap, sem saída, recusa nem marca da equipe", () => {
    const base = { saiu: false, recusado: false, bootstrap: true, noApp: false, equipe: false, pareando: false };
    expect(abreProvisorio(base)).toBe(true);
    for (const k of ["saiu", "recusado", "noApp", "equipe", "pareando"] as const) expect(abreProvisorio({ ...base, [k]: true }), k).toBe(false);
    expect(abreProvisorio({ ...base, bootstrap: false })).toBe(false);
  });

  it("NOD-406: linkDaEquipe só com login de equipe pelo Google, sem o Google para conta e fora do app", () => {
    const url = "/api/sessao/google";
    expect(linkDaEquipe({ loginGoogle: true, contaGoogle: false, noApp: false, url })).toBe(url);
    expect(linkDaEquipe({ loginGoogle: false, contaGoogle: false, noApp: false, url })).toBeNull();
    expect(linkDaEquipe({ loginGoogle: true, contaGoogle: true, noApp: false, url })).toBeNull();
    expect(linkDaEquipe({ loginGoogle: true, contaGoogle: false, noApp: true, url })).toBeNull();
  });
});

describe("NOD-406 (revisões r5 a r7): o pedido do Mac guardado", () => {
  const prov = { conta: null, legado: null, verificando: null, escolha: null };
  const d = (estado: Parameters<typeof decidirPareamento>[0]["estado"], extra: Partial<Parameters<typeof decidirPareamento>[0]> = {}) => decidirPareamento({ modoLido: true, contas: true, estado, ...extra });
  it("abre direto para conta, pessoa da equipe e sem contas ligadas", () => {
    expect(d({ ...prov, conta: { email: "a@b.c" } })).toBe("abrir");
    expect(d({ ...prov, legado: { email: "eq@b.c" } })).toBe("abrir");
    expect(decidirPareamento({ modoLido: true, contas: false, estado: null })).toBe("abrir");
  });
  it("o espaço provisório entra primeiro, inclusive com resposta parcial", () => {
    expect(d(prov)).toBe("entrar");
    expect(d({})).toBe("entrar");
  });
  it("espera quando não deu para ler, na volta recusada e com código ou escolha em andamento", () => {
    expect(decidirPareamento({ modoLido: false, contas: false, estado: null })).toBe("esperar");
    expect(d(null)).toBe("esperar");
    expect(d(prov, { volta: "recusado" })).toBe("esperar");
    expect(d({ ...prov, verificando: { email: "a@b.c" } })).toBe("esperar");
    expect(d({ ...prov, escolha: { email: "a@b.c" } })).toBe("esperar");
  });
});

describe("NOD-351: o cartão aberto pelo chat (frame conta.abrir)", () => {
  it("abre na conversa DO FRAME (nem na da tela nem na do Nod) e não troca a conversa da tela", async () => {
    const api = { sessoes: vi.fn(async () => ({ atual: "s1", sessoes: [] })) };
    const { c, irParaConversa } = montar(api as unknown as Partial<ApiConta>);
    expect(await c.abrirPeloChat("sessoes", "conv-ada")).toBe(true);
    expect(c.blocoNaConversa("conv-ada")).toContain("Sessões");
    expect(c.blocoNaConversa("conv-nod")).toBe("");
    expect(c.blocoNaConversa("conv-tela")).toBe("");
    expect(irParaConversa).not.toHaveBeenCalled();
    expect(c.etapa()).toMatchObject({ tipo: "sessoes", confirmar: false });
  });

  it("cada etapa da lista abre o cartão dela; parear-gerar só mostra o botão, e o código sai no toque da pessoa", async () => {
    for (const [qual, tipo] of [["inicio", "inicio"], ["entrar", "entrar"], ["senha", "senha"], ["recuperar", "recuperar"]] as const) {
      const { c } = montar({});
      await c.abrirPeloChat(qual, "conv-ada");
      expect(c.etapa()?.tipo).toBe(tipo);
    }
    const gerarPareamento = vi.fn(async () => ({ codigo: "654321", expiraEm: 301_000 }));
    const { c } = montar({ gerarPareamento, pareamento: vi.fn(async () => ({ pareamento: null })) } as unknown as Partial<ApiConta>);
    await c.abrirPeloChat("parear-gerar", "conv-ada");
    // O frame chega a todas as abas e aparelhos: nenhum deles pode gerar (e invalidar) código sozinho.
    expect(gerarPareamento).not.toHaveBeenCalled();
    expect(c.etapa()).toEqual({ tipo: "parear-pronto" });
    expect(c.blocoNaConversa("conv-ada")).toContain("Gerar código");
    await c.acoes["conta-parear-gerar"]!(el());
    expect(gerarPareamento).toHaveBeenCalledTimes(1);
    expect(c.blocoNaConversa("conv-ada")).toContain("654 321");
  });

  it("duas abas recebem o mesmo frame de pareamento e nenhuma chama a API", async () => {
    const gerarPareamento = vi.fn(async () => ({ codigo: "111111", expiraEm: 301_000 }));
    const api = { gerarPareamento, pareamento: vi.fn(async () => ({ pareamento: null })) } as unknown as Partial<ApiConta>;
    const a = montar(api);
    const b = montar(api);
    await a.c.abrirPeloChat("parear-gerar", "conv-ada");
    await b.c.abrirPeloChat("parear-gerar", "conv-ada");
    expect(gerarPareamento).not.toHaveBeenCalled();
  });

  it("emRepouso: só troca cartão parado, nunca um em curso", () => {
    expect(emRepouso(null)).toBe(true);
    expect(emRepouso({ tipo: "parear-pronto" })).toBe(true);
    expect(emRepouso({ tipo: "parear-entrar", simbolos: null, erro: null })).toBe(false);
    expect(emRepouso({ tipo: "parear-gerar", codigo: "1", expiraEm: 1, pedido: { aparelho: "Mac", simbolos: ["a"] }, vencido: false })).toBe(false);
    expect(emRepouso({ tipo: "parear-gerar", codigo: "1", expiraEm: 1, pedido: null, vencido: true })).toBe(true);
    expect(emRepouso({ tipo: "sessoes", dados: null, confirmar: true })).toBe(false);
    expect(emRepouso({ tipo: "sessoes", dados: null, confirmar: false })).toBe(true);
    expect(emRepouso({ tipo: "entrar", erro: null })).toBe(false);
    expect(emRepouso({ tipo: "senha", erro: null, salva: null })).toBe(false);
    expect(emRepouso({ tipo: "senha", erro: null, salva: 1 })).toBe(true);
    expect(emRepouso({ tipo: "recuperar", enviadoPara: null })).toBe(false);
    expect(emRepouso({ tipo: "recuperar", enviadoPara: "a@x.com" })).toBe(true);
  });

  it("frame novo não atropela código de pareamento já gerado nem formulário aberto", async () => {
    const gerarPareamento = vi.fn(async () => ({ codigo: "222222", expiraEm: 301_000 }));
    const { c } = montar({ gerarPareamento, pareamento: vi.fn(async () => ({ pareamento: null })) } as unknown as Partial<ApiConta>);
    await c.abrirPeloChat("parear-gerar", "conv-ada");
    await c.acoes["conta-parear-gerar"]!(el());
    expect(await c.abrirPeloChat("entrar", "conv-ada")).toBe(false);
    expect(c.blocoNaConversa("conv-ada")).toContain("222 222");
    let digitou = true;
    const f = montar({}, { digitado: () => digitou });
    await f.c.abrirPeloChat("entrar", "conv-ada");
    expect(await f.c.abrirPeloChat("sessoes", "conv-ada")).toBe(false);
    expect(f.c.etapa()?.tipo).toBe("entrar");
    // Tocou no cartão (mostrar a senha, por exemplo): mesmo com os campos vazios, ele é dela agora.
    digitou = false;
    await f.c.acoes["conta-mostrar"]?.(el());
    await f.c.acoes["conta-ir"]!(el({ etapa: "entrar" }));
    expect(await f.c.abrirPeloChat("sessoes", "conv-ada")).toBe(false);
  });

  it("cartão aberto pelo chat e ainda intocado cede ao pedido seguinte, mesmo noutra conversa (o bot não diz que abriu à toa)", async () => {
    const { c } = montar({ sessoes: vi.fn(async () => ({ atual: "s1", sessoes: [] })) } as unknown as Partial<ApiConta>, { digitado: () => false });
    expect(await c.abrirPeloChat("entrar", "conv-ada")).toBe(true);
    expect(await c.abrirPeloChat("senha", "conv-ada")).toBe(true);
    expect(c.etapa()?.tipo).toBe("senha");
    expect(await c.abrirPeloChat("sessoes", "conv-bia")).toBe(true);
    expect(c.blocoNaConversa("conv-bia")).toContain("Sessões");
    expect(c.blocoNaConversa("conv-ada")).toBe("");
  });

  it("cartão aberto pela pessoa (menu) não cede ao chat", async () => {
    const { c } = montar({}, { digitado: () => false });
    await c.abrir("entrar");
    expect(await c.abrirPeloChat("senha", "conv-ada")).toBe(false);
    expect(c.etapa()?.tipo).toBe("entrar");
  });

  it("o frame é dado: etapa fora da lista do chat, tipo errado ou conversa vazia não abre nada", async () => {
    const { c } = montar({});
    for (const [qual, conv] of [["cadastro", "conv-ada"], ["parear-entrar", "conv-ada"], ["codigo", "conv-ada"], ["escolha", "conv-ada"], ["google-app", "conv-ada"], [7, "conv-ada"], [undefined, "conv-ada"], ["entrar", ""], ["entrar", undefined], ["entrar", 3]] as const) {
      expect(await c.abrirPeloChat(qual, conv)).toBe(false);
    }
    expect(c.etapa()).toBeNull();
  });

  it("não passa por cima do que a pessoa está fazendo: com código aberto ou envio em curso, ignora", async () => {
    let soltar: () => void = () => undefined;
    const api = {
      cadastrar: vi.fn(async () => ({ enviado: true, email: "ana@x.com" })),
      entrar: vi.fn(() => new Promise((r) => { soltar = () => r({ resultado: "recusado" }); })),
    };
    const { c } = montar(api as unknown as Partial<ApiConta>);
    await c.abrir("cadastro");
    await c.forms["conta-cadastro"]!(form({ email: "ana@x.com", senha: SENHA }));
    expect(c.etapa()?.tipo).toBe("codigo");
    expect(await c.abrirPeloChat("entrar", "conv-ada")).toBe(false);
    expect(c.etapa()?.tipo).toBe("codigo");

    const outro = montar(api as unknown as Partial<ApiConta>);
    await outro.c.abrir("entrar");
    const enviando = outro.c.forms["conta-entrar"]!(form({ email: "ana@x.com", senha: SENHA }));
    expect(await outro.c.abrirPeloChat("sessoes", "conv-ada")).toBe(false);
    soltar();
    await enviando;
  });

  it("o SSE aceita o frame conta.abrir (TIPOS espelha TipoFrame)", () => {
    expect(interpretarFrame(JSON.stringify({ streamId: "s", seq: 1, pessoaId: "p", tipo: "conta.abrir", dados: { etapa: "entrar", conversaId: "c" } }))).toMatchObject({ tipo: "conta.abrir" });
  });
});
