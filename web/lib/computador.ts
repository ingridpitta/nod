import type { ComputadorDto, RegistroComputador } from "../../src/contracts/computador.ts";
import type { MotivoFalhaComputador } from "../../src/contracts/motivos.ts";
import { botao, esc } from "./render.ts";
import { ehCelular } from "./celular.ts";

/**
 * Cópia de PREFIXO/SUFIXO de src/domain/computador.ts (a web não executa src/). O teste unitário
 * compara com `textoPedidoDeTela`: se a frase do servidor mudar e a cópia não, o cartão some.
 */
const PREFIXO_PEDIDO_DE_TELA = "Abra meu computador para concluir este passo: ";
const SUFIXO_PEDIDO_DE_TELA = ". Abra a tela e clique nela para assumir; quando terminar, toque em Parar. Não envie senha ou código aqui.";
/** O sufixo de antes da NOD-97: os pedidos já gravados na conversa continuam virando o cartão. */
const SUFIXO_PEDIDO_DE_TELA_ANTIGO = ". Use Assumir controle; depois, Devolver ao bot. Não envie senha ou código aqui.";

/** O motivo humano do pedido de tela, ou null se a frase não é um `computador_pedir_ajuda`. */
export function motivoDoPedidoDeTela(frase: string): string | null {
  if (!frase.startsWith(PREFIXO_PEDIDO_DE_TELA)) return null;
  const sufixo = [SUFIXO_PEDIDO_DE_TELA, SUFIXO_PEDIDO_DE_TELA_ANTIGO].find((s) => frase.endsWith(s));
  return sufixo === undefined ? null : frase.slice(PREFIXO_PEDIDO_DE_TELA.length, frase.length - sufixo.length);
}

/**
 * definido em 2026-10-22 (NOD-97, parte 3): em Assistindo, o primeiro clique ou tecla na tela assume o controle e NÃO
 * chega ao site. Estas teclas não assumem: Tab e Shift+Tab (sair da tela pelo teclado), Esc (fechar) e as
 * modificadoras sozinhas. A roda do mouse também não assume.
 */
const TECLAS_QUE_NAO_ASSUMEM = new Set(["Tab", "Escape", "Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn", "OS"]);
/** Atalhos do navegador (Ctrl/Cmd+tecla, F1 a F12) também não assumem: continuam sendo do navegador da pessoa. */
export function teclaAssume(e: { key: string; ctrlKey?: boolean; metaKey?: boolean }): boolean {
  if (e.ctrlKey || e.metaKey || /^F([1-9]|1[0-2])$/.test(e.key)) return false;
  return !TECLAS_QUE_NAO_ASSUMEM.has(e.key);
}

/** A espera antes da tentativa `n` (0, 1, …) de assumir de novo: 0,5 s, 1 s, 2 s e daí 4 s. */
export function esperaParaAssumir(tentativa: number): number {
  return Math.min(4000, 500 * 2 ** Math.max(0, tentativa));
}

/**
 * O assumir que falhou espera e tenta de novo (a pílula fica em "Assumindo…", sem erro vermelho) quando a falha passa
 * sozinha: o computador ocupado com a ação do bot (`estado_invalido`), sem rede (status 0) ou o servidor fora (5xx).
 */
export function falhaQuePassaAoAssumir(e: unknown): boolean {
  const { status, codigo } = (typeof e === "object" && e !== null ? e : {}) as { status?: unknown; codigo?: unknown };
  if (codigo === "estado_invalido" || codigo === "servidor_indisponivel") return true;
  return typeof status === "number" && (status === 0 || status >= 500);
}

/** De onde veio o assumir da tela: o gesto na imagem (`clique`) ou a pílula e o Abrir do cartão (`botao`). */
export type OrigemDoAssumir = "clique" | "botao";

/**
 * O portão do clique que assume (NOD-97), sem DOM, para o teste. Cada método devolve `true` quando o evento foi
 * CONSUMIDO e não vira ação no site: o gesto que assumiu (o mousedown e o mouseup dele), e tudo que chega durante o
 * "Assumindo…". `botao` assume sem gesto a engolir. `concluiu` fecha o "Assumindo…" (deu certo ou desistiu).
 */
