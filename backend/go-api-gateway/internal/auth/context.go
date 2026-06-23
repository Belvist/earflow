package auth

import "context"

func IsAdmin(ctx context.Context) bool {
	v := ctx.Value(ctxIsAdmin)
	b, ok := v.(bool)
	return ok && b
}
