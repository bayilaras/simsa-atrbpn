/** Automatic baseline activation is only a local development/test convenience. */
export function allowsLocalRegulatoryBootstrap(source: NodeJS.ProcessEnv = process.env): boolean {
    const mode = source.NODE_ENV || 'development';
    return ['development', 'test'].includes(mode) && !source.K_SERVICE && !source.VERCEL;
}

export function assertLocalRegulatorySeed(): void {
    if (!allowsLocalRegulatoryBootstrap()) {
        throw new Error(
            'Seed bootstrap instrumen hanya tersedia untuk development/test lokal. '
            + 'Deployment wajib memakai PDF sumber privat terverifikasi, manifest kelengkapan, '
            + 'serta pengajuan, telaah, persetujuan, dan aktivasi oleh aktor berwenang melalui alur tata kelola.',
        );
    }
}