export function criarCliqueQueAssume(o: { assistindo(): boolean; assumir(origem: OrigemDoAssumir): void }) {
  let assumindo = false;
  let engolirSoltar = false;
  return {
    assumindo: () => assumindo,
    apertar(): boolean {
      if (assumindo) { engolirSoltar = true; return true; }
      // O gesto que assumiu pode ter soltado fora da imagem: o mouseup dele não veio, e este gesto é outro.
      if (!o.assistindo()) { engolirSoltar = false; return false; }
      assumindo = true;
      engolirSoltar = true;
      o.assumir("clique");
      return true;
    },
    soltar(): boolean {
      if (engolirSoltar) { engolirSoltar = false; return true; }
      return assumindo;
    },
    tecla(e: { key: string; ctrlKey?: boolean; metaKey?: boolean }): boolean {
      if (!teclaAssume(e)) return false;
      if (assumindo) return true;
      if (!o.assistindo()) return false;
      assumindo = true;
      o.assumir("clique");
      return true;
    },
    botao(): boolean {
      if (assumindo || !o.assistindo()) return false;
      assumindo = true;
      o.assumir("botao");
      return true;
    },
    rolar(): boolean {
      return assumindo;
    },
    concluiu(): void {
      assumindo = false;
    },
  };
}

/** O texto da pílula da tela, nos 3 estados (NOD-97). */
export type FaseDaPilula = "assistindo" | "assumindo" | "controle";
export const TEXTO_DA_PILULA: Readonly<Record<FaseDaPilula, string>> = { assistindo: "Assistindo", assumindo: "Assumindo…", controle: "Você está no controle" };
export const AVISO_CLIQUE_SO_ASSUMIU = "Seu clique só assumiu; os próximos chegam ao site.";

/**
 * A pílula sobre a tela (NOD-97, protótipo v1.1): "Assistindo · Clique para assumir" → "Assumindo…" → "Você está no
 * controle · Parar". A dica de assumir mora no mesmo vidro: aparece no hover; no toque (pointer: coarse) fica fixa e
 * diz "Toque para assumir". O botão continua sendo "Assumir o controle" para o leitor de tela.
 * "Parar" DEVOLVE ao bot (data-c="devolver"); não desliga o computador (o `parar` da toolbar do Modo dev).
 */
export function htmlPilula(nome: string, fase: FaseDaPilula, oculta = false): string {
  const acao = fase === "assistindo"
    ? `<span class="computador-pilula-sep" aria-hidden="true">·</span><button type="button" class="computador-pilula-bt computador-pilula-dica" data-c="assumir" aria-label="Assumir o controle"><span class="dica-clique">Clique para assumir</span><span class="dica-toque">Toque para assumir</span></button>`
    : fase === "controle"
    ? `<span class="computador-pilula-sep" aria-hidden="true">·</span><button type="button" class="computador-pilula-bt" data-c="devolver" aria-label="Parar e devolver a tela ao ${esc(nome)}">Parar</button>`
    : "";
  return `<div class="computador-pilula" data-fase="${fase}" role="group" aria-label="Controle da tela de ${esc(nome)}"${oculta ? " hidden" : ""}><span class="computador-pilula-ponto" aria-hidden="true"></span><span class="computador-pilula-est">${TEXTO_DA_PILULA[fase]}</span>${acao}</div>`;
}

/**
 * NOD-97: o que fechar a tela faz com o controle. No controle e sem pedido de ajuda, devolve ao bot; com o pedido de
 * ajuda aberto, não devolve e o cartão espera a pessoa (Abrir e Terminei). Sem controle, nada.
 */
export function aoFecharATela(controla: boolean, ajudaDecisaoId: string | null): "devolver" | "esperar" | "nada" {
  if (!controla) return "nada";
  return ajudaDecisaoId === null ? "devolver" : "esperar";
}

