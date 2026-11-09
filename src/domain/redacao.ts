import type { MotivoFalha, MotivoInterrupcao } from "../contracts/motivos.ts";
import type { PlataformaMaquina } from "../contracts/ponte.ts";
import { ehMaquinaDoMotor } from "./plataforma-maquina.ts";

export type ChaveRedacao =
  | "capacidade-desligada"
  | "rotina-sem-resposta"
  | "agente-vazio"
  | "offset-numerico"
  | "proposta-recusada"
  | "agente-nasceu"
  | "sem-acessos-nunca-executou"
  | "turno-interrompido"
  | "turno-orfao-encerrado"
  | "turno-preso-sem-contato"
  | "parada-nada-rodando"
  | "memoria-nao-e-fonte"
  | "proposta-confirmada"
  | "rotina-proxima-execucao"
  | "rotina-webhook-ativa"
  | "rotina-passou-em-branco"
  | "rotina-falhou"
  | "rotina-parada-aberta"
  | "handoff"
  | "passe"
  | "consentimento"
  | "executor-indisponivel"
  | "anexo-nao-lido"
  | "ia-trocada"
  | "ia-trocada-limite"
  | "cota-no-limite-espera"
  | "cota-no-limite-segue"
  | "conta-no-limite-espera"
  | "cota-no-limite-espera-pedido"
  | "conta-no-limite-espera-pedido"
  | "cota-no-limite-espera-rotina"
  | "cota-no-limite-rotina-nao-rodou"
  | "pedido-a-colega-espera-cota"
  | "retorno-do-lote-caiu"
  | "fundo-espera-maquina"
  | "fundo-espera-servidor"
  | "fundo-nova-tentativa"
  | "fundo-desistiu"
  | "rotina-nao-rodou"
  | "fala-no-limite-espera"
  | "ia-pronta-noutra-maquina"
  | "conta-fora-da-maquina"
  | "rodando-desta-vez"
  | "tentando-de-novo"
  | "nota-ja-refeita"
  | "nota-turno-nao-interrompido"
  | "nota-conta-de-outra-ia"
  | "nota-conta-no-limite"
  | "nota-orcamento-da-sala"
  | "nota-bot-fora-da-sala"
  | "nota-maquina-sem-contato"
  | "negacao-terminal"
  | "decisao-vencida"
  | "retomada"
  | "retomada-automatica"
  | "frente-retomada-automatica"
  | "anotei"
  | "permissao-permanente"
  | "computador-fora-do-ar"
  | "computador-fora-do-ar-com-acao"
  | "computador-em-operacao"
  | "computador-tela-fechada"
  | "computador-senha-preenchida"
  | "rotina-pausada-sem-acesso";

