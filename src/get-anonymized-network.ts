import { readFileSync } from 'node:fs';
import type { AccessSchema, MainSchema, ServiceSchema } from './schema';

const lanMasks = [
    '192.168.17',
    '192.168.54',
    '192.168.34',
    '192.168.86',
    '192.168.32',
];

const wanMasks = [
    '156.47.214',
    '164.23.11',
    '210.213.142',
    '148.95.210',
    '198.62.114',
];

const words = readFileSync('words.txt', 'utf8').split('\n');

export const getAnonymizedDomainBase = (reverseProxyDomain: string) => `${simpleHash(reverseProxyDomain)}.hidden`;

const simpleHash = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
    }
    const index = hash >>> 0;
    return words[ index % words.length ];
};

const cleanObject = <O extends Record<string, unknown>>(o: O) => {
    Object.keys(o).forEach(key => {
        if (o[ key ] === undefined) {
            delete o[ key ];
        }
    });
    return o;
};

export const getAnonymizedNetwork = (mainSchema: MainSchema): MainSchema => {

    const lanMaskIndexes: string[] = [];
    const wanMaskIndexes: string[] = [];

    const reverseProxyDomains = mainSchema.networks
        .flatMap(network => network.peers)
        .flatMap(peer => peer.services ?? [])
        .flatMap(service => [ service, ...service.services ?? [] ])
        .flatMap(service => service.generator?.type === 'caddy' ? service.generator.domains : []);

    const getAnonymizedDomain = <V extends string | undefined>(domain: V): V => {
        if (!domain) return domain;

        const protocol = domain.includes('://')
            ? domain.split('://')[ 0 ] + '://'
            : '';

        const [ domainBase, ...domainRest ] = domain.split('://').pop()!.split('/');
        const path = domainRest.length > 0
            ? '/' + domainRest.join('/')
            : '';

        const [ _, ...domainBaseParts ] = domainBase.split('.');

        const reverseProxyDomain = reverseProxyDomains.find(d => domainBase.endsWith(d));

        const newDomain = reverseProxyDomain
            ? getAnonymizedDomainBase(reverseProxyDomain)
            : domainBaseParts.join('.');

        return `${protocol}${simpleHash(domainBase)}.${newDomain}${path}` as V;
    };

    const getAnonymizedIp = <V extends string | undefined>(ip: V): V => {
        if (!ip) return ip;

        const ipParts = ip.split('.');
        const lastPart = ipParts.pop();
        const submask = ipParts.join('.');

        const isLan = [ '192.', '10.', '172.', '127.' ].some(prefix => ip.startsWith(prefix));
        if (isLan) {
            let index = lanMaskIndexes.indexOf(submask);
            if (index === -1) {
                index = lanMaskIndexes.length;
                lanMaskIndexes.push(submask);
            }
            const newMask = lanMasks[ index % lanMasks.length ];
            return [ newMask, lastPart ].join('.') as V;
        }

        let index = wanMaskIndexes.indexOf(submask);
        if (index === -1) {
            index = wanMaskIndexes.length;
            wanMaskIndexes.push(submask);
        }
        const newMask = wanMasks[ index % wanMasks.length ];
        return [ newMask, lastPart ].join('.') as V;
    };

    const getAnonymizedAccess = (access: AccessSchema): AccessSchema => cleanObject(access.expose_outside_vpn
        ? access
        : {
            ...access,
            domain: getAnonymizedDomain(access.domain),
        });

    const getAnonymizedService = (service: ServiceSchema): ServiceSchema => cleanObject({
        ...service,
        domain: getAnonymizedDomain(service.domain),
        lan_ip: getAnonymizedIp(service.lan_ip),
        vpn_ip: getAnonymizedIp(service.vpn_ip),
        access: service.access?.map(getAnonymizedAccess),
        services: service.services?.map(getAnonymizedService),
        generator: service.generator?.type === 'caddy'
            ? cleanObject({
                ...service.generator,
                domains: [ ...new Set([
                    ...service.generator.domains,
                    ...service.generator.domains.map(getAnonymizedDomain),
                ]) ],
            })
            : service.generator,
    });

    return {
        networks: mainSchema.networks.map(network => cleanObject({
            ...network,
            ddns: getAnonymizedDomain(network.ddns),
            wan_ip: getAnonymizedIp(network.wan_ip),
            peers: network.peers.map(peer => cleanObject({
                ...peer,
                lan_ip: getAnonymizedIp(peer.lan_ip),
                vpn_ip: getAnonymizedIp(peer.vpn_ip),
                domain: getAnonymizedDomain(peer.domain),
                access: peer.access?.map(getAnonymizedAccess),
                services: peer.services?.map(getAnonymizedService),
            })),
        })),
    };
};
