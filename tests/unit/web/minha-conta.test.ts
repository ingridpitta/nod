import { describe, expect, it, vi } from "vitest";
import type { MinhaContaDto } from "../../../src/contracts/minha-conta.ts";
import { ErroApi } from "../../../web/lib/erro-api.ts";
import { base64DoDataUrl, bytesDoBase64 } from "../../../web/lib/foto-base64.ts";
import { SECOES_ESPACO } from "../../../web/telas/espaco.ts";
import * as dominio from "../../../src/domain/minha-conta.ts";
import { FOCO_DA_JANELA, NAO_ENVIOU_CODIGO, NAO_ENVIOU_LINK, NOME_MAX, SOBRE_MIM_MAX, criarMinhaConta, diasAte, fraseDoErro, iniciais, quando, tamanhoLegivel, type ApiMinhaConta, type DepsMinhaConta } from "../../../web/telas/minha-conta.ts";

/**
 * NOD-346: a seção Minha conta, sem DOM. A API, o relógio e os campos são falsos. O que se prova: as três abas, a janela
 * "Confirme que é você" que abre no `motivo: reautenticar` e refaz a ação depois, o Google que não sai quando é a última
 * forma, a troca de e-mail pendente, a exportação (pedida → relê a cada 5 s → pronta), a exclusão programada com os dias
 * que faltam e o desfazer, e que senha e código nunca chegam ao HTML.
 */
const AGORA = new Date(2026, 9, 23, 15, 12).getTime();
const DIA = 86_400_000;
const SENHA = "uma-senha-bem-longa-123";
const form = (valores: Record<string, string>) => ({ valores });
const campo = (f: object, nome: string) => (f as { valores: Record<string, string> }).valores[nome] ?? "";
const el = (dados: Record<string, string> = {}) => ({ dataset: dados });
const reaut = () => Object.assign(new ErroApi(403, "nao_autorizado", "Confirme que é você."), { motivo: "reautenticar" });
const comMotivo = (motivo: string, status = 409) => Object.assign(new ErroApi(status, "estado_invalido", "frase do servidor"), { motivo });

function dados(p: Partial<MinhaContaDto> = {}, conta: Partial<NonNullable<MinhaContaDto["conta"]>> = {}): MinhaContaDto {
  return {
    perfil: { nome: "Ana Souza", sobreMim: "Gosto de respostas curtas.", temFoto: false },
    conta: { email: "ana@exemplo.com.br", formas: { senha: true, google: true }, trocaEmail: null, exclusao: null, podeExcluir: true, ...conta },
    exportacao: null,
    reautenticadaAte: null,
    purgaLigada: false,
    ...p,
  };
}

function montar(api: Partial<ApiMinhaConta>, inicial: MinhaContaDto = dados(), extra: Partial<DepsMinhaConta> = {}) {
  const relogios: { fn: () => void; ms: number }[] = [];
  let atual = inicial;
  const estado = vi.fn(async () => atual);
  const c = criarMinhaConta({
    api: () => ({ estado, ...api }) as ApiMinhaConta,
    aoMudar: () => undefined,
    agora: () => AGORA,
    campo,
    lerFoto: async () => "AAAA",
    agendar: (fn, ms) => { const r = { fn, ms }; relogios.push(r); return () => { relogios.splice(relogios.indexOf(r), 1); }; },
    ...extra,
  });
  const html = () => c.render();
  const trocar = (d: MinhaContaDto) => { atual = d; };
  return { c, html, estado, relogios, trocar };
}

async function aberto(api: Partial<ApiMinhaConta>, inicial?: MinhaContaDto, extra?: Partial<DepsMinhaConta>) {
  const m = montar(api, inicial, extra);
  m.c.abrir();
  await vi.waitFor(() => expect(m.c.vista().dados).not.toBeNull());
  return m;
}

