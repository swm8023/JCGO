// This process fixture isolates GPU/model cost while exercising the real worker protocol.
package main

import (
	"bufio"
	"encoding/json"
	"os"
	"strconv"
	"time"
)

func main() {
	if path := os.Getenv("JCGO_TEST_CHILD_PID"); path != "" {
		_ = os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())), 0600)
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	for scanner.Scan() {
		var query struct {
			ID        string `json:"id"`
			MaxVisits int    `json:"maxVisits"`
		}
		if json.Unmarshal(scanner.Bytes(), &query) != nil {
			continue
		}
		if path := os.Getenv("JCGO_TEST_QUERY_STARTED"); path != "" {
			_ = os.WriteFile(path, []byte(query.ID), 0600)
		}
		if os.Getenv("JCGO_TEST_SLOW_ANALYSIS") == "1" {
			time.Sleep(30 * time.Second)
		}
		result := map[string]any{"id": query.ID, "rootInfo": map[string]any{"visits": query.MaxVisits, "winrate": 0.5, "scoreLead": 0}, "moveInfos": []map[string]any{{"move": "D4", "visits": query.MaxVisits, "winrate": 0.5, "scoreLead": 0, "order": 0, "pv": []string{"D4"}}}}
		_ = json.NewEncoder(os.Stdout).Encode(result)
	}
}
