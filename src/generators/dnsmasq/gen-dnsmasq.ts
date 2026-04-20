import z from 'zod';
import type { MainSchema, ServiceSchema } from '../../schema.ts';
import { formatDnsmasqConf } from './format-dnsmasq-conf.ts';
import { renderDnsmasqConf } from './templates/dnsmasq.conf.ts';

export const genDnsmasqSchema = z.object({
    type: z.literal('dnsmasq'),
    paths: z.object({
        "dnsmasq.conf": z.string().nonempty(),
    }),
    dns: z.array(z.ipv4()),
    domains: z.array(z.object({
        domain: z.string().nonempty(),
        ip_to_use: z.enum([ 'wan', 'lan', 'vpn' ]),
        service: z.string().nonempty().optional()
    })),
});
export type GenDnsmasqOptions = z.infer<typeof genDnsmasqSchema>;

type IpObject = Pick<ServiceSchema, 'lan_ip' | 'vpn_ip'> & { wan_ip?: string };

export const genDnsmasq = async (generatorService: ServiceSchema, networks: MainSchema[ 'networks' ], options: GenDnsmasqOptions) => {

    const addressGroups: Record<string, Record<string, string>> = {};
    // const addressList: [ string, string, string ][] = [];

    const getIPObjectById = (id: string): IpObject => {
        for (const network of networks) {
            if (network.id === id) {
                return network;
            }

            for (const peer of network.peers) {
                if (peer.id === id) {
                    return peer;
                }

                for (const service of peer.services ?? []) {
                    if (service.id === id) {
                        return service;
                    }

                    for (const serviceBis of service.services ?? []) {
                        if (serviceBis.id === id) {
                            return serviceBis;
                        }

                    }
                }
            }
        }

        throw new Error('IP Object not found for id: ' + id);
    };

    const port = generatorService.access?.[ 0 ].port!;

    options.domains.forEach(allowedDomain => {

        const addresses = addressGroups[ allowedDomain.domain ] ?? {};
        addressGroups[ allowedDomain.domain ] = addresses;

        const getIP = (ipObject: IpObject) => {
            switch (allowedDomain.ip_to_use) {
                case 'wan': return ipObject.wan_ip;
                case 'lan': return ipObject.lan_ip;
                case 'vpn': return ipObject.vpn_ip;
                default: throw new Error('IP to use not handled: ' + allowedDomain.ip_to_use);
            }
        };

        if (allowedDomain.service) {
            const ipObj = getIPObjectById(allowedDomain.service);
            addresses[ allowedDomain.domain ] = getIP(ipObj)!;
            return;
        }

        const addDomain = (domain: string | undefined, ipObject: IpObject, src: string) => {
            if (!domain) {
                return;
            }

            if (!domain.includes(allowedDomain.domain)) {
                return;
            }

            const ip = getIP(ipObject);

            if (!ip) {
                return;
            }

            const domainPostHttp = domain.split('://').pop()!;
            const finalDomain = domainPostHttp.split('/')[ 0 ];

            // if (addressList.some(entry => entry[ 0 ] === domain && entry[ 1 ] === ip)) {
            //     return;
            // }

            addresses[ finalDomain ] = ip;
            // addressList.push([ finalDomain, ip, src ]);
        };

        networks.forEach(network => {
            addDomain(network.ddns, network, 'network-ddns');

            network.peers.forEach(peer => {
                addDomain(peer.domain, peer, 'peer');

                peer.access?.forEach(access => {
                    addDomain(access.domain, peer, 'peer-access');
                });

                const checkService = (service: ServiceSchema) => {
                    addDomain(service.domain, service, 'service');

                    service.access?.forEach(access => {
                        addDomain(access.domain, service, 'service-access');
                    });
                }

                peer.services?.forEach(checkService);
            });
        });

    });

    // console.log(addressList);

    return {
        type: options.type,
        files: {
            [ options.paths[ 'dnsmasq.conf' ] ]: formatDnsmasqConf(
                renderDnsmasqConf({
                    port,
                    dns: options.dns,
                    addressGroups: Object.entries(addressGroups).map(([ group, addresses ]) => ({
                        group,
                        addresses: Object.entries(addresses).map(([ domain, ip ]) => ({
                            domain,
                            ip,
                        })),
                    })),
                })
            ),
        },
    };
};
