// Command auth-pg-backfill copies active auth session metadata from Redis into Postgres SoT.
// PEND-SEC-011 — run on server after migration 003, before AUTH_PG_SOT_MODE=dual_write.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/earflow/music-platform/security-service/internal/config"
	"github.com/earflow/music-platform/security-service/internal/store"
	"github.com/earflow/music-platform/security-service/internal/store/authpg"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	pg, err := store.NewPostgres(ctx, cfg.Postgres)
	if err != nil {
		log.Fatal(err)
	}
	defer pg.Close()

	rd, err := store.NewRedis(ctx, cfg.Redis)
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = rd.Close() }()

	authStore := authpg.NewStore(pg.Pool())
	rdb := rd.Client()
	dryRun := strings.EqualFold(strings.TrimSpace(os.Getenv("AUTH_PG_BACKFILL_DRY_RUN")), "1") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("AUTH_PG_BACKFILL_DRY_RUN")), "true")
	if dryRun {
		log.Println("DRY RUN — no Postgres writes")
	}

	users, err := rdb.Keys(ctx, "auth:user_sids:*").Result()
	if err != nil {
		log.Fatal(err)
	}

	var sessionsSeen, sessionsWritten, sessionErrors, devicesSeen, devicesWritten, deviceErrors int
	for _, userKey := range users {
		userID, ok := parseUserIDKey(userKey)
		if !ok {
			continue
		}
		sids, err := rdb.SMembers(ctx, userKey).Result()
		if err != nil {
			log.Printf("skip user %d: %v", userID, err)
			continue
		}
		for _, sid := range sids {
			sid = strings.TrimSpace(sid)
			if sid == "" {
				continue
			}
			jti, _ := rdb.Get(ctx, "auth:sid:"+sid).Result()
			metaRaw, _ := rdb.Get(ctx, "auth:session:meta:"+sid).Result()
			var ip, ua string
			if metaRaw != "" {
				var meta struct {
					IP string `json:"ip"`
					UA string `json:"ua"`
				}
				_ = json.Unmarshal([]byte(metaRaw), &meta)
				ip, ua = meta.IP, meta.UA
			}
			sessionsSeen++
			if !dryRun {
				if err := authStore.UpsertSession(ctx, authpg.SessionUpsertParams{
					SID: sid, UserID: userID, RefreshJTI: strings.TrimSpace(jti), IP: ip, UserAgent: ua,
				}); err != nil {
					sessionErrors++
					log.Printf("session upsert sid=%s: %v", sid, err)
					continue
				}
				sessionsWritten++
			}

			devIDs, _ := rdb.SMembers(ctx, "auth:sid_devices:"+sid).Result()
			for _, devID := range devIDs {
				devID = strings.TrimSpace(devID)
				if devID == "" {
					continue
				}
				raw, err := rdb.Get(ctx, "auth:device:"+devID).Result()
				if err != nil || raw == "" {
					continue
				}
				var rec struct {
					PublicKeySPKI string `json:"publicKeySpki"`
					UA            string `json:"ua"`
				}
				if json.Unmarshal([]byte(raw), &rec) != nil || rec.PublicKeySPKI == "" {
					continue
				}
				devicesSeen++
				if !dryRun {
					if err := authStore.UpsertDevice(ctx, authpg.DeviceUpsertParams{
						AuthDeviceID: devID, SID: sid, UserID: userID,
						PublicKeySPKI: rec.PublicKeySPKI, UserAgent: rec.UA,
					}); err != nil {
						deviceErrors++
						log.Printf("device upsert %s: %v", devID, err)
						continue
					}
					devicesWritten++
				}
			}
		}
	}

	if dryRun {
		fmt.Printf("backfill done (dry): sessions=%d devices=%d\n", sessionsSeen, devicesSeen)
		return
	}

	fmt.Printf("backfill done: sessions=%d written=%d errors=%d devices=%d written=%d errors=%d\n",
		sessionsSeen, sessionsWritten, sessionErrors, devicesSeen, devicesWritten, deviceErrors)
	if sessionsSeen > 0 && sessionsWritten == 0 {
		log.Fatal("backfill failed: 0 sessions written")
	}
	if sessionErrors > 0 {
		log.Fatalf("backfill failed: %d session upsert errors", sessionErrors)
	}
}

func parseUserIDKey(key string) (int64, bool) {
	const prefix = "auth:user_sids:"
	if !strings.HasPrefix(key, prefix) {
		return 0, false
	}
	n, err := strconv.ParseInt(strings.TrimPrefix(key, prefix), 10, 64)
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}
