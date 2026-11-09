import type { EpochMs } from "./ids.ts";
import type { CausaSemIa } from "./inventario.ts";

/**
 * O estado ÚNICO de cada IA do Mac (definido em 2026-10-09, plano "IAs: conexão, troca e escolha de modelo", PR 1).
 * Uma palavra por IA, que vale igual para o onboarding, para Provedores de IA e para o chat: a tela escolhe o texto e o
 * botão olhando só para ela. Só tipos e `as const` (EMENDA 26): a web importa com `import type`, e quem monta o estado
 * é src/domain/estado-ia.ts (o app do Mac junta a sonda, a instalação, o login e o teste).
 *
 *  - procurando: o Mac ainda não terminou a primeira sonda;
 *  - nao_instalada: o CLI não está neste Mac;
 *  - instalando: o app está instalando o CLI (`instalacao` traz a última linha do progresso);
 *  - desatualizada: o CLI está abaixo do piso testado (`versao` e `minima`);
 *  - sem_node: o CLI é um script de Node e não há Node neste Mac;
 *  - falta_entrar: instalado, sem login;
 *  - entrando: o login está aberto no app (`login` traz o link e o código);
 *  - testando: o teste de verdade (um turno de uma frase) está rodando;
 *  - pronta: logada e sem veredito contra;
 *  - sem_acesso: logada, mas a conta não respondeu ao teste (`causa`: conta_sem_acesso ou teste_falhou);
 *  - no_limite: a assinatura chegou ao limite até `ate` (o Mac ainda não sabe disso; vem com o PR do servidor);
 *  - config_invalida: o CLI recusou a configuração da pessoa (separado de falta_entrar: entrar não resolve);
 *  - lenta: a sonda estourou o prazo (Mac carregado); o app tenta de novo sozinho;
 *  - atualizando (NOD-9, definido em 2026-10-23): o nod está atualizando o CLI; instalado, nunca "Instalar".
 */
export const ESTADOS_IA = ["procurando", "nao_instalada", "instalando", "desatualizada", "sem_node", "falta_entrar", "entrando", "testando", "pronta", "sem_acesso", "no_limite", "config_invalida", "lenta", "atualizando"] as const;
export type EstadoDaIa = (typeof ESTADOS_IA)[number];

/** De onde veio o binário que o nod usa (o "detalhe" do suporte): configurado (NOD_*_BIN) ou a camada do PATH aumentado. */
export const ORIGENS_BINARIO = ["configurado", "nod", "processo", "extra", "nvm", "shell", "node_do_nod", "path"] as const;
export type OrigemDoBinario = (typeof ORIGENS_BINARIO)[number];

/** O login dentro do app: fases, na ordem em que acontecem. Só "aguardando" está em curso. */
export const FASES_LOGIN_IA = ["aguardando", "sucesso", "falhou", "expirou", "cancelado"] as const;
export type FaseLoginIa = (typeof FASES_LOGIN_IA)[number];

/**
 * Por que o login não terminou (código fechado; a frase vem em `mensagem`, escrita pelo app, nunca o texto do CLI):
 *  - nao_instalada: o CLI não foi achado;
 *  - sem_link: o CLI não mostrou o link a tempo (rede, CLI travado);
 *  - link_nao_oficial: o CLI mostrou um endereço fora da lista oficial (desktop/login-ia.ts) — o app não mostra nem abre;
 *  - codigo_invalido: a página do Claude não aceitou o código colado;
 *  - login_por_codigo_bloqueado: a organização desligou o login por código de dispositivo no ChatGPT;
 *  - cli_antigo: o CLI não conhece o login por código (atualize);
 *  - config_invalida: o CLI não abriu por causa da configuração da pessoa;
 *  - nao_confirmou: o código foi enviado e o CLI não terminou;
 *  - falhou: outro motivo (o detalhe fica só no log do Mac).
 */
export const CAUSAS_FALHA_LOGIN = ["nao_instalada", "sem_link", "link_nao_oficial", "codigo_invalido", "login_por_codigo_bloqueado", "cli_antigo", "config_invalida", "nao_confirmou", "falhou"] as const;
export type CausaFalhaLogin = (typeof CAUSAS_FALHA_LOGIN)[number];