/**
 * O rótulo do ✕ e a dica do topo (protótipo v1.1). No controle, fechar devolve; com o pedido de ajuda aberto, fechar
 * não devolve, e o ✕ diz isso em vez de prometer devolver.
 */
export function rotuloDoFechar(nome: string, controla: boolean, ajudaDecisaoId: string | null, celular = ehCelular()): { rotulo: string; dica: string | null } {
  const efeito = aoFecharATela(controla, ajudaDecisaoId);
  // NOD-383: no celular não há Esc.
  if (efeito === "devolver") return { rotulo: `Fechar e devolver ao ${nome}${celular ? "" : " (Esc)"}`, dica: `Fechar devolve ao ${nome}` };
  if (efeito === "esperar") return { rotulo: "Fechar (o pedido continua aberto)", dica: celular ? "Fechar não encerra o pedido" : "Esc fecha; o pedido continua aberto" };
  return { rotulo: "Fechar computador", dica: null };
}

/**
 * NOD-97: com pedido de ajuda aberto, fechar a tela no controle NÃO devolve; o cartão da conversa passa a dizer que o
 * bot espera, com Abrir e Terminei. Vale enquanto a página está aberta (o estado do servidor segue o mesmo).
 */
// A marca é do PEDIDO (decisão da ajuda), não do bot: resolvido o pedido por outro caminho, o próximo cartão do mesmo
// bot nasce limpo. Guarda o bot de cada pedido para Abrir/Terminei limparem sem saber a decisão.
const telasFechadasNaAjuda = new Map<string, string>();
/** Marca o pedido `decisaoId` do bot como "a pessoa fechou a tela"; com `null`, limpa as marcas do bot. */
export function marcarTelaFechadaNaAjuda(agenteId: string, decisaoId: string | null): void {
  for (const [d, a] of telasFechadasNaAjuda) if (a === agenteId) telasFechadasNaAjuda.delete(d);
  if (decisaoId !== null) telasFechadasNaAjuda.set(decisaoId, agenteId);
}
export function telaFechadaNaAjuda(decisaoId: string): boolean {
  return telasFechadasNaAjuda.has(decisaoId);
}

/**
 * definido em 2026-10-16: a pessoa vê a tela. Ligar, desligar, terminal, arquivos, política e a
 * atividade ficam na classe `computador-dev-only` e só aparecem com o Modo dev (`.computador-dev`).
 * Mora aqui, sem DOM, para o teste do servidor não puxar o diálogo.
 */
