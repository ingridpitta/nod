import { describe, expect, it } from "vitest";
import {
  MEMORIA_INICIAL,
  MS_AINDA_ESPERANDO,
  MS_OK,
  UI_INICIAL,
  estadoDaGaveta,
  htmlAvisoDeFalha,
  htmlGavetaTela,
  avisoDoComputador,
  htmlLinhaDoChat,
  htmlLogin,
  htmlPedidoDeTela,
  textoDeEntrou,
  htmlPainelComputadorDoBot,
  htmlPilula,
  lembrarComputador,
  lerComputadorPessoa,
  resumoDasTelas,
  type ComputadorPessoaDto,
  type TelaDaPessoa,
  dicaDoPreparo,
  htmlLinhaDoPreparo,
  htmlDialogoDoPainel,
  tamanhoEmPalavras,
  retryAutomaticoDoComputador,
  esperaDoRetryDoComputador,
  URL_ATUALIZAR_APP,
} from "../../../web/lib/computador-pessoa.ts";
import { htmlCenaDoPreparo } from "../../../web/lib/cena-do-preparo.ts";
import { readFileSync } from "node:fs";
import { estadoInicial, reduzir, secaoDoPedido } from "../../../web/estado/reducer.ts";
import { SECOES_ESPACO } from "../../../web/telas/espaco.ts";
import { htmlMenuConta } from "../../../web/telas/menu-conta.ts";

/** NOD-96, PR 6: a web do computador do bot v2 (um computador por pessoa, uma tela por bot). */
const bot = (id: string, nome: string) => ({ id, nome, cor: "c-red", forma: "shape-square" }) as never as { id: string; nome: string; cor: string; forma: string };
const BOTS = [bot("a", "Dev 2"), bot("b", "Dev 3"), bot("c", "Dev 4")] as never[];
const NOMES = { a: "Dev 2", b: "Dev 3", c: "Dev 4" };
const tela = (agenteId: string, o: Partial<TelaDaPessoa> = {}): TelaDaPessoa => ({ agenteId, estado: "aberta", controle: "bot", memoriaMb: 400, ...o });
const pc = (o: Partial<ComputadorPessoaDto> = {}): ComputadorPessoaDto => ({ estado: "pronto", maquina: { id: "vm", nome: "vm-sp", contato: 1 }, telas: [], esperando: [], ...o });

