package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"reco-feedback-worker/internal/config"
)

type Pool struct {
	pool *pgxpool.Pool
	cfg  config.Config
}

func New(cfg config.Config) (*Pool, error) {
	dsn := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s",
		urlEscape(cfg.DB.User),
		urlEscape(cfg.DB.Password),
		cfg.DB.Host,
		cfg.DB.Port,
		cfg.DB.Name,
	)
	if !cfg.DB.Prepare {
		dsn += "?default_query_exec_mode=simple_protocol"
	}

	pcfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}

	pcfg.MaxConns = cfg.DB.MaxConns
	pcfg.MaxConnIdleTime = 30 * time.Second
	pcfg.MaxConnLifetime = 30 * time.Minute
	pcfg.MinConns = 0
	pcfg.ConnConfig.ConnectTimeout = cfg.DB.ConnTimeout

	pool, err := pgxpool.NewWithConfig(context.Background(), pcfg)
	if err != nil {
		return nil, err
	}

	return &Pool{pool: pool, cfg: cfg}, nil
}

func (p *Pool) Close() {
	p.pool.Close()
}

func (p *Pool) Ping(ctx context.Context) error {
	c, err := p.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer c.Release()
	_, err = c.Exec(ctx, "SELECT 1")
	return err
}

func urlEscape(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		b := s[i]
		if (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '-' || b == '_' || b == '.' || b == '~' {
			out = append(out, b)
		} else {
			hex := "0123456789ABCDEF"
			out = append(out, '%', hex[b>>4], hex[b&15])
		}
	}
	return string(out)
}