describe("Minha conta: perfil", () => {
  it("carrega, mostra as três abas, as iniciais e o Sobre mim; salvar diz que vale no próximo turno", async () => {
    const salvarPerfil = vi.fn(async (p: { nome: string; sobreMim: string }) => ({ nome: p.nome, sobreMim: p.sobreMim, temFoto: false }));
    const { c, html } = await aberto({ salvarPerfil });
    expect(html()).toContain("Formas de entrada");
    expect(html()).toContain("Seus dados");
    expect(html()).toContain(">AS<");
    expect(html()).toContain("Gosto de respostas curtas.");
    await c.forms["mc-perfil"]!(form({ nome: "Ana S.", sobreMim: "Novo texto" }));
    expect(salvarPerfil).toHaveBeenCalledWith({ nome: "Ana S.", sobreMim: "Novo texto" });
    expect(html()).toContain("Alterações salvas. Valem no próximo turno.");
    expect(html()).toContain('value="Ana S."');
  });

  it("o erro do nome fica no campo do nome (aria-invalid) e o rascunho não se perde", async () => {
    const salvarPerfil = vi.fn(async () => { throw comMotivo("nome:nome_vazio", 400); });
    const { c, html } = await aberto({ salvarPerfil });
    await c.forms["mc-perfil"]!(form({ nome: "", sobreMim: "meu rascunho" }));
    expect(html()).toMatch(/name="nome"[^>]*aria-invalid="true"/);
    expect(html()).toContain("Escreva seu nome.");
    expect(html()).toContain("meu rascunho");
  });

  it("o rascunho digitado atravessa um redesenho", async () => {
    const { c, html } = await aberto({});
    c.digitou("sobreMim", "texto pela metade");
    expect(html()).toContain("texto pela metade");
    expect(html()).toContain("Ana Souza");
  });

  it("sem conta (sessão provisória): só o perfil, com a nota para criar a conta", async () => {
    const { html } = await aberto({}, dados({ conta: null }));
    expect(html()).not.toContain("Formas de entrada</button>");
    expect(html()).toContain("Seu espaço ainda não tem conta");
  });

  it("foto: escolhida vai em base64 e o avatar troca para a imagem (com versão nova)", async () => {
    const definirFoto = vi.fn(async () => ({ nome: "Ana Souza", sobreMim: null, temFoto: true }));
    const { c, html } = await aberto({ definirFoto });
    await c.acoes["mc-foto-escolhida"]!(el());
    expect(definirFoto).toHaveBeenCalledWith("AAAA");
    expect(html()).toContain('src="/api/conta/eu/foto?v=1"');
    expect(html()).toContain("Remover");
  });

  it("foto ilegível não vai ao servidor", async () => {
    const definirFoto = vi.fn();
    const { c, html } = await aberto({ definirFoto }, undefined, { lerFoto: async () => null });
    await c.acoes["mc-foto-escolhida"]!(el());
    expect(definirFoto).not.toHaveBeenCalled();
    expect(html()).toContain("Use JPG ou PNG");
  });
});

