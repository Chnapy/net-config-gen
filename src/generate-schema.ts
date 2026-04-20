import fs from 'node:fs';
import yaml from 'yaml';
import { mainSchema } from './schema.ts';

const jsonSchema = mainSchema.toJSONSchema();

fs.writeFileSync("net.schema.yml", yaml.stringify(jsonSchema));