/** Textos de sistema FIXOS em português; nunca vêm do modelo. `{chave}` é preenchido com params. */
const CATALOGO: Record<ChaveRedacao, string> = {
  "capacidade-desligada": "Não posso fazer isso: essa capacidade está desligada. Nada mais será tentado neste turno.",
  "rotina-sem-resposta": "A rotina não executou: ninguém respondeu o gate. Nada foi enviado.",
  "agente-vazio": "Este agente nasce sem nenhum acesso. O alcance será concedido por você, capacidade a capacidade.",
  "offset-numerico": "Não gravo fuso como offset. Use um nome IANA, por exemplo America/Sao_Paulo.",
  "proposta-recusada": "Deixei isso de lado. Nada foi agendado nem concedido.",
  "agente-nasceu": "Este agente nasce com identidade de execução vazia: sem nome definitivo, sem acessos, sem rotina. Diga o que ele faz.",
  "sem-acessos-nunca-executou": "sem acessos · nunca executou",
  "turno-interrompido": "Turno interrompido: {motivo}. O que já saiu fica marcado como parcial; nada foi reenviado.",
  // definido em 2026-10-13 (NOD-219): o pendente que nenhuma máquina podia pegar sai da fila com a causa em palavras.
  // NOD-314: o pendente preso 24 h a uma máquina sem contato. A linha leva o atalho "Rodar em <outra> desta vez" (payload turno_preso).
  "turno-preso-sem-contato": "Tirei este pedido da fila: {maquina} ficou sem contato por mais de 24 h. Nada foi feito com ele.",
  "turno-orfao-encerrado": "Tirei este pedido da fila: {causa}, e ele não ia mais sair. Nada foi feito com ele; se ainda precisar, peça de novo.",
  "parada-nada-rodando": "Nada estava rodando. Nenhum turno foi interrompido.",
  "permissao-permanente": "{pessoa} permitiu para sempre: {ferramentas}. Vale já, para qualquer destino destas ferramentas, enquanto o bot não tiver lido conteúdo de fora na tarefa.",
  "memoria-nao-e-fonte": "Memória do agente: não substitui fonte autoritativa. Se um dado importa, confira na origem.",
  "proposta-confirmada": "Confirmado por {pessoa}. A partir de agora vale: {resumo}.",
  // NOD-378 (27/10): o {resumo} (resumoCron) já termina em "({fuso})"; o molde repetia o fuso. O texto antigo, com
  // "({fuso})" no fim, continua casando com este molde no classificador (assunto-do-texto.ts), porque {proxima} o absorve.
  "rotina-proxima-execucao": "Rotina ativa: {resumo} · próxima execução: {proxima}.",
  // NOD-84: a rotina webhook não tem próxima; o endereço a pessoa copia na tela da rotina (o bot nunca o vê).
  "rotina-webhook-ativa": "Rotina ativa: {resumo}. Copie o endereço na tela de rotinas e cole no {provedor}.",
  "rotina-passou-em-branco": "A rotina passou em branco: {motivo}. Nada foi enviado.",
  "rotina-falhou": "A rotina falhou por erro técnico: {motivo}. Nada foi enviado; a próxima execução segue agendada.",
  // definido em 2026-10-15 (NOD-256, NOD-225): a parada segura a rotina, nunca em silêncio — a linha diz o que destrava.
  "rotina-parada-aberta": "A rotina não rodou: {bot} está parado por você. Fale com {bot} ou use Executar agora para retomar.",
  handoff: "{de} passou para {para}: {motivo}.",
  passe: "{agente} passou a vez ({motivo}).",
  // definido em 2026-09-24 (ADR-044): {escopo} é a lista `slug.capacidade` do lote; com uma só, o texto é o de antes.
  consentimento: "Concedido por {pessoa} em {quando}: {escopo}; não inclui: {naoInclui}.",
  "executor-indisponivel": "Nenhum trabalho começa: executor indisponível ({motivo}) desde {desde}.",
  // NOD-285 (revisão do Gil no #345): a IA está pronta e só não lê o arquivo; nada de "executor indisponível… desde".
  "anexo-nao-lido": "Nenhum trabalho começa: {motivo}.",
  // definido em 2026-10-05: o bot em automático repetiu o pedido na outra IA (assentar-turno.ts, aposContaSemAcesso).
  "ia-trocada": "Respondendo pelo {para}: a conta do {de} neste computador está sem acesso.",
  // definido em 2026-10-10 (emenda da ADR-036): o automático repetiu o pedido na próxima IA da ordem (aposLimite).
  "ia-trocada-limite": "O {de} chegou ao limite da assinatura · respondendo pelo {para}. Ele volta a ser usado {quando}.",
  // definido em 2026-10-12 (ADR-099 §7): a task bateu no limite e espera a cota renovar, em vez de falhar (aposLimiteNoFundo).
  "cota-no-limite-espera": "A cota do {ia} chegou ao limite. Esta task espera e volta sozinha {quando}, de onde parou.",
  // definido em 2026-10-12 (ADR-101, QA do NOD-211): a conta em uso parou, há outra livre, mas o modo é "Perguntar antes"
  // (nada troca sozinho) e a task não tem ninguém para perguntar: espera a conta voltar. Só a posição, nunca o apelido.
  // definido em 2026-10-16 (ADR-108 R4): a task SEM sessão na IA que parou segue na outra IA na hora (não há o que perder).
  "cota-no-limite-segue": "A cota do {ia} chegou ao limite. Esta task segue no {para}, de onde parou.",
  "conta-no-limite-espera": "A conta {de} do {ia} chegou ao limite. Esta task espera e volta sozinha {quando}, de onde parou.",
  // definido em 2026-10-15 (NOD-274, NOD-269): o mesmo, no trabalho de fundo sem task — rotina, pedido de colega,
  // retorno do lote e a frente sem task. "Esta task" não servia: a pessoa lia uma task que não existe.
  "cota-no-limite-espera-pedido": "A cota do {ia} chegou ao limite. Este pedido espera e volta sozinho {quando}, de onde parou.",
  "conta-no-limite-espera-pedido": "A conta {de} do {ia} chegou ao limite. Este pedido espera e volta sozinho {quando}, de onde parou.",
  "cota-no-limite-espera-rotina": "A cota do {ia} chegou ao limite. Esta execução da rotina espera e roda sozinha {quando}.",
  // NOD-274: a cota só volta depois da próxima janela; a execução fica 'nao_rodou' e a rotina segue a agenda.
  "cota-no-limite-rotina-nao-rodou": "A cota do {ia} chegou ao limite e só volta {quando}, depois da próxima execução: esta janela não rodou. A rotina segue a agenda.",
  // NOD-274: o colega que recebeu o pedido está sem cota; quem pediu lê a hora uma vez só, não um erro.
  "pedido-a-colega-espera-cota": "{agente} está sem cota do {ia}. Seu pedido espera e volta sozinho {quando}.",
  // definido em 2026-10-15 (NOD-258): o retorno do lote caiu de novo depois de refeito uma vez; os resumos não somem.
  "retorno-do-lote-caiu": "O retorno do lote caiu duas vezes e não foi refeito de novo. Os resumos ficaram em cada frente: {frentes}.",
  // definido em 2026-10-20 (NOD-309): o fundo espera por toda queda, com UM aviso por cadeia. {pedido} já com artigo
  // ("Este pedido", "Esta frente", "Esta execução da rotina"); {quando} = "às 14:30" (quandoDaFrase).
  "fundo-espera-maquina": "{maquina} está sem contato. {pedido} fica na fila e retoma quando o contato voltar, de onde parou.",
  // NOD-386: o lease venceu com a máquina em contato (o servidor não atendeu a renovação ou a entrega). Não cita a máquina:
  // ela estava de pé. {quando} = a volta com espera crescente ("às 14:30").
  "fundo-espera-servidor": "O servidor do nod não respondeu a tempo. {pedido} volta {quando}, de onde parou.",
  "fundo-nova-tentativa": "O serviço do {ia} está instável. {pedido} tenta de novo {quando}: tentativa {tentativa} de {maximo}.",
  "fundo-desistiu": "{pedido} caiu ({motivo}) e parou de tentar: {porque}. Peça de novo quando quiser.",
  // NOD-309: a janela que nenhuma queda pode rodar a tempo — uma linha por janela, na conversa da rotina e no histórico.
  "rotina-nao-rodou": "Não rodou · {motivo}, volta {quando}. A rotina segue a agenda.",
  // definido em 2026-10-15 (NOD-268): a fala da pessoa passou do teto de reenvios (ou todas as IAs da máquina do bot estão
  // no limite) e espera a hora do limite, com UMA linha, em vez de girar de IA em IA.
  "fala-no-limite-espera": "O {ia} está no limite da assinatura. Sua mensagem espera e volta sozinha {quando}.",
  // NOD-268: a outra IA existe, mas noutra máquina; o bot só roda na dele (ADR-090), então a troca não serve.
  "ia-pronta-noutra-maquina": "O {ia} está no limite da assinatura. O {outra} está pronto noutra máquina, mas este bot roda {maquina}. Sua mensagem volta sozinha {quando}.",
  // NOD-268: "Seguir com" numa conta que não está logada na máquina que pega o turno — refazer só daria outra nota.
  "conta-fora-da-maquina": "A conta {conta} não está {maquina}. Entre com ela lá ou escolha outra conta.",
  // NOD-280/NOD-284 (definido em 2026-10-15): os passos da nota de limite dizem o que fizeram — ou por que não refizeram.
  // QA do NOD-314: "em", sem artigo — o nome da máquina é livre ("VM nod", "Mac do Marlon").
  "rodando-desta-vez": "Rodando em {maquina} desta vez.",
  "tentando-de-novo": "Tentando de novo com {conta}.",
  "nota-ja-refeita": "Essa fala já foi refeita; nada foi repetido.",
  "nota-turno-nao-interrompido": "Essa fala não está parada no limite; nada foi repetido.",
  "nota-conta-de-outra-ia": "{conta} é de outra IA; este bot segue no {ia}. Escolha uma conta do {ia}.",
  "nota-conta-no-limite": "{conta} também está no limite. Escolha outra conta ou espere ela voltar.",
  "nota-orcamento-da-sala": "A sala esfriou: {agente} só fala de novo depois que uma pessoa falar na sala.",
  "nota-bot-fora-da-sala": "{agente} não está mais na sala; nada foi repetido.",
  "nota-maquina-sem-contato": "O {maquina} não responde agora; nada foi repetido. Escolha outra máquina ou espere ele voltar.",
  "negacao-terminal": "Negado (terminal): {nome} — {motivo}. Não tente outro caminho neste turno.",
  // definido em 2026-09-24: {desfecho} em palavras (varredor-expiracao.ts), nunca o enum com espaços no lugar de "_".
  "decisao-vencida": "Este pedido venceu em {quando} sem resposta — {desfecho}. Você pode reabrir.",
  retomada: "Retomando o turno interrompido ({motivo}) a partir de onde parou; nada foi reenviado.",
  // definido em 2026-10-08 (pedidos-parados.ts): o pedido de um colega caiu por infraestrutura e o servidor o retomou.
  "retomada-automatica": "Este pedido caiu ({motivo}) e foi retomado sozinho quando as máquinas voltaram: tentativa {tentativa} de {maximo}.",
  // definido em 2026-10-12 (ADR-099, I9): a frente de um lote caiu por infraestrutura e o servidor a retomou (frentes-caidas.ts).
  "frente-retomada-automatica": "A frente {titulo} caiu ({motivo}) e foi retomada sozinha quando as máquinas voltaram: tentativa {tentativa} de {maximo}.",
  // definido em 2026-10-03: {tipo} já com artigo e acento ("uma preferência"), nunca o enum cru (lembrar.ts).
  anotei: "Anotei {tipo}: {texto}",
  // definido em 2026-09-24 (emenda da ADR-037): o aviso ÚNICO da transição; a hora sai no cartão da web.
  "computador-fora-do-ar": "O computador de {agente} não responde: {motivo}. Tirei o computador das próximas execuções até você religá-lo.",
  // definido em 2026-10-22 (NOD-96 PR 5): no computador da pessoa, o aviso leva o caminho no painel ({acao} é o rótulo
  // do botão, "⚙ Atualizar o computador" ou "Tentar de novo"); e a operação dela fecha as telas com um aviso por chat.
  "computador-fora-do-ar-com-acao": "O computador de {agente} não responde: {motivo}. Para resolver, use \"{acao}\" no painel do computador.",
  "computador-em-operacao": "Fechei a tela de {agente} no computador: {operacao}. Quando terminar, {agente} tenta de novo sozinho.",
  // definido em 2026-10-22 (NOD-97, protótipo v1.1): a linha cinza quando a pessoa fecha a tela no controle.
  "computador-tela-fechada": "Você fechou a tela. {agente} voltou a usar o computador do bot.",
  // definido em 2026-10-24 (NOD-97 PR 5): o Chrome preencheu a senha salva numa tela; o bot não enxerga o valor.
  "computador-senha-preenchida": "Entrou de novo com a senha salva. {agente} não vê a senha.",
  // definido em 2026-09-24 (emenda da ADR-044): a linha ÚNICA quando o pedido de acesso da rotina vence —
  // no lugar do "este pedido venceu"; {prazo} é o da decisão ("24h"), {app} o nome que a pessoa lê.
  "rotina-pausada-sem-acesso": "Rotina pausada: ninguém liberou o acesso ao {app} em {prazo}. Reative quando quiser.",
};

