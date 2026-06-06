export const composeMiddlewares = (middlewares, terminal) => {
    const chain = Array.isArray(middlewares) ? middlewares.filter(Boolean) : [];
    const last = typeof terminal === 'function' ? terminal : async () => {
        throw new Error('HTTP_CLIENT_MISSING_TERMINAL');
    };

    return chain.reduceRight((next, mw) => {
        return async (ctx) => {
            return await mw(ctx, next);
        };
    }, last);
};