export type LoginDaIa = {
  fase: FaseLoginIa;
  /**
   * O host do endereço oficial onde a pessoa entra ("auth.openai.com", "claude.com"); null até o CLI imprimir. Só o
   * host vai à página (revisão do PR 1): a URL inteira leva o `state` do OAuth e fica no processo principal, que a abre
   * pelo `abrirLink`.
   */
  host: string | null;
  /** Codex: o código de uso único que a pessoa digita na página da OpenAI (formato medido: "NP6Z-V3598"). */
  codigoDoDispositivo: string | null;
  /** Claude: a página da Anthropic pode mostrar um código para colar no app (colarCodigo). */
  pedeCodigo: boolean;
  codigoEnviado: boolean;
  /** Quando o link/código deixa de valer (o Codex diz "expires in 15 minutes"). */
  expiraEm: EpochMs | null;
  /** Os 2 min de conferência passaram sem o login terminar: a tela oferece "Verificar de novo". */
  verificarDeNovo: boolean;
  causa?: CausaFalhaLogin;
  /** Frase pronta para a tela. */
  mensagem: string;
};

/**
 * Por que a instalação não terminou: sem_internet, sem_espaco e sem_permissao vêm do código de erro do npm;
 * pacote_indisponivel (o registro não tem o pacote/versão); sem_npm (o app não achou o npm que leva consigo nem um
 * Node no Mac); verificacao_falhou (instalou, mas o binário não respondeu ao `--version` ou ficou abaixo do piso);
 * falhou (outro motivo — o stderr cru fica só no registro da instalação).
 */
export const CAUSAS_FALHA_INSTALACAO = ["sem_internet", "sem_espaco", "sem_permissao", "pacote_indisponivel", "sem_npm", "verificacao_falhou", "falhou"] as const;
export type CausaFalhaInstalacao = (typeof CAUSAS_FALHA_INSTALACAO)[number];

export type InstalacaoDaIa = {
  fase: "instalando" | "sucesso" | "falhou" | "cancelado";
  /** A última linha da saída do npm, sem cor, até 160 caracteres. */
  linha: string | null;
  /** 1 na primeira; só sobe numa falha passageira de rede. */
  tentativa: number;
  causa?: CausaFalhaInstalacao;
  mensagem: string;
  /** A versão que respondeu ao `--version` depois de instalar. */
  versao?: string;
  /** O nome do arquivo de registro desta instalação (em ~/Library/Logs/nod), para o suporte. */
  registro?: string;
};

/**
 * A atualização do CLI pelo nod (definido em 2026-10-22, NOD-9, planos do Arquiteto de 20/10 e 22/10). Uma fase por IA,
 * a mesma no app do Mac (EstadoIa.atualizacao) e no anúncio da máquina (Inventario.atualizacao), para a web mostrar a
 * VM e o Mac visto de outro aparelho pelo mesmo render.
 *  - esperando: há turno daquele provedor (ou ligação aberta); roda na brecha;
 *  - aviso: 1 h antes de segurar os pedidos novos (E0);
 *  - segurando: 24 h sem brecha; os pedidos novos daquele provedor esperam na fila (E1);
 *  - atualizando: o atualizador está rodando (E2);
 *  - pedindo_aprovacao: a janela de senha do macOS está aberta (só a partir de um clique, nunca no automático);
 *  - sucesso / falhou / insuficiente: o fim (insuficiente = subiu, mas ainda abaixo do alvo).
 */
export const FASES_ATUALIZACAO = ["esperando", "aviso", "segurando", "atualizando", "pedindo_aprovacao", "sucesso", "falhou", "insuficiente"] as const;
export type FaseAtualizacao = (typeof FASES_ATUALIZACAO)[number];

/**
 * Por que a atualização não chegou ao alvo (código fechado; a frase é da tela, nunca a saída do CLI):
 *  - configurado: o binário é o de NOD_*_BIN; o nod não mexe nele;
 *  - nao_suportado: o CLI não tem atualizador conhecido (hoje o Codex, até a NOD-8);
 *  - sem_permissao: o atualizador falhou por permissão (EACCES/EPERM, "isn't writable");
 *  - recusou: a pessoa cancelou a janela de senha do macOS (osascript saiu com -128); nada tenta de novo sozinho;
 *  - falhou: outro motivo (o detalhe fica só no log);
 *  - tempo_esgotado: passou do prazo;
 *  - insuficiente: subiu, mas ainda abaixo do alvo;
 *  - versao_ilegivel: o `--version` depois de atualizar não disse a versão;
 *  - sem_espaco / sem_internet (pedido aditivo da NOD-8, revisão de 22/10): o disco ou a rede impediram (com `espaco`).
 */
