// Package tgcode implements one-time confirmation-code delivery through a
// Telegram bot (PEND-AUTH-002). Codes are sent via sendMessage and the
// message is automatically deleted after the code TTL so codes do not pile
// up in the user's chat.
package tgcode

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const defaultTimeout = 10 * time.Second

var (
	ErrDisabled = errors.New("telegram code delivery is disabled")
	ErrSend     = errors.New("telegram send failed")
	ErrDelete   = errors.New("telegram delete failed")
)

// Client is a minimal Telegram Bot API client used for code delivery.
type Client struct {
	botToken string
	httpc    *http.Client
}

func NewClient(botToken string) *Client {
	return &Client{
		botToken: botToken,
		httpc:    &http.Client{Timeout: defaultTimeout},
	}
}

// SetTransport overrides the HTTP transport (used in tests to stub the Bot API).
func (c *Client) SetTransport(rt http.RoundTripper) {
	if c.httpc != nil {
		c.httpc.Transport = rt
	}
}

// Enabled reports whether a bot token is configured.
func (c *Client) Enabled() bool {
	return c != nil && c.botToken != ""
}

type sendMessageResponse struct {
	OK     bool `json:"ok"`
	Result struct {
		MessageID int64 `json:"message_id"`
	} `json:"result"`
	Description string `json:"description"`
}

// SendCode delivers the code text to chatID and returns the message ID so the
// caller can schedule deletion after the code TTL.
func (c *Client) SendCode(ctx context.Context, chatID int64, text string) (int64, error) {
	if !c.Enabled() {
		return 0, ErrDisabled
	}
	payload, _ := json.Marshal(map[string]any{
		"chat_id":                  chatID,
		"text":                     text,
		"disable_notification":     true,
		"disable_web_page_preview": true,
	})
	body, status, err := c.do(ctx, "sendMessage", payload)
	if err != nil {
		return 0, fmt.Errorf("%w: %v", ErrSend, err)
	}
	var resp sendMessageResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return 0, fmt.Errorf("%w: decode response: %v", ErrSend, err)
	}
	if !resp.OK || status != http.StatusOK {
		return 0, fmt.Errorf("%w: http=%d %s", ErrSend, status, resp.Description)
	}
	return resp.Result.MessageID, nil
}

// DeleteMessage removes a previously sent message. It is idempotent: if the
// message no longer exists the bot returns ok=false but that is not an error
// worth surfacing.
func (c *Client) DeleteMessage(ctx context.Context, chatID, messageID int64) error {
	if !c.Enabled() {
		return nil
	}
	payload, _ := json.Marshal(map[string]any{
		"chat_id":    chatID,
		"message_id": messageID,
	})
	body, _, err := c.do(ctx, "deleteMessage", payload)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrDelete, err)
	}
	var resp struct {
		OK bool `json:"ok"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return fmt.Errorf("%w: decode response: %v", ErrDelete, err)
	}
	// ok=false (already deleted) is treated as success.
	return nil
}

func (c *Client) do(ctx context.Context, method string, payload []byte) ([]byte, int, error) {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/%s", c.botToken, method)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpc.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

// GenerateCode returns a numeric code of the given length using a CSPRNG.
func GenerateCode(length int) (string, error) {
	if length <= 0 {
		length = 6
	}
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	for i := range buf {
		buf[i] = byte('0' + (buf[i] % 10))
	}
	return string(buf), nil
}
