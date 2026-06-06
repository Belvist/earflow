import { toArrayBuffer, u32be, utf8Bytes } from '../lib/bytes';

export async function hkdfSha256(params: {
    ikm: Uint8Array;
    salt: Uint8Array;
    info: Uint8Array;
    length: number;
}): Promise<Uint8Array> {
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

export async function aesGcmDecrypt(params: {
    keyBytes: Uint8Array;
    iv12: Uint8Array;
    ciphertext: Uint8Array;
    aad?: Uint8Array;
}): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', toArrayBuffer(params.keyBytes), { name: 'AES-GCM' }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(params.iv12), additionalData: params.aad ? toArrayBuffer(params.aad) : undefined },
        key,
        toArrayBuffer(params.ciphertext)
    );
    return new Uint8Array(pt);
}

export async function aesCtrDecrypt(keyBytes: Uint8Array, iv16: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'AES-CTR' }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt(
        { name: 'AES-CTR', counter: toArrayBuffer(iv16), length: 64 },
        key,
        toArrayBuffer(ciphertext)
    );
    return new Uint8Array(pt);
}

export async function deriveTrackKeyMasterKey(params: { trackKeyMasterSecret: Uint8Array }): Promise<Uint8Array> {
    return hkdfSha256({
        ikm: params.trackKeyMasterSecret,
        salt: utf8Bytes('ebap-track-key-master-salt'),
        info: utf8Bytes('ebap-track-key-master'),
        length: 32,
    });
}

export async function unwrapTrackKeyFromStorage(params: {
    trackKeyMasterSecret: Uint8Array;
    trackId: number;
    trackSalt: Uint8Array;
    trackKeyMasterIv: Uint8Array;
    wrappedTrackKeyMaster: Uint8Array;
}): Promise<Uint8Array> {
    const masterKey = await deriveTrackKeyMasterKey({ trackKeyMasterSecret: params.trackKeyMasterSecret });
    const aad = new Uint8Array([
        ...utf8Bytes('ebap-track-key'),
        ...u32be(params.trackId),
        ...params.trackSalt,
    ]);

    return aesGcmDecrypt({
        keyBytes: masterKey,
        iv12: params.trackKeyMasterIv,
        ciphertext: params.wrappedTrackKeyMaster,
        aad,
    });
}

export async function decryptTrackChunk(params: { trackKey: Uint8Array; chunkIndex: number; ciphertext: Uint8Array }): Promise<Uint8Array> {
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

    return aesCtrDecrypt(keyBytes, iv, params.ciphertext);
}