export const MOTIVOS_ATUALIZACAO = ["configurado", "nao_suportado", "sem_permissao", "recusou", "falhou", "tempo_esgotado", "insuficiente", "versao_ilegivel", "sem_espaco", "sem_internet"] as const;
export type MotivoAtualizacao = (typeof MOTIVOS_ATUALIZACAO)[number];

/**
 * O último passo tentado (só para log e UAT): o atualizador oficial, a reserva pelo instalador do nod (ADR-093), a
 * aprovação do macOS (janela de senha) ou o npm do motor no `~/.local` da VM.
 */
export const CAMINHOS_ATUALIZACAO = ["oficial", "reserva", "aprovacao", "npm_local"] as const;
export type CaminhoAtualizacao = (typeof CAMINHOS_ATUALIZACAO)[number];

export type AtualizacaoDaIa = {
  fase: FaseAtualizacao;
  /** A versão antes de atualizar e a lida depois (x.y.z[-pre]). */
  antes?: string;
  depois?: string;
  /** A versão-alvo: a maior entre o piso (PISO_CLI) e a mínima do modelo pedido. */
  alvo: string;
  motivo?: MotivoAtualizacao;
  caminho?: CaminhoAtualizacao;
  /** Quando a fase começou. */
  em: EpochMs;
  /** aviso: quando os pedidos novos passam a esperar (E0 → E1). */
  seguraEm?: EpochMs;
  /** sem_espaco: o espaço livre e o que a instalação precisa, em MB (NOD-8, J4: "tem 1,2 GB livres e precisa de 2 GB"). */
  espaco?: { livreMb: number; precisaMb: number };
};

/**
 * QUAL conta está logada na IA (definido em 2026-10-12, NOD-209), como o próprio CLI diz: o `claude auth status` e o
 * `account/read` do `codex app-server` (nunca o arquivo de credencial). ADR-019: nunca serve para autorização nem vai ao
 * log ou ao inventário. Desde 2026-10-15 (ADR-105) o e-mail e a organização vão ao servidor só pelo anúncio das contas.
 */
export type ContaDaIa = {
  email: string;
  /** A organização (o Claude diz "Gamefik"; o ChatGPT não diz). */
  organizacao: string | null;
  /** O plano já legível ("Team", "Pro", "Max", "Plus"). */
  plano: string | null;
};

export type EstadoIa = {
  ia: "claude-cli" | "codex-cli";
  estado: EstadoDaIa;
  /** Frase curta, pronta para a tela. */
  mensagem: string;
  versao?: string;
  /** desatualizada: a versão mínima. */
  minima?: string;
  /** sem_acesso: o que o teste disse. */
  causa?: CausaSemIa;
  /** no_limite: até quando. */
  ate?: EpochMs;
  /** Qual binário o nod usa e de onde ele veio (o caminho com ~ no lugar da pasta pessoal). */
  detalhe?: { binario: string; origem: OrigemDoBinario };
  /** A instalação feita pelo app (a em curso ou a última). */
  instalacao?: InstalacaoDaIa;
  /** O login aberto pelo app (o em curso ou o último). */
  login?: LoginDaIa;
  /** A conta logada, quando o CLI disse qual é (só no app do Mac; ver ContaDaIa). */
  conta?: ContaDaIa;
  /** A atualização do CLI pelo nod (a em curso ou a última; NOD-9). */
  atualizacao?: AtualizacaoDaIa;
  em: EpochMs;
};

/** O resultado de colar o código do Claude: o código só vai ao CLI se tiver a forma de um código. */
export type ResultadoColarCodigo = { ok: true } | { ok: false; motivo: "codigo_invalido" | "sem_login_aberto" | "ja_enviado" | "nao_pede_codigo" };