describe("Minha conta: confirmar identidade", () => {
  it("ação de risco sem confirmação abre a janela; com a senha certa, refaz a ação", async () => {
    let confirmado = false;
    const removerGoogle = vi.fn(async () => { if (!confirmado) throw reaut(); return { formas: { senha: true, google: false } }; });
    const reautenticarComSenha = vi.fn(async (s: string) => { confirmado = s === SENHA; return confirmado ? { resultado: "ok" as const, ate: AGORA + 600_000 } : { resultado: "recusado" as const }; });
    const { c, html } = await aberto({ removerGoogle, reautenticarComSenha });
    c.acoes["mc-aba"]!(el({ aba: "acesso" }));
    await c.acoes["mc-google-remover"]!(el());
    expect(html()).toContain("Confirme que é você");
    expect(html()).toContain("Para desconectar o Google");
    await c.forms["mc-confirmar-senha"]!(form({ senha: "errada" }));
    expect(html()).toContain("A senha não confere.");
    await c.forms["mc-confirmar-senha"]!(form({ senha: SENHA }));
    expect(removerGoogle).toHaveBeenCalledTimes(2);
    expect(html()).not.toContain("Confirme que é você");
    expect(html()).toContain("Google desconectado");
    expect(html()).not.toContain(SENHA);
  });

  it("sem senha, a janela vai por código no e-mail; código errado diz quantas tentativas restam", async () => {
    let ok = false;
    const excluir = vi.fn(async () => { if (!ok) throw reaut(); return { pedidaEm: AGORA, purgarEm: AGORA + 30 * DIA }; });
    const enviarCodigo = vi.fn(async () => ({ enviado: true, expiraEm: AGORA + 600_000 }));
    const reautenticarComCodigo = vi.fn(async (codigo: string) => {
      ok = codigo === "123456";
      return ok ? { resultado: "ok" as const, ate: AGORA + 600_000 } : { resultado: "errado" as const, restantes: 4 };
    });
    const m = await aberto({ excluir, enviarCodigo, reautenticarComCodigo }, dados({}, { formas: { senha: false, google: true } }));
    m.c.acoes["mc-aba"]!(el({ aba: "dados" }));
    m.c.acoes["mc-passo"]!(el({ passo: "excluir" }));
    await m.c.acoes["mc-excluir"]!(el());
    expect(m.html()).toContain("Enviar código");
    expect(m.html()).not.toContain("Usar senha");
    await m.c.acoes["mc-codigo-enviar"]!(el());
    expect(enviarCodigo).toHaveBeenCalledOnce();
    await m.c.forms["mc-confirmar-codigo"]!(form({ codigo: "000000" }));
    expect(m.html()).toContain("Código errado. Mais 4 tentativas.");
    m.trocar(dados({}, { formas: { senha: false, google: true }, exclusao: { pedidaEm: AGORA, purgarEm: AGORA + 30 * DIA } }));
    await m.c.forms["mc-confirmar-codigo"]!(form({ codigo: "123 456" }));
    expect(reautenticarComCodigo).toHaveBeenLastCalledWith("123456");
    expect(excluir).toHaveBeenCalledTimes(2);
    expect(m.html()).toContain("Exclusão programada");
    expect(m.html()).not.toContain("123456");
  });

  it("codex no PR 506: código ou link que o provedor não enviou não aparece como enviado", async () => {
    const excluir = vi.fn(async () => { throw reaut(); });
    const enviarCodigo = vi.fn(async () => ({ enviado: false, expiraEm: AGORA + 600_000 }));
    const m = await aberto({ excluir, enviarCodigo }, dados({}, { formas: { senha: false, google: true } }));
    m.c.acoes["mc-aba"]!(el({ aba: "dados" }));
    m.c.acoes["mc-passo"]!(el({ passo: "excluir" }));
    await m.c.acoes["mc-excluir"]!(el());
    await m.c.acoes["mc-codigo-enviar"]!(el());
    expect(m.html()).toContain(NAO_ENVIOU_CODIGO);
    expect(m.html()).toContain("Enviar código");

    const pedirTrocaEmail = vi.fn(async (email: string) => ({ enviado: false, para: email, expiraEm: AGORA + DIA }));
    const e = await aberto({ pedirTrocaEmail });
    e.c.acoes["mc-aba"]!(el({ aba: "acesso" }));
    e.c.acoes["mc-passo"]!(el({ passo: "email" }));
    e.trocar(dados({}, { trocaEmail: { para: "nova@exemplo.com.br", expiraEm: AGORA + DIA } }));
    await e.c.forms["mc-email"]!(form({ email: "nova@exemplo.com.br" }));
    expect(e.html()).toContain(NAO_ENVIOU_LINK);
    // Revisão 5: o "Enviamos um link" não convive com o erro de envio.
    expect(e.html()).not.toContain("Enviamos um link");
    expect(e.html()).toContain("mas o e-mail não saiu");
  });

  it("fechar a janela não faz a ação", async () => {
    const removerGoogle = vi.fn(async () => { throw reaut(); });
    const { c, html } = await aberto({ removerGoogle });
    c.acoes["mc-aba"]!(el({ aba: "acesso" }));
    await c.acoes["mc-google-remover"]!(el());
    c.acoes["mc-janela-fechar"]!(el());
    expect(html()).not.toContain("Confirme que é você");
    expect(removerGoogle).toHaveBeenCalledOnce();
  });

  it("revisão do PR 506: a janela recebe o foco ao abrir, e o foco volta a quem a abriu ao fechar (o Esc usa fecharJanela)", async () => {
    const focar = vi.fn();
    const removerGoogle = vi.fn(async () => { throw reaut(); });
    const { c, html } = await aberto({ removerGoogle }, undefined, { focar });
    c.acoes["mc-aba"]!(el({ aba: "acesso" }));
    expect(c.janelaAberta()).toBe(false);
    await c.acoes["mc-google-remover"]!(el());
    expect(c.janelaAberta()).toBe(true);
    expect(focar).toHaveBeenLastCalledWith(FOCO_DA_JANELA);
    c.acoes["mc-janela-modo"]!(el({ modo: "codigo" }));
    expect(focar).toHaveBeenLastCalledWith(FOCO_DA_JANELA);
    c.fecharJanela();
    expect(c.janelaAberta()).toBe(false);
    expect(html()).not.toContain("Confirme que é você");
    expect(focar).toHaveBeenLastCalledWith('[data-act="mc-google-remover"]');
    expect(removerGoogle).toHaveBeenCalledOnce();
    // Fechar de novo (Esc sem janela) não faz nada.
    focar.mockClear();
    c.fecharJanela();
    expect(focar).not.toHaveBeenCalled();
  });
});

