//go:build !windows

package main

import "os/exec"

func configureNativeCommand(command *exec.Cmd) {}
