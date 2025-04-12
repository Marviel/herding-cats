'use server';

import { streamObject } from 'ai';
import { createStreamableValue } from 'ai/rsc';
import { z } from 'zod';

import { openai } from '@ai-sdk/openai';

export async function generate(input: string) {
    'use server';

    const stream = createStreamableValue();

    (async () => {
        const { partialObjectStream } = streamObject({
            model: openai('gpt-4-turbo'),
            system: 'You generate three notifications for a messages app.',
            prompt: input,
            schema: z.object({
                notifications: z.array(
                    z.object({
                        name: z.string().describe('Name of a fictional person.'),
                        message: z.string().describe('Do not use emojis or links.'),
                        minutesAgo: z.number(),
                    }),
                ),
            }),
        });

        for await (const partialObject of partialObjectStream) {
            stream.update(partialObject);
        }

        stream.done();
    })();

    return { object: stream.value };
}