import Anthropic from '@anthropic-ai/sdk';

export interface ChecklistItemForPrompt {
  name: string;
  done: boolean;
}

export interface ClassifyInput {
  jobName: string;
  phaseName: string;
  checklist: ChecklistItemForPrompt[];
  bolaCom: 'ilha' | 'cliente';
  pastedText: string;
}

export interface RawSuggestion {
  tipo: 'checklist_item' | 'bola_com';
  valor: string;
  confidence: number;
  evidencia: string;
}

export interface Classifier {
  classify(input: ClassifyInput): Promise<RawSuggestion[]>;
}

const SUGGESTIONS_TOOL = {
  name: 'record_suggestions',
  description:
    'Registra as atualizações sugeridas para o job com base nas mensagens de WhatsApp analisadas.',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestions: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            tipo: { type: 'string' as const, enum: ['checklist_item', 'bola_com'] },
            valor: { type: 'string' as const },
            confidence: { type: 'number' as const },
            evidencia: { type: 'string' as const },
          },
          required: ['tipo', 'valor', 'confidence', 'evidencia'],
        },
      },
    },
    required: ['suggestions'],
  },
};

function buildSystemPrompt(input: ClassifyInput): string {
  const checklistLines = input.checklist
    .map((item) => `- [${item.done ? 'x' : ' '}] ${item.name}`)
    .join('\n');

  return `Você analisa mensagens de WhatsApp de uma produtora audiovisual e identifica quais marcos do checklist da fase atual de um job foram concluídos, e se a responsabilidade ("bola") está com a Ilha (produtora) ou com o cliente.

Job: ${input.jobName}
Fase atual: ${input.phaseName}
Checklist da fase atual:
${checklistLines}

Bola com atualmente: ${input.bolaCom === 'ilha' ? 'a Ilha' : 'o cliente'}

Regras:
- Só sugira itens de checklist que estão na lista acima, usando o texto exato do item em "valor".
- Para bola_com, "valor" deve ser exatamente "ilha" ou "cliente".
- confidence é um número de 0 a 1 refletindo o quão certo você está da sugestão.
- evidencia deve ser um trecho literal da mensagem que embasa a sugestão.
- Não invente marcos fora da lista. Se nada relevante mudou, chame a ferramenta com uma lista vazia de sugestões.`;
}

// Note: the brief's original draft defined a small local duck-typed `ToolUseBlock`
// interface here to sidestep depending on the SDK's own type names. With
// @anthropic-ai/sdk@0.32.1 that local type (missing `id`/`name`) doesn't
// structurally extend the SDK's `ContentBlock` union, so `Array.prototype.find`'s
// type-predicate overload isn't selected and `toolUse.input` fails to compile.
// Using the SDK's own exported `Anthropic.ToolUseBlock` type (available via the
// default import's merged namespace) keeps the same duck-typed runtime check
// while satisfying the type checker.
function isToolUseBlock(block: unknown): block is Anthropic.ToolUseBlock {
  return typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool_use';
}

export function createAnthropicClassifier(apiKey: string): Classifier {
  const client = new Anthropic({ apiKey });

  return {
    async classify(input: ClassifyInput): Promise<RawSuggestion[]> {
      const response = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        system: buildSystemPrompt(input),
        messages: [{ role: 'user', content: input.pastedText }],
        tools: [SUGGESTIONS_TOOL],
        tool_choice: { type: 'tool', name: 'record_suggestions' },
      });

      const toolUse = response.content.find(isToolUseBlock);

      if (!toolUse) {
        return [];
      }

      const parsed = toolUse.input as { suggestions?: RawSuggestion[] };
      return parsed.suggestions ?? [];
    },
  };
}
