import type { GetDeviceFull, operations } from 'homenet-types';
import z from 'zod';
import type { AccessSchema, MainSchema, ServiceSchema } from '../../schema.ts';

export const genHomenetSchema = z.object({
    type: z.literal('homenet'),
    safeMode: z.boolean().optional(),
    themes: z.array(z.enum<Theme[]>([ "default", "mauve", "blue", "green", "yellow" ])).optional(),
    paths: z.object({
        "devices.json": z.string().nonempty(),
        "metadata.json": z.string().nonempty().optional(),
    }),
});
export type GenHomenetOptions = z.infer<typeof genHomenetSchema>;

type UserMetadata = operations[ 'getDevicesUserMetadata' ][ 'responses' ][ '200' ][ 'content' ][ 'application/json' ][ 'result' ][ 'data' ];
type Metadata = UserMetadata[ string ];
type Theme = Metadata[ 'theme' ];

type Device = GetDeviceFull[ 'deviceList' ][ number ];
type Instance = GetDeviceFull[ 'instanceList' ][ number ];
type App = GetDeviceFull[ 'appList' ][ number ];
// type Agent = GetDeviceFull[ 'agentMetadataList' ][ number ];
type NetEntity = GetDeviceFull[ 'netEntityMap' ][ string ];

export const genHomenet = async (generatorService: ServiceSchema, networks: MainSchema[ 'networks' ], options: GenHomenetOptions) => {
    const devices: GetDeviceFull = {
        safeMode: options.safeMode,
        deviceList: [],
        instanceList: [],
        appList: [],
        agentMetadataList: [],
        netEntityMap: {},
    };
    const metadata: UserMetadata = {};

    const reverseProxy: App[ 'reverseProxy' ] = [];
    const vpnClients: App[ 'vpnClients' ] = [];

    let peerIndex = -1;

    networks.forEach(network => {
        network.peers.forEach(peer => {
            peerIndex++;

            const getType = (): Device[ 'type' ] => {
                if (peer.services?.find(service => service.type === 'docker-container')) {
                    return 'DOCKER';
                }
                if (peer.services?.find(service => service.type === 'proxmox-vm' || service.type === 'proxmox-lxc')) {
                    return 'PROXMOX';
                }
                return 'DEVICE';
            };

            const getOs = (): Device[ 'os' ] => {
                if (getType() === 'PROXMOX') {
                    return 'PROXMOX';
                }
                return 'UNRECOGNIZED';
            };

            const peerId = peer.id;
            const peerSshPorts = peer.access?.filter(access => access.type === 'ssh').map(access => access.port);
            const peerWebs = peer.access?.filter(access => access.type === 'http') ?? [];

            const lanIp = peer.services?.find(service => service.lan_ip)?.lan_ip;

            const peerDevice: Device = {
                id: peerId,
                type: getType(),
                os: getOs(),
                wan: peer.network_entrypoint ? network.wan_ip : undefined,
                ddns: peer.network_entrypoint ? network.ddns : undefined,
                lan: peer.lan_ip ?? lanIp!,
                dhcp: [],
                ssh: peerSshPorts && { ports: peerSshPorts },
                web: peerWebs.map(({ port, ssl = false }) => ({ port, ssl, paths: [] })),
                meta: {
                    name: peer.name,
                    description: peer.description,
                    icon: peer.icon,
                },
            };
            devices.deviceList.push(peerDevice);

            let peerNetEntity: NetEntity = {
                id: peerId,
                addressList: ([
                    {
                        type: 'address-only',
                        scope: 'lan',
                        address: peerDevice.lan,
                    },
                    peer.vpn_ip && {
                        type: 'address-only',
                        scope: 'vpn',
                        address: peer.vpn_ip,
                    },
                    peerDevice.wan && {
                        type: 'address-only',
                        scope: 'wan',
                        address: peerDevice.wan,
                    },
                    peerDevice.ddns && {
                        type: 'address-only',
                        scope: 'dns-domain',
                        address: peerDevice.ddns,
                    },
                ] satisfies (NetEntity[ 'addressList' ][ number ] | '' | undefined)[])
                    .filter(o => typeof o === 'object'),
                lan: peerDevice.lan,
                wan: peerDevice.wan,
                ddns: peerDevice.ddns,
                vpn: peer.vpn_ip,
                os: [],
                apps: {
                    [ peerDevice.os ]: []
                },
            };
            devices.netEntityMap[ peerNetEntity.id ] = peerNetEntity;

            if (peer.services?.find(service => service.type === 'docker-container')) {
                const peerInstance: Instance = {
                    parentId: peerDevice.id,
                    id: peerDevice.id + '-docker',
                    type: 'DOCKER',
                    os: 'DOCKER',
                    // wan: peerDevice.wan,
                    // ddns: peerDevice.ddns,
                    lan: peerDevice.lan,
                    dhcp: [],
                    // ssh: serviceSshPorts && { ports: serviceSshPorts },
                    web: [],
                    meta: {
                        name: 'Docker compose',
                        description: '',
                        // icon: ,
                    },
                };
                devices.instanceList.push(peerInstance);

                const instanceNetEntity: NetEntity = {
                    id: peerInstance.id,
                    addressList: ([
                        {
                            type: 'address-only',
                            scope: 'lan',
                            address: peerInstance.lan,
                        },
                        peer.vpn_ip && {
                            type: 'address-only',
                            scope: 'vpn',
                            address: peer.vpn_ip,
                        },
                        peerInstance.wan && {
                            type: 'address-only',
                            scope: 'wan',
                            address: peerInstance.wan,
                        },
                        peerInstance.ddns && {
                            type: 'address-only',
                            scope: 'dns-domain',
                            address: peerInstance.ddns,
                        },
                    ] satisfies (NetEntity[ 'addressList' ][ number ] | '' | undefined)[])
                        .filter(o => typeof o === 'object'),
                    lan: peerInstance.lan,
                    wan: peerInstance.wan,
                    ddns: peerInstance.ddns,
                    vpn: peer.vpn_ip,
                    os: [],
                    apps: {
                        [ peerInstance.os ]: []
                    },
                };
                devices.netEntityMap[ instanceNetEntity.id ] = instanceNetEntity;
                peerNetEntity = instanceNetEntity;
            }

            metadata[ peerId ] = {
                deviceId: peerId,
                name: peer.name,
                type: peer.type,
                theme: options.themes
                    ? options.themes[ peerIndex % options.themes.length ] ?? 'default'
                    : 'default',
            };

            let currentNetEntity = peerNetEntity;

            const checkService = (parentId: string, service: ServiceSchema) => {
                const id = service.id;
                const serviceSshPorts = peer.access?.filter(access => access.type === 'ssh').map(access => access.port);
                const serviceWebs = peer.access?.filter(access => access.type === 'http') ?? [];

                const hasDockerChildren = service.services?.some(s => s.type === 'docker-container');

                const getType = (): Instance[ 'type' ] => {
                    if (service.type === 'docker-container') {
                        return 'DOCKER';
                    }
                    if (service.type === 'proxmox-vm' || service.type === 'proxmox-lxc') {
                        return 'PROXMOX';
                    }
                    return 'UNRECOGNIZED';
                };

                const getOs = (): Instance[ 'os' ] => {
                    if (getType() === 'PROXMOX') {
                        return 'PROXMOX';
                    }
                    return 'UNRECOGNIZED';
                };

                const getSlug = (): App[ 'slug' ] => {
                    if (service.id === generatorService.id) {
                        return 'HOMENET';
                    }
                    if (service.role === 'vpn-server') {
                        return 'WIREGUARD';
                    }
                    // return 'UNRECOGNIZED';
                    return service.id;
                };

                const getVpnMode = (): App[ 'vpnMode' ] => {
                    if (service.role === 'vpn-server') {
                        return 'SERVER';
                    }
                    if (service.vpn_ip) {
                        return 'CLIENT';
                    }
                    return 'UNRECOGNIZED';
                };

                const getAccessHref = ({ type, port, domain, ssl, domain_port }: AccessSchema, ip?: string) => {
                    if (type === 'http') {
                        if (port === 443) ssl = true;

                        if ((port === 80 && !ssl) || (port === 443 && ssl)) {
                            port = 0;
                        }

                        if (ip) {
                            return `${ip.includes('://') ? '' : (ssl ? 'https://' : 'http://')}${ip}${port ? `:${port}` : ''}`;
                        } else if (domain) {
                            return `${domain.includes('://') ? '' : (ssl ? 'https://' : 'http://')}${domain}${domain_port ? `:${domain_port}` : ''}`;
                        }
                    } else if (type === 'ssh') {
                        if (port === 22) {
                            port = 0;
                        }

                        if (ip) {
                            return `${ip.includes('://') ? '' : 'ssh://'}${ip}${port ? `:${port}` : ''}`;
                        } else if (domain) {
                            return `${domain.includes('://') ? '' : 'ssh://'}${domain}${domain_port ? `:${domain_port}` : ''}`;
                        }
                    }

                    return '';
                };

                if (service.type === 'proxmox-vm' || hasDockerChildren) {
                    const serviceInstance: Instance = {
                        parentId,
                        id,
                        type: getType(),
                        os: getOs(),
                        wan: peer.network_entrypoint ? network.wan_ip : undefined,
                        ddns: peer.network_entrypoint ? network.ddns : undefined,
                        lan: service.lan_ip!,
                        dhcp: [],
                        ssh: serviceSshPorts && { ports: serviceSshPorts },
                        web: serviceWebs.map(({ port, ssl = false }) => ({ port, ssl, paths: [] })),
                        meta: {
                            name: service.name,
                            description: service.description,
                            icon: service.icon,
                        },
                    };
                    devices.instanceList.push(serviceInstance);
                    // currentDevice = serviceInstance;

                    const serviceNetEntity: NetEntity = {
                        id,
                        addressList: ([
                            {
                                type: 'address-only',
                                scope: 'lan',
                                address: serviceInstance.lan,
                            },
                            service.vpn_ip && {
                                type: 'address-only',
                                scope: 'vpn',
                                address: service.vpn_ip,
                            },
                            serviceInstance.wan && {
                                type: 'address-only',
                                scope: 'wan',
                                address: serviceInstance.wan,
                            },
                            serviceInstance.ddns && {
                                type: 'address-only',
                                scope: 'dns-domain',
                                address: serviceInstance.ddns,
                            },
                        ] satisfies (NetEntity[ 'addressList' ][ number ] | '' | undefined)[])
                            .filter(o => typeof o === 'object'),
                        lan: serviceInstance.lan,
                        wan: serviceInstance.wan,
                        ddns: serviceInstance.ddns,
                        vpn: service.vpn_ip,
                        os: [],
                        apps: {
                            [ serviceInstance.os ]: []
                        },
                    };
                    devices.netEntityMap[ serviceNetEntity.id ] = serviceNetEntity;
                    currentNetEntity = serviceNetEntity;

                    service.access?.forEach(access => {
                        if (access.type !== 'http' && access.type !== 'ssh') {
                            return;
                        }

                        if (options.safeMode && (!access.expose_outside_vpn || peer.type == 'router')) {
                            return;
                        }

                        const type = access.type === 'http' ? 'web' : 'ssh';

                        if (access.domain)
                            serviceNetEntity.os.push({
                                type,
                                scope: access.expose_outside_vpn ? 'wan' : 'vpn',
                                address: access.domain,
                                href: getAccessHref(access),
                                ssl: access.ssl,
                                port: access.port,
                            });
                        if (service.domain)
                            serviceNetEntity.os.push({
                                type,
                                scope: 'wan',
                                address: service.domain,
                                href: getAccessHref(access, service.domain),
                                ssl: access.ssl,
                                port: access.port,
                            });
                        if (service.vpn_ip)
                            serviceNetEntity.os.push({
                                type,
                                scope: 'vpn',
                                address: service.vpn_ip,
                                href: getAccessHref(access, service.vpn_ip),
                                ssl: access.ssl,
                                port: access.port,
                            });
                        if (service.lan_ip)
                            serviceNetEntity.os.push({
                                type,
                                scope: 'lan',
                                address: service.lan_ip,
                                href: getAccessHref(access, service.lan_ip),
                                ssl: access.ssl,
                                port: access.port,
                            });
                    });

                } else {
                    const serviceApp: App = {
                        parentId,
                        id,
                        slug: getSlug(),
                        vpnMode: getVpnMode(),
                        vpnAddress: service.vpn_ip,
                        vpnClients: service.role === 'vpn-server' ? vpnClients : [],
                        reverseProxy: service.role === 'reverse-proxy' ? reverseProxy : [],
                        web: serviceWebs.map(({ port, ssl = false }) => ({ port, ssl, paths: [] })),
                        meta: {
                            name: service.name,
                            description: service.description,
                            icon: service.icon,
                        },
                    };
                    devices.appList.push(serviceApp);

                    currentNetEntity.apps[ serviceApp.slug ] ??= [];

                    if (service.role !== 'reverse-proxy') {
                        service.access?.forEach(access => {
                            if (access.type !== 'http' && access.type !== 'ssh') {
                                return;
                            }

                            if (options.safeMode && (!access.expose_outside_vpn || peer.type == 'router')) {
                                return;
                            }

                            const type = access.type === 'http' ? 'web' : 'ssh';

                            if (access.domain)
                                currentNetEntity.apps[ serviceApp.slug ]!.push({
                                    type,
                                    scope: access.expose_outside_vpn ? 'wan' : 'vpn',
                                    appSlug: serviceApp.slug,
                                    address: access.domain,
                                    href: getAccessHref(access),
                                    ssl: access.ssl,
                                    port: access.port,
                                });
                            if (service.domain)
                                currentNetEntity.apps[ serviceApp.slug ]!.push({
                                    type,
                                    scope: 'vpn',
                                    appSlug: serviceApp.slug,
                                    address: service.domain,
                                    href: getAccessHref(access, service.domain),
                                    ssl: access.ssl,
                                    port: access.port,
                                });
                            if (service.vpn_ip)
                                currentNetEntity.apps[ serviceApp.slug ]!.push({
                                    type,
                                    scope: 'vpn',
                                    appSlug: serviceApp.slug,
                                    address: service.vpn_ip,
                                    href: getAccessHref(access, service.vpn_ip),
                                    ssl: access.ssl,
                                    port: access.port,
                                });
                            if (service.lan_ip)
                                currentNetEntity.apps[ serviceApp.slug ]!.push({
                                    type,
                                    scope: 'lan',
                                    appSlug: serviceApp.slug,
                                    address: service.lan_ip,
                                    href: getAccessHref(access, service.lan_ip),
                                    ssl: access.ssl,
                                    port: access.port,
                                });
                        });
                    }
                }

                if (getVpnMode() === 'CLIENT' && service.vpn_ip) {
                    vpnClients.push(service.vpn_ip);
                }

                if (service.role !== 'reverse-proxy') {
                    service.access?.forEach(access => {
                        if (access.domain) {
                            reverseProxy.push({
                                fromDomain: {
                                    domain: access.domain,
                                    ssl: access.domain.startsWith('https'),
                                },
                                toAddress: {
                                    address: service.vpn_ip ?? service.lan_ip!,
                                    ssl: access.ssl ?? false,
                                    port: access.port,
                                },
                            });
                        }
                    });
                }

                service.services?.forEach(s => checkService(id, {
                    lan_ip: service.lan_ip,
                    vpn_ip: service.vpn_ip,
                    domain: service.domain,
                    ...s,
                }));
            };

            peer.services?.forEach(service => {
                currentNetEntity = peerNetEntity;

                checkService(currentNetEntity.id, {
                    lan_ip: peer.lan_ip,
                    vpn_ip: peer.vpn_ip,
                    domain: peer.domain,
                    ...service,
                });
            });
        });
    });

    devices.appList.sort((a, b) => {
        if (!options.safeMode) {
            return 0;
        }

        const aNet = devices.netEntityMap[ a.parentId ]?.apps[ a.slug ] ?? [];
        const bNet = devices.netEntityMap[ b.parentId ]?.apps[ b.slug ] ?? [];

        return aNet.some(n => n.scope === 'wan') && !bNet.some(n => n.scope === 'wan') ? -1 : 0;
    });

    const metadataFile = options.paths[ 'metadata.json' ] && {
        [ options.paths[ 'metadata.json' ] ]: JSON.stringify(metadata, undefined, 2),
    };

    return {
        type: options.type,
        files: {
            [ options.paths[ 'devices.json' ] ]: JSON.stringify(devices, undefined, 2),
            ...metadataFile,
        },
    };
};
