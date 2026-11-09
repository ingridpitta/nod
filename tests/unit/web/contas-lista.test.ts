import { describe, expect, it } from "vitest";
import type { ContaIa, ContasIaDto, LoginNaMaquina } from "../../../src/contracts/contas-ia.ts";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import { criarContasDaPessoa, ligarPedeAvisoDosTermos, type ApiContas } from "../../../web/lib/contas-da-pessoa.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { REGRAS_DA_FILA, renderListaDeContas, renderContasNaMaquina, resumoDasContasNaMaquina, UI_CONTAS_INICIAL, type ContextoContas, type UiContas } from "../../../web/telas/contas-lista.ts";
import { hora } from "../../../web/lib/render.ts";
import { renderMaquinas } from "../../../web/telas/maquinas.ts";
import { renderProvedores } from "../../../web/telas/provedores.ts";

/**
 * ADR-102 (2026-10-13): a lista única de contas em Provedores de IA (protótipos G1/CM1-A), o login na VM pela tela (G1-P3)
 * e o que Máquinas mostra das contas (G2). E-mail e organização vêm do servidor (ADR-105).
 */
const AGORA = Date.UTC(2026, 9, 13, 15, 0);
const VM = "11111111-1111-4111-8111-111111111111";
const MAC = "22222222-2222-4222-8222-222222222222";
const maquina = (id: string, nome: string, o: Partial<MaquinaDto> = {}): MaquinaDto => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: {}, gh: false, ...o });
const MAQUINAS = [maquina(VM, "vm-bots", { atualizaIas: true }), maquina(MAC, "MacBook", { plataforma: "darwin" })];
const conta = (id: string, ia: ContaIa["ia"], apelido: string, maquinas: string[], o: Partial<ContaIa> = {}): ContaIa => ({
  id, ia, impressao: id.replace(/-/g, "").padEnd(64, "a").slice(0, 64), apelido, email: null, organizacao: null, plano: "Max", corporativa: false, posicao: 1, entraNaTrocaAutomatica: false, noLimiteAte: null,
  maquinas: maquinas.map((m) => ({ maquinaId: m, nome: m === VM ? "vm-bots" : "MacBook", estado: "pronta" as const })), ...o,
});
// ADR-108 + NOD-308: a 1ª conta de cada IA na fila; a Lumen (corporativa) é a 2ª do Claude e nasce fora.
const PESSOAL = conta("aaaaaaaa-0000-4000-8000-000000000001", "claude-cli", "Pessoal", [VM, MAC], { entraNaTrocaAutomatica: true });
const GPT = conta("aaaaaaaa-0000-4000-8000-000000000002", "codex-cli", "Pessoal", [MAC], { plano: "Plus", entraNaTrocaAutomatica: true });
const LUMEN = conta("aaaaaaaa-0000-4000-8000-000000000003", "claude-cli", "Lumen", [MAC], { plano: "Team", corporativa: true, noLimiteAte: AGORA + 3_600_000 });
const CONTAS: ContasIaDto = { disponivel: true, modo: "perguntar", contas: [PESSOAL, GPT, LUMEN] };

function ctx(o: Partial<Omit<ContextoContas, "ui">> & { ui?: Partial<UiContas> } = {}): ContextoContas {
  return { contas: CONTAS, maquinas: MAQUINAS, detalhes: null, agora: AGORA, noApp: false, botsNaMaquina: () => ["Ze 1"], cartaoDoMac: () => "<div>cartão do mac</div>", ...o, ui: { ...UI_CONTAS_INICIAL, ...o.ui } };
}

const login = (o: Partial<LoginNaMaquina> = {}): LoginNaMaquina => ({ id: "33333333-3333-4333-8333-333333333333", maquinaId: VM, ia: "claude-cli", contaId: GPT.id, apelido: null, fase: "aguardando_pessoa", url: "https://claude.com/cai/oauth/authorize?x=1", codigoDispositivo: null, pedeCodigo: true, chavePublica: "QUJD", codigoEnviado: false, erro: null, contaFinalId: null, criadoEm: AGORA, atualizadoEm: AGORA, ...o });

