package managed

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Ownership struct {
	Role    string `json:"role"`
	Managed bool   `json:"managed"`
}

type Instance struct{ file *os.File }

func Acquire(dir, role string, managed bool) (*Instance, error) {
	if role != "server" && role != "worker" {
		return nil, fmt.Errorf("invalid runtime role")
	}
	path := filepath.Join(dir, "run", role+".lock")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = lock(file); err != nil {
		file.Close()
		return nil, fmt.Errorf("JCGO %s already running for this data directory", role)
	}
	data, _ := json.Marshal(Ownership{Role: role, Managed: managed})
	if err = file.Truncate(0); err == nil {
		_, err = file.WriteAt(append(data, '\n'), 0)
	}
	if err != nil {
		unlock(file)
		file.Close()
		return nil, err
	}
	return &Instance{file: file}, nil
}

func (i *Instance) Close() {
	if i != nil && i.file != nil {
		_ = unlock(i.file)
		_ = i.file.Close()
		i.file = nil
	}
}

// CheckMaintenance trusts the live OS lock, never a recorded PID or stale marker.
func CheckMaintenance(dir string) error {
	for _, role := range []string{"server", "worker"} {
		file, err := os.OpenFile(filepath.Join(dir, "run", role+".lock"), os.O_RDWR, 0600)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if err = lock(file); err == nil {
			_ = unlock(file)
			file.Close()
			continue
		}
		var owner Ownership
		decodeErr := json.NewDecoder(file).Decode(&owner)
		file.Close()
		if decodeErr != nil || owner.Role != role || owner.Managed {
			return fmt.Errorf("JCGO %s is managed by WheelMaker; stop it in Hub Monitor before maintenance", role)
		}
	}
	return nil
}