describe("Minha conta: formas de entrada", () => {
  it("só com Google: o Desconectar fica desabilitado e explica por quê", async () => {
    const { c, html } = await aberto({}, dados({}, { formas: { senha: false, google: true } }));
    c.acoes["mc-aba"]!(el({ aba: "acesso" }));
    expect(html()).toMatch(/data-act="mc-google-remover"[^>]*aria-describedby="ultima-ajuda"[^>]*disabled/);
    expect(html()).toContain("Nenhuma senha definida");
  });

  it("o servidor recusando a última forma vira uma frase clara", async () => {
    const removerGoogle = vi.fn(async () => { throw comMotivo("ultima_forma_de_entrada"); });
    const { c, html } = await aberto({ removerGoogle });
    c.acoes["mc-aba"]!(el({ aba: "acesso" }));
    await c.acoes["mc-google-remover"]!(el());
    expect(html()).toContain("Esta é sua última forma de entrada");
  });

  it("trocar e-mail: pede, mostra o aguardo, reenviar e cancelar", async () => {
    const pedirTrocaEmail = vi.fn(async (email: string) => ({ enviado: true, para: email, expiraEm: AGORA + DIA }));
    const cancelarTrocaEmail = vi.fn(async () => ({ cancelada: true }));
    const m = await aberto({ pedirTrocaEmail, cancelarTrocaEmail });
    m.c.acoes["mc-aba"]!(el({ aba: "acesso" }));
    m.c.acoes["mc-passo"]!(el({ passo: "email" }));
    m.trocar(dados({}, { trocaEmail: { para: "nova@exemplo.com.br", expiraEm: AGORA + DIA } }));
    await m.c.forms["mc-email"]!(form({ email: " nova@exemplo.com.br " }));
    expect(pedirTrocaEmail).toHaveBeenCalledWith("nova@exemplo.com.br");
    expect(m.html()).toContain("Enviamos um link para <strong>nova@exemplo.com.br</strong>");
    expect(m.html()).toContain("continue entrando com <strong>ana@exemplo.com.br</strong>");
    await m.c.acoes["mc-email-reenviar"]!(el());
    expect(pedirTrocaEmail).toHaveBeenCalledTimes(2);
    m.trocar(dados());
    await m.c.acoes["mc-email-cancelar"]!(el());
    expect(cancelarTrocaEmail).toHaveBeenCalledOnce();
    expect(m.html()).toContain("Troca cancelada");
  });

  it("e-mail já em uso aparece no campo", async () => {
    const pedirTrocaEmail = vi.fn(async () => { throw comMotivo("email_em_uso"); });
    const { c, html } = await aberto({ pedirTrocaEmail });
    c.acoes["mc-aba"]!(el({ aba: "acesso" }));
    c.acoes["mc-passo"]!(el({ passo: "email" }));
    await c.forms["mc-email"]!(form({ email: "outra@exemplo.com.br" }));
    expect(html()).toContain("Esse e-mail já é de outra conta.");
    expect(html()).toContain('value="outra@exemplo.com.br"');
  });

  it("trocar senha: confirmação diferente não chama o servidor; certa diz as sessões encerradas", async () => {
    const trocarSenha = vi.fn(async () => ({ resultado: "trocada" as const, encerradas: 2 }));
    const { c, html } = await aberto({ trocarSenha });
    c.acoes["mc-aba"]!(el({ aba: "acesso" }));
    c.acoes["mc-passo"]!(el({ passo: "senha" }));
    await c.forms["mc-senha"]!(form({ atual: SENHA, nova: "outra-senha-longa-1", confirmar: "diferente-123456" }));
    expect(trocarSenha).not.toHaveBeenCalled();
    expect(html()).toContain("A confirmação não é igual à nova senha.");
    await c.forms["mc-senha"]!(form({ atual: SENHA, nova: "outra-senha-longa-1", confirmar: "outra-senha-longa-1" }));
    expect(trocarSenha).toHaveBeenCalledWith(SENHA, "outra-senha-longa-1");
    expect(html()).toContain("As outras 2 sessões foram encerradas");
    expect(html()).not.toContain(SENHA);
  });

  it("o link do e-mail novo: trocado abre Formas de entrada com o aviso; inválido diz para pedir de novo", async () => {
    const confirmarEmail = vi.fn(async (t: string) => (t === "bom" ? { resultado: "trocado" as const, email: "nova@exemplo.com.br", encerradas: 1 } : { resultado: "invalido" as const }));
    const m = await aberto({ confirmarEmail });
    await m.c.confirmarEmail("bom");
    expect(m.c.vista().aba).toBe("acesso");
    expect(m.html()).toContain("E-mail trocado para nova@exemplo.com.br");
    await m.c.confirmarEmail("ruim");
    expect(m.html()).toContain("Este link de confirmação não vale mais");
    await m.c.confirmarEmail(null);
    expect(m.html()).toContain("Este link de confirmação não vale mais");
  });
});