describe("contrato e flag", () => {
  it("lê só a forma do plano; o resto (404, lixo) vira null e a web fica na v1", () => {
    expect(lerComputadorPessoa(null)).toBeNull();
    expect(lerComputadorPessoa({ estado: "outro" })).toBeNull();
    expect(lerComputadorPessoa({ estado: "dormindo" })).toEqual({ estado: "dormindo", maquina: null, telas: [], esperando: [] });
  });

  // NOD-367: as Configurações têm 6 seções fixas; o computador do bot (v2) mora dentro de Máquinas.
  it("a v2 não acrescenta seção às Configurações; o pedido antigo cai em Máquinas", () => {
    expect(SECOES_ESPACO.map((s) => s.id)).toEqual(["conta", "geral", "conexao", "maquinas", "agentes", "rotinas", "feedback"]);
    expect(secaoDoPedido("computador-do-bot")).toBe("maquinas");
    expect(secaoDoPedido("computadores")).toBe("maquinas");
  });

  it("o menu da conta não lista máquinas nem o computador do bot", () => {
    const menu = htmlMenuConta({ faixa: null, conexao: "Conectada" });
    expect(menu).not.toContain("Computador do bot");
    expect(menu).not.toContain("Computadores");
    expect(menu).not.toContain("Máquinas");
    expect(avisoDoComputador(pc())).toBeNull();
  });

  it("o reducer guarda o computador e o apaga quando a rota some", () => {
    const e0 = { ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" } } as never;
    const e1 = reduzir(e0, { tipo: "hidratar-computador-pessoa", dto: pc({ esperando: ["a"] }), agora: 1 });
    expect(e1.computadorPessoa?.estado).toBe("pronto");
    expect(e1.computadorMemoria.esperas.a?.motivo).toBe("memoria");
    const e2 = reduzir(e1, { tipo: "hidratar-computador-pessoa", dto: null, agora: 2 });
    expect(e2.computadorPessoa).toBeNull();
  });
});

describe("gaveta e tela cheia", () => {
  it("mostra miniatura, sem tela, dormindo, acordando ou fora", () => {
    expect(estadoDaGaveta(pc({ telas: [tela("a")] }), "a")).toBe("miniatura");
    expect(estadoDaGaveta(pc({ telas: [tela("b")] }), "a")).toBe("sem_tela");
    expect(estadoDaGaveta(pc({ estado: "dormindo" }), "a")).toBe("dormindo");
    expect(estadoDaGaveta(pc({ estado: "ligando" }), "a")).toBe("acordando");
    expect(estadoDaGaveta(pc({ estado: "fora_do_ar" }), "a")).toBe("fora");
    const mini = htmlGavetaTela(pc({ telas: [tela("a")] }), BOTS[0] as never);
    expect(mini).toContain("Tela de Dev 2");
    expect(mini).toContain('data-act="abrir-computador"');
    expect(htmlGavetaTela(pc(), BOTS[0] as never)).toContain("Dev 2 não está usando o navegador agora.");
    expect(htmlGavetaTela(pc({ estado: "dormindo" }), BOTS[0] as never)).toContain('data-op="acordar"');
    expect(htmlGavetaTela(pc({ estado: "ligando" }), BOTS[0] as never)).toContain("Acordando…");
  });

  it("sem contato diz desde quando; app antigo mostra as duas versões e Atualizar app", () => {
    const desde = Date.UTC(2026, 9, 30, 6, 15);
    const semContato = pc({ estado: "fora_do_ar", maquina: { id: "vm", nome: "Mac da Ana", contato: null }, falha: { motivo: "maquina_sem_contato", desde }, semContatoDesde: desde });
    const fora = htmlGavetaTela(semContato, BOTS[0] as never);
    expect(fora).toContain("Mac da Ana está sem contato desde");
    expect(fora).not.toContain("Atualize a página");
    // O 409 do Tentar de novo não apaga o "desde HH:MM": a leitura do servidor passa na frente da recusa.
    const depoisDoClique = htmlGavetaTela(semContato, BOTS[0] as never, "A máquina onde o computador mora não está respondendo.");
    expect(depoisDoClique).toContain("Mac da Ana está sem contato desde");
    expect(depoisDoClique).toContain("Onde o computador mora");
    expect(depoisDoClique).not.toContain("O computador não acordou");
    const app = htmlGavetaTela(pc({ estado: "dormindo", appDesatualizado: { atual: "1.0.0-rc.1", minima: "1.0.0-rc.2", plataforma: "darwin" } }), BOTS[0] as never, "Atualize o app do nod para usar o computador.");
    expect(app).toContain("Seu app está na versão 1.0.0-rc.1; o computador precisa da 1.0.0-rc.2.");
    expect(app).toContain(`href="${URL_ATUALIZAR_APP}"`);
    expect(app).toContain("Atualizar app");
    expect(app).not.toContain("Atualize a página");
    expect(app.match(/cb-aviso"/g)).toHaveLength(1);
  });

  it("app antigo no motor Linux pede o instalador naquela máquina; o painel mostra o mesmo aviso", () => {
    const linux = pc({ estado: "dormindo", appDesatualizado: { atual: "0.9.0", minima: "1.0.0-rc.2", plataforma: "linux" } });
    const gaveta = htmlGavetaTela(linux, BOTS[0] as never);
    expect(gaveta).toContain("vm-sp está na versão 0.9.0; o computador precisa da 1.0.0-rc.2.");
    expect(gaveta).not.toContain(URL_ATUALIZAR_APP);
    const painel = htmlPainelComputadorDoBot(pc({ estado: "dormindo", appDesatualizado: { atual: "1.0.0-rc.1", minima: "1.0.0-rc.2" } }), BOTS as never, UI_INICIAL, 0);
    expect(painel).toContain("Atualize o app para usar o computador");
    expect(painel).toContain("Atualizar app");
  });

  it("retry automático fica só nas causas transitórias", () => {
    for (const motivo of ["ocupado", "ligando", "esperando_tela", "atualizando"]) expect(retryAutomaticoDoComputador(motivo)).toBe(true);
    for (const motivo of ["maquina_sem_contato", "app_desatualizado", "fora_do_ar", null]) expect(retryAutomaticoDoComputador(motivo)).toBe(false);
  });

  it("retry cresce 2, 4, 8, 16 s (com jitter de até 20%) e para depois de ~30 s", () => {
    expect([0, 1, 2, 3].map((n) => esperaDoRetryDoComputador(n, 0))).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(esperaDoRetryDoComputador(0, 1)).toBe(2_400);
    expect(esperaDoRetryDoComputador(4, 0)).toBeNull();
  });

  it("a pílula: Assistindo · Assumir o controle, depois Você está no controle · Parar", () => {
    expect(htmlPilula("Dev 2", "assistindo")).toMatch(/Assistindo[\s\S]*Assumir o controle/);
    expect(htmlPilula("Dev 2", "assumindo")).toContain("Assumindo… Dev 2 termina a ação em curso");
    expect(htmlPilula("Dev 2", "controle")).toMatch(/Você está no controle[\s\S]*data-c="devolver">Parar/);
  });
});

describe("chat: espera e erro", () => {
  it("espera por memória é cinza, com quem está usando; depois de 10 min vira Ainda esperando…", () => {
    const dto = pc({ telas: [tela("b"), tela("c")], esperando: ["a"] });
    const mem = lembrarComputador(null, dto, MEMORIA_INICIAL, 1000);
    const linha = htmlLinhaDoChat(dto, mem, "a", NOMES, 2000);
    expect(linha).toContain("Esperando uma tela livre");
    expect(linha).toContain("Dev 3 e Dev 4 estão usando o computador");
    expect(linha).toContain("ver telas");
    expect(htmlLinhaDoChat(dto, mem, "a", NOMES, 1000 + MS_AINDA_ESPERANDO)).toContain("Ainda esperando…");
  });

  it("ligando mostra o chip; quando a tela abre, ✓ Tela aberta por alguns segundos", () => {
    const ligando = pc({ estado: "ligando", esperando: ["a"] });
    const m1 = lembrarComputador(null, ligando, MEMORIA_INICIAL, 0);
    expect(htmlLinhaDoChat(ligando, m1, "a", NOMES, 0)).toContain("Ligando o computador…");
    const memoria = pc({ esperando: ["a"] });
    const m2 = lembrarComputador(null, memoria, MEMORIA_INICIAL, 0);
    const aberta = pc({ telas: [tela("a")] });
    const m3 = lembrarComputador(memoria, aberta, m2, 100);
    expect(htmlLinhaDoChat(aberta, m3, "a", NOMES, 200)).toContain("Tela aberta");
    expect(htmlLinhaDoChat(aberta, m3, "a", NOMES, 100 + 7000)).toBe("");
  });

  it("redefinir fecha as telas abertas com uma linha em cada chat e acende o ✓ do menu no fim", () => {
    const antes = pc({ telas: [tela("a"), tela("b")] });
    const durante = pc({ estado: "operando", telas: [], operacao: { tipo: "redefinir", pct: 34, etapa: "Criando" } });
    const m = lembrarComputador(antes, durante, MEMORIA_INICIAL, 0);
    expect(m.fechadas?.agentes).toEqual(["a", "b"]);
    expect(htmlLinhaDoChat(durante, m, "b", NOMES, 0)).toContain("A tela de Dev 3 fechou");
    const fim = lembrarComputador(durante, pc(), m, 500);
    expect(fim.fechadas).toBeNull();
    expect(fim.okMenuAte).toBe(500 + MS_OK);
    expect(MS_OK).toBe(2_000);
  });

  it("o link do erro abre a ação no painel: Ver computador do bot realça Atualizar", () => {
    const fora = pc({ estado: "fora_do_ar", falha: { motivo: "sem_resposta", desde: 0 } as never });
    const aviso = htmlAvisoDeFalha(fora)!;
    expect(aviso).toContain('data-act="ver-computador-do-bot" data-realce="atualizar"');
    expect(aviso).toContain('data-op="tentar_de_novo"');
    expect(htmlAvisoDeFalha(pc())).toBeNull();
    const painel = htmlPainelComputadorDoBot(fora, BOTS as never, { ...UI_INICIAL, realce: "atualizar" }, 0);
    expect(painel).toMatch(/data-pc-acao="atualizar"[^>]*>[\s\S]*?sugerido/);
    expect(painel).toContain("pc-acao realce");
  });
});

describe("painel e menu", () => {
  it("Redefinir confirma com os nomes das telas que fecham; as etapas mostram a atual e o %", () => {
    const dto = pc({ telas: [tela("a"), tela("b")] });
    const conf = htmlPainelComputadorDoBot(dto, BOTS as never, { ...UI_INICIAL, confirmar: "redefinir" }, 0);
    expect(conf).toContain("Redefinir o computador?");
    expect(conf).toContain("As telas de Dev 2 e Dev 3 fecham agora");
    expect(conf).toContain('data-act="pc-cancelar" data-cl-autofoco');
    const op = pc({ estado: "operando", operacao: { tipo: "redefinir", pct: 34, etapa: "Criando" } });
    const etapas = htmlPainelComputadorDoBot(op, BOTS as never, { ...UI_INICIAL, etapasAbertas: true }, 0);
    expect(etapas).toMatch(/aria-current="step"[^>]*>[\s\S]*?Criando<span class="pc-pct">34%/);
    expect(etapas).toContain("Continuar em segundo plano");
  });

  it("NOD-367: o progresso vira a linha discreta do menu (abre Máquinas); o ✓ logo depois; dormindo não avisa", () => {
    const op = pc({ estado: "operando", operacao: { tipo: "redefinir", pct: 34, etapa: null } });
    expect(avisoDoComputador(op)).toEqual({ texto: "Computador do bot · Redefinindo · 34%", tom: "neutro" });
    expect(avisoDoComputador(pc({ estado: "dormindo" }))).toBeNull();
    expect(avisoDoComputador(pc(), true)).toEqual({ texto: "Computador do bot pronto", tom: "ok" });
    const menu = htmlMenuConta({ faixa: null, conexao: "Conectada", maquina: avisoDoComputador(op) });
    expect(menu).toMatch(/class="mc-faixa mc-faixa-neutro" role="status">[\s\S]*Redefinindo · 34%[\s\S]*data-secao="maquinas">Ver</);
    // fora do role=menu: um status não é item de menu
    expect(menu.indexOf("mc-faixa-neutro")).toBeLessThan(menu.indexOf('role="menu"'));
  });

  it("Esquecer senhas salvas é uma ação de Logins, confirma e vira operação com etapas", () => {
    const dto = pc({ telas: [tela("a")] });
    const painel = htmlPainelComputadorDoBot(dto, BOTS as never, UI_INICIAL, 0);
    expect(painel).toContain("Esquecer senhas salvas");
    expect(painel).toContain('data-op="esquecer_senhas"');
    const conf = htmlPainelComputadorDoBot(dto, BOTS as never, { ...UI_INICIAL, confirmar: "esquecer_senhas" }, 0);
    expect(conf).toContain("Esquecer as senhas salvas?");
    expect(conf).toContain('data-act="pc-confirmar" data-op="esquecer_senhas"');
    const op = pc({ estado: "operando", operacao: { tipo: "esquecer_senhas", pct: 50, etapa: "Apagando senhas salvas" } });
    expect(avisoDoComputador(op)?.texto).toContain("Esquecendo as senhas · 50%");
    // Com o nome que o supervisor emite, a lista avança: a etapa anterior feita, a atual marcada, nada inventado antes.
    const etapas = htmlPainelComputadorDoBot(op, BOTS as never, { ...UI_INICIAL, etapasAbertas: true }, 0);
    expect(etapas).toMatch(/<li class="feita">.*Esquecendo senhas<\/li><li class="atual" aria-current="step">.*Apagando senhas salvas/);
    expect(/<ol class="pc-etapas">(.*?)<\/ol>/.exec(etapas)?.[1]?.match(/<li/g)).toHaveLength(3);
  });

  it("a confirmação de Sair de todos aponta Esquecer senhas salvas com o texto do plano (NOD-97 PR 6)", () => {
    const conf = htmlPainelComputadorDoBot(pc({ telas: [tela("a")] }), BOTS as never, { ...UI_INICIAL, confirmar: "sair_de_todos" }, 0);
    expect(conf).toContain("Sair de todos os sites?");
    expect(conf).toContain("Para que eles não entrem de novo, use também Esquecer senhas salvas.");
  });

  it("o aviso de recriação pede para entrar nos sites de novo uma vez, até a pessoa dispensar", () => {
    const dto = pc({ aviso_recriado: true });
    expect(htmlPainelComputadorDoBot(dto, BOTS as never, UI_INICIAL, 0)).toContain("Entre nos sites de novo uma vez");
    expect(htmlPainelComputadorDoBot(dto, BOTS as never, UI_INICIAL, 0, true)).not.toContain("Entre nos sites de novo uma vez");
  });

  it("Esta máquina resume as telas abertas", () => {
    expect(resumoDasTelas(pc({ telas: [tela("a"), tela("b")] }), BOTS as never)).toBe("Computador do bot · 2 telas abertas: Dev 2 e Dev 3");
    expect(resumoDasTelas(pc({ estado: "dormindo" }), BOTS as never)).toBe("Computador do bot dormindo");
  });
});

describe("pedido de ajuda (login leve)", () => {
  it("depois de entrar vira uma linha só, ✓ Entrou no <site>", () => {
    const linha = htmlPedidoDeTela("entrar no LinkedIn para ver as mensagens", "a", false);
    expect(linha).toContain("cb-ok");
    expect(linha).toContain("Entrou no LinkedIn");
    expect(linha).not.toContain("A tela voltou para o bot");
    expect(linha.match(/class="cb-seg"/g)).toHaveLength(1);
    expect(htmlPedidoDeTela("verificar que é humano na Amazon", "a", false)).toContain("Entrou na Amazon");
    expect(htmlPedidoDeTela("fazer o login", "a", false)).toContain("Entrou no site");
    // O texto do protótipo aprovado: o lugar dito no pedido, mesmo sem nome próprio.
    expect(textoDeEntrou("Entrar no portal de vendas")).toBe("Entrou no portal de vendas");
    expect(textoDeEntrou("Entre na conta do banco, depois confirme o 2FA")).toBe("Entrou na conta do banco");
    expect(textoDeEntrou("Faça login no Linear para eu ver as issues.")).toBe("Entrou no Linear");
    // O nome não engole a frase seguinte nem o ponto final.
    expect(textoDeEntrou("Preciso do 2FA no LinkedIn. Depois sigo.")).toBe("Entrou no LinkedIn");
    expect(textoDeEntrou("Resolva o CAPTCHA no Mercado Livre")).toBe("Entrou no Mercado Livre");
    expect(htmlPedidoDeTela("entrar no Gmail", "a", true)).toContain('data-assumir="1"');
  });

  it("sem miniatura, o Abrir fica sempre à vista", () => {
    expect(htmlLogin({ agenteId: "a", titulo: "entrar no Gmail" })).toContain('class="cb-login-mini sem-imagem"');
    expect(htmlLogin({ agenteId: "a", titulo: "entrar no Gmail", src: "data:image/png;base64,AA" })).toContain('class="cb-login-mini"');
  });
});

describe("preparo da VM local (NOD-93, passo 10)", () => {
  const MB = 1024 ** 2;
  const baixando = { estado: "baixando" as const, bytes: 870 * MB, total: 1126 * MB, desde: 1 };
  it("tamanho e dica do anel: 870 MB de 1,1 GB · 77%; pausado diz pausado; fora do download, sem dica", () => {
    expect(tamanhoEmPalavras(870 * MB)).toBe("870 MB");
    expect(tamanhoEmPalavras(1126 * MB)).toBe("1,1 GB");
    expect(dicaDoPreparo(baixando)).toBe("Preparando · 870 MB de 1,1 GB · 77%");
    expect(dicaDoPreparo({ ...baixando, estado: "pausado_sem_internet" })).toMatch(/^Download pausado · /);
    expect(dicaDoPreparo({ estado: "pronto", desde: 1 })).toBeNull();
  });

  it("menu: a linha com o download; pronto não avisa", () => {
    expect(avisoDoComputador(pc({ preparo: baixando }))?.texto).toBe("Computador do bot · Preparando · 870 MB de 1,1 GB · 77%");
    expect(avisoDoComputador(pc({ preparo: { estado: "pronto", desde: 1 } }))).toBeNull();
  });

  it("chat: pausado com tentar agora; macOS antigo vira o card com Conectar uma VM; falhou é aviso", () => {
    const pausado = htmlLinhaDoPreparo({ ...baixando, estado: "pausado_sem_internet" });
    expect(pausado).toContain("Download pausado em 77% · sem internet");
    expect(pausado).toContain('data-act="vm-tentar-agora"');
    const antigo = htmlLinhaDoPreparo({ estado: "macos_antigo", desde: 1 });
    expect(antigo).toContain("macOS 13 ou mais novo");
    expect(antigo).toContain('data-act="conectar-sempre-ligada"');
    expect(htmlLinhaDoPreparo({ estado: "falhou", desde: 1 })).toContain("Não consegui preparar o computador");
    expect(htmlLinhaDoPreparo({ estado: "ligando", desde: 1 })).toContain("Esperando o computador ficar pronto");
  });

  it("painel: a barra do download com os MB; macOS antigo mostra a faixa e esconde telas e manutenção", () => {
    const painel = htmlPainelComputadorDoBot(pc({ preparo: baixando }), BOTS as never, UI_INICIAL, 0);
    expect(painel).toContain('aria-label="Baixando o computador"');
    expect(painel).toContain('aria-valuenow="77"');
    const antigo = htmlPainelComputadorDoBot(pc({ estado: "sem_suporte" as never, preparo: { estado: "macos_antigo", desde: 1 } }), BOTS as never, UI_INICIAL, 0);
    expect(antigo).toContain("Conectar uma VM");
    expect(antigo).not.toContain("Manutenção");
  });
});

describe("janela de primeiro uso da VM local (NOD-93, protótipo v2; revisão do #516 item 4)", () => {
  const MB = 1024 ** 2;
  const baixando = { estado: "baixando" as const, bytes: 870 * MB, total: 1126 * MB, desde: 1 };
  const aberta = { ...UI_INICIAL, preparoAberto: true };

  it("a cena muda por etapa: o monitor enche com o % no download, liga e abre; o mascote é decorativo", () => {
    const b = htmlCenaDoPreparo("baixando", "<nod-mascote></nod-mascote>", 50);
    expect(b).toContain('data-etapa="baixando"');
    expect(b).toContain('role="img"');
    expect(b).toContain('class="cb-cena-masc" aria-hidden="true"');
    expect(b).toContain('class="cb-cena-enche" x="157" y="57" width="116" height="35"');
    expect(b).toContain("cb-peca p1");
    const l = htmlCenaDoPreparo("ligando", "");
    expect(l).toContain('data-etapa="ligando"');
    expect(l).not.toContain("cb-cena-enche");
    expect(htmlCenaDoPreparo("abrindo", "")).toContain("cb-cena-mao");
  });

  it("aberta pelo app no primeiro download: a cena com o mascote, a barra, as etapas e o ghost Continuar em segundo plano com o foco", () => {
    const j = htmlDialogoDoPainel(pc({ preparo: baixando }), BOTS as never, aberta);
    expect(j).toContain('role="dialog"');
    expect(j).toContain("Preparando o computador no seu Mac");
    expect(j).toContain('class="cb-cena" data-etapa="baixando"');
    expect(j).toContain("nod-mascote");
    expect(j).toContain("Só da primeira vez: 1,1 GB. Depois, ele liga em segundos.");
    expect(j).toContain('aria-valuenow="77"');
    expect(j).toContain("870 MB de 1,1 GB");
    expect(j).toMatch(/<button type="button" class="cb-bt-ghost" data-act="pc-segundo-plano" data-cl-autofoco>Continuar em segundo plano<\/button>/);
    expect(j).toContain('<div class="cl-fundo" data-act="pc-segundo-plano"></div>');
  });

  it("ligando muda a cena; pausado diz que continua sozinho, com tentar agora; sem preparo, falhou ou fechada, nada", () => {
    expect(htmlDialogoDoPainel(pc({ preparo: { estado: "preparando", desde: 1 } }), BOTS as never, aberta)).toContain('data-etapa="ligando"');
    const pausado = htmlDialogoDoPainel(pc({ preparo: { ...baixando, estado: "pausado_sem_internet" } }), BOTS as never, aberta);
    expect(pausado).toContain("Download pausado em 77% · sem internet. Continua sozinho quando a conexão voltar.");
    expect(pausado).toContain('data-act="vm-tentar-agora"');
    expect(htmlDialogoDoPainel(pc({ preparo: { estado: "falhou", desde: 1 } }), BOTS as never, aberta)).toBe("");
    expect(htmlDialogoDoPainel(pc({ preparo: { estado: "pronto", desde: 1 } }), BOTS as never, aberta)).toBe("");
    expect(htmlDialogoDoPainel(pc({ preparo: baixando }), BOTS as never, UI_INICIAL)).toBe("");
  });

  it("o reducer abre a janela e a fecha sozinho quando o preparo acaba", () => {
    let e = reduzir(estadoInicial, { tipo: "computador-ui", ui: { preparoAberto: true } } as never);
    e = reduzir(e, { tipo: "hidratar-computador-pessoa", dto: pc({ preparo: baixando }), agora: 1 } as never);
    expect(e.computadorUi.preparoAberto).toBe(true);
    e = reduzir(e, { tipo: "hidratar-computador-pessoa", dto: pc({ preparo: { estado: "pronto", desde: 2 } }), agora: 2 } as never);
    expect(e.computadorUi.preparoAberto).toBe(false);
  });

  it("prefers-reduced-motion: cada etapa vira uma imagem parada", () => {
    const css = readFileSync(new URL("../../../web/computador-do-bot.css", import.meta.url), "utf8");
    const reduzido = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(css).toMatch(/\.cb-cena\[data-etapa="baixando"\] \.cb-peca \{ animation: cb-cai/);
    expect(reduzido).toContain(".cb-cena *, .cb-cena-masc > nod-mascote { animation: none !important; }");
  });
});
