export function opusPacketGetSamplesPerFrame(packet: Uint8Array, sampleRate: number): number {
    if (packet.byteLength < 1) {
        throw new Error('OPUS_BAD_PACKET');
    }

    const toc = packet[0]! & 0xff;
    let audioSize: number;

    if ((toc & 0x80) !== 0) {
        audioSize = (toc >> 3) & 0x03;
        audioSize = (sampleRate << audioSize) / 400;
    } else if ((toc & 0x60) === 0x60) {
        audioSize = (toc & 0x08) !== 0 ? sampleRate / 50 : sampleRate / 100;
    } else {
        audioSize = (toc >> 3) & 0x03;
        if (audioSize === 3) {
            audioSize = (sampleRate * 60) / 1000;
        } else {
            audioSize = (sampleRate << audioSize) / 100;
        }
    }

    return Math.trunc(audioSize);
}

export function opusPacketGetNbFrames(packet: Uint8Array): number {
    if (packet.byteLength < 1) {
        throw new Error('OPUS_BAD_PACKET');
    }

    const toc = packet[0]! & 0xff;
    const count = toc & 0x03;

    if (count === 0) return 1;
    if (count !== 3) return 2;

    if (packet.byteLength < 2) {
        throw new Error('OPUS_BAD_PACKET');
    }

    return packet[1]! & 0x3f;
}

export function opusPacketGetNbSamples(packet: Uint8Array, sampleRate: number): number {
    const frames = opusPacketGetNbFrames(packet);
    const samplesPerFrame = opusPacketGetSamplesPerFrame(packet, sampleRate);
    return Math.trunc(frames * samplesPerFrame);
}