/**
 * definido em 2026-09-18: a frase interpolava o código cru e a pessoa lia "erro_max_turns".
 * definido em 2026-10-05 (NOD-174): o mapa é TOTAL sobre os enums de contracts/motivos.ts — um motivo novo sem
 * tradução quebra o typecheck, em vez de aparecer cru na conversa ("Turno interrompido: erro_execucao.").
 */
const MOTIVO_EM_PORTUGUES: Readonly<Record<MotivoFalha | MotivoInterrupcao, string>> = {
  turno_travado: "o agente ficou sem responder",
  trabalho_incompleto: "o agente não chegou ao fim da tarefa",
  sem_progresso: "o agente não chegou a produzir nada",
  parado_pela_pessoa: "você pediu para parar",
  // definido em 2026-09-24 (ADR-045): "o computador" era lido como o computador DO BOT (ADR-037); quem
  // parou foi o Mac da pessoa, e as três causas comuns cabem na frase.
  maquina_sem_contato: "seu Mac parou de responder (repouso, sem rede ou nod fechado)",
  reinicio_servidor: "o servidor reiniciou",
  // ADR-131: o motor da máquina parou no meio (a atualização sozinha da VM, o restart, o app fechado).
  reinicio_do_motor: "o nod foi reiniciado na máquina",
  executor_indisponivel: "a inteligência não estava disponível",
  // Jornada C do onboarding (2026-11-07): "neste Mac" no Windows e no Linux era bug. A frase vale em qualquer sistema.
  lancamento_falhou: "a IA não conseguiu abrir neste computador",
  sessao_rejeitada: "a IA recusou a conversa antes de começar",
  absorvido: "a mensagem foi lida junto com a seguinte",
  // Revisão 3 do PR #544: também o turno de um pedido a colega que o prazo fechou (NOD-377), não só a rotina.
  vencido: "ficou na fila sem começar e o prazo passou",
  // NOD-293 A7: a pessoa revogou a chave da máquina com o turno rodando nela.
  maquina_removida: "a máquina foi removida; a frente parou",
  erro_max_turns: "o agente chegou ao limite de passos deste turno",
  erro_execucao: "a IA parou por um erro; tente de novo e, se repetir, relate o problema nesta mensagem",
  motor_ausente: "a IA não está instalada neste computador",
  nao_autenticado: "a conta da IA não está conectada neste computador",
  // NOD-171: sem a hora. O aviso do turno usa fraseDoLimiteDoPlano (erro-fornecedor.ts), que diz quando volta.
  limite_do_plano: "o plano da IA atingiu o limite de uso; espere o uso renovar e tente de novo",
  // NOD-269: nenhuma conta livre na máquina na hora do despacho; o trabalho de fundo espera sozinho.
  sem_conta: "todas as contas da IA neste computador estão no limite; o pedido espera a cota voltar",
};

