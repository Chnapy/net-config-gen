export const formatDnsmasqConf = (dnsmasqConf: string): string => {
    return dnsmasqConf
        .replaceAll(/\n+/gm, '\n')
        .trimStart()
        .replaceAll(/(?<!^#.*\n)^(#).*$/gm, (substring, _, i) => {
            if (!i) {
                return substring;
            }

            return `\n${substring}`;
        });
};
