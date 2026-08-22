import { describe, it, expect, vi } from 'vitest';
import { createGeminiClassifier } from '../src/services/classifier';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const INPUT = {
  jobName: 'Colgate - Color Correct Wave 2',
  phaseName: 'Comercial e Orçamento',
  checklist: [{ name: 'Briefing Recebido', done: false }],
  bolaCom: 'ilha' as const,
  pastedText: 'Cliente confirmou o briefing hoje',
};

describe('createGeminiClassifier', () => {
  it('parses suggestions from the structured JSON response', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    suggestions: [
                      {
                        tipo: 'checklist_item',
                        valor: 'Briefing Recebido',
                        confidence: 0.9,
                        evidencia: 'Cliente confirmou o briefing hoje',
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    );

    const classifier = createGeminiClassifier('fake-key', 'gemini-3.6-flash', fetchMock as unknown as typeof fetch);
    const suggestions = await classifier.classify(INPUT);

    expect(suggestions).toEqual([
      {
        tipo: 'checklist_item',
        valor: 'Briefing Recebido',
        confidence: 0.9,
        evidencia: 'Cliente confirmou o briefing hoje',
      },
    ]);
  });

  it('sends the API key, model, and structured-output config in the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ candidates: [] }));
    const classifier = createGeminiClassifier('minha-chave', 'gemini-3.6-flash', fetchMock as unknown as typeof fetch);

    await classifier.classify(INPUT);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('gemini-3.6-flash:generateContent');
    expect(url).toContain('key=minha-chave');
    const body = JSON.parse(options.body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[0].text).toBe(INPUT.pastedText);
  });

  it('returns an empty list when there are no candidates', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ candidates: [] }));
    const classifier = createGeminiClassifier('fake-key', 'gemini-3.6-flash', fetchMock as unknown as typeof fetch);

    const suggestions = await classifier.classify(INPUT);

    expect(suggestions).toEqual([]);
  });

  it('throws with the response body on a non-ok response, for the caller to handle', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'Your credit balance is too low' } }, 400),
    );
    const classifier = createGeminiClassifier('fake-key', 'gemini-3.6-flash', fetchMock as unknown as typeof fetch);

    await expect(classifier.classify(INPUT)).rejects.toThrow(/Gemini API error 400/);
  });
});
