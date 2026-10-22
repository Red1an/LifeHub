"""
Окна Джарвиса на рабочем столе (pywebview → WebView2, тот же движок, что у Edge).

  орб    — прозрачное окно поверх всех: сфера из частиц, что услышал, что ответил.
           Не забирает фокус. Появляется на разговор (или висит всегда — настройка).
  панель — модуль «Джарвис» хаба в отдельном окне: разговор, голос, команды, настройки.
  трей   — значок у часов: панель, орб, микрофон, режим ожидания.

Окна живут в главном потоке (так требует WinForms), голос — в рабочем.
"""

import json
import os
import threading
import time

import webview

HERE = os.path.dirname(os.path.abspath(__file__))
ORB_W, ORB_H = 300, 400


class Api:
    """Вызовы из страницы орба: window.pywebview.api.*"""

    def __init__(self, ui: "Ui"):
        self._ui = ui

    def open_panel(self):
        self._ui.open_panel()

    def hide_orb(self):
        # Крестик: замолчать и спрятаться.
        self._ui.on_tray("stop")
        self._ui.hide(now=True)


class Ui:
    def __init__(self, hub_url: str, mode: str, pos: str, on_tray=None):
        self.hub_url = hub_url.rstrip("/")
        self.mode = mode  # talk | always
        self.pos = pos  # br | bl | tc
        self.on_tray = on_tray or (lambda action: None)
        self.orb = None
        self.panel = None
        self.ready = threading.Event()
        self.visible = False
        self._hide_timer: threading.Timer | None = None
        self._last_level = 0.0
        self._tray = None
        self.h = ORB_H
        self.tray_state = {"muted": False, "sleeping": False}

    # ───────────── запуск ─────────────

    def start(self, worker):
        """Блокирует главный поток: окна. worker — голос, в своём потоке."""
        self.orb = webview.create_window(
            "Джарвис",
            html=open(os.path.join(HERE, "ui", "orb.html"), encoding="utf-8").read(),
            js_api=Api(self),
            width=ORB_W,
            height=ORB_H,
            x=0,
            y=0,
            frameless=True,
            easy_drag=False,
            transparent=False,
            on_top=True,
            focus=False,
            hidden=True,
            resizable=False,
            background_color="#04080D",
        )
        self.orb.events.loaded += lambda: self._on_loaded()
        # Панель создаём сразу, скрытой: из других потоков (трей, голос) создавать окна нельзя.
        # Страница хаба грузится при первом открытии, крестик окно только прячет.
        self.panel = webview.create_window(
            "Джарвис",
            html="<body style='background:#071019'></body>",
            width=1120,
            height=780,
            min_size=(380, 520),
            background_color="#071019",
            hidden=True,
        )
        self.panel.events.closing += self._panel_closing
        self._panel_loaded = False
        threading.Thread(target=self._tray_loop, daemon=True).start()
        base = os.path.join(os.path.expanduser("~"), ".lifehub", "voice")
        icon = os.path.join(base, "jarvis.ico")
        try:
            import ctypes

            # Своя группа на панели задач — «Джарвис» со своим значком, а не «Python».
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("LifeHub.Jarvis")
            os.makedirs(base, exist_ok=True)
            self._icon_image().save(icon, sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
        except Exception as e:
            print(f"Значок не создался: {e}", flush=True)
        webview.start(worker, private_mode=False, storage_path=os.path.join(base, "webview"), icon=icon if os.path.exists(icon) else None)

    def _on_loaded(self):
        self._round()
        self._place()
        self.ready.set()
        if self.mode == "always":
            self.show()

    def _round(self):
        """Скруглённые углы Windows 11; орб — служебное окно: без кнопки на панели задач и в Alt+Tab."""
        try:
            import ctypes

            hwnd = self.orb.native.Handle.ToInt32()
            pref = ctypes.c_int(2)  # DWMWCP_ROUND
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(pref), ctypes.sizeof(pref))
            u = ctypes.windll.user32
            ex = u.GetWindowLongW(hwnd, -20)
            u.SetWindowLongW(hwnd, -20, (ex | 0x80) & ~0x40000)  # WS_EX_TOOLWINDOW, без WS_EX_APPWINDOW
        except Exception as e:
            print(f"Окно орба не настроилось: {e}", flush=True)

    def _place(self):
        try:
            s = webview.screens[0]
            sw, sh = s.width, s.height
        except Exception:
            sw, sh = 1920, 1080
        if self.pos == "tc":
            x, y = (sw - ORB_W) // 2, 24
        elif self.pos == "bl":
            x, y = 16, sh - self.h - 60
        else:
            x, y = sw - ORB_W - 16, sh - self.h - 60
        self.orb.move(x, y)

    def js(self, code: str):
        if not self.ready.is_set() or not self.orb:
            return
        try:
            self.orb.run_js(code)
        except Exception:
            pass

    # ───────────── орб ─────────────

    def show(self):
        if self._hide_timer:
            self._hide_timer.cancel()
            self._hide_timer = None
        if not self.ready.is_set():
            return
        if not self.visible:
            self.visible = True
            self.orb.show()
            self.js("jv.visible(true)")

    def hide(self, now=False, after: float = 0):
        if self.mode == "always" and not now:
            return
        if self._hide_timer:
            self._hide_timer.cancel()
        if after > 0:
            self._hide_timer = threading.Timer(after, self.hide, kwargs={"now": now})
            self._hide_timer.daemon = True
            self._hide_timer.start()
            return
        if not self.visible:
            return
        self.visible = False
        self.js("jv.visible(false)")
        threading.Timer(0.32, lambda: (not self.visible) and self.orb.hide()).start()

    def state(self, st: str, label: str | None = None):
        self.js(f"jv.state({json.dumps(st)}, {json.dumps(label)})")

    def level(self, x: float):
        # Не чаще ~30 раз в секунду и только когда орб виден.
        if not self.visible:
            return
        now = time.monotonic()
        if now - self._last_level < 0.033:
            return
        self._last_level = now
        self.js(f"jv.level({x:.3f})")

    def heard(self, text: str):
        self.js(f"jv.heard({json.dumps(text)})")

    def answer(self, text: str, duration: float = 0):
        self.js(f"jv.answer({json.dumps(text)}, {duration:.1f})")

    def clear(self):
        self.js("jv.clear()")

    # ───────────── панель ─────────────

    def open_panel(self):
        try:
            if not self._panel_loaded:
                self._panel_loaded = True
                self.panel.load_url(self.hub_url + "/m/jarvis")
            self.panel.show()
            self.panel.restore()
            self._front(self.panel)
        except Exception as e:
            print(f"Панель не открылась: {e}", flush=True)

    def _panel_closing(self):
        # Крестик прячет панель, а не закрывает: заново создать окно из другого потока нельзя.
        threading.Thread(target=self.panel.hide, daemon=True).start()
        return False

    @staticmethod
    def _front(w):
        """Windows не отдаёт фокус фоновому процессу — короткое нажатие Alt снимает запрет."""
        try:
            import ctypes

            hwnd = w.native.Handle.ToInt32()
            u = ctypes.windll.user32
            u.keybd_event(0x12, 0, 0, 0)
            u.keybd_event(0x12, 0, 2, 0)
            u.ShowWindow(hwnd, 9)
            u.SetForegroundWindow(hwnd)
        except Exception as e:
            print(f"Окно не вышло на передний план: {e}", flush=True)

    # ───────────── трей ─────────────

    def _icon_image(self):
        from PIL import Image, ImageDraw, ImageFilter

        size = 64
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(glow)
        d.ellipse((10, 10, 54, 54), outline=(90, 209, 255, 255), width=6)
        glow = glow.filter(ImageFilter.GaussianBlur(3))
        img.alpha_composite(glow)
        d = ImageDraw.Draw(img)
        d.ellipse((12, 12, 52, 52), outline=(170, 235, 255, 255), width=3)
        d.ellipse((25, 25, 39, 39), fill=(230, 250, 255, 255))
        return img

    def _tray_loop(self):
        try:
            import pystray
        except Exception:
            return
        item = pystray.MenuItem
        menu = pystray.Menu(
            item("Открыть панель", lambda: self.open_panel(), default=True),
            item("Показать орб", lambda: self.show()),
            pystray.Menu.SEPARATOR,
            item("Микрофон выключен", lambda: self.on_tray("mute"), checked=lambda i: self.tray_state["muted"]),
            item("Режим ожидания", lambda: self.on_tray("sleep"), checked=lambda i: self.tray_state["sleeping"]),
            pystray.Menu.SEPARATOR,
            item("Перезапустить голос", lambda: self.on_tray("restart")),
        )
        self._tray = pystray.Icon("jarvis", self._icon_image(), "Джарвис", menu)
        self._tray.run()

    def update_tray(self, muted: bool, sleeping: bool):
        self.tray_state.update(muted=muted, sleeping=sleeping)
        if self._tray:
            try:
                self._tray.update_menu()
            except Exception:
                pass