export function htmlDialogoComputador(nome: string): string {
  return `<header class="computador-header"><div><span class="computador-kicker computador-dev-only">COMPUTADOR DO BOT</span><h2>${esc(nome)}</h2><p class="computador-sub computador-dev-only">Privado de ${esc(nome)} · separado do seu Mac e dos outros bots</p></div><span class="computador-dev-selo computador-dev-only">Modo dev</span><span class="computador-status" role="status">Conectando…</span><span class="computador-fechar-dica" hidden>Fechar devolve ao ${esc(nome)}</span><button type="button" class="computador-fechar" data-c="fechar" aria-label="Fechar computador" title="Fechar computador">✕</button></header>
    <div class="computador-toolbar computador-dev-only"><button data-c="iniciar">Ligar computador</button><button data-c="assumir">Assumir controle</button><button data-c="devolver">Devolver ao bot</button><button data-c="parar">Desligar</button><button data-c="atualizar">Atualizar tela</button><label>Bot pode agir<select aria-label="Permissão do bot"><option value="supervisionado">Com aprovação por ação</option><option value="autonomo">Nas tarefas que eu pedir</option></select></label></div>
    <p class="computador-ajuda computador-dev-only" role="status">Seu navegador, logins e arquivos ficam neste computador.</p><p class="computador-erro" role="alert"></p>
    <div class="computador-layout"><section class="computador-desktop"><form class="computador-url computador-dev-only"><label class="sr-only" for="computador-url">Endereço do navegador</label><input id="computador-url" name="url" placeholder="https://…" autocomplete="off" /><button>Abrir</button></form>
      <div class="computador-abas computador-dev-only"></div><div class="computador-viewport"><div class="computador-vazio">Abrindo a tela de ${esc(nome)}.<small>O desktop está ligando.</small></div><div class="computador-fora" role="status" hidden></div><img hidden alt="Tela do computador do bot" tabindex="0" draggable="false" /><p class="computador-assumiu" role="status" aria-live="polite"></p>${htmlPilula(nome, "assistindo", true)}<div class="computador-browser-dialog" hidden><p></p><input aria-label="Resposta ao diálogo do navegador" /><button data-c="aceitar-dialogo">Confirmar</button><button data-c="recusar-dialogo">Cancelar</button></div></div>
      <div class="computador-input computador-dev-only"><form class="computador-texto"><input type="password" autocomplete="off" aria-label="Texto para digitar no computador" placeholder="Cole texto ou senha aqui para digitar na tela" /><button>Digitar</button></form><button data-c="enter">Enter</button><button data-c="tab">Tab</button><button data-c="esc">Esc</button><button data-c="audio">Ouvir 5 s</button></div><audio controls hidden></audio><p class="computador-dica computador-dev-only">Assuma o controle para clicar e digitar. Clique na tela para usar o teclado. Senhas são enviadas diretamente ao computador.</p>
    </section><aside class="computador-lateral computador-dev-only"><details open><summary>Arquivos</summary><p>Arquivos e downloads em /workspace</p><form class="computador-pasta"><input aria-label="Pasta" value="." /><button>Ver</button></form><label class="computador-upload">Enviar arquivo<input type="file" /></label><div class="computador-arquivos"></div></details>
      <details><summary>Terminal</summary><form class="computador-terminal"><textarea aria-label="Comando no computador" placeholder="python3 --version" rows="3"></textarea><button>Executar</button></form><pre class="computador-saida"></pre></details>
      <details open><summary>Atividade recente</summary><ol class="computador-atividade"></ol></details></aside></div>`;
}

/** O cartão da conversa: o bot entregou a tela e a pessoa entra sem mandar senha no chat. */
export function htmlCartaoTela(motivo: string, agenteId: string, aberta: boolean, nome = "O bot", decisaoId = ""): string {
  // NOD-97 (protótipo v1.1): a pessoa fechou a tela no meio do pedido; Abrir volta já no controle, Terminei devolve.
  const fechou = aberta && agenteId !== "" && decisaoId !== "" && telaFechadaNaAjuda(decisaoId);
  const acao = fechou
    ? `<p class="mc-sub">Você fechou a tela; ${esc(nome)} espera você terminar.</p><div class="mcf-acoes">${botao("abrir-computador", "Abrir", { classe: "pri sm", id: agenteId, dados: { assumir: "1" } })}${botao("terminei-computador", "Terminei", { classe: "link sm", id: agenteId })}</div>`
    : aberta && agenteId
    ? `<div class="mcf-acoes">${botao("abrir-computador", "Abrir computador", { classe: "pri sm", id: agenteId, dados: { assumir: "1" } })}</div>`
    : `<p class="mudo sm">A tela voltou para o bot.</p>`;
  return `<div class="msg-computador" role="status"><div class="mc-cab"><b>Computador</b><span class="tag ${aberta ? "tag-ok" : "tag-cinza"}">${fechou ? "aguardando você" : aberta ? "precisa de você" : "devolvida"}</span></div><p>${esc(motivo)}</p>${acao}</div>`;
}

/**
 * definido em 2026-09-24 (emenda da ADR-037): a falha do computador do bot em palavras. Mesmos textos
 * de src/domain/computador.ts (MOTIVO_FALHA_EM_PORTUGUES) — o teste unitário compara as duas tabelas.
 */
