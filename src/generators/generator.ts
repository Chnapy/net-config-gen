import z from 'zod';
import { genCaddySchema } from './caddy/gen-caddy.ts';
import { genDnsmasqSchema } from './dnsmasq/gen-dnsmasq.ts';
import { genGatusSchema } from './gatus/gen-gatus.ts';
import { genHomenetSchema } from './homenet/gen-homenet.ts';
import { genHomepageSchema } from './homepage/gen-homepage.ts';

export const generatorSchema = z.union([
    genDnsmasqSchema,
    genCaddySchema,
    genGatusSchema,
    genHomepageSchema,
    genHomenetSchema,
].map(schema => z.object({
    ...schema.shape,
    anonymize_network: z.boolean().optional(),
})));
export type GeneratorSchema = z.infer<typeof generatorSchema>;
