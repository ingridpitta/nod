# ADR-131 — O motor se atualiza com frentes rodando

Status: proposta · Data: 2026-10-27 · Emenda a [ADR-100](adr-100-o-motor-se-atualiza-sozinho.md) (item 2, a drenagem,
e a emenda de 2026-10-15) e a [ADR-045](adr-045-queda-do-mac-vira-um-aviso.md) (o que é queda); usa a
[ADR-130](adr-130-a-fala-da-pessoa-nao-espera-os-bastidores.md) (a faixa da pessoa).

## Contexto

Medido em produção em 27/10 (só metadados, sem texto de mensagem):

- **Das 35 falas da pessoa que esperaram mais de 30 s em 14 dias, 25 tinham a conversa livre.** Nenhum turno ocupava a
  faixa; a máquina era sempre a VM do motor (`309ec3dd`, a `nod-motor-teste`), que não despachou nada de 1 a 16 min antes
  e durante a espera. Depois vários pendentes saíam juntos, sem incidente nem reinício do servidor.
- **O journal da VM confirma a drenagem da ADR-100.** Em 26/10, as 8 esperas da pessoa caem exatamente nas janelas
  `drenando` → `drenagem_desistiu`, que se repetem a cada ~70 min (10 a 15 min cada), com `turnos` entre 1 e 6 e nunca 0.
- **A contagem não é vazamento: a VM nunca fica sem turno.** Cruzando o journal com o banco, em cada janela rodavam de 1
  a 5 frentes de 20 a 134 min. A regra "só reinicio sem nenhum turno" nunca se cumpre numa máquina de bots que trabalham
  por horas. O motor da VM ficou dias sem se atualizar — e nenhuma correção do motor chegou nela nesse tempo.
- **Reiniciar à mão também não servia.** O SIGTERM já interrompe o turno com a causa `reinicio_do_motor` (laco.ts) e
  entrega, mas o servidor a lia como `trabalho_incompleto`: a frente falhava, o lote fechava como falha e quem pediu ao
  colega recebia aviso de falha. Só a morte à força (lease vencido, `maquina_sem_contato`) retomava o fundo sozinho.

A ADR-130 já resolve a fala da pessoa durante a drenagem (`soDaPessoa`). Esta ADR resolve a drenagem em si.

## Decisão

1. **O reinício do motor é queda** (`reinicio_do_motor`, 0122). A entrega com essa causa, sem Parar, assenta
   `interrompido` com o motivo novo (`desfechoDaEntrega`), em qualquer turno. O fundo (rotina, pedido de colega, frente,
   retorno do lote) volta para a fila na hora, com a sessão do CLI, sem linha na conversa e sem incidente — como o
   reinício do servidor (NOD-309). A conversa ganha o Retomar com "o nod foi reiniciado na máquina". O Parar vence.
2. **O reinício do motor não gasta o teto de quedas** (`QUEDAS_FORA_DO_TETO`). O motor reinicia a cada versão nova; com o
   teto de 3, uma frente de horas desistiria na terceira atualização sem nada ter dado errado. O prazo do fundo (24 h)
   continua valendo.
3. **O plano diz se o turno é da pessoa** (`daPessoa`, a régua do `soDaPessoa`: a ligação, o que ela olha e a faixa dela
   na conversa). O pool conta esses turnos à parte (`turnosDaPessoa`). Plano sem o campo (servidor antigo) conta como da
   pessoa: o motor novo com servidor velho se comporta como antes.
4. **Drenando, o motor espera só os turnos da pessoa.** Desatualizado, ele segue puxando tudo por até 30 min à espera de
   um momento sem turno nenhum (como antes: vários deploys seguidos viram um reinício só). Passada a janela, sem turno da
   pessoa rodando, pede o reinício na hora, por cima do fundo (`pedido_sobre_o_fundo`); com turno dela, drena só o fundo e
   reavalia a cada 15 s. O teto da drenagem (10 min) passa a valer só para os turnos da pessoa.
5. **Entre o pedido e o reinício o motor não puxa nada** (`drenar("tudo")`), nem a fala da pessoa, que o reinício
   cortaria. Se o root não reiniciar em 2 min, a fala volta a sair enquanto o pedido espera.

## O que a pessoa vê

A frente pausa o tempo do reinício (de segundos a um minuto) e continua da mesma sessão, sem aviso. A rotina volta à fila; se a volta
passaria da próxima janela, fica `nao_rodou` com "o nod foi reiniciado na máquina". A fala dela espera no máximo os
segundos entre o pedido e o reinício. Perde-se a chamada de ferramenta em andamento e os processos em segundo plano da
task (servidor de desenvolvimento, Postgres de teste), que a retomada sobe de novo.

## Limites

- **A primeira vez é à mão.** O motor que está na VM tem a regra antiga e não se atualiza sozinho: depois do deploy desta
  ADR e da ADR-130, a VM precisa de um `curl … /motor | sh` seguido de `sudo systemctl restart nod-motor` (o instalador
  não reinicia um motor que já roda). Com o servidor novo, esse reinício já retoma as frentes.
- **O mesmo laço roda no app do Mac.** Fechar o app também entrega `reinicio_do_motor`: as frentes do Mac passam a voltar
  à fila (esperando o app abrir) em vez de falhar, e a conversa ganha o Retomar com a frase do motor.
- **Efeito externo no meio.** A retomada da queda já diz ao bot para não repetir efeito externo (`ENTRADA_DA_RETOMADA_DA_QUEDA`).

## Gatilho de reversão

Frentes com trabalho repetido ou perdido depois de uma atualização do motor (a retomada não reconhece o que já fez).
Nesse caso, voltar a drenar sem pedir sobre o fundo e reiniciar só de madrugada, mantendo o item 1 (o reinício manual
continua sendo queda).

## Alternativas rejeitadas

- **Trocar o motor a quente, com dois processos** (o velho termina os turnos, o novo puxa): zero interrupção, mas o
  servidor aceita uma conexão por chave, os CLIs vivem no cgroup do serviço e a limpeza de órfãos mataria os turnos do
  processo velho. Custo e risco altos; fica como evolução se a pausa de segundos incomodar.
- **Atualizar só de madrugada:** as correções atrasariam até um dia e as frentes noturnas parariam do mesmo jeito.
- **Consertar a contagem de turnos:** a contagem está certa (o banco confirma); o problema é a regra.