describe("Minha conta: exportar e excluir", () => {
  it("exportação pedida relê a cada 5 s enquanto a seção está aberta; pronta, para de reler", async () => {
    const pedida = { id: "e1", estado: "pedida" as const, motivo: null, tamanho: null, pedidaEm: AGORA, prontaEm: null, expiraEm: null };
    const pedirExportacao = vi.fn(async () => pedida);
    const m = await aberto({ pedirExportacao });
    m.c.acoes["mc-aba"]!(el({ aba: "dados" }));
    expect(m.html()).toContain("Pedir exportação");
    expect(m.html()).toContain("Senhas, códigos, tokens");
    await m.c.acoes["mc-exportar"]!(el());
    expect(m.html()).toContain("Preparando sua exportação");
    expect(m.html()).toContain("Pedida hoje, 15:12");
    expect(m.relogios).toHaveLength(1);
    expect(m.relogios[0]!.ms).toBe(5000);
    m.trocar(dados({ exportacao: { ...pedida, estado: "pronta", tamanho: 2_400_000, prontaEm: AGORA, expiraEm: AGORA + 7 * DIA } }));
    m.relogios[0]!.fn();
    await vi.waitFor(() => expect(m.html()).toContain("Exportação pronta"));
    expect(m.html()).toContain("2,3 MB");
    expect(m.relogios).toHaveLength(0);
  });

  it("fechar a seção para o relógio", async () => {
    const pedida = { id: "e1", estado: "pedida" as const, motivo: null, tamanho: null, pedidaEm: AGORA, prontaEm: null, expiraEm: null };
    const m = await aberto({}, dados({ exportacao: pedida }));
    expect(m.relogios).toHaveLength(1);
    m.c.fechar();
    expect(m.relogios).toHaveLength(0);
  });

  it("baixar exige confirmar; depois baixa o id da exportação", async () => {
    let ok = false;
    const baixarExportacao = vi.fn(async () => { if (!ok) throw reaut(); });
    const reautenticarComSenha = vi.fn(async () => { ok = true; return { resultado: "ok" as const, ate: AGORA + 600_000 }; });
    const pronta = { id: "e9", estado: "pronta" as const, motivo: null, tamanho: 900, pedidaEm: AGORA, prontaEm: AGORA, expiraEm: AGORA + 7 * DIA };
    const { c, html } = await aberto({ baixarExportacao, reautenticarComSenha }, dados({ exportacao: pronta }));
    c.acoes["mc-aba"]!(el({ aba: "dados" }));
    await c.acoes["mc-baixar"]!(el());
    expect(html()).toContain("Para baixar seus dados");
    await c.forms["mc-confirmar-senha"]!(form({ senha: SENHA }));
    expect(baixarExportacao).toHaveBeenLastCalledWith("e9");
    expect(baixarExportacao).toHaveBeenCalledTimes(2);
  });

  it("falhou por tamanho não oferece tentar de novo; falha comum oferece", async () => {
    const base = { id: "e1", estado: "falhou" as const, tamanho: null, pedidaEm: AGORA, prontaEm: null, expiraEm: null };
    const grande = await aberto({}, dados({ exportacao: { ...base, motivo: "grande_demais" } }));
    grande.c.acoes["mc-aba"]!(el({ aba: "dados" }));
    expect(grande.html()).toContain("Relate o problema");
    expect(grande.html()).not.toContain("Tentar de novo");
    const comum = await aberto({}, dados({ exportacao: { ...base, motivo: "erro" } }));
    comum.c.acoes["mc-aba"]!(el({ aba: "dados" }));
    expect(comum.html()).toContain("Tentar de novo");
  });

  it("exclusão programada: dias que faltam, data, desfazer e a nota da purga pausada", async () => {
    const desfazerExclusao = vi.fn(async () => ({ desfeita: true }));
    const m = await aberto({ desfazerExclusao }, dados({}, { exclusao: { pedidaEm: AGORA, purgarEm: AGORA + 30 * DIA } }));
    m.c.acoes["mc-aba"]!(el({ aba: "dados" }));
    expect(m.html()).toContain("<b>30</b><small>dias</small>");
    expect(m.html()).toContain("22 nov 2026");
    expect(m.html()).toContain("a purga automática ainda está pausada");
    m.trocar(dados());
    await m.c.acoes["mc-desfazer"]!(el());
    expect(desfazerExclusao).toHaveBeenCalledOnce();
    expect(m.html()).toContain("Exclusão desfeita");
    expect(m.html()).toContain("Excluir conta…");
  });

  it("com a purga ligada, a nota de pausa some", async () => {
    const m = await aberto({}, dados({ purgaLigada: true }, { exclusao: { pedidaEm: AGORA, purgarEm: AGORA + DIA + 3_600_000 } }));
    m.c.acoes["mc-aba"]!(el({ aba: "dados" }));
    expect(m.html()).not.toContain("pausada");
    expect(m.html()).toContain("<b>2</b><small>dias</small>");
  });

  it("conta de equipe não oferece excluir", async () => {
    const m = await aberto({}, dados({}, { podeExcluir: false }));
    m.c.acoes["mc-aba"]!(el({ aba: "dados" }));
    expect(m.html()).toContain("Este espaço é de uma equipe");
    expect(m.html()).not.toContain('data-act="mc-passo" data-passo="excluir"');
  });

  it("duplo clique não manda duas exclusões", async () => {
    let soltar: () => void = () => undefined;
    const excluir = vi.fn(() => new Promise<{ pedidaEm: number; purgarEm: number }>((r) => { soltar = () => r({ pedidaEm: AGORA, purgarEm: AGORA + 30 * DIA }); }));
    const m = await aberto({ excluir });
    m.c.acoes["mc-aba"]!(el({ aba: "dados" }));
    m.c.acoes["mc-passo"]!(el({ passo: "excluir" }));
    const a = m.c.acoes["mc-excluir"]!(el());
    const b = m.c.acoes["mc-excluir"]!(el());
    expect(m.html()).toContain("Programando…");
    soltar();
    await Promise.all([a, b]);
    expect(excluir).toHaveBeenCalledOnce();
  });
});

