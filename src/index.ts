import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { genCaddy } from './generators/caddy/gen-caddy.ts';
import { genDnsmasq } from './generators/dnsmasq/gen-dnsmasq.ts';
import { genGatus } from './generators/gatus/gen-gatus.ts';
import { genHomenet } from './generators/homenet/gen-homenet.ts';
import { genHomepage } from './generators/homepage/gen-homepage.ts';
import { mainSchema, type MainSchema, type ServiceSchema } from './schema.ts';
import { getAnonymizedNetwork } from './get-anonymized-network.ts';

const ymlPath = process.argv[ 2 ];

if (!ymlPath) {
    throw new Error('Please pass the root config YAML file path.');
}

const ymlDirpath = path.dirname(ymlPath);

const ymlRawContent = fs.readFileSync(ymlPath, 'utf8');
const ymlContent = yaml.parse(ymlRawContent, {});

const data = mainSchema.parse(ymlContent);

const anonymizedData = getAnonymizedNetwork(data);

const getServiceWithGeneratorOptions = (service: ServiceSchema): ServiceSchema[] => {
    return [
        service.generator && service,
        ...(service.services ?? []).flatMap(getServiceWithGeneratorOptions),
    ].filter(gen => gen !== undefined);
};

const getGenerator = async (service: ServiceSchema, mainSchema: MainSchema) => {
    switch (service.generator?.type) {
        case 'dnsmasq': return genDnsmasq(service, mainSchema.networks, service.generator);
        case 'caddy': return genCaddy(service, mainSchema.networks, service.generator);
        case 'gatus': return genGatus(service, mainSchema.networks, service.generator);
        case 'homepage': return genHomepage(service, mainSchema.networks, service.generator);
        case 'homenet': return genHomenet(service, mainSchema.networks, service.generator);
        default: throw new Error('missing generator: ' + service.generator);
    }
};

const generators = await Promise.all(data.networks
    .flatMap(network => network.peers)
    .flatMap(peer => peer.services ?? [])
    .flatMap(getServiceWithGeneratorOptions)
    .filter(service => !service.generator?.anonymize_network)
    .map(service => getGenerator(service, data)));

const anonymizedGenerators = await Promise.all(anonymizedData.networks
    .flatMap(network => network.peers)
    .flatMap(peer => peer.services ?? [])
    .flatMap(getServiceWithGeneratorOptions)
    .filter(service => service.generator?.anonymize_network)
    .map(service => getGenerator(service, anonymizedData)));

[ ...generators, ...anonymizedGenerators ].forEach(g => {
    console.log(g.type);
    console.log('Generate files:');
    Object.entries(g.files).forEach(([ filepathRelative, content ]) => {
        const filepath = path.join(ymlDirpath, filepathRelative);

        console.log('- ' + filepath);
        // console.log(content);

        fs.mkdirSync(path.dirname(filepath), { recursive: true });
        fs.writeFileSync(filepath, content, 'utf8');
    });
});
