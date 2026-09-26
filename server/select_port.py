"""Choose a localhost port so launching a new release never opens an old server."""

import socket

for candidate in range(43121, 43221):
    with socket.socket() as listener:
        try:
            listener.bind(("127.0.0.1", candidate))
        except OSError:
            continue
        print(candidate)
        break
else:
    raise SystemExit("No available localhost port for Flow2Short")