describe("Minha conta: utilitários e Seu espaço", () => {
  it("formatos", () => {
    expect(diasAte(AGORA + 30 * DIA, AGORA)).toBe(30);
    expect(diasAte(AGORA - 1, AGORA)).toBe(0);
    expect(tamanhoLegivel(900)).toBe("900 B");
    expect(tamanhoLegivel(4096)).toBe("4 KB");
    expect(iniciais("Ana Maria Souza", null)).toBe("AS");
    expect(iniciais(null, "bruno@x.com")).toBe("BR");
    expect(iniciais(null, null)).toBe("?");
    expect(quando(AGORA - DIA, AGORA)).toBe("22 out, 15:12");
    expect(fraseDoErro(comMotivo("motivo_desconhecido"))).toBe("frase do servidor");
    expect(fraseDoErro(new Error("x"))).toBe("Não deu para concluir. Tente de novo.");
  });

  it("foto: base64 só de PNG/JPEG em data URL e o tamanho em bytes", () => {
    expect(base64DoDataUrl("data:image/jpeg;base64,QUJD")).toBe("QUJD");
    expect(base64DoDataUrl("data:image/svg+xml;base64,QUJD")).toBeNull();
    expect(bytesDoBase64("QUJD")).toBe(3);
    expect(bytesDoBase64("QQ==")).toBe(1);
  });

  it("os limites da tela são os do domínio", () => {
    expect([NOME_MAX, SOBRE_MIM_MAX]).toEqual([dominio.NOME_MAX, dominio.SOBRE_MIM_MAX]);
  });

  it("Minha conta é a primeira seção de Seu espaço", () => {
    expect(SECOES_ESPACO[0]?.id).toBe("conta");
  });
});
