import { toArrayBuffer, utf8Bytes, u32be } from '../lib/bytes';

export async function hkdfSha256(params: { ikm: Uint8Array; salt: Uint8Array; info: Uint8Array; length: number }): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', toArrayBuffer(params.ikm), 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: toArrayBuffer(params.salt),
            info: toArrayBuffer(params.info),
        },
        key,
        params.length * 8
    );
    return new Uint8Array(bits);
}

export async function aesGcmEncrypt(params: { keyBytes: Uint8Array; iv12: Uint8Array; plaintext: Uint8Array; aad?: Uint8Array }): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', toArrayBuffer(params.keyBytes), { name: 'AES-GCM' }, false, ['encrypt']);
    const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(params.iv12), additionalData: params.aad ? toArrayBuffer(params.aad) : undefined },
        key,
        toArrayBuffer(params.plaintext)
    );
    return new Uint8Array(ct);
}

async function aesGcmDecrypt(params: { keyBytes: Uint8Array; iv12: Uint8Array; ciphertext: Uint8Array; aad?: Uint8Array }): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', toArrayBuffer(params.keyBytes), { name: 'AES-GCM' }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(params.iv12), additionalData: params.aad ? toArrayBuffer(params.aad) : undefined },
        key,
        toArrayBuffer(params.ciphertext)
    );
    return new Uint8Array(pt);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const p of parts) total += p.byteLength;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.byteLength;
    }
    return out;
}

export async function deriveTrackKeyMasterKey(params: { trackKeyMasterSecret: Uint8Array }): Promise<Uint8Array> {
    return hkdfSha256({
        ikm: params.trackKeyMasterSecret,
        salt: utf8Bytes('ebap-track-key-master-salt'),
        info: utf8Bytes('ebap-track-key-master'),
        length: 32,
    });
}

export async function wrapTrackKeyForStorage(params: {
    trackKeyMasterSecret: Uint8Array;
    trackId: number;
    trackSalt: Uint8Array;
    trackKey: Uint8Array;
}): Promise<{ trackKeyMasterIv: Uint8Array; wrappedTrackKeyMaster: Uint8Array }> {
    const masterKey = await deriveTrackKeyMasterKey({ trackKeyMasterSecret: params.trackKeyMasterSecret });
    const trackKeyMasterIv = crypto.getRandomValues(new Uint8Array(12));
    const aad = concatBytes([utf8Bytes('ebap-track-key'), u32be(params.trackId), params.trackSalt]);
    const wrappedTrackKeyMaster = await aesGcmEncrypt({
        keyBytes: masterKey,
        iv12: trackKeyMasterIv,
        plaintext: params.trackKey,
        aad,
    });
    return { trackKeyMasterIv, wrappedTrackKeyMaster };
}

export async function tryUnwrapTrackKeyFromStorage(params: {
    trackKeyMasterSecrets: Uint8Array[];
    trackId: number;
    trackSalt: Uint8Array;
    trackKeyMasterIv: Uint8Array;
    wrappedTrackKeyMaster: Uint8Array;
}): Promise<{ trackKey: Uint8Array; keyIndex: number } | null> {
    if (!Number.isInteger(params.trackId) || params.trackId <= 0) {
        throw new Error('Invalid trackId');
    }
    if (!Array.isArray(params.trackKeyMasterSecrets) || params.trackKeyMasterSecrets.length === 0) {
        throw new Error('Missing trackKeyMasterSecrets');
    }

    const aad = concatBytes([utf8Bytes('ebap-track-key'), u32be(params.trackId), params.trackSalt]);

    for (let i = 0; i < params.trackKeyMasterSecrets.length; i++) {
        const secret = params.trackKeyMasterSecrets[i];
        if (!(secret instanceof Uint8Array) || secret.byteLength === 0) continue;

        try {
            const masterKey = await deriveTrackKeyMasterKey({ trackKeyMasterSecret: secret });
            const trackKey = await aesGcmDecrypt({
                keyBytes: masterKey,
                iv12: params.trackKeyMasterIv,
                ciphertext: params.wrappedTrackKeyMaster,
                aad,
            });
            if (trackKey.byteLength !== 32) continue;
            return { trackKey, keyIndex: i };
        } catch {
            continue;
        }
    }

    return null;
}

export async function aesCtrEncrypt(keyBytes: Uint8Array, iv16: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'AES-CTR' }, false, ['encrypt']);
    const ct = await crypto.subtle.encrypt(
        { name: 'AES-CTR', counter: toArrayBuffer(iv16), length: 64 },
        key,
        toArrayBuffer(plaintext)
    );
    return new Uint8Array(ct);
}

export async function encryptTrackChunk(params: { trackKey: Uint8Array; chunkIndex: number; plaintext: Uint8Array }): Promise<Uint8Array> {
    const salt = u32be(params.chunkIndex);

    const keyBytes = await hkdfSha256({
        ikm: params.trackKey,
        salt,
        info: utf8Bytes('ebap-track-chunk-key'),
        length: 32,
    });

    const iv = await hkdfSha256({
        ikm: params.trackKey,
        salt,
        info: utf8Bytes('ebap-track-chunk-iv'),
        length: 16,
    });

    return aesCtrEncrypt(keyBytes, iv, params.plaintext);
}