/** Aceita string: o banco guarda motivos que saíram do enum. Motivo legado sem tradução sai como está, sem quebrar. */
export function motivoEmPortugues(motivo: string): string {
  return Object.hasOwn(MOTIVO_EM_PORTUGUES, motivo) ? MOTIVO_EM_PORTUGUES[motivo as keyof typeof MOTIVO_EM_PORTUGUES] : motivo;
}

/** A máquina de um turno caído, como a chave dela diz (maquina_tokens, 0067); null = sem chave (o Mac do modo local). */
export type MaquinaDaQueda = { nome: string; plataforma: PlataformaMaquina | null };

/** ADA-243 (jornada B): os motivos de IA ausente que diziam "neste Mac" mesmo no Windows (o caso de 05/11). */
const IA_AUSENTE_NA_MAQUINA: Partial<Record<MotivoFalha | MotivoInterrupcao, (nome: string) => string>> = {
  motor_ausente: (n) => `a IA não está instalada no ${n}; instale e entre na conta em Configurações › Computadores`,
  nao_autenticado: (n) => `a conta da IA não está conectada no ${n}; entre na conta em Configurações › Computadores`,
  lancamento_falhou: (n) => `a IA não conseguiu abrir no ${n}`,
};

/**
 * ADA-243: o motivo com a máquina em que o turno rodou. Windows e Linux (máquina do motor, ADR-147) são nomeados; o Mac,
 * a chave sem sistema e o modo local (sem chave) ficam com a frase de sempre.
 */
