package main

import (
	"os/exec"
	"syscall"
)

// Video tools inherit the desktop host's job object and never flash a console.
func configureNativeCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
