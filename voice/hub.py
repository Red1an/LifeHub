"""Связь с хабом: события по SSE, состояние и вопросы — POST-запросами."""

import json
import os
import queue
import ssl
import threading
import time
import urllib.error
import urllib.request

# Хаб недоступен столько секунд — выходим: значит, он закрылся, а голос без него не нужен.
HUB_GONE_SEC = 30


class Hub:
    def __init__(self, url: str, token: str, insecure: bool):
        self.url = url.rstrip("/")
        self.token = token
        self.ctx = ssl._create_unverified_context() if insecure else None
        self.events: "queue.Queue[dict]" = queue.Queue()
        self.connected = threading.Event()
        self._states: "queue.Queue[dict]" = queue.Queue()
        threading.Thread(target=self._stream, daemon=True).start()
        threading.Thread(target=self._state_sender, daemon=True).start()

    def _req(self, path: str, data: dict | None = None, timeout: float = 60):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else None
        req = urllib.request.Request(
            self.url + path,
            data=body,
            method="POST" if body is not None else "GET",
            headers={"content-type": "application/json", "x-voice-token": self.token, "x-lifehub": "1"},
        )
        return urllib.request.urlopen(req, timeout=timeout, context=self.ctx)

    def ask(self, text: str) -> dict:
        with self._req("/api/jarvis/voice/ask", {"text": text}, timeout=200) as r:
            return json.loads(r.read().decode("utf-8"))

    def state(self, **kw):
        """Сообщить хабу, что делаем. Не блокирует."""
        self._states.put(kw)

    def _state_sender(self):
        while True:
            kw = self._states.get()
            # Склеиваем пачку обновлений в одно.
            while not self._states.empty():
                kw.update(self._states.get())
            try:
                with self._req("/api/jarvis/voice/state", kw, timeout=10):
                    pass
            except urllib.error.HTTPError as e:
                if e.code == 409:
                    os._exit(0)
            except Exception:
                pass

    def _stream(self):
        last_ok = time.time()
        while True:
            try:
                with self._req("/api/jarvis/voice/stream", timeout=40) as r:
                    self.connected.set()
                    last_ok = time.time()
                    data = []
                    for raw in r:
                        last_ok = time.time()
                        line = raw.decode("utf-8").rstrip("\r\n")
                        if line.startswith("data:"):
                            data.append(line[5:].strip())
                        elif not line:
                            if data and data[0]:
                                try:
                                    self.events.put(json.loads("\n".join(data)))
                                except ValueError:
                                    pass
                            data = []
            except urllib.error.HTTPError as e:
                if e.code == 409:
                    print("Хаб запустил другой процесс голоса — выхожу", flush=True)
                    os._exit(0)
            except Exception:
                pass
            self.connected.clear()
            if time.time() - last_ok > HUB_GONE_SEC:
                print("Хаб недоступен — выхожу", flush=True)
                os._exit(0)
            time.sleep(2)
