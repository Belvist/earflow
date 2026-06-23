export const createTelegramAuthMiddleware = () => {
    return async (ctx, next) => {
        return await next(ctx);
    };
};
