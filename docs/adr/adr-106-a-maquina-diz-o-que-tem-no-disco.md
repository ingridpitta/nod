# ADR-106 — A limpeza pergunta pelas pastas que a máquina tem no disco

Status: aceito (pedido do Marlon, 2026-10-15; decisões D1–D4 da revisão do PR #320 no mesmo dia) · Data: 2026-10-15 ·
Revisa a [ADR-088](adr-088-limpeza-das-pastas-de-task.md) (quem pode ser limpo) e a
[ADR-096](adr-096-o-disco-que-se-cuida.md) (o disco que se cuida)

## Contexto

Em 15/10 a VM dos bots (`nod-motor-teste`) encheu de novo: 409 MB livres de 99 GB. O disco foi para 200 GB e a
limpeza foi investigada. Ela rodava a cada 30 min com o disco apertado, mas não apagava nada. Medido em 15/10:

- **O servidor só oferecia pastas já limpas.** `candidatosALimpeza` devolve até 500 tasks encerradas nos últimos 30
  dias, das mais antigas para as mais novas. O Marlon tinha 1.151 nessa janela, e a 500ª tinha terminado em 09/10
  20:32. Nada que terminou depois aparecia. Quase todas as 500 já tinham saído do disco, então cada passada da VM
  achava "1 pasta". Das 124 tasks encerradas do Ze 1, só 10 entravam no corte, todas elegíveis (sem turno vivo, sem
  decisão pendente, sem pasta dividida). A VM liberou 0 MB por dia de 12 a 14/10. Sem mudança, o corte só andaria
  quando as tasks de 09/10 saíssem da janela, perto de 08/11.
- **A reconfirmação caía no mesmo corte.** Antes de apagar, a máquina pede a lista inteira de novo e procura a pasta
  nela. A pasta fora das 500 não se reconfirmava (`nao_reconfirmada`).
- **A worktree sem clone travava a pasta para sempre.** O `guardarEApagar` da ADR-096 apagava uma pasta encerrada com
  um clone dentro sem olhar se outras tasks tinham worktrees desse clone. Foi assim que o clone `nod` de uma task da
  Ada sumiu. A worktree que sobrou (`Ada/…-169c93/nod`, e mais cinco da Teodora) aponta para um `gitdir` que não
  existe, o `git rev-parse` falha, a limpeza marca `erro`, e `erro` segura a pasta. Era essa a pasta oferecida e
  recusada a cada 30 min desde 04:47 UTC. Com uma task ativa, ela perderia o repositório no meio do trabalho.
- **O log misturava as máquinas.** `limpeza_feita` é por pessoa. Os 24,7 GB liberados às 14:29 UTC foram no Mac do
  Marlon, mas pareciam da VM, cujo espaço livre ficou em ~5,9 GB o dia inteiro.

## Decisão

1. **A máquina manda o código das pastas que tem, nunca o nome (D2).** Cada passada lê os nomes em
   `~/nod/<bot>/<slug>` (dois `readdir`, sem medir nada, `pastasNoDisco`) e manda, em `codigos`, o sha256 em
   hexadecimal de cada `<bot>/<slug>` em NFC (`codigoDaPasta`). Em `~/nod/<bot>/` moram também clones, órfãs e pastas
   criadas à mão, com nome que pode citar cliente ou jovem, e no modo local as pastas de outra pessoa: nenhum nome sai
   da máquina. O servidor calcula o mesmo código das pastas que já guarda em `trabalhos.pasta` (`sha256` de
   `normalize(…, NFC)` no SQL) e só reconhece essas. A rota valida a lista (`codigosDaMaquina`: 64 dígitos
   hexadecimais, sem repetir, até 5.000). Com 64 caracteres por código, 5.000 dão ~335 KB, abaixo do corpo máximo de
   1 MiB. Lista vazia = nada a limpar, sem consultar o banco.
2. **Com a lista, sem teto de 500 e sem janela de 30 dias (D4a).** A lista já limita a consulta (teto de 10.000
   linhas). Com 500, as tasks recentes que ainda não podem sair escondiam as antigas que podem. Sem a janela, a pasta
   presa há mais de 30 dias volta a ser vista. Por isso, a pasta de várias tasks só sai pela mais recente: ela conta
   como `dividida` também quando outra task da mesma pasta encerrou depois. Antes, a task antiga oferecia como
   `encerrada` uma pasta cuja task nova tinha acabado havia minutos, e sem a janela qualquer task do histórico
   serviria.
3. **Sem lista, as mais recentes primeiro.** A máquina que ainda não atualizou não manda `codigos`. Para ela, a
   consulta ordena por `terminado_em desc`, com a janela e o teto de 500 de antes. A reconfirmação de um app antigo
   pode perder uma pasta empurrada para fora das 500 por uma task que acabou no meio. Isso segura a pasta
   (`nao_reconfirmada`), sem apagar nada.
4. **A reconfirmação pergunta só pelo código da pasta que vai sair.** Responde certo fora de qualquer corte e é mais
   barata. E acontece duas vezes na pasta guardada (D4b): antes da primeira remoção, como antes, e de novo logo antes
   do `worktree remove`/`rm`, depois do guardado pronto. A compactação leva até 20 min, e um turno pode ter voltado à
   pasta nesse meio. Se não confirmar (ou houver um turno na pasta), a pasta fica e o guardado recém-criado sai.
5. **O clone em uso não sai (D1).** Antes de guardar e apagar uma pasta com um clone (`.git` pasta) dentro, a limpeza
   lê do disco os registros das worktrees desse clone (`.git/worktrees/<nome>/gitdir` e `locked`). Não usa o git,
   que num `.git` quebrado sobe para o repositório de cima e listaria as worktrees de outro. A pasta fica (motivo
   `clone_em_uso`) se alguma worktree de fora existe, está travada ou mora num caminho que pode voltar (fora de
   `~/nod`, ou atrás de um link). Só o registro de uma worktree que sumiu de vez em `~/nod` não conta. Se a busca
   dos clones na pasta não leu tudo (passou de 20.000 pastas, ou uma não se leu), a pasta também fica, com `erro`.
6. **`clone_sumiu`, só com certeza (D3).** A worktree cujo `gitdir:` aponta para um clone dentro de `~/nod` que não
   existe mais (`cloneSumiu`) entra em `SAI_GUARDANDO`. Na task encerrada, a pasta é guardada (`.tar.gz` em
   `~/nod/.guardado`, ADR-096 §4) e apagada. Na recente, fica. O mesmo vale para a órfã da raiz do bot. Sem o clone,
   não há commit a referenciar nem worktree a desligar, e os arquivos vão no guardado. **Não** é `clone_sumiu`
   (segue `erro`, consertável com `git worktree repair`):
   - um `gitdir` fora da forma `<clone>/.git/worktrees/<nome>`;
   - um clone fora de `~/nod` (um disco desmontado pode voltar);
   - o `.git` do clone ainda existir (só o registro da worktree foi podado);
   - um link no caminho até o clone (o primeiro ancestral que existe precisa ser o próprio caminho real);
   - um clone em `~/nod` que ainda registra a worktree (ele mudou de lugar). A busca vai até o nível 4, não desce em
     repositório, e na dúvida (erro de leitura que não seja "não está lá", ou mais de 20.000 pastas, com
     `limpeza_clone_busca_no_teto` no log) conta como "registra".
7. **O log diz qual máquina limpou e o tamanho da lista (D4c).** `limpeza_feita`, `limpeza_simulada` e
   `limpeza_adiada` levam `machine_id` (pela ponte HTTP, a chave; no modo local, a máquina do laço) e, da máquina nova,
   `pastas_enviadas`, `pastas_cortadas` (passaram do teto) e `candidatos` (o que o servidor ofereceu). O pedido que
   falha vira `limpeza_pedido_falhou` na máquina, em vez de uma lista vazia calada.

**Limite de privacidade (pede validação humana).** O código é um sha256 sem chave secreta de um nome previsível
(`<bot>/<slug>`). Quem capturasse o corpo do pedido (ele vai por HTTPS) poderia testar nomes candidatos e confirmar que
uma pasta existe na máquina. É pseudonimização, não anonimização. O servidor não grava nem registra os códigos no log:
eles só filtram a consulta. Se isso não bastar para o critério de dados da Lumen, o passo seguinte é um HMAC com uma
chave que o servidor dá a cada máquina.

## Alternativas descartadas

- **Mandar os nomes das pastas.** Era a primeira versão deste PR. A ADR dizia que o servidor "já guarda" esses nomes,
  o que vale só para as pastas de task. A revisão mostrou que iam também nomes de clones, órfãs e pastas criadas à
  mão, e no modo local os de outra pessoa. Também passava de 1 MiB no teto.
- **Mandar só nomes no formato do slug de task (`<slug>-<6 do id>`).** Resolve parte da privacidade, mas deixa de
  fora a pasta de task com nome escolhido à mão e ainda precisaria de um teto em bytes.
- **Só inverter a ordem (item 3 sozinho).** Resolve o 15/10, mas volta a falhar quando uma pasta antiga ficar presa e
  houver mais de 500 tasks mais novas.
- **Tirar o teto e paginar sem lista.** A consulta tem três subconsultas por task, e o número de tasks só cresce. A
  cada passada, o banco pagaria por pastas que não existem em disco nenhum.
- **O servidor lembrar o que cada máquina já limpou.** Exige tabela nova e relato por pasta, que é caminho, e o relato
  hoje é só números (ADR-088). A máquina já sabe o que tem no disco.

## Gatilho de reversão

- Voltar a mandar só `apertado` (sem a lista) se a consulta `candidatosALimpeza` com `codigos` passar de 1 s (medir
  com `explain analyze` no banco de produção) ou se `pastas_cortadas` aparecer maior que zero no `limpeza_feita`.
- Tirar `clone_sumiu` de `SAI_GUARDANDO` se aparecer pasta guardada com esse motivo cujo clone existia.
- Rever o item 5 se `pulada_clone_em_uso` crescer sem parar: um clone compartilhado com uma worktree esquecida
  segura a pasta inteira (e dois clones com worktrees cruzadas se seguram para sempre).
