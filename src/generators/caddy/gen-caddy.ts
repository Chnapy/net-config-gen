import path from "path";
import z from "zod";
import type { MainSchema, ServiceSchema } from "../../schema.ts";
import { formatCaddyfile } from './format-caddyfile.ts';
import { renderCaddyfile, type RenderAddress, type RenderRestrictedSnippet } from './templates/Caddyfile.ts';

export const genCaddySchema = z.object({
    type: z.literal("caddy"),
    paths: z.object({
        Caddyfile: z.string().nonempty(),
    }),
    email: z.email(),
    domains: z.array(z.string().nonempty()),
});
export type GenCaddyOptions = z.infer<typeof genCaddySchema>;

export const genCaddy = async (
    generatorService: ServiceSchema,
    networks: MainSchema[ "networks" ],
    options: GenCaddyOptions,
) => {
    const entries: { [ domain: string ]: RenderAddress } = {};
    const restrictedSnippets: Record<string, RenderRestrictedSnippet> = {};

    networks.forEach((network) => {
        network.peers.forEach((peer) => {
            const checkService = (service: ServiceSchema) => {
                service.access?.forEach((access) => {
                    if (access.type === "http" && access.domain) {
                        const domain = access.domain.startsWith("https://")
                            ? access.domain.slice(8)
                            : access.domain;

                        const domainParts = domain.split("://");
                        const domainEnd = domainParts.pop()!;
                        const [ domainBase, ...pathParts ] = domainEnd.split("/");

                        if (!options.domains.some(d => domainBase.endsWith(d))) {
                            return;
                        }

                        const domainFinal = [ domainParts[ 0 ], domainBase ]
                            .filter(Boolean)
                            .join("://");
                        const pathFinal =
                            pathParts.length > 0 ? path.join("/", ...pathParts, "*") : "";

                        const restrictedIPSubnets = access.expose_outside_vpn
                            ? []
                            : Array.from(
                                new Set(
                                    [
                                        generatorService.vpn_ip,
                                        service.vpn_ip,
                                        peer.vpn_ip,
                                    ]
                                        .filter((ip) => ip !== undefined)
                                        .map((ip) => {
                                            const ipParts = ip.split(".");
                                            ipParts.pop();
                                            return `${ipParts.join(".")}.0/24`;
                                        }),
                                ),
                            );

                        const getRestrictedSnippet = () => {
                            if (restrictedIPSubnets.length === 0) {
                                return;
                            }
                            const restrictedSnippetKey = restrictedIPSubnets.join(" ");

                            if (restrictedSnippets[ restrictedSnippetKey ]) {
                                return restrictedSnippets[ restrictedSnippetKey ];
                            }

                            const existingSnippet = Object.values(restrictedSnippets).find(snip => restrictedIPSubnets.every(sub => snip.ipSubnets.includes(sub)));
                            if (existingSnippet) {
                                return existingSnippet;
                            }

                            const snippetsLength = Object.values(restrictedSnippets).length;
                            const snippet = {
                                name: snippetsLength
                                    ? `restricted-${snippetsLength}`
                                    : "restricted",
                                ipSubnets: restrictedIPSubnets,
                            };
                            restrictedSnippets[ restrictedSnippetKey ] = snippet;
                            return snippet;
                        };

                        const snippet = getRestrictedSnippet();

                        const entry = entries[ domainFinal ] ?? {
                            domain: domainFinal,
                            snippetName: snippet?.name,
                            paths: [],
                        };

                        entry.paths.push({
                            path: pathFinal,
                            ip: service.vpn_ip ?? service.lan_ip!,
                            port: access.internal_port ?? access.port,
                            ssl: access.ssl ?? false,
                        });

                        entries[ domainFinal ] = entry;
                    }
                });

                service.services?.forEach((s) =>
                    checkService({
                        ...s,
                        lan_ip: s.lan_ip ?? service.lan_ip,
                        vpn_ip: s.vpn_ip ?? service.vpn_ip,
                    }),
                );
            };

            peer.services?.forEach((service) =>
                checkService({
                    ...service,
                    lan_ip: service.lan_ip ?? peer.lan_ip,
                    vpn_ip: service.vpn_ip ?? peer.vpn_ip,
                }),
            );
        });
    });

    return {
        type: options.type,
        files: {
            [ options.paths[ "Caddyfile" ] ]: await formatCaddyfile(
                renderCaddyfile({
                    email: options.email,
                    restrictedSnippets: Object.values(restrictedSnippets),
                    addresses: Object.values(entries),
                })
            ),
        },
    };
};
