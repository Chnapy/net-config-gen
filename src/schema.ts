import { z } from "zod";
import { generatorSchema } from './generators/generator.ts';

export const accessSchema = z.object({
    type: z.enum([ 'ssh', 'http', 'tcp', 'udp' ]).optional(),
    port: z.number().nonnegative(),
    internal_port: z.number().nonnegative().optional(),
    domain_port: z.number().nonnegative().optional(),
    domain: z.string().nonempty().optional(),
    ssl: z.boolean().optional(),
    expose_outside_vpn: z.boolean().optional(),
    port_forward: z.boolean().optional(),
});
export type AccessSchema = z.infer<typeof accessSchema>;

export const serviceSchema = z.object({
    id: z.string().nonempty(),
    name: z.string().nonempty(),
    icon: z.string().nonempty(),
    description: z.string(),
    type: z.enum([ 'docker-container', 'proxmox-lxc', 'proxmox-vm' ]).optional(),
    role: z.enum([ 'reverse-proxy', 'vpn-server' ]).optional(),
    lan_ip: z.ipv4().optional(),
    vpn_ip: z.ipv4().optional(),
    domain: z.string().optional(),
    access: z.array(accessSchema).optional(),
    generator: generatorSchema.optional(),
    get services() {
        return z.array(serviceSchema).optional();
    },
});
export type ServiceSchema = z.infer<typeof serviceSchema>;

export const peerSchema = z.object({
    id: z.string().nonempty(),
    name: z.string().nonempty(),
    icon: z.string().nonempty(),
    description: z.string(),
    type: z.enum([ 'router', 'server', 'desktop', 'mediacenter', 'cloud' ]),
    network_entrypoint: z.boolean().optional(),
    lan_ip: z.ipv4().optional(),
    vpn_ip: z.ipv4().optional(),
    domain: z.string().optional(),
    access: z.array(accessSchema).optional(),
    services: z.array(serviceSchema).optional(),
});
export type PeerSchema = z.infer<typeof peerSchema>;

export const networkSchema = z.object({
    id: z.string().nonempty(),
    name: z.string().nonempty(),
    description: z.string(),
    wan_ip: z.ipv4(),
    ddns: z.string().optional(),
    peers: z.array(peerSchema),
});
export type NetworkSchema = z.infer<typeof networkSchema>;

export const mainSchema = z.object({
    networks: z.array(networkSchema),
});
export type MainSchema = z.infer<typeof mainSchema>;
