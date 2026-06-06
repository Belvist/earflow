function parsePositiveInt(raw: string | undefined): number | null {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
}

export type IntegrationEnv = {
    gatewayBaseUrl: string;
    directStreamBaseUrl: string;
    adapterBaseUrl: string;
    partyBaseUrl: string;
    /** Party WebSocket (party-go gateway); public path is /ws/v2 via api-gateway, internal IT hits this port */
    partyGatewayBaseUrl: string;
    ebapBaseUrl: string;
    deliveryBaseUrl: string;
    origin: string;
    readyTrackId: number | null;
    notReadyTrackId: number | null;
    testUserId: string;
    hlsSignedUrls: boolean;
    hlsAssetTokenOnly: boolean;
    jwtSecret: string | null;
    gatewayCookie: string | null;
    csrfToken: string | null;
};

export function loadIntegrationEnv(): IntegrationEnv {
    const gatewayBaseUrl = (process.env.IT_GATEWAY_BASE_URL || 'http://api-gateway:3000').trim();
    const directStreamBaseUrl = (process.env.IT_DIRECT_STREAM_BASE_URL || 'http://direct-stream-service:3096').trim();
    const adapterBaseUrl = (process.env.IT_ADAPTER_BASE_URL || 'http://ebap-hls-adapter:3095').trim();
    const partyBaseUrl = (process.env.IT_PARTY_BASE_URL || 'http://party-state-service:3130').trim();
    const partyGatewayBaseUrl = (process.env.IT_PARTY_GATEWAY_URL || 'http://party-gateway-service:3131').trim();
    const ebapBaseUrl = (process.env.IT_EBAP_BASE_URL || '').trim();
    const deliveryBaseUrl = (process.env.IT_DELIVERY_BASE_URL || '').trim();
    const origin = (process.env.IT_ORIGIN || 'https://earflow.ru').trim();

    const readyTrackId = parsePositiveInt(process.env.IT_TRACK_READY_ID);
    const notReadyTrackId = parsePositiveInt(process.env.IT_TRACK_NOT_READY_ID);
    const testUserId = (process.env.IT_TEST_USER_ID || '1').trim();
    const hlsSignedUrlsRaw = (process.env.IT_HLS_SIGNED_URLS || '').trim();
    const hlsSignedUrls = ['1', 'true', 'yes'].includes(hlsSignedUrlsRaw.toLowerCase());
    const hlsAssetTokenOnlyRaw = (process.env.IT_HLS_ASSET_TOKEN_ONLY || '').trim();
    const hlsAssetTokenOnly = ['1', 'true', 'yes'].includes(hlsAssetTokenOnlyRaw.toLowerCase());

    const jwtSecret = (process.env.JWT_SECRET || '').trim();

    const gatewayCookie = (process.env.IT_GATEWAY_COOKIE || '').trim();
    const csrfToken = (process.env.IT_CSRF_TOKEN || '').trim();

    if (!gatewayBaseUrl) throw new Error('IT_GATEWAY_BASE_URL is required');
    if (!directStreamBaseUrl) throw new Error('IT_DIRECT_STREAM_BASE_URL is required');
    if (!adapterBaseUrl) throw new Error('IT_ADAPTER_BASE_URL is required');
    if (!partyBaseUrl) throw new Error('IT_PARTY_BASE_URL is required');
    if (!partyGatewayBaseUrl) throw new Error('IT_PARTY_GATEWAY_URL is required');
    if (!origin) throw new Error('IT_ORIGIN is required');
    if (!testUserId) throw new Error('IT_TEST_USER_ID is required');

    return {
        gatewayBaseUrl,
        directStreamBaseUrl,
        adapterBaseUrl,
        partyBaseUrl,
        partyGatewayBaseUrl,
        ebapBaseUrl: ebapBaseUrl || 'disabled',
        deliveryBaseUrl: deliveryBaseUrl || adapterBaseUrl,
        origin,
        readyTrackId,
        notReadyTrackId,
        testUserId,
        hlsSignedUrls,
        hlsAssetTokenOnly,
        jwtSecret: jwtSecret || null,
        gatewayCookie: gatewayCookie || null,
        csrfToken: csrfToken || null,
    };
}
