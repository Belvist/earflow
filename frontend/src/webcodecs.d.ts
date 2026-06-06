type WebCodecsEncodedAudioChunkType = 'key' | 'delta';

type WebCodecsAudioDataFormat = 'f32-planar' | string;

type WebCodecsAudioDecoderState = 'unconfigured' | 'configured' | 'closed';

type WebCodecsDOMException = DOMException | Error;

type WebCodecsBufferSource = ArrayBuffer | ArrayBufferView;

type WebCodecsAudioDataCopyToOptions = {
    planeIndex: number;
    format?: WebCodecsAudioDataFormat;
};

type WebCodecsAudioDecoderInit = {
    output: (output: AudioData) => void;
    error: (error: WebCodecsDOMException) => void;
};

type WebCodecsAudioDecoderConfig = {
    codec: string;
    sampleRate?: number;
    numberOfChannels?: number;
    description?: WebCodecsBufferSource;
};

type WebCodecsEncodedAudioChunkInit = {
    type: WebCodecsEncodedAudioChunkType;
    timestamp: number;
    duration?: number;
    data: WebCodecsBufferSource;
};

declare class AudioData {
    readonly numberOfChannels: number;
    readonly numberOfFrames: number;
    readonly sampleRate: number;

    copyTo(destination: Float32Array, options: WebCodecsAudioDataCopyToOptions): void;
    close(): void;
}

declare class EncodedAudioChunk {
    constructor(init: WebCodecsEncodedAudioChunkInit);
}

type WebCodecsAudioDecoderConstructor = {
    new(init: WebCodecsAudioDecoderInit): AudioDecoder;
    isConfigSupported?: (config: WebCodecsAudioDecoderConfig) => Promise<unknown>;
};

declare class AudioDecoder {
    constructor(init: WebCodecsAudioDecoderInit);

    readonly state: WebCodecsAudioDecoderState;

    configure(config: WebCodecsAudioDecoderConfig): void;
    decode(chunk: EncodedAudioChunk): void;
    flush(): Promise<void>;
    close(): void;
}

declare const AudioDecoder: WebCodecsAudioDecoderConstructor | undefined;
