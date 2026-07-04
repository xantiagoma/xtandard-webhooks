// A net/http receiver verifying with the OFFICIAL Standard Webhooks Go library.
//
//	go mod tidy && go run .          # listens on :8000
//	PORT=8100 go run .
//
// Then, from ../: `bun run send.ts` (RECEIVER_URL defaults to :8000/webhook).
//
// The secret is the Standard Webhooks spec's example value; the sender pins
// its endpoint to the same one. NewWebhook expects the base64 part (no
// `whsec_` prefix), like Svix's.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	standardwebhooks "github.com/standard-webhooks/standard-webhooks/libraries/go"
)

func main() {
	secret := os.Getenv("WEBHOOK_SECRET")
	if secret == "" {
		secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
	}
	wh, err := standardwebhooks.NewWebhook(strings.TrimPrefix(secret, "whsec_"))
	if err != nil {
		log.Fatalf("bad secret: %v", err)
	}

	http.HandleFunc("/webhook", func(w http.ResponseWriter, r *http.Request) {
		payload, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read error", http.StatusBadRequest)
			return
		}
		if err := wh.Verify(payload, r.Header); err != nil {
			log.Printf("REJECTED: %v", err)
			http.Error(w, "invalid signature", http.StatusUnauthorized)
			return
		}
		var envelope struct {
			Type      string          `json:"type"`
			Timestamp string          `json:"timestamp"`
			Data      json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(payload, &envelope); err != nil {
			http.Error(w, "invalid envelope", http.StatusBadRequest)
			return
		}
		log.Printf("verified %s: %s", envelope.Type, envelope.Data)
		fmt.Fprint(w, `{"ok":true}`)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}
	log.Printf("Go receiver on http://127.0.0.1:%s/webhook", port)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, nil))
}