describe("lista única de contas (ADR-102)", () => {
  it("uma linha por conta, sem agrupar: logo, provedor · apelido, plano, corporativa e uma pílula por máquina", () => {
    const html = renderListaDeContas(ctx());
    expect(html.indexOf("Claude · Pessoal")).toBeLessThan(html.indexOf("ChatGPT · Pessoal"));
    expect(html.indexOf("ChatGPT · Pessoal")).toBeLessThan(html.indexOf("Claude · Lumen"));
    expect(html).toContain("3 contas · em ordem de uso");
    expect(html).toContain("Corporativa");
    expect(html).toContain("No limite até");
    expect(html).toContain("Em uso");
    // A ChatGPT · Pessoal não está na VM: a pílula tracejada leva ao login nela.
    expect(html).toContain(`data-act="cl-entrar" data-id="${GPT.id}" data-maquina="${VM}"`);
    // Fora do app do Mac, o Mac só entra pelo app (a pílula explica, sem clique).
    expect(html).not.toContain(`data-act="cl-entrar" data-id="${PESSOAL.id}" data-maquina="${MAC}"`);
    expect(html).toContain('data-ordem-lista="contas"');
  });

  it("sem e-mail no servidor nem no app, a linha diz só por qual CLI", () => {
    expect(renderListaDeContas(ctx())).not.toContain("@");
    expect(renderListaDeContas(ctx())).toContain("<span>pelo Claude Code</span>");
  });

  it("ADR-105: o e-mail e a organização vêm do servidor, em qualquer máquina (fora do app também)", () => {
    const comEmail = { ...CONTAS, contas: [PESSOAL, GPT, { ...LUMEN, email: "pessoa1@exemplo.com", organizacao: "Lumen" }] };
    const html = renderListaDeContas(ctx({ contas: comEmail }));
    expect(html).toContain("pessoa1@exemplo.com · organização Lumen · pelo Claude Code");
    // O Detalhes da conta também.
    expect(renderListaDeContas(ctx({ contas: comEmail, ui: { detalhe: LUMEN.id } }))).toContain("<dt>Conta</dt><dd>pessoa1@exemplo.com · Lumen</dd>");
  });

  it("ADR-105: o app do Mac que conhece a conta ganha do servidor (é o que o CLI disse agora)", () => {
    const comEmail = { ...CONTAS, contas: [PESSOAL, GPT, { ...LUMEN, email: "antigo@exemplo.com", organizacao: "Lumen" }] };
    const html = renderListaDeContas(ctx({ contas: comEmail, noApp: true, detalhes: { maquinaId: MAC, contas: [{ impressao: LUMEN.impressao, ia: "claude-cli", email: "pessoa1@exemplo.com", organizacao: "Lumen SA", plano: "Team" }] } }));
    expect(html).toContain("pessoa1@exemplo.com · organização Lumen SA · pelo Claude Code");
    expect(html).not.toContain("antigo@");
  });

  it("o ⋯ abre Renomear, Detalhes, Sair de cada máquina e Remover de todas", () => {
    const html = renderListaDeContas(ctx({ ui: { menu: PESSOAL.id } }));
    expect(html).toContain('data-act="cl-renomear"');
    expect(html).toContain('data-act="cl-detalhe"');
    expect(html).toContain(`data-act="cl-sair" data-id="${PESSOAL.id}" data-maquina="${VM}"`);
    expect(html).toContain(`data-act="cl-sair" data-id="${PESSOAL.id}" data-maquina="${MAC}"`);
    expect(html).toContain("Remover de todas as máquinas");
  });

  // Regression: ISSUE-004 — o menu dizia "Sair doa vm-qa". Found by /qa on 2026-10-13.
  it("QA do PR #306: o menu diz 'Sair da vm-bots' e 'Sair do Mac'", () => {
    const html = renderListaDeContas(ctx({ ui: { menu: PESSOAL.id } }));
    expect(html).toContain("Sair da vm-bots");
    expect(html).toContain("Sair do Mac");
    expect(html).not.toContain("doa ");
  });

  // Regression: ISSUE-008 — sem máquina nenhuma, a primeira conta aparecia "Em uso". Found by /qa on 2026-10-13.
  it("QA do PR #306: conta sem máquina não aparece 'Em uso'", () => {
    const sem = { ...CONTAS, contas: [{ ...PESSOAL, maquinas: [] }, GPT] };
    const html = renderListaDeContas(ctx({ contas: sem }));
    expect(html.indexOf("Em uso")).toBeGreaterThan(html.indexOf("ChatGPT · Pessoal"));
  });

  // Regression: ISSUE-003 — entrar numa conta que já estava na lista não dizia nada. Found by /qa on 2026-10-13.
  it("QA do PR #306: login de conta nova que era uma conta da lista avisa qual", () => {
    const html = renderListaDeContas(ctx({ ui: { logins: [{ onde: "vm", login: login({ contaId: null, fase: "pronto", contaFinalId: PESSOAL.id }), codigo: "", enviando: false, erroEnvio: null }] } }));
    expect(html).toContain("já estava na lista");
    expect(html).toContain("Claude · Pessoal");
  });

  // Regression: ISSUE-009 — a linha da conta nova seguia "Entrando…" depois do login concluído. Found by /qa on 2026-10-13.
  it("QA do PR #306: a linha da conta nova diz 'Entrou' quando o login termina", () => {
    const html = renderListaDeContas(ctx({ ui: { logins: [{ onde: "vm", login: login({ contaId: null, fase: "pronto" }), codigo: "", enviando: false, erroEnvio: null }] } }));
    expect(html).not.toContain("Entrando…");
    expect(html).toContain(">Entrou</span>");
  });

  it("sair: o diálogo diz o que acontece com os bots da máquina; remover: de quantas máquinas", () => {
    const sair = renderListaDeContas(ctx({ ui: { confirmar: { tipo: "sair", contaId: PESSOAL.id, maquinaId: VM } } }));
    expect(sair).toContain("Sair da Claude · Pessoal na vm-bots?");
    expect(sair).toContain("A vm-bots fica sem conta de IA");
    const remover = renderListaDeContas(ctx({ ui: { confirmar: { tipo: "remover", contaId: PESSOAL.id } } }));
    expect(remover).toContain("Remover das 2 máquinas");
  });

  it("NOD-293 C11: o diálogo diz quais frentes vão parar; sem frente, diz que nenhuma usa; sem conferir, avisa o risco; os quatro estados são anunciados", () => {
    const safari = { trabalhoId: "t-1", titulo: "Login no Safari", agente: "Ada", conversaId: "c-1", maquinaId: VM, maquina: "vm-bots" };
    const conversa = { trabalhoId: null, titulo: null, agente: "Ze 1", conversaId: "c-2", maquinaId: MAC, maquina: "MacBook" };
    const sair = renderListaDeContas(ctx({ ui: { confirmar: { tipo: "sair", contaId: PESSOAL.id, maquinaId: VM, frentes: [safari] } } }));
    expect(sair).toContain('<p class="cl-caixa" role="status">Vão parar: <b>Login no Safari</b>.</p>');
    expect(sair).toContain("A vm-bots esquece o login desta conta.");
    const remover = renderListaDeContas(ctx({ ui: { confirmar: { tipo: "remover", contaId: PESSOAL.id, frentes: [safari, conversa] } } }));
    expect(remover).toContain("Vão parar: <b>Login no Safari</b> (vm-bots) e <b>a conversa com Ze 1</b> (Mac).");
    const nenhuma = renderListaDeContas(ctx({ ui: { confirmar: { tipo: "sair", contaId: PESSOAL.id, maquinaId: VM, frentes: [] } } }));
    expect(nenhuma).not.toContain("Vão parar");
    expect(nenhuma).toContain('<p class="cl-caixa" role="status">Nenhuma frente usa esta conta agora.</p>');
    expect(nenhuma).toContain("A vm-bots fica sem conta de IA");
    const semConferir = renderListaDeContas(ctx({ ui: { confirmar: { tipo: "sair", contaId: PESSOAL.id, maquinaId: VM, frentes: null } } }));
    expect(semConferir).toContain('<p class="cl-caixa cl-caixa-aviso" role="status">Não deu para conferir se alguma frente usa esta conta. Se houver alguma, ela para ao sair.</p>');
    expect(semConferir).toContain('data-act="cl-confirmar"');
    const removerSemConferir = renderListaDeContas(ctx({ ui: { confirmar: { tipo: "remover", contaId: PESSOAL.id, frentes: null } } }));
    expect(removerSemConferir).toContain("Se houver alguma, ela para ao remover.");
    const pendente = renderListaDeContas(ctx({ ui: { confirmar: { tipo: "sair", contaId: PESSOAL.id, maquinaId: VM } } }));
    expect(pendente).toContain('<p class="cl-caixa" role="status">Conferindo as frentes que usam esta conta…</p>');
    expect(pendente).toContain('data-act="cl-confirmar" disabled aria-busy="true"');
    // Revisor do PR #429: o foco vai ao "Cancelar" já ao abrir, durante a busca (até 5 s).
    expect(pendente).toContain('data-act="cl-confirmar-fechar" data-cl-autofoco>Cancelar</button>');
  });

  it("login na VM pela tela: link oficial, campo do código e o aviso de que vai cifrado; o terminal fica escondido", () => {
    const html = renderListaDeContas(ctx({ ui: { logins: [{ onde: "vm", login: login(), codigo: "", enviando: false, erroEnvio: null }] } }));
    expect(html).toContain("Abrir a página da Anthropic");
    expect(html).toContain('data-form="cl-codigo"');
    expect(html).toContain("vai cifrado direto para a vm-bots");
    expect(html).toContain("Prefere o terminal?");
    expect(html).not.toContain("nod-motor entrar claude");
    const aberto = renderListaDeContas(ctx({ ui: { terminal: login().id, logins: [{ onde: "vm", login: login(), codigo: "", enviando: false, erroEnvio: null }] } }));
    expect(aberto).toContain("nod-motor entrar claude");
  });

  it("NOD-9 PR4: login que falhou com a IA desatualizada mostra o Atualizar; outra falha, não", () => {
    const html = renderListaDeContas(ctx({ ui: { logins: [{ onde: "vm", login: login({ fase: "falhou", erro: "cli_antigo" }), codigo: "", enviando: false, erroEnvio: null }] } }));
    expect(html).toContain('data-act="cl-atualizar-ia"');
    expect(html).toContain("nod-motor atualizar-ia claude");
    const enviado = renderListaDeContas(ctx({ ui: { logins: [{ onde: "vm", login: login({ fase: "falhou", erro: "cli_antigo" }), codigo: "", enviando: false, erroEnvio: "Pedido enviado." }] } }));
    expect(enviado).toContain("Pedido enviado.");
    const outra = renderListaDeContas(ctx({ ui: { logins: [{ onde: "vm", login: login({ fase: "falhou", erro: "codigo_invalido" }), codigo: "", enviando: false, erroEnvio: null }] } }));
    expect(outra).not.toContain("cl-atualizar-ia");
  });

  it("devolução do #501: cli_antigo do Codex cita `atualizar-ia codex`; sem a capacidade (ou sem contato), sem o botão", () => {
    const falhou = (ia: "claude-cli" | "codex-cli") => ({ ui: { logins: [{ onde: "vm" as const, login: login({ ia, fase: "falhou", erro: "cli_antigo" }), codigo: "", enviando: false, erroEnvio: null }] } });
    const codex = renderListaDeContas(ctx(falhou("codex-cli")));
    expect(codex).toContain("nod-motor atualizar-ia codex");
    expect(codex).not.toContain("nod-motor atualizar-ia claude");
    const semCapacidade = renderListaDeContas(ctx({ ...falhou("claude-cli"), maquinas: MAQUINAS.map((m) => ({ ...m, atualizaIas: false })) }));
    expect(semCapacidade).not.toContain('data-act="cl-atualizar-ia"');
    expect(semCapacidade).not.toContain("Clique em Atualizar");
    expect(semCapacidade).toContain("Rode nod-motor atualizar-ia claude no terminal dela.");
    const semContato = renderListaDeContas(ctx({ ...falhou("claude-cli"), maquinas: MAQUINAS.map((m) => ({ ...m, conectada: false })) }));
    expect(semContato).not.toContain('data-act="cl-atualizar-ia"');
  });

  it("Codex na VM: o código do aparelho para digitar na página da OpenAI", () => {
    const html = renderListaDeContas(ctx({ ui: { logins: [{ onde: "vm", login: login({ ia: "codex-cli", pedeCodigo: false, codigoDispositivo: "ABCD-1234", url: "https://auth.openai.com/codex/device" }), codigo: "", enviando: false, erroEnvio: null }] } }));
    expect(html).toContain("ABCD-1234");
    expect(html).toContain("Abrir a página da OpenAI");
  });

  it("filtro por máquina: abas, voltar para Máquinas e o botão de entrar nas contas que não estão nela", () => {
    const html = renderListaDeContas(ctx({ ui: { filtro: VM } }));
    expect(html).toContain("Voltar para Máquinas");
    expect(html).toContain(`data-act="cl-entrar" data-id="${LUMEN.id}" data-maquina="${VM}"`);
    expect(html).toContain("Em uso na vm-bots");
  });

  it("ADR-108 (R8): sem o 'Perguntar antes / Trocar sozinho' — um liga/desliga 'na fila' por conta e as três regras do Nod", () => {
    const html = renderListaDeContas(ctx());
    expect(html).not.toContain("cl-modo");
    expect(html).not.toContain("Trocar sozinho");
    expect(html).not.toContain("data-cl-optin");
    expect(html).toContain(`role="switch" aria-checked="true" data-act="cl-fila" data-id="${PESSOAL.id}"`);
    expect(html).toContain(`role="switch" aria-checked="false" data-act="cl-fila" data-id="${LUMEN.id}"`);
    expect(html).toContain("Quando uma conta acabar");
    for (const r of REGRAS_DA_FILA) expect(html).toContain(`<b>${r.titulo}:</b>`);
    // Revisão do PR 2 (I1): só no Claude nada se perde; no ChatGPT a task com sessão recomeçaria do resumo noutra conta.
    expect(REGRAS_DA_FILA[0]?.texto).toContain("No Claude, nada se perde.");
    expect(REGRAS_DA_FILA[0]?.texto).toContain("No ChatGPT, a task com sessão recomeçaria do resumo noutra conta");
    expect(html).toContain("Outra IA:</b> só nos bots em Automático");
    expect(html).toContain("o Nod recomenda esperar ou trocar");
    // Fora da fila e livre: a linha diz isso (no lugar de "Disponível").
    const foraLivre = { ...CONTAS, contas: [PESSOAL, GPT, { ...LUMEN, noLimiteAte: null }] };
    expect(renderListaDeContas(ctx({ contas: foraLivre }))).toContain("Fora da fila");
  });

  it("ADR-108 (E4): 'Em uso' é a 1ª da fila livre, nunca a fora da fila antes dela", () => {
    const foraPrimeiro = { ...CONTAS, contas: [{ ...LUMEN, noLimiteAte: null, posicao: 1 }, { ...PESSOAL, posicao: 2 }, { ...GPT, posicao: 3 }] };
    const html = renderListaDeContas(ctx({ contas: foraPrimeiro }));
    const linhaDa = (id: string) => html.slice(html.indexOf(`data-ordem-item="${id}"`), html.indexOf("</li>", html.indexOf(`data-ordem-item="${id}"`)));
    expect(linhaDa(PESSOAL.id)).toContain("Em uso");
    expect(linhaDa(LUMEN.id)).toContain("Fora da fila");
  });

  describe("NOD-8: o passo 1 do login (a máquina instala ou atualiza a IA antes)", () => {
    const naTela = (o: Partial<LoginNaMaquina>) => renderListaDeContas(ctx({ ui: { logins: [{ onde: "vm", login: login({ ia: "codex-cli", contaId: null, apelido: "Pessoal", url: null, pedeCodigo: false, ...o }), codigo: "", enviando: false, erroEnvio: null }] } }));

    it("preparando: passo 1 instalando (com a linha do npm), passo 2 'começa sozinho' e o Cancelar", () => {
      const html = naTela({ fase: "preparando", preparo: { acao: "instalar", linha: "added 1 package in 9s" } });
      expect(html).toContain("Preparar o ChatGPT na vm-bots");
      expect(html).toContain("Entrar na conta da OpenAI");
      expect(html).toContain("added 1 package in 9s");
      expect(html).toContain("Começa sozinho quando a instalação terminar.");
      expect(html).toContain('data-act="cl-login-cancelar"');
      expect(html).not.toContain("Abrindo o login");
      expect(naTela({ fase: "preparando", preparo: { acao: "instalar" } })).toContain("Instalando o Codex · leva até 2 minutos");
      expect(naTela({ fase: "preparando", preparo: null })).toContain("Preparando…");
    });

    it("atualizar mostra 'antes → depois'", () => {
      expect(naTela({ fase: "preparando", preparo: { acao: "atualizar", antes: "0.158.0", depois: "0.159.0" } })).toContain("0.158.0 → 0.159.0 · leva até 2 minutos");
      expect(naTela({ fase: "preparando", preparo: { acao: "atualizar", antes: "0.158.0", depois: "0.159.0" } })).toContain("Atualizar o Codex na vm-bots");
      expect(naTela({ fase: "preparando", preparo: { acao: "atualizar" } })).toContain("Começa sozinho quando a atualização terminar.");
    });

    it("concluído com o preparo: '✓ ChatGPT pronto na vm-bots · Codex X'; sem preparo, o '✓ Entrou' de sempre", () => {
      expect(naTela({ fase: "pronto", preparo: { acao: "instalar", depois: "0.160.0" } })).toContain("✓ ChatGPT pronto na vm-bots · Codex 0.160.0");
      const daMaquina = renderListaDeContas(ctx({ maquinas: [maquina(VM, "vm-bots", { iasDetalhe: { "codex-cli": { versao: "0.161.0" } } })], ui: { logins: [{ onde: "vm", login: login({ ia: "codex-cli", contaId: null, fase: "pronto", preparo: { acao: "instalar" } }), codigo: "", enviando: false, erroEnvio: null }] } }));
      expect(daMaquina).toContain("✓ ChatGPT pronto na vm-bots · Codex 0.161.0");
      expect(naTela({ fase: "pronto", preparo: null })).toContain("✓ Entrou");
    });

    it("a falha do preparo diz o que houve e oferece Tentar de novo", () => {
      const html = naTela({ fase: "falhou", erro: "preparo_falhou", preparo: { acao: "instalar" } });
      expect(html).toContain("Não deu para preparar a IA nessa máquina. Tente de novo.");
      expect(html).toContain('data-act="cl-login-de-novo"');
    });

    it("passo 11: com o motivo, a falha do preparo diz a frase da atualização e, só agora, o terminal (recolhido)", () => {
      const falha = { fase: "falhou", erro: "preparo_falhou", preparo: { acao: "instalar", atualizacao: { fase: "falhou", alvo: "0.159.0", motivo: "sem_espaco", em: 1, espaco: { livreMb: 1200, precisaMb: 2048 } } } } as Partial<LoginNaMaquina>;
      const semEspaco = naTela(falha);
      expect(semEspaco).toContain("falta espaço no disco (tem 1200 MB livres e precisa de 2048 MB)");
      // Protótipo v2.2: o terminal num link discreto; o comando só depois do clique.
      expect(semEspaco).toMatch(/data-act="cl-terminal" data-login="[^"]+">Prefere o terminal\?</);
      expect(semEspaco).not.toContain("<code>nod-motor atualizar-ia codex</code>");
      const aberto = renderListaDeContas(ctx({ ui: { terminal: login().id, logins: [{ onde: "vm", login: login({ ia: "codex-cli", contaId: null, apelido: "Pessoal", url: null, pedeCodigo: false, ...falha }), codigo: "", enviando: false, erroEnvio: null }] } }));
      expect(aberto).toContain("<code>nod-motor atualizar-ia codex</code>");
      expect(aberto).toMatch(/data-act="copiar-texto" data-texto="nod-motor atualizar-ia codex" aria-live="polite">Copiar</);
      expect(naTela({ fase: "falhou", erro: "preparo_falhou", preparo: { acao: "instalar", atualizacao: { fase: "falhou", alvo: "0.159.0", motivo: "sem_internet", em: 1 } } })).toContain("sem conexão com a internet");
      // QA #511: no "instalar" a frase diz instalar, não atualizar (a IA nem existia na máquina).
      const instalar = (motivo: string, acao = "instalar") => naTela({ fase: "falhou", erro: "preparo_falhou", preparo: { acao, atualizacao: { fase: "falhou", alvo: "0.159.0", motivo, em: 1 } } } as Partial<LoginNaMaquina>);
      expect(instalar("sem_internet")).toContain("Não deu para instalar o Codex: sem conexão com a internet.");
      expect(instalar("falhou")).toContain("Não deu para instalar o Codex sozinho.");
      expect(semEspaco).toContain("Não deu para instalar o Codex: falta espaço");
      for (const m of ["sem_internet", "falhou", "sem_espaco"]) expect(instalar(m)).not.toContain("para atualizar");
      expect(instalar("sem_internet", "atualizar")).toContain("Não deu para atualizar o Codex: sem conexão com a internet.");
      // Antes da falha (preparando), nada de comando do terminal.
      expect(naTela({ fase: "preparando", preparo: { acao: "instalar" } })).not.toContain("nod-motor atualizar-ia");
    });

    it("J5: na linha da conta, 'Atualizar o X' só com alvo pendente na VM conectada que atende o pedido", () => {
      const com = (o: Partial<MaquinaDto>) => renderListaDeContas(ctx({ maquinas: [maquina(VM, "vm-bots", { atualizaIas: true, ...o }), MAQUINAS[1]!] }));
      const antigo = { iasDetalhe: { "claude-cli": { causa: "cli_antigo" as const, versao: "2.0.1", minima: "2.1.150" } } };
      expect(com(antigo)).toMatch(new RegExp(`data-act="cl-atualizar-maquina" data-maquina="${VM}" data-ia="claude-cli"[^>]*>Atualizar o Claude Code<`));
      expect(com({ ...antigo, atualizaIas: false })).not.toContain("cl-atualizar-maquina");
      expect(com({ ...antigo, conectada: false })).not.toContain("cl-atualizar-maquina");
      expect(com({ iasDetalhe: { "claude-cli": { versao: "2.1.200" } } })).not.toContain("cl-atualizar-maquina");
      // O Mac fica com o cartão da IA do #498.
      const mac = renderListaDeContas(ctx({ maquinas: [MAQUINAS[0]!, maquina(MAC, "MacBook", { plataforma: "darwin", atualizaIas: true, ...antigo })] }));
      expect(mac).not.toContain(`data-maquina="${MAC}" data-ia="claude-cli"`);
    });

    it("Nova conta: na VM sem a IA, 'o nod instala o ChatGPT nela'; abaixo do piso, 'atualiza'; com ela, o de sempre", () => {
      const nova = { ia: "codex-cli" as const, apelido: "", maquinas: [] };
      const com = (o: Partial<MaquinaDto>) => renderListaDeContas(ctx({ maquinas: [maquina(VM, "vm-bots", o)], ui: { nova } }));
      expect(com({ ias: { "codex-cli": "ausente" } })).toContain("o nod instala o ChatGPT nela e o login aparece aqui");
      expect(com({ ias: { "codex-cli": "ausente" }, iasDetalhe: { "codex-cli": { causa: "cli_antigo", versao: "0.158.0", minima: "0.159.0" } } })).toContain("o nod atualiza o ChatGPT nela");
      expect(com({ ias: { "codex-cli": "nao_autenticado" } })).toContain("o login aparece aqui na tela");
      expect(com({ ias: {} })).toContain("o login aparece aqui na tela");
      expect(com({ ias: { "codex-cli": "ausente" }, iasDetalhe: { "codex-cli": { causa: "sonda_lenta" } } })).not.toContain("o nod instala");
    });
  });

  describe("PR #306: Adicionar conta sem máquina que receba o login", () => {
    const nova = { ia: "claude-cli" as const, apelido: "", maquinas: [] };

    it("sem máquina nenhuma: no lugar do formulário, o porquê e o Conectar uma VM", () => {
      const html = renderListaDeContas(ctx({ maquinas: [], ui: { nova } }));
      expect(html).not.toContain('data-form="cl-nova"');
      expect(html).toContain("o login do Claude e do ChatGPT é feito no Mac, pelo app do nod, ou numa VM");
      expect(html).toContain('data-act="cl-conectar-vm"');
      expect(html).toContain('data-act="cl-nova-fechar"');
      expect(html).toContain("No Mac, o login é feito pelo app do nod");
    });

    it("só o Mac conectado e a pessoa no navegador: o aviso diz para abrir o app nele", () => {
      const html = renderListaDeContas(ctx({ maquinas: [maquina(MAC, "MacBook", { plataforma: "darwin" })], ui: { nova } }));
      expect(html).not.toContain('data-form="cl-nova"');
      expect(html).toContain("Seu Mac já está conectado: abra o app do nod nele");
    });

    it("VM desconectada não conta como máquina para o login", () => {
      const html = renderListaDeContas(ctx({ maquinas: [maquina(VM, "vm-bots", { conectada: false })], ui: { nova } }));
      expect(html).toContain('data-act="cl-conectar-vm"');
    });

    it("com uma VM conectada (ou dentro do app do Mac), o formulário de sempre", () => {
      expect(renderListaDeContas(ctx({ maquinas: [maquina(VM, "vm-bots")], ui: { nova } }))).toContain('data-form="cl-nova"');
      const noMac = renderListaDeContas(ctx({ maquinas: [maquina(MAC, "MacBook", { plataforma: "darwin" })], noApp: true, detalhes: { maquinaId: MAC, contas: [] }, ui: { nova } }));
      expect(noMac).toContain('data-form="cl-nova"');
      expect(noMac).toContain("Este Mac");
    });
  });
});

