import type { Config, Endpoint } from 'gatus-types';
import yaml from 'yaml';
import z from 'zod';
import type { AccessSchema, MainSchema, ServiceSchema } from '../../schema.ts';

export const genGatusSchema = z.object({
    type: z.literal('gatus'),
    mode: z.enum([ 'all', 'partial' ]),
    alerting: z.object({
        service: z.string().nonempty(),
        topic: z.string().nonempty(),
        token: z.string().nonempty(),
    }).optional(),
    ui: z.object({
        header: z.string().nonempty().optional(),
        title: z.string().nonempty().optional(),
    }).optional(),
    paths: z.object({
        "config.yaml": z.string().nonempty(),
    }),
});
export type GenGatusOptions = z.infer<typeof genGatusSchema>;

type IpObject = Pick<ServiceSchema, 'name' | 'lan_ip' | 'vpn_ip' | 'domain'>;

export const genGatus = async (generatorService: ServiceSchema, networks: MainSchema[ 'networks' ], options: GenGatusOptions) => {

    const config: Config = {
        ui: {
            header: options.ui?.header,
            title: [ options.ui?.title, options.ui?.header ].filter(Boolean).join(' | ') || undefined,
            "dashboard-heading": options.ui?.title,
        },
    };

    const endpointsByUrl: Record<string, AddEndpointPayload[]> = {};

    const generatorServiceIPParts = generatorService.lan_ip?.split('.');
    generatorServiceIPParts?.pop();
    const generatorServiceIPSubnet = generatorServiceIPParts?.join('.');

    type AddEndpointPayload = {
        scope: 'network' | 'peer' | 'service';
        target: 'wan' | 'ddns' | 'lan' | 'vpn' | 'hostname' | 'domain';
        group: string;
        name: string;
        url: string;
        protocol: 'icmp' | 'http' | 'https' | 'ssh' | 'tcp' | 'udp';
        port?: number;
        enabled: boolean;
    };

    const getUrl = ({ url, protocol, port }: Pick<AddEndpointPayload, 'url' | 'protocol' | 'port'>) => {
        if (protocol === 'http' &&
            (port === 443 || url.startsWith('https://'))
        ) {
            protocol = 'https';
        }

        const prefix = url.includes('://') ? '' : (protocol + '://');

        url = `${prefix}${url}${port ? (':' + port) : ''}`;

        return { url, protocol };
    };

    const getName = (payload: AddEndpointPayload, similarPayloads: AddEndpointPayload[]) => {
        let { name, url, protocol, port } = payload;

        if (protocol === 'http' && port === 80) {
            port = undefined;
        } else if (protocol === 'https' && port === 443) {
            port = undefined;
        }

        const finalScope = [ ...new Set(similarPayloads.map(ep => `[${[
            ep.scope[ 0 ],
            ep.target.substring(0, 4),
        ].filter(Boolean).join('/')}]`)) ].join(' ');

        if (options.mode === 'all') {
            return [
                url,
                finalScope
            ].filter(Boolean).join(' ');
        }

        return [
            // name,
            name,
            protocol.toUpperCase(),
            port && ':' + port,
            finalScope
        ].filter(Boolean).join(' ');
    };

    const addEndpoint = (payload: AddEndpointPayload) => {
        const { url } = getUrl(payload);

        endpointsByUrl[ url ] = [
            ...(endpointsByUrl[ url ] ?? []),
            payload,
        ];
        return payload;
    };

    const addSimilarEndpoints = (payloads: (AddEndpointPayload | '' | 0 | false | undefined)[]) => {
        for (const payload of payloads.filter(v => typeof v === 'object')) {
            addEndpoint(payload);

            if (options.mode === 'partial') {
                break;
            }
        }
    };

    networks.forEach(network => {
        network.peers.forEach(peer => {

            const enabled = peer.type !== 'desktop';

            const sameNetworkAsGenerator = !!generatorServiceIPSubnet && !!peer.lan_ip && peer.lan_ip.startsWith(generatorServiceIPSubnet);

            const addAccessEndpoint = (group: string, ipObject: IpObject, access: AccessSchema, protocol: AddEndpointPayload[ 'protocol' ], scope: AddEndpointPayload[ 'scope' ]) => {
                addSimilarEndpoints([
                    access.domain && {
                        scope: scope,
                        target: 'domain',
                        group,
                        name: ipObject.name,
                        url: access.domain,
                        protocol,
                        port: access.domain_port,
                        enabled,
                    },
                    network.ddns && access.expose_outside_vpn && (peer.network_entrypoint || access.port_forward) && {
                        scope: scope,
                        target: 'domain',
                        group,
                        name: ipObject.name,
                        url: network.ddns,
                        protocol,
                        port: access.port,
                        enabled,
                    },
                    ipObject.domain && {
                        scope: scope,
                        target: 'hostname',
                        group,
                        name: ipObject.name,
                        url: ipObject.domain,
                        protocol,
                        port: access.port,
                        enabled,
                    },
                    ipObject.domain && access.internal_port && access.internal_port !== access.port && {
                        scope: scope,
                        target: 'hostname',
                        group,
                        name: ipObject.name,
                        url: ipObject.domain,
                        protocol,
                        port: access.internal_port,
                        enabled,
                    },
                    ipObject.vpn_ip && {
                        scope: scope,
                        target: 'vpn',
                        group,
                        name: ipObject.name,
                        url: ipObject.vpn_ip,
                        protocol,
                        port: access.port,
                        enabled,
                    },
                    ipObject.vpn_ip && access.internal_port && access.internal_port !== access.port && {
                        scope: scope,
                        target: 'vpn',
                        group,
                        name: ipObject.name,
                        url: ipObject.vpn_ip,
                        protocol,
                        port: access.internal_port,
                        enabled,
                    },
                    network.wan_ip && access.expose_outside_vpn && (peer.network_entrypoint || access.port_forward) && {
                        scope: scope,
                        target: 'wan',
                        group,
                        name: ipObject.name,
                        url: network.wan_ip,
                        protocol,
                        port: access.port,
                        enabled,
                    },
                    ipObject.lan_ip && sameNetworkAsGenerator && {
                        scope,
                        target: 'lan',
                        group,
                        name: ipObject.name,
                        url: ipObject.lan_ip,
                        protocol,
                        port: access.port,
                        enabled,
                    },
                    ipObject.lan_ip && sameNetworkAsGenerator && access.internal_port && access.internal_port !== access.port && {
                        scope: scope,
                        target: 'lan',
                        group,
                        name: ipObject.name,
                        url: ipObject.lan_ip,
                        protocol,
                        port: access.internal_port,
                        enabled,
                    },
                ]);
            };

            const addAccess = (group: string, ipObject: IpObject, access: AccessSchema, scope: AddEndpointPayload[ 'scope' ]) => {
                switch (access.type) {
                    case 'ssh':
                        return addAccessEndpoint(
                            group,
                            ipObject,
                            access,
                            'ssh',
                            scope,
                        );
                    case 'http':
                        return addAccessEndpoint(
                            group,
                            ipObject,
                            access,
                            access.ssl ? 'https' : 'http',
                            scope,
                        );
                    case 'tcp':
                        return addAccessEndpoint(
                            group,
                            ipObject,
                            access,
                            'tcp',
                            scope,
                        );
                    case 'udp':
                        return addAccessEndpoint(
                            group,
                            ipObject,
                            access,
                            'udp',
                            scope,
                        );
                }
            };

            const checkService = (group: string, service: ServiceSchema) => {

                const sameNetworkAsGenerator = !!generatorServiceIPSubnet && !!service.lan_ip && service.lan_ip.startsWith(generatorServiceIPSubnet);

                service.access?.forEach(access => addAccess(
                    group,
                    service,
                    service.role === 'reverse-proxy' && access.type === 'http'
                        ? { ...access, type: 'tcp' }
                        : access,
                    'service'
                ));

                if (options.mode === 'all' || !service.access?.length) {
                    addSimilarEndpoints([
                        service.domain && {
                            scope: 'service',
                            target: 'hostname',
                            group,
                            name: service.name,
                            url: service.domain,
                            protocol: 'icmp' as const,
                            enabled,
                        },
                        service.vpn_ip && {
                            scope: 'service',
                            target: 'vpn',
                            group,
                            name: service.name,
                            url: service.vpn_ip,
                            protocol: 'icmp' as const,
                            enabled,
                        },
                        service.lan_ip && sameNetworkAsGenerator && {
                            scope: 'service',
                            target: 'lan',
                            group,
                            name: service.name,
                            url: service.lan_ip,
                            protocol: 'icmp' as const,
                            enabled,
                        },
                    ]);
                }

                if (options.alerting?.service === service.name) {
                    const access = service.access?.find(access => access.type === 'http')!;
                    config.alerting = {
                        ntfy: {
                            topic: options.alerting.topic,
                            url: getUrl({
                                protocol: 'http',
                                url: (sameNetworkAsGenerator
                                    ? service.lan_ip
                                    : service.vpn_ip) ?? service.vpn_ip!,
                                port: access.port,
                            }).url,
                            token: options.alerting.token,
                            "default-alert": {
                                type: 'ntfy',
                                "failure-threshold": 3,
                                "success-threshold": 1,
                                "send-on-resolved": true,
                            },
                        },
                    };
                }

                service.services?.forEach(s => checkService(group, {
                    lan_ip: service.lan_ip,
                    vpn_ip: service.vpn_ip,
                    domain: service.domain,
                    ...s,
                }));
            };

            peer.services?.forEach(service => checkService(service.name, {
                lan_ip: peer.lan_ip,
                vpn_ip: peer.vpn_ip,
                domain: peer.domain,
                ...service,
            }));

            peer.access?.forEach(access => addAccess(peer.name, peer, access, 'peer'));

            if (options.mode === 'all' || (!peer.services?.length && !peer.access?.length)) {
                addSimilarEndpoints([
                    peer.domain && {
                        scope: 'peer',
                        target: 'hostname',
                        group: peer.name,
                        name: peer.name,
                        url: peer.domain,
                        protocol: 'icmp' as const,
                        enabled,
                    },
                    peer.vpn_ip && {
                        scope: 'peer',
                        target: 'vpn',
                        group: peer.name,
                        name: peer.name,
                        url: peer.vpn_ip,
                        protocol: 'icmp' as const,
                        enabled,
                    },
                    peer.lan_ip && sameNetworkAsGenerator && {
                        scope: 'peer',
                        target: 'lan',
                        group: peer.name,
                        name: peer.name,
                        url: peer.lan_ip,
                        protocol: 'icmp' as const,
                        enabled,
                    },
                ]);
            }
        });
    });

    config.endpoints = Object.values(endpointsByUrl).map((eps): Endpoint => {
        const { group, target, enabled = true } = eps[ 0 ];
        const { url, protocol } = getUrl(eps[ 0 ]);

        const name = getName({ ...eps[ 0 ], url, protocol }, eps);

        return {
            group,
            name,
            url,
            enabled: enabled ? undefined : false,
            interval: options.mode === 'partial' ? '5m' : '15m',
            conditions: [
                (protocol === 'icmp'
                    || protocol === 'tcp'
                    || protocol === 'udp') && '[CONNECTED] == true',
                protocol === 'ssh' && '[STATUS] == 0',
                (protocol === 'http'
                    || protocol === 'https') && '[STATUS] == 200',
            ]
                .filter(value => typeof value === 'string'),
            client: protocol === 'https' && target !== 'domain'
                ? {
                    insecure: true,
                    timeout: '10s',
                    network: 'ip',
                }
                : undefined,
            alerts: config.alerting && Object.keys(config.alerting).map(type => ({
                type,
                "failure-threshold": 3,
                "success-threshold": 1,
            })),
        };
    });

    const duplicates = config.endpoints!.filter(ep =>
        config.endpoints!.filter(e => e.name === ep.name && e.group === ep.group).length > 1
    );

    if (duplicates.length > 1) {
        throw new Error('Endpoints named duplicates:\n' + duplicates.map(ep => `group:${ep.group} name:${ep.name} url:${ep.url}`).sort().join('\n'))
    }

    return {
        type: options.type,
        files: {
            [ options.paths[ 'config.yaml' ] ]: '# File generated by net-config-gen\n' + yaml.stringify(config),
        },
    };
};
