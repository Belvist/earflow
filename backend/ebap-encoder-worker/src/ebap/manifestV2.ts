import { z } from 'zod';

export const manifestV2Schema = z.object({
    version: z.literal(2),
    trackId: z.number().int().positive(),
    codec: z.literal('opus'),
    mime: z.literal('application/ebap-opus-packets'),
    trackSaltB64: z.string().min(1),
    trackKeyMasterIvB64: z.string().min(1),
    wrappedTrackKeyMasterB64: z.string().min(1),
    chunks: z
        .array(
            z.object({
                index: z.number().int().nonnegative(),
                key: z.string().min(1),
                size: z.number().int().nonnegative(),
                sha256B64: z.string().min(1),
            })
        )
        .min(1),
});

export type ManifestV2 = z.infer<typeof manifestV2Schema>;

export function parseManifestV2OrThrow(value: unknown): ManifestV2 {
    return manifestV2Schema.parse(value);
}
