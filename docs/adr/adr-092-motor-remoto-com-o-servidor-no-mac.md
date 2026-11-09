# ADR-092 — A VM da pessoa com o servidor no Mac (modo local)

**Status** aceito · decidido e implementado em 2026-10-09 (o Marlon escolheu este caminho para ligar a
`nod-motor-teste` ao nod diário, entre voltar a VM para a produção e passar o diário ao modo compartilhado)

Estende a ADR-090 (motor numa máquina Linux da pessoa) ao modo local. Mantém a ADR-021 (o servidor nunca disca para
a máquina), a ADR-022 (o agente não escolhe a máquina) e a regra 0005 (a sessão do CLI é de quem a criou).

## Contexto

A ADR-090 foi escrita para o modo compartilhado: as máquinas falam com o servidor pela ponte HTTP (`/api/maquina/*`),
autenticadas pela chave de máquina. No modo local (o nod diário) o servidor roda no próprio Mac e executa os bots dentro
do processo. A ponte HTTP e a autorização por chave ficavam desligadas (`boot.ts`: `autorizarMaquina` só no
compartilhado).

Em 2026-10-09 o pareamento da `nod-motor-teste` com o diário passou, porque a tela emite a chave em qualquer modo. A
primeira chamada do motor, porém, voltou 401, e depois de três recusas ele desistiu. Os outros caminhos eram:

- passar o diário ao modo compartilhado, o que tiraria o Mac de dentro do servidor e mudaria o dia a dia (gh detectado
  no servidor, arquivo do Mac da ADR-068);
- deixar a VM só na produção.

## Decisão

1. **No modo local a ponte HTTP também fica de pé.** A chave de máquina passa a valer: rotas `/api/maquina/*`, a
   varredura de presença e a lista viva de "Máquinas". O Mac continua rodando os bots neste processo, e o seletor de
   IA continua sendo o deste Mac.
2. **Sem máquina escolhida, o bot roda no Mac.** A máquina da ponte só pega o turno que tem ELA como alvo, pela mesma
   ordem da ADR-090: o "desta vez", a máquina do bot e o padrão da pessoa (`reivindicar` com `soComoAlvo`). Com o
   servidor no Mac, os arquivos e os clones dos bots estão no Mac. Uma VM que pegasse turno de qualquer bot faria o bot
   acordar sem a pasta dele. Na tela, "Qualquer uma" vira "Este Mac", e conectar uma máquina não muda o padrão da pessoa.
3. **O turno da VM sai como no compartilhado.** O plano leva as IAs, o gh e o nome da VM, executor `local` (a IA real,
   mesmo com o Mac no catcher), sem `--resume` e sem as pastas de projeto do Mac (`maquinaRemota`), que não existem lá.
4. **A sessão do CLI devolvida pela VM é descartada** (`descartarSessao` na ponte). A sessão da conversa e a do
   trabalho são do Mac, e o próximo turno no Mac as retoma. Gravar a da VM faria o Mac pedir `--resume` de uma sessão que
   ele não tem. O que a VM respondeu chega ao Mac pelo histórico da conversa, como qualquer fala depois da sessão.
5. **O que é do Mac fica com o Mac.** A VM não grava o inventário persistido por pessoa, que é o do Mac e é o que o
   gate pré-spawn lê. Ela também não repete as falas barradas por falta de IA no Mac e não puxa itens do gh, que no
   modo local rodam no Mac na hora.
6. **Transporte: túnel SSH aberto pelo Mac.** O diário escuta só em 127.0.0.1, com login stub. Um túnel reverso
   (`ssh -N -R 8888:127.0.0.1:8888 <vm>`) faz a VM enxergar a API em `http://127.0.0.1:8888`, que o motor aceita por
   ser loopback. Nada fica exposto na internet, e o motor continua puxando (ADR-021): quem abre o túnel é a pessoa,
   não o servidor. A tela "Conectar uma máquina" mostra o túnel e o comando com o endereço da API (`servidorNoMac.api`).

## Alternativas rejeitadas

- **Diário no modo compartilhado.** Resolve o motor, mas muda como o Mac roda os bots para todas as conversas, por
  causa de um teste.
- **Túnel público (ngrok etc.).** Exporia o login stub do diário a qualquer pessoa com o endereço.
- **A VM pegar o bot sem escolha ("qualquer uma", como no compartilhado).** No modo local o bot acordaria sem os
  arquivos dele, num lugar que a pessoa não escolheu.
- **Guardar a sessão por máquina (coluna nova) para a VM também retomar.** Seria o certo para os dois modos, mas mexe
  no esquema e nas regras de sessão da ADR-083. Fica para quando a VM tiver uso diário. Hoje ela recebe o histórico,
  como no compartilhado.

## Limites conhecidos

- **"Rodar em <Mac> desta vez".** O Mac do modo local não tem chave e não aparece como opção. Para o bot voltar ao
  Mac, a pessoa escolhe "Este Mac" para ele em Máquinas.
- **A drenagem do SIGTERM.** No modo local ela não espera os turnos da VM. Um reinício do diário interrompe o turno
  dela, que volta pela fila, como os do Mac.
- **O túnel depende do Mac ligado.** É o mesmo limite do diário, que também roda no Mac.

## Gatilho de reversão

Se, em 14 dias com uma VM conectada ao diário, aparecer um turno da VM retomando sessão do Mac, ou um turno do Mac
falhando com sessão inexistente depois de um turno da VM, a regra do item 4 está furada. Desligar a VM (cancelar a
chave) e guardar a sessão por máquina antes de religar.

## Implementação (2026-10-09)

- `src/adapters/http/boot.ts`: `autorizarMaquina` em qualquer modo.
- `src/adapters/http/compor.ts`: ponte HTTP e varredor em qualquer modo; no local, a ponte de cada conexão roda com
  `executor: "local"` e `soComoAlvo`, sem `persistir`, `itensLocais` nem `repetirBarrados`, com `descartarSessao`.
  `maquinaDaPonte` decide o plano e o gh do turno; "Máquinas" recebe `servidorNoMac`.
- `src/repositories/turnos.repo.ts`, `src/use-cases/despachar-turno.ts`, `src/adapters/fundo/ponte-interna.ts`:
  `soComoAlvo`.
- `src/adapters/http/rotas/ponte.ts`: `descartarSessao`. `src/use-cases/emitir-plano-turno.ts`: `maquinaRemota`.
- `web/telas/maquinas.ts` e `web/main.ts`: "Este Mac", o túnel no "Conectar" e o padrão intocado.
- Teste: `tests/concurrency/ponte-http-modo-local.test.ts` (o bot sem escolha fica no Mac e a VM não o pega; o bot da
  VM sai só para ela, sem `--resume`, e a sessão dela não vira a da conversa; de volta a "Este Mac", roda no Mac).

## Emenda de 2026-10-09 — a tela fala por máquina

Com os bots na VM, a tela de "Trabalhos" juntava a leitura da VM com a do Mac e dizia "Seu Mac está ocupado" com a VM
cheia. A emenda da ADR-085 do mesmo dia faz cada trabalho esperar pela máquina dele e dizer o nome dela. Aqui no modo
local, o trabalho sem alvo é do Mac do servidor (item 2), e a lista usa a mesma regra do alvo que o `reivindicar`
(`alvoDoTurno`).