export const MOTIVO_FALHA_TEXTO: Readonly<Record<MotivoFalhaComputador, string>> = {
  docker_indisponivel: "o Docker do servidor não está respondendo",
  imagem_ausente: "a imagem do computador não foi preparada no servidor",
  nao_iniciou: "o computador não conseguiu ligar",
  cofre_invalido: "o cofre de logins do computador não abriu",
  navegador_nao_abriu: "o navegador do computador não abriu",
  sem_resposta: "o computador parou de responder",
  acao_falhou: "a ação falhou dentro do computador",
  tela_alterada: "a tela mudou desde a última observação",
  ocupado: "outra ação estava em andamento",
  limite_de_computadores: "este Mac já tem o máximo de computadores ligados",
  maquina_sem_contato: "a máquina do computador não está respondendo",
  faltam_pacotes: "faltam pacotes do computador na máquina",
  sem_suporte: "a máquina não consegue rodar o computador",
  nao_ficou_pronto: "o computador ligou mas não ficou pronto a tempo",
  atualizando: "o computador está sendo atualizado",
  app_desatualizado: "o app do nod precisa ser atualizado para usar o computador",
};

/**
 * definido em 2026-10-05 (NOD-170): o cartão do teto de computadores ligados. Mesmo texto de textoDoLimite
 * (src/domain/computador.ts), sem a parte que fala com o bot — o teste unitário compara as duas.
 */
export function textoDoLimite(l: { maximo: number; ociosoMin: number }): string {
  const ocioso = l.ociosoMin > 0 ? ` Os computadores sem uso há ${l.ociosoMin} min desligam sozinhos.` : "";
  return `Este Mac já tem ${l.maximo} computadores ligados, o limite. Nada foi executado.${ocioso}`;
}

/** O cartão do limite enquanto o computador segue desligado e a última tentativa bateu no teto do host. */
export function mensagemDoLimite(d: Pick<ComputadorDto, "ativo" | "atividade" | "limite">): string | null {
  const ultima = d.atividade[0];
  if (d.ativo || ultima?.estado !== "falhou" || ultima.motivo !== "limite_de_computadores") return null;
  return d.limite ? textoDoLimite(d.limite) : "Este Mac já tem o máximo de computadores ligados. Nada foi executado.";
}

