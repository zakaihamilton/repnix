#!/usr/bin/env python3
"""Drive RepNix's intentionally interactive setup command through a real PTY."""

import errno
import os
import pty
import select
import signal
import sys
import time


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[2] not in {"--apply", "--no-changes"}:
        raise SystemExit("usage: drive-setup.py <repnix-bin> <--apply|--no-changes>")

    binary = sys.argv[1]
    should_apply = sys.argv[2] == "--apply"
    pid, terminal = pty.fork()
    if pid == 0:
        os.execve(binary, [binary, "setup"], os.environ)

    output = b""
    selected = False
    reviewed = False
    confirmed = False
    deadline = time.monotonic() + 600

    while True:
        if time.monotonic() >= deadline:
            os.kill(pid, signal.SIGTERM)
            os.waitpid(pid, 0)
            raise TimeoutError(output.decode(errors="replace"))

        readable, _, _ = select.select([terminal], [], [], 0.25)
        if not readable:
            completed, status = os.waitpid(pid, os.WNOHANG)
            if completed:
                return os.waitstatus_to_exitcode(status)
            continue

        try:
            chunk = os.read(terminal, 8192)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""

        if not chunk:
            _, status = os.waitpid(pid, 0)
            return os.waitstatus_to_exitcode(status)

        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()
        output += chunk
        prompt_text = bytes(character for character in output if 32 <= character <= 126).replace(b" ", b"").lower()

        if not selected and (b"selectproviders" in prompt_text or b"choosethecheckstoadd" in prompt_text):
            os.write(terminal, b"\r")
            selected = True
        if not reviewed and b"pressspacetoinspectthisfile." in prompt_text:
            os.write(terminal, b"\r")
            reviewed = True
        if should_apply and not confirmed and (b"applychanges?" in prompt_text or b"applythesereviewedchanges?" in prompt_text):
            os.write(terminal, b"\x1b[C\r")
            confirmed = True


if __name__ == "__main__":
    raise SystemExit(main())