export function motivoDependeDaMaquina(motivo: string): boolean {
  return Object.hasOwn(IA_AUSENTE_NA_MAQUINA, motivo);
}

export function motivoNaMaquina(motivo: string, maquina: MaquinaDaQueda | null): string {
  const f = Object.hasOwn(IA_AUSENTE_NA_MAQUINA, motivo) ? IA_AUSENTE_NA_MAQUINA[motivo as keyof typeof IA_AUSENTE_NA_MAQUINA] : undefined;
  return f && maquina && ehMaquinaDoMotor(maquina.plataforma) ? f(maquina.nome) : motivoEmPortugues(motivo);
}

/**
 * definido em 2026-10-09: o `maquina_sem_contato` de quem rodava na VM dizia "seu Mac parou de responder" (o Ze 1 no
 * motor Linux, com o Mac aberto na mesa). A máquina Linux é nomeada, com as causas dela; o Mac, a chave que ainda não
 * disse o sistema e o Mac sem chave do modo local ficam com a frase de sempre.
 */
export function motivoDaQuedaEmPortugues(maquina: MaquinaDaQueda | null): string {
  return maquina && ehMaquinaDoMotor(maquina.plataforma) ? `a máquina ${maquina.nome} parou de responder (desligada, sem rede ou motor parado)` : MOTIVO_EM_PORTUGUES.maquina_sem_contato;
}