/** "O navegador do computador não abriu" — o título do cartão de fora do ar. */
export function tituloDaFalha(motivo: MotivoFalhaComputador): string {
  const texto = MOTIVO_FALHA_TEXTO[motivo];
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** O que cada registro de atividade foi, em palavras (o tipo cru "ler_texto" não dizia nada). */
const ROTULO_ATIVIDADE: Readonly<Record<string, string>> = {
  observar: "Observar a tela",
  navegar: "Abrir endereço",
  clicar: "Clicar",
  arrastar: "Arrastar",
  digitar: "Digitar",
  tecla: "Pressionar tecla",
  rolar: "Rolar a tela",
  abas: "Trocar de aba",
  dialogo: "Responder diálogo",
  audio: "Ouvir o áudio",
  arquivos: "Ver arquivos",
  ler_arquivo: "Baixar arquivo",
  ler_texto: "Ler texto",
  gravar_texto: "Salvar texto",
  gravar_arquivo: "Salvar arquivo",
  anexar: "Anexar arquivo",
  terminal: "Terminal",
  pedir_ajuda: "Pedir sua ajuda",
  iniciar: "Ligar",
  parar: "Desligar",
  assumir: "Assumir controle",
  devolver: "Devolver ao bot",
  supervisionado: "Pedir aprovação por ação",
  autonomo: "Agir nas tarefas pedidas",
};

const ROTULO_ESTADO: Readonly<Record<RegistroComputador["estado"], string>> = {
  pendente: "aguardando aprovação",
  executando: "em andamento",
  concluida: "concluída",
  falhou: "falhou",
  recusada: "recusada",
};

export function rotuloDaAtividade(tipo: string): string {
  return ROTULO_ATIVIDADE[tipo] ?? tipo.replaceAll("_", " ");
}

export function rotuloDoEstado(estado: RegistroComputador["estado"]): string {
  return ROTULO_ESTADO[estado] ?? estado;
}

/** Uma linha da atividade: registros SEGUIDOS iguais viram um só, com ×N e o intervalo. */
export type LinhaAtividade = { autor: RegistroComputador["autor"]; tipo: string; estado: RegistroComputador["estado"]; motivo: MotivoFalhaComputador | null; n: number; de: number; ate: number };

/**
 * "Observar a tela · falhou ×7" em vez de sete linhas iguais (a Nina tinha a lista cheia da mesma
 * falha). Agrupa só os VIZINHOS com o mesmo autor, tipo, estado e motivo — a ordem conta a história.
 * A lista chega do mais novo para o mais antigo; `de` é o mais antigo do grupo, `ate` o mais novo.
 */
export function agruparAtividade(atividade: readonly RegistroComputador[]): LinhaAtividade[] {
  const linhas: LinhaAtividade[] = [];
  for (const a of atividade) {
    const ultima = linhas.at(-1);
    if (ultima && ultima.autor === a.autor && ultima.tipo === a.tipo && ultima.estado === a.estado && ultima.motivo === a.motivo) {
      ultima.n += 1;
      ultima.de = Math.min(ultima.de, a.em);
      ultima.ate = Math.max(ultima.ate, a.em);
      continue;
    }
    linhas.push({ autor: a.autor, tipo: a.tipo, estado: a.estado, motivo: a.motivo, n: 1, de: a.em, ate: a.em });
  }
  return linhas;
}

/** Fora do ar: a saúde do servidor manda, esteja o container de pé ou não. */
export function foraDoAr(dto: Pick<ComputadorDto, "computador">): boolean {
  return dto.computador.indisponivelDesde !== null;
}

/** O estado do computador em palavras, para o selo do cabeçalho do diálogo. */
export function estadoEmPalavras(dto: ComputadorDto, agora: number, configuracao: string | null): string {
  const c = dto.computador;
  if (configuracao === "iniciar") return foraDoAr(dto) ? "Tentando de novo…" : "Ligando computador…";
  if (configuracao === "parar") return "Desligando…";
  if (foraDoAr(dto)) return "Fora do ar";
  if (!dto.disponivel) return "Ambiente indisponível";
  if (!dto.ativo) return "Desligado";
  if (c.controle === "pessoa") return "Você está no controle";
  if (c.controle === "aguardando_pessoa") return "Precisa de você";
  return c.ocupadoAte && c.ocupadoAte > agora ? "Bot trabalhando" : "Pronto para o bot";
}

/**
 * ADR-125 (NOD-349): o estado da aba Computador da gaveta. Sem linha em `computadores` = o bot nunca teve computador;
 * fora do ar manda (saúde do servidor); desligado = dormindo (acorda sozinho quando o bot precisar); `ocupadoAte` no
 * futuro = ligado e usando a tela agora.
 */
export function estadoDoComputador(dto: Pick<ComputadorDto, "computador" | "ativo"> & Partial<Pick<ComputadorDto, "disponivel">>, agora: number): "ligado" | "ocupado" | "dormindo" | "sem" | "fora" | "indisponivel" {
  if (foraDoAr(dto)) return "fora";
  // Revisão da NOD-349: com o ambiente fora, Acordar falharia; a aba diz que o ambiente está indisponível.
  if (dto.disponivel === false) return "indisponivel";
  if (dto.computador.id === null) return "sem";
  if (!dto.ativo) return "dormindo";
  return (dto.computador.ocupadoAte ?? 0) > agora ? "ocupado" : "ligado";
}

/**
 * NOD-97 PR 5 (plano v1.1): quando o Chrome preenche a senha salva, a linha cinza do chat diz "Entrou de novo com a
 * senha salva" com o selo do cadeado "‹bot› não vê a senha". O selo é só aviso: a senha nunca chega à web.
 */
export const TEXTO_SENHA_SALVA = "Entrou de novo com a senha salva";
const CADEADO = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
export function htmlSeloSigilo(nome: string): string {
  return `<i class="at-sigilo">${CADEADO}${esc(nome)} não vê a senha</i>`;
}
export function htmlLinhaSenhaSalva(nome: string): string {
  return `<div class="msg-sistema msg-senha-salva" role="status">${TEXTO_SENHA_SALVA} ${htmlSeloSigilo(nome)}</div>`;
}
