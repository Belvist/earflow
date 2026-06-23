import { SignJWT } from 'jose';

export async function mintHs256AccessToken(params: {
    jwtSecret: string;
    userId: string;
    username?: string;
    ttlSeconds?: number;
}): Promise<string> {
    const secret = new TextEncoder().encode(params.jwtSecret);
    const ttlSeconds = Number.isFinite(params.ttlSeconds) && Number(params.ttlSeconds) > 0 ? Math.floor(Number(params.ttlSeconds)) : 60 * 60;

    const issuedAtSec = Math.floor(Date.now() / 1000);
    const expSec = issuedAtSec + ttlSeconds;

    return await new SignJWT({
        type: 'access',
        id: String(params.userId),
        userId: String(params.userId),
        sub: String(params.userId),
        username: typeof params.username === 'string' && params.username.trim() ? params.username.trim() : 'integration',
        iat: issuedAtSec,
        exp: expSec,
    })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .sign(secret);
}
