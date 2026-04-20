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

export const getAnonymizedNetwork = (mainSchema: MainSchema): MainSchema => {

    const lanMaskIndexes: string[] = [];
    const wanMaskIndexes: string[] = [];

    const getAnonymizedDomain = <V extends string | undefined>(domain: V): V => {
        if (!domain) return domain;

        return 'hidden.domain.me' as V;
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

    const getAnonymizedAccess = (access: AccessSchema): AccessSchema => access.expose_outside_vpn
        ? access
        : {
            ...access,
            domain: getAnonymizedDomain(access.domain),
        };

    const getAnonymizedService = (service: ServiceSchema): ServiceSchema => ({
        ...service,
        domain: getAnonymizedDomain(service.domain),
        lan_ip: getAnonymizedIp(service.lan_ip),
        vpn_ip: getAnonymizedIp(service.vpn_ip),
        access: service.access?.map(getAnonymizedAccess),
        services: service.services?.map(getAnonymizedService),
    });

    return {
        networks: mainSchema.networks.map(network => ({
            ...network,
            ddns: getAnonymizedDomain(network.ddns),
            wan_ip: getAnonymizedIp(network.wan_ip),
            peers: network.peers.map(peer => ({
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