describe("Provedores e Máquinas com a lista (ADR-102)", () => {
  const estado = (o: Partial<Estado> = {}): Estado => ({ ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, maquinas: { maquinas: MAQUINAS, padraoId: null }, contasIa: CONTAS, frota: { agentes: [] } as never, ...o });

  it("Provedores mostra a lista única no modo compartilhado e a tela de antes no modo local", () => {
    expect(renderProvedores(estado())).toContain('data-ordem-lista="contas"');
    expect(renderProvedores(estado({ contasIa: { disponivel: false, modo: "perguntar", contas: [] } }))).not.toContain('data-ordem-lista="contas"');
  });

  it("app do Mac antigo: a tela de antes, com a faixa para atualizar", () => {
    const html = renderProvedores(estado({ contasUi: { ...UI_CONTAS_INICIAL, appAntigo: true } }));
    expect(html).toContain("Atualize o app do nod");
    expect(html).not.toContain('data-ordem-lista="contas"');
  });

  it("Máquinas: o resumo das contas de cada máquina, quantas faltam e o Gerenciar contas", () => {
    const resumo = resumoDasContasNaMaquina(CONTAS, MAQUINAS[0]!);
    expect(resumo).toContain("1 conta · Claude · Pessoal");
    expect(resumo).toContain("2 contas suas ainda não estão aqui");
    expect(resumo).toContain(`data-act="cl-gerenciar" data-maquina="${VM}"`);
    const html = renderMaquinas(estado({ contasUi: { ...UI_CONTAS_INICIAL, maquinaMenu: VM } }));
    expect(html).toContain('data-act="maq-renomear"');
    expect(html).toContain('data-act="maq-desconectar"');
  });

  it("Desconectar: com contas na máquina, a caixa de sair delas vem marcada", () => {
    const html = renderMaquinas(estado({ contasUi: { ...UI_CONTAS_INICIAL, desconectar: { maquinaId: VM, sair: true } } }));
    expect(html).toContain("Desconectar a vm-bots?");
    expect(html).toMatch(/data-maq-sair-contas checked/);
  });

  it("Conectar com convite: o comando leva o convite e a tela espera a máquina, sem o passo do código", () => {
    const html = renderMaquinas(estado({ conectarMaquina: { passo: "comando", codigo: "", pedido: null, erro: null, chavesAntes: [], marcados: [], convite: "abc_DEF-123" } }));
    expect(html).toContain("/motor?convite=abc_DEF-123");
    expect(html).toContain("Esperando a máquina aparecer");
    expect(html).not.toContain("Digitar o código");
  });

  it("passo Contas do Conectar: cada conta com Entrar na máquina nova", () => {
    const html = renderContasNaMaquina({ contas: CONTAS, maquinas: MAQUINAS, detalhes: null, ui: UI_CONTAS_INICIAL, agora: AGORA, noApp: false, botsNaMaquina: () => [], cartaoDoMac: () => "" }, VM);
    expect(html).toContain("✓ logada");
    expect(html).toContain(`data-act="cl-entrar" data-id="${GPT.id}" data-maquina="${VM}"`);
    expect(html).toContain('data-act="cl-nova-na-maquina" data-ia="codex-cli"');
  });
});

