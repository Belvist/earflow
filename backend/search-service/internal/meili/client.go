package meili

import (
	"net"
	"net/http"
	"time"

	"github.com/earflow/music-platform/search-service/internal/config"
	"github.com/meilisearch/meilisearch-go"
)

type Client struct {
	raw     meilisearch.ServiceManager
	indexes config.IndexNames
}

func New(cfg config.MeiliConfig) *Client {
	tr := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: 5 * time.Second,
	}
	h := http.Client{Timeout: 10 * time.Second, Transport: tr}
	raw := meilisearch.New(cfg.URL, meilisearch.WithAPIKey(cfg.APIKey), meilisearch.WithCustomClient(&h))
	return &Client{raw: raw, indexes: cfg.Indexes}
}

func (c *Client) Raw() meilisearch.ServiceManager { return c.raw }

func (c *Client) IndexTracks() meilisearch.IndexManager { return c.raw.Index(c.indexes.Tracks) }

func (c *Client) IndexArtists() meilisearch.IndexManager { return c.raw.Index(c.indexes.Artists) }

func (c *Client) IndexAlbums() meilisearch.IndexManager { return c.raw.Index(c.indexes.Albums) }

func (c *Client) IndexNames() config.IndexNames { return c.indexes }
