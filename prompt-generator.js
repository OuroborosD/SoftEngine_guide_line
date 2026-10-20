/* Geração determinística: usa apenas os dados fornecidos pelos cards. */
const PromptGenerator = (() => {
  const fields = {
    destination: ['Destino', {
      engineer: ['Engenheiro de Codex', 'Use quando quiser que o trabalho seja analisado, dividido e transformado em uma próxima ação segura para o Codex.'],
      direct: ['Codex direto', 'Use quando a tarefa já estiver suficientemente definida para investigação, planejamento ou implementação diretamente no repositório.']
    }],
    mode: ['Objetivo da IA', {
      auto: ['Automático', 'Permite que o Engenheiro de Codex escolha se o trabalho deve ser investigado, planejado ou executado conforme o tamanho, risco e clareza da tarefa.'],
      decompose: ['Analisar e decompor', 'Use quando uma pendência possui várias funcionalidades ou ainda está pouco estruturada. A IA deverá separar o trabalho antes de gerar implementação.'],
      investigate: ['Investigar', 'Não altera código. Serve para descobrir implementação atual, arquivos envolvidos, causa de problemas, dependências e riscos.'],
      plan: ['Planejar', 'Não altera código. Produz uma sequência de implementação, arquivos/áreas envolvidos, dependências e estratégia de validação.'],
      execute: ['Executar', 'Use quando o comportamento desejado já estiver claro e a tarefa estiver pronta para implementação.']
    }],
    scope: ['Escopo', {
      item: ['Somente este item', 'Usa apenas o primeiro item escolhido, sem expandir relacionados.'],
      related: ['Item + relacionados abertos', 'Usa os itens escolhidos e seus relacionados diretos ainda abertos, quando a inclusão de relacionados estiver ativa.'],
      feature: ['Feature completa', 'Parte da funcionalidade ancestral e percorre seus relacionados, incluindo somente cards abertos. Requer a inclusão de relacionados.'],
      selected: ['Pendências selecionadas', 'Usa somente os cards marcados na lista abaixo, sem acrescentar outros relacionados.']
    }],
    division: ['Divisão do trabalho', {
      auto: ['Automática', 'Fornece os itens ao Engenheiro de Codex para avaliar e decompor trabalhos independentes antes da implementação.'],
      single: ['Manter em um único prompt', 'Mantém todo o escopo em uma única solicitação.'],
      checklist: ['Um prompt por item de checklist', 'Gera uma saída independente para cada checklist aberto. Cards sem checklist aberto permanecem em uma saída própria.']
    }],
    context: ['Nível de contexto', {
      minimal: ['Mínimo', 'Somente objetivo, pendências e instruções essenciais.'],
      balanced: ['Equilibrado', 'Objetivo, contexto do card, pendências, relacionados, bloqueios, critérios e validação.'],
      full: ['Completo', 'Inclui também observações, tags e demais informações úteis existentes no card.']
    }],
    validation: ['Validação', {
      proportional: ['Proporcional', 'Instrui o Codex a executar primeiro as validações mais próximas da mudança e ampliar conforme o risco.'],
      basic: ['Básica', 'Solicita apenas os checks diretamente relacionados à alteração.'],
      full: ['Completa', 'Solicita testes relevantes e, quando existirem no projeto, lint, typecheck e build.']
    }]
  };
  const options = {
    includeRelated: 'Incluir itens relacionados',
    includeBlockers: 'Incluir dependências e bloqueios',
    includeCriteria: 'Incluir critérios de conclusão',
    actionPacket: 'Solicitar CODEX ACTION PACKET',
    investigateFirst: 'Investigar antes de perguntar'
  };
  const defaults = {destination:'engineer',mode:'auto',scope:'related',division:'auto',context:'balanced',validation:'proportional',includeRelated:true,includeBlockers:true,includeCriteria:true,actionPacket:true,investigateFirst:true};
  function normalize(saved) {
    const result = {...defaults};
    for (const key of Object.keys(fields)) if (Object.hasOwn(fields[key][1], saved?.[key])) result[key] = saved[key];
    for (const key of Object.keys(options)) if (typeof saved?.[key] === 'boolean') result[key] = saved[key];
    return result;
  }
  const clean = value => typeof value === 'string' ? value.trim() : '';
  const openChecks = item => (item.checklist || []).filter(c => !c.completed);
  function resolveItems(all, seeds, prefs) {
    const byId = new Map(all.map(i => [i.id, i]));
    let result = seeds.filter(i => i.status !== 'Concluído');
    if (prefs.scope === 'item') result = result.slice(0, 1);
    if (prefs.includeRelated && prefs.scope === 'related') {
      const ids = new Set(result.map(i => i.id));
      result = [...result, ...all.filter(i => ids.has(i.relatedId) || result.some(seed => seed.relatedId === i.id))];
    }
    if (prefs.includeRelated && prefs.scope === 'feature') {
      const ids = new Set();
      for (let seed of result) {
        const visited = new Set([seed.id]);
        while (byId.has(seed.relatedId) && !visited.has(seed.relatedId)) {
          seed = byId.get(seed.relatedId); visited.add(seed.id);
        }
        ids.add(seed.id);
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const i of all) if (ids.has(i.relatedId) && !ids.has(i.id)) {ids.add(i.id); changed = true;}
      }
      result = all.filter(i => ids.has(i.id));
    }
    return [...new Map(result.filter(i => i.status !== 'Concluído').map(i => [i.id, i])).values()];
  }
  function warnings(items) {
    const result = [];
    const titleWarning = title => clean(title).length < 5 || /^(tarefa|fazer|corrigir|oque fazer|o que fazer|item)$/i.test(clean(title));
    for (const i of items) {
      if (titleWarning(i.title)) result.push(`${i.title}: ⚠ Use um título mais específico para ajudar a IA a entender a pendência.`);
      for (const c of openChecks(i)) {
        const prefix = `${i.title} / ${c.title}: `;
        if (titleWarning(c.title)) result.push(prefix + '⚠ Use um título mais específico para ajudar a IA a entender a pendência.');
        if (!clean(c.description)) result.push(prefix + '⚠ Esta pendência não possui instruções.');
        if (clean(c.description).length > 700) result.push(prefix + "⚠ Esta pendência contém muitas instruções. Considere dividi-la ou utilizar 'Analisar e decompor'.");
      }
    }
    return result;
  }
  function build(items, projectName, prefs, contextItems = items) {
    if (!items.length) return '';
    const blocks = [], rich = prefs.context !== 'minimal', engineer = prefs.destination === 'engineer';
    const add = (title, values) => {const value = (Array.isArray(values) ? values : [values]).filter(Boolean).join('\n\n').trim(); if (value) blocks.push(`## ${title}\n\n${value}`);};
    const objective = items.map(i => `- ${i.title}`).join('\n');
    const work = items.map(i => [`### ${i.title}`, !rich && clean(i.description), ...openChecks(i).map(c => [`- ${c.title}`, clean(c.description) && `Instruções:\n${clean(c.description)}`].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n')).join('\n\n');
    const context = rich ? contextItems.map(i => [
      `${i.title}${i.type ? ` · ${i.type}` : ''}${i.status ? ` · ${i.status}` : ''}`,
      clean(i.description),
      prefs.context === 'full' && clean(i.notes) && `Observações: ${clean(i.notes)}`,
      prefs.context === 'full' && i.priority && `Prioridade: ${i.priority}`,
      prefs.context === 'full' && i.tags?.length && `Tags: ${i.tags.join(', ')}`
    ].filter(Boolean).join('\n')).join('\n\n') : '';
    const blockers = prefs.includeBlockers ? contextItems.filter(i => i.blocked || i.status === 'Bloqueado').map(i => `- ${i.title}: ${clean(i.blockReason) || 'Bloqueio registrado sem motivo informado.'}`).join('\n') : '';
    const relations = rich && prefs.includeRelated ? contextItems.map(i => {const parent = contextItems.find(p => p.id === i.relatedId); return parent && `- ${i.title} está relacionado a ${parent.title}.`;}).filter(Boolean).join('\n') : '';
    const criteria = rich && prefs.includeCriteria ? items.flatMap(i => openChecks(i).map(c => `- Atender “${c.title}” (${i.title})${clean(c.description) ? ' conforme suas instruções' : ''}.`)).join('\n') : '';
    const modeInstructions = {
      auto: 'Avalie tamanho, risco e clareza; recomende INVESTIGAR, PLANEJAR ou EXECUTAR e justifique a próxima ação segura.',
      decompose: 'Analise e decomponha o trabalho em requisitos e próximas ações antes de gerar implementação. Não altere código nesta etapa.',
      investigate: 'INVESTIGAR: não altere código. Descubra implementação atual, arquivos envolvidos, causas, dependências e riscos.',
      plan: 'PLANEJAR: não altere código. Produza uma sequência de implementação, áreas envolvidas, dependências e estratégia de validação.',
      execute: 'EXECUTAR: implemente o comportamento solicitado dentro do escopo, respeitando bloqueios e decisões de produto pendentes.'
    };
    const validation = {
      proportional: 'Execute primeiro as validações mais próximas da mudança e amplie conforme o risco.',
      basic: 'Execute apenas os checks diretamente relacionados à alteração.',
      full: 'Execute testes relevantes e, quando existirem no projeto, lint, typecheck e build.'
    }[prefs.validation] + ' Descubra os comandos existentes no projeto; não invente comandos. Em investigação, análise ou planejamento, apresente a estratégia de validação sem alterar código.';
    const restrictions = [
      'Limite mudanças ao escopo solicitado; reutilize padrões existentes e evite alterações arquiteturais, de APIs públicas ou dependências sem justificativa concreta.',
      prefs.investigateFirst && 'Se uma informação técnica puder ser descoberta no repositório, investigue primeiro. Não pergunte ao usuário por informações que possam ser determinadas com segurança lendo o código, configuração, documentação ou testes.\n\nSó transforme algo em pergunta quando for uma decisão de produto realmente necessária, material para o comportamento e impossível de inferir com segurança.',
      blockers && 'Respeite os bloqueios informados; identifique o que pode avançar e o que depende de resolução.'
    ];
    const orientation = [
      'Leia o AGENTS.md aplicável e investigue arquivos relevantes antes de propor ou realizar alterações. O contexto abaixo foi fornecido pelos cards; a aplicação não inspecionou o repositório.',
      modeInstructions[prefs.mode],
      prefs.division === 'auto' && 'Identifique quando a pendência contém vários trabalhos independentes e decomponha antes de implementação; separe requisitos grandes.',
      prefs.division === 'single' && 'Mantenha o trabalho em um único prompt.',
      'Diferencie informações conhecidas de unknowns (informações desconhecidas), identifique dependências e riscos.'
    ];
    const delivery = [
      prefs.actionPacket && 'Gere um CODEX ACTION PACKET com objetivo, contexto conhecido, escopo, restrições, próxima ação recomendada e validação.',
      'Informe resultado, arquivos envolvidos, validações realizadas e resultados, riscos e pendências; identifique checks não executados e o motivo.',
      'Antes de concluir trabalho no repositório, revise git diff e git status.'
    ];
    if (engineer) {
      blocks.push('# SOLICITAÇÃO AO ENGENHEIRO DE CODEX');
      add('TIPO DE SOLICITAÇÃO', fields.mode[1][prefs.mode][0]);
      add('OBJETIVO DE PRODUTO', [`Trabalhar nas pendências abertas do projeto “${projectName}”.`, objective]);
      add('CONTEXTO FORNECIDO', context);
      add('TRABALHO AINDA ABERTO', [`Escopo: ${fields.scope[1][prefs.scope][0]}.`, work]);
      add('DEPENDÊNCIAS E BLOQUEIOS', [rich && relations, blockers]);
      add('CRITÉRIOS DE CONCLUSÃO', criteria);
      add('RESTRIÇÕES', restrictions);
      add('ORIENTAÇÃO AO ENGENHEIRO DE CODEX', orientation);
      add('ENTREGA ESPERADA', [...delivery, validation]);
    } else {
      add('OBJETIVO', [modeInstructions[prefs.mode], objective]);
      add('CONTEXTO ESSENCIAL', context);
      add('ESCOPO', [`${fields.scope[1][prefs.scope][0]}:\n\n${work}`, relations, blockers && `Dependências e bloqueios:\n${blockers}`, criteria && `Critérios de conclusão:\n${criteria}`]);
      add('RESTRIÇÕES', restrictions);
      add('EXECUÇÃO', orientation);
      add('VALIDAÇÃO', validation);
      add('ENTREGA', delivery);
    }
    return blocks.join('\n\n');
  }
  function generate(all, seeds, projectName, saved) {
    const prefs = normalize(saved), items = resolveItems(all, seeds, prefs);
    const outputs = prefs.division === 'checklist' ? items.flatMap(i => {
      const checks = openChecks(i);
      return checks.length ? checks.map(c => build([{...i, checklist:[c]}], projectName, prefs, items)) : [build([i], projectName, prefs, items)];
    }) : items.length ? [build(items, projectName, prefs)] : [];
    return {items, outputs, warnings:warnings(items), text:outputs.join('\n\n---\n\n')};
  }
  return {fields, options, defaults, normalize, generate};
})();
if (typeof module !== 'undefined') module.exports = PromptGenerator;