describe("controlador da lista (ADR-102)", () => {
  function montar(api: Partial<ApiContas> = {}, termos: { aceita: boolean } = { aceita: true }, noMac?: () => Promise<boolean | { erro: string }>, prazoFrentesMs = 5_000) {
    let estado = reduzir({ ...estadoInicial, maquinas: { maquinas: MAQUINAS, padraoId: null } }, { tipo: "hidratar-contas", contas: CONTAS, detalhes: null });
    const pendentes: (() => void)[] = [];
    const chamadas: string[] = [];
    const c = criarContasDaPessoa({
      api: () => ({
        ordemContas: async (ids) => { chamadas.push(`ordem:${ids.length}`); return null; },
        mudarConta: async (id, corpo) => { if (corpo.entraNaTrocaAutomatica !== undefined) chamadas.push(`fila:${id}:${corpo.entraNaTrocaAutomatica}`); return null; },
        sairDaConta: async (id, m) => { chamadas.push(`sair:${id}:${m}`); return { ok: true }; },
        removerConta: async (id) => { chamadas.push(`remover:${id}`); return { ok: true }; },
        pedirLogin: async (m, p) => login({ maquinaId: m, contaId: p.contaId ?? null, apelido: p.apelido ?? null, fase: "pedido", url: null }),
        verLogin: async () => login(),
        colarCodigoLogin: async () => { chamadas.push("codigo"); return { ok: true }; },
        cancelarLogin: async () => ({ ok: true }),
        frentesAtivas: async () => [],
        ...api,
      }),
      ui: () => estado.contasUi,
      mudar: (mudanca) => { estado = reduzir(estado, { tipo: "contas-ui", mudanca }); },
      contas: () => estado.contasIa,
      trocarContas: (contas) => { estado = reduzir(estado, { tipo: "trocar-contas", contas }); },
      maquinas: () => estado.maquinas?.maquinas ?? [],
      detalhes: () => (noMac ? { maquinaId: MAC, contas: [] } : estado.detalhesContas),
      invalidar: () => chamadas.push("invalidar"),
      entrarNoMac: noMac ?? (async () => true),
      avisarTermos: async (ia) => { chamadas.push(`termos:${ia}`); return termos.aceita; },
      cifrar: async (chave, codigo) => ({ chave, iv: "aXY=", dados: btoa(codigo) }),
      agendar: (fn) => { pendentes.push(fn); },
      agora: () => AGORA,
      prazoFrentesMs,
    });
    const rodar = async () => { for (const fn of pendentes.splice(0)) fn(); await new Promise((r) => setTimeout(r, 0)); };
    return { c, chamadas, rodar, get estado() { return estado; } };
  }

  it("revisão NOD-373: recarregar as contas não fecha o \u201c…\u201d de uma IA em Provedores; o de uma conta que sumiu fecha", () => {
    const m = montar();
    m.c.menu("ia-ordem:claude-cli");
    m.c.aoHidratar(CONTAS);
    expect(m.estado.contasUi.menu).toBe("ia-ordem:claude-cli");
    m.c.menu("ia-ordem:claude-cli");
    m.c.menu("conta-que-sumiu");
    m.c.aoHidratar(CONTAS);
    expect(m.estado.contasUi.menu).toBeNull();
  });

  it("arrastar muda a lista na hora e manda a ordem ao servidor", async () => {
    const m = montar();
    await m.c.reordenar([LUMEN.id, PESSOAL.id, GPT.id]);
    expect(m.estado.contasIa?.contas.map((c) => c.apelido)).toEqual(["Lumen", "Pessoal", "Pessoal"]);
    expect(m.chamadas).toContain("ordem:3");
  });

  it("entrar numa VM abre o login na tela; o código vai cifrado e a tela segue conferindo", async () => {
    const m = montar();
    await m.c.entrar(GPT.id, VM);
    expect(m.estado.contasUi.logins).toHaveLength(1);
    await m.rodar();
    const l = m.estado.contasUi.logins[0]!;
    expect(l.onde === "vm" && l.login.fase).toBe("aguardando_pessoa");
    await m.c.enviarCodigo(l.onde === "vm" ? l.login.id : "", "codigo-da-pagina");
    expect(m.chamadas).toContain("codigo");
    const depois = m.estado.contasUi.logins[0]!;
    expect(depois.onde === "vm" && depois.login.codigoEnviado).toBe(true);
  });

  it("NOD-8 (regressão, crítico): no Mac, a instalação que falhou não abre o cartão do login; a nota mostra o erro", async () => {
    const m = montar({}, { aceita: true }, async () => ({ erro: "Não deu para instalar: sem conexão com a internet." }));
    await m.c.novaNaMaquina("codex-cli", MAC);
    expect(m.estado.contasUi.logins).toEqual([]);
    expect(m.estado.contasUi.nota).toBe("Não deu para instalar: sem conexão com a internet.");
    const ok = montar({}, { aceita: true }, async () => true);
    await ok.c.novaNaMaquina("codex-cli", MAC);
    expect(ok.estado.contasUi.logins.map((l) => l.onde)).toEqual(["mac"]);
  });

  it("sair e remover passam pela confirmação", async () => {
    const m = montar();
    await m.c.pedirSaida(PESSOAL.id, VM);
    await m.c.confirmar();
    await m.c.pedirRemocao(LUMEN.id);
    await m.c.confirmar();
    expect(m.chamadas).toEqual(expect.arrayContaining([`sair:${PESSOAL.id}:${VM}`, `remover:${LUMEN.id}`]));
    expect(m.estado.contasIa?.contas.some((c) => c.id === LUMEN.id)).toBe(false);
  });

  // NOD-293 C11 (2026-10-20): a confirmação conta antes quais frentes param; a busca que falha não impede a saída.
  it("NOD-293 C11: sair e remover buscam as frentes da conta antes de perguntar; sem resposta, perguntam do mesmo jeito", async () => {
    const pedidas: string[] = [];
    const frente = { trabalhoId: "t-1", titulo: "Login no Safari", agente: "Ada", conversaId: "c-1", maquinaId: VM, maquina: "vm-bots" };
    const m = montar({ frentesAtivas: async (id, maquinaId) => { pedidas.push(`${id}:${maquinaId ?? "todas"}`); return [frente]; } });
    await m.c.pedirSaida(PESSOAL.id, VM);
    expect(pedidas).toEqual([`${PESSOAL.id}:${VM}`]);
    expect(m.estado.contasUi.confirmar).toEqual({ tipo: "sair", contaId: PESSOAL.id, maquinaId: VM, frentes: [frente] });
    m.c.fecharConfirmacao();
    await m.c.pedirRemocao(LUMEN.id);
    expect(pedidas).toEqual([`${PESSOAL.id}:${VM}`, `${LUMEN.id}:todas`]);
    expect(m.estado.contasUi.confirmar).toMatchObject({ tipo: "remover", contaId: LUMEN.id, frentes: [frente] });
    const falha = montar({ frentesAtivas: async () => { throw new Error("rede"); } });
    await falha.c.pedirSaida(PESSOAL.id, VM);
    expect(falha.estado.contasUi.confirmar).toEqual({ tipo: "sair", contaId: PESSOAL.id, maquinaId: VM, frentes: null });
    await falha.c.confirmar();
    expect(falha.chamadas).toContain(`sair:${PESSOAL.id}:${VM}`);
  });

  it("NOD-293 C11: mostra pendente na hora, ignora clique duplicado e timeout cai em frentes=null", async () => {
    const frente = { trabalhoId: "t-1", titulo: "Login no Safari", agente: "Ada", conversaId: "c-1", maquinaId: VM, maquina: "vm-bots" };
    let resolver!: (v: typeof frente[]) => void;
    let chamadas = 0;
    const m = montar({ frentesAtivas: async () => { chamadas += 1; return new Promise((r) => { resolver = r; }); } });
    const primeira = m.c.pedirSaida(PESSOAL.id, VM);
    const duplicada = m.c.pedirSaida(PESSOAL.id, VM);
    expect(m.estado.contasUi.confirmar).toEqual({ tipo: "sair", contaId: PESSOAL.id, maquinaId: VM });
    expect(chamadas).toBe(1);
    await m.c.confirmar();
    expect(m.chamadas).not.toContain(`sair:${PESSOAL.id}:${VM}`);
    resolver([frente]);
    await Promise.all([primeira, duplicada]);
    expect(m.estado.contasUi.confirmar).toMatchObject({ frentes: [frente] });

    const timeout = montar({ frentesAtivas: async (_id, _maquina, signal) => new Promise((_r, rejeitar) => signal?.addEventListener("abort", () => rejeitar(signal.reason), { once: true })) }, { aceita: true }, undefined, 1);
    await timeout.c.pedirRemocao(LUMEN.id);
    expect(timeout.estado.contasUi.confirmar).toEqual({ tipo: "remover", contaId: LUMEN.id, frentes: null });
  });

  it("NOD-293 C11 (Gil): abrir, fechar e reabrir durante a busca mostra o diálogo de novo e a busca em curso o preenche", async () => {
    const frente = { trabalhoId: "t-1", titulo: "Login no Safari", agente: "Ada", conversaId: "c-1", maquinaId: VM, maquina: "vm-bots" };
    let resolver!: (v: typeof frente[]) => void;
    let chamadas = 0;
    const m = montar({ frentesAtivas: async () => { chamadas += 1; return new Promise((r) => { resolver = r; }); } });
    const abrir = m.c.pedirSaida(PESSOAL.id, VM);
    expect(m.estado.contasUi.confirmar).toEqual({ tipo: "sair", contaId: PESSOAL.id, maquinaId: VM });
    m.c.fecharConfirmacao();
    expect(m.estado.contasUi.confirmar).toBeFalsy();
    const reabrir = m.c.pedirSaida(PESSOAL.id, VM);
    expect(m.estado.contasUi.confirmar).toEqual({ tipo: "sair", contaId: PESSOAL.id, maquinaId: VM });
    expect(chamadas).toBe(1);
    resolver([frente]);
    await Promise.all([abrir, reabrir]);
    expect(m.estado.contasUi.confirmar).toEqual({ tipo: "sair", contaId: PESSOAL.id, maquinaId: VM, frentes: [frente] });
  });

  it("ADR-108: ligar a corporativa como 2ª da IA pede os termos; recusado, nada muda; aceito, liga", async () => {
    const recusa = montar({}, { aceita: false });
    await recusa.c.naFila(LUMEN.id, true);
    expect(recusa.chamadas).toEqual(["termos:claude-cli"]);
    expect(recusa.estado.contasIa?.contas.find((c) => c.id === LUMEN.id)?.entraNaTrocaAutomatica).toBe(false);
    const aceita = montar();
    await aceita.c.naFila(LUMEN.id, true);
    expect(aceita.chamadas).toEqual(["termos:claude-cli", `fila:${LUMEN.id}:true`, "invalidar"]);
    expect(aceita.estado.contasIa?.contas.find((c) => c.id === LUMEN.id)?.entraNaTrocaAutomatica).toBe(true);
  });

  it("ADR-108: desligar nunca pede os termos; a 1ª pessoal da IA liga sem pedir; a 2ª da mesma IA pede", async () => {
    const m = montar();
    await m.c.naFila(PESSOAL.id, false);
    expect(m.chamadas).toEqual([`fila:${PESSOAL.id}:false`, "invalidar"]);
    await m.c.naFila(PESSOAL.id, true);
    expect(m.chamadas).not.toContain("termos:claude-cli");
    const segunda = conta("aaaaaaaa-0000-4000-8000-000000000004", "claude-cli", "Pessoal 2", [VM]);
    const comSegunda = { ...CONTAS, contas: [...CONTAS.contas, segunda] };
    expect(ligarPedeAvisoDosTermos(comSegunda, segunda.id)).toBe(true);
    expect(ligarPedeAvisoDosTermos(comSegunda, LUMEN.id)).toBe(true);
    expect(ligarPedeAvisoDosTermos({ ...CONTAS, contas: [{ ...PESSOAL, entraNaTrocaAutomatica: false }, GPT] }, PESSOAL.id)).toBe(false);
  });

  it("NOD-308: ligar a corporativa como 1ª da IA não pede os termos; como 2ª pede, igual à pessoal", () => {
    const so = { ...CONTAS, contas: [GPT, { ...LUMEN, posicao: 1 }] };
    expect(ligarPedeAvisoDosTermos(so, LUMEN.id)).toBe(false);
    expect(ligarPedeAvisoDosTermos({ ...CONTAS, contas: [{ ...PESSOAL, entraNaTrocaAutomatica: false }, GPT, LUMEN] }, LUMEN.id)).toBe(false);
    expect(ligarPedeAvisoDosTermos(CONTAS, LUMEN.id)).toBe(true);
  });

  it("o Mac só entra pelo app aberto nele", async () => {
    const m = montar();
    await m.c.entrar(GPT.id, MAC);
    expect(m.estado.contasUi.nota).toContain("abra o app do nod");
    expect(m.estado.contasUi.logins).toHaveLength(0);
  });
});