/**
 * NOD-386 (definido em 2026-10-28): o motivo da queda quando o lease venceu com a máquina em contato — quem não respondeu
 * foi o servidor, e a frase não cita a máquina. O banco continua gravando `maquina_sem_contato` (sem valor novo no enum).
 */
export const MOTIVO_SERVIDOR_NAO_RESPONDEU = "o servidor do nod não respondeu a tempo";

/**
 * NOD-386: o começo da linha `fundo-espera-servidor`. Ela promete uma hora de volta e por isso não conta como o aviso de
 * fundo preso da cadeia (turnos.repo `fundosPresos`): se a volta não for pega, o aviso ainda sai.
 */
export const ABERTURA_DA_ESPERA_DO_SERVIDOR = "O servidor do nod não respondeu a tempo.";

/**
 * O molde cru de uma chave, com os `{param}` por preencher (definido em 2026-10-18, chat limpo): o backfill do assunto
 * reconhece uma linha antiga pelo molde inteiro (src/domain/assunto-do-texto.ts), sem copiar o texto do catálogo.
 */
export function moldeDaRedacao(chave: ChaveRedacao): string {
  return CATALOGO[chave];
}

export function redigir(chave: ChaveRedacao, _agora: number, params: Readonly<Record<string, string>> = {}): string {
  let texto = CATALOGO[chave];
  for (const [k, v] of Object.entries(params)) texto = texto.split(`{${k}}`).join(v);
  return texto;
}