describe("o uso de cada conta na lista (NOD-302 CA12; NOD-12)", () => {
  it("a linha mostra as barras de 5 h e da semana; sem `cota` (servidor anterior) nada; a pílula do limite diz o dia quando é outro", () => {
    const volta = AGORA + 2 * 3_600_000;
    const comCota = { ...CONTAS, contas: [
      { ...PESSOAL, cota: { cincoHoras: { utilizacao: 0.995, renovaEm: volta }, semana: { utilizacao: 0.4, renovaEm: AGORA + 86_400_000 }, situacao: "reserva" as const, voltaEm: volta, medidoEm: AGORA } },
      { ...GPT, cota: null },
      LUMEN,
    ] };
    const html = renderListaDeContas(ctx({ contas: comCota }));
    expect(html).toContain(`aria-valuetext="5 horas: 99% usado, renova às ${hora(volta)}"`);
    expect(html).toContain('class="cu-jan f-alerta"');
    expect(html).toContain('aria-label="Semana"');
    expect(html).toContain("O ChatGPT não informou o uso desta conta");
    // A Lumen (sem o campo) não ganha bloco nenhum; a Pessoal (alerta) diz o que acontece sem outra conta na fila.
    expect(html.match(/class="cl-uso"/g)).toHaveLength(1);
    expect(html).toContain("Sem outra conta do Claude na fila: no limite, as rotinas esperam até renovar.");
    expect(html).not.toContain("cl-cota");
    const amanha = AGORA + 30 * 3_600_000;
    const d = new Date(amanha);
    const dia = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    const limite = renderListaDeContas(ctx({ contas: { ...CONTAS, contas: [PESSOAL, GPT, { ...LUMEN, noLimiteAte: amanha }] } }));
    expect(limite).toContain(`No limite até ${dia} às ${hora(amanha)}`);
  });

  it("NOD-12: na simulação (catcher) nenhum medidor; os detalhes dizem de onde vem o número, só com o campo `cota`", () => {
    const comCota = { ...CONTAS, contas: [{ ...PESSOAL, cota: { cincoHoras: { utilizacao: 0.42, renovaEm: AGORA + 3_600_000 }, semana: null, situacao: "livre" as const, voltaEm: null, medidoEm: AGORA } }, { ...GPT, cota: null }, LUMEN] };
    const simulado = renderListaDeContas(ctx({ contas: comCota, simulacao: true }));
    expect(simulado).not.toContain("cl-uso");
    expect(simulado).not.toContain("cu-nada");
    const detalhe = (id: string, simulacao = false) => renderListaDeContas(ctx({ contas: comCota, simulacao, ui: { detalhe: id } }));
    expect(detalhe(PESSOAL.id)).toContain("O próprio Claude Code informa o uso a cada trabalho.");
    expect(detalhe(GPT.id)).toContain("O próprio Codex informa o uso no fim de cada conversa.");
    expect(detalhe(LUMEN.id)).not.toContain("Uso do plano");
    expect(detalhe(PESSOAL.id, true)).not.toContain("Uso do plano");
  });
});
